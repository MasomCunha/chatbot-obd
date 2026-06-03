// Verificação do RAG sobre o índice REAL (data/index.json).
// Testa o contrato fiável: perguntas dentro do tema passam o gate; perguntas
// fora do tema ficam abaixo do threshold (resposta "fora do contexto").
// NOTA: os embeddings passaram a usar a API do Google, por isso este script já
// precisa da GOOGLE_GENERATIVE_AI_API_KEY (.env.local) e de rede.
import "./_env.ts"; // carrega .env.local — tem de vir primeiro
import { embed } from "../lib/embeddings.ts";
import { search } from "../lib/vector-store.ts";
import { RELEVANCE_THRESHOLD, buildRetrievalQuery } from "../lib/prompt.ts";

let falhas = 0;

// `retrievalText` é o que vai ao embedding/busca (pode incluir histórico para
// simular seguimentos); `question` é só o rótulo mostrado.
async function run(
  label: "DENTRO" | "FORA",
  question: string,
  retrievalText: string = question
) {
  const { results, maxScore, maxLex, lexicalRescue } = search(
    await embed(retrievalText),
    retrievalText,
    8
  );
  // Gate HÍBRIDO: relevância densa OU resgate lexical específico.
  const passa =
    results.length > 0 && (maxScore >= RELEVANCE_THRESHOLD || lexicalRescue);
  const ok = label === "DENTRO" ? passa : !passa;
  if (!ok) falhas++;
  console.log(`\n[${label}] "${question}"`);
  console.log(
    `  maxScore=${maxScore.toFixed(3)} maxLex=${maxLex.toFixed(2)} rescue=${lexicalRescue} -> ${passa ? "PASSA gate" : "fora do contexto"}  ${ok ? "✅" : "❌"}`
  );
  results.slice(0, 3).forEach((r, i) =>
    console.log(`   #${i + 1} cos=${r.score.toFixed(3)} lex=${r.lex.toFixed(2)} ph=${r.phraseHits} sp=${r.specificHits}: ${r.text.slice(0, 70).replace(/\s+/g, " ")}`)
  );
}

console.log(`THRESHOLD = ${RELEVANCE_THRESHOLD}`);
await run("DENTRO", "Quantos pontos vale o exercicio de Junto na Classe 2?");
await run("DENTRO", "Quanto tempo dura o deitado em grupo na classe 2?");
await run("DENTRO", "O que acontece se o cao ladrar durante o exercicio?");
// Perguntas simples/coloquiais que antes eram (erradamente) rejeitadas.
await run("DENTRO", "Quanto necessito para ter excelente?");
await run("DENTRO", "O que acontece quando tenho amarelo?");
await run("DENTRO", "O que acontece quando tenho vermelho?");
// Pergunta de SEGUIMENTO (pronome) — sozinha cairia em "fora do contexto", mas
// com o histórico da troca anterior o retrieval herda o referente (cartões).
await run(
  "DENTRO",
  "que significam? (seguimento de 'que cartoes conheces?')",
  buildRetrievalQuery([
    { role: "user", content: "que cartoes conheces?" },
    {
      role: "assistant",
      content:
        "Os cartões conhecidos são o cartão amarelo e o cartão vermelho.",
    },
    { role: "user", content: "que significam?" },
  ])
);
await run("FORA", "Qual e a melhor receita de bacalhau a bras?");
await run("FORA", "Quem ganhou o campeonato do mundo de futebol em 2022?");

console.log(`\n${falhas === 0 ? "PASS ✅ — gate dentro/fora do contexto correto" : `FALHA ❌ (${falhas})`}`);
process.exit(falhas === 0 ? 0 : 1);
