import { google } from "@ai-sdk/google";
import { streamText, formatDataStreamPart, type CoreMessage } from "ai";

import { embed } from "@/lib/embeddings";
import { search } from "@/lib/vector-store";
import {
  SYSTEM_PROMPT,
  NO_ANSWER_MESSAGE,
  RELEVANCE_THRESHOLD,
  buildContextPrompt,
} from "@/lib/prompt";

// transformers.js e o ficheiro de índice precisam do runtime Node, não do Edge.
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages }: { messages: CoreMessage[] } = await req.json();

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const question =
    typeof lastUser?.content === "string"
      ? lastUser.content
      : Array.isArray(lastUser?.content)
        ? lastUser.content
            .map((p) => ("text" in p ? p.text : ""))
            .join(" ")
        : "";

  if (!question.trim()) {
    return new Response("Pergunta vazia.", { status: 400 });
  }

  // 1. Retrieval híbrido: embedding da pergunta + busca semântica + lexical.
  const queryEmbedding = await embed(question);
  const { results, maxScore, lexicalRescue } = search(queryEmbedding, question, 8);

  // 2. Guarda-rede HÍBRIDA: passa o gate se houver relevância densa (cosine) OU
  // uma correspondência lexical específica (resgata perguntas curtas/coloquiais
  // com palavras-chave exatas, ex.: "tenho amarelo?"). Se nada for relevante,
  // responde "fora do contexto" sem chamar o LLM (poupa uma chamada e funciona
  // mesmo sem API key). O SYSTEM_PROMPT é a guarda final do "não sei".
  const passes =
    results.length > 0 && (maxScore >= RELEVANCE_THRESHOLD || lexicalRescue);
  if (!passes) {
    const body = formatDataStreamPart("text", NO_ANSWER_MESSAGE);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "x-vercel-ai-data-stream": "v1",
      },
    });
  }

  // 3. Monta o prompt com contexto e deixa o histórico para coerência.
  const history = messages.filter((m) => m.role !== "system");
  history[history.length - 1] = {
    role: "user",
    content: buildContextPrompt(question, results),
  };

  const result = streamText({
    model: google("gemini-2.5-flash"),
    system: SYSTEM_PROMPT,
    messages: history,
  });

  // Converte erros do provider numa mensagem legível (em vez de silêncio na UI).
  return result.toDataStreamResponse({
    getErrorMessage: (error) => {
      const msg = error instanceof Error ? error.message : String(error);
      if (/quota|rate|429|exceed|limit|resource.?exhausted/i.test(msg)) {
        return "⚠️ Limite de pedidos do Gemini (tier gratuito) atingido. Espera um pouco (cerca de 1 minuto) e tenta novamente.";
      }
      return "⚠️ Ocorreu um erro ao gerar a resposta. Tenta novamente.";
    },
  });
}
