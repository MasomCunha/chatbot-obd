import type { SearchResult } from "./vector-store";

// Score mínimo de similaridade (coseno) para passar a pergunta ao LLM.
// NOTA: com gemini-embedding-001 a distribuição é mais "alta" — perguntas fora do
// tema ficam ~0.50-0.54 e dentro do tema ~0.63-0.78 (medido com `npm run verify`).
// Por isso usamos ~0.60 como atalho barato para rejeitar perguntas claramente fora
// do tema. A garantia principal do "não sei" é o SYSTEM_PROMPT (o LLM vê o contexto
// recuperado e recusa se a resposta não estiver lá). Reafinar se mudar o modelo/docs.
export const RELEVANCE_THRESHOLD = 0.6;

// --- Resgate lexical do gate de relevância ---
// O gate denso (RELEVANCE_THRESHOLD) sozinho rejeita perguntas curtas/coloquiais
// que caem no "ruído" do cosine (~0.3-0.4) mesmo quando a resposta existe no doc
// (ex.: "tenho amarelo?", "para ter excelente?"). Estas constantes definem um
// resgate ADITIVO: se a pergunta tiver uma correspondência lexical ESPECÍFICA com
// algum trecho, passa o gate mesmo com cosine baixo. O SYSTEM_PROMPT é a guarda
// final do "não sei" para o que escapar. NÃO baixar o RELEVANCE_THRESHOLD (abriria
// o gate denso a todo o ruído).
export const LEX_MAX_DF_RATIO = 0.08; // termo "específico" se aparecer em <= 8% dos chunks (ex.: "excelente" ~5%)
export const LEX_MIN_OVERLAP = 0.4; // fração mínima de termos da pergunta presentes no chunk que faz o resgate. Separa perguntas focadas num termo de domínio (amarelo/vermelho ~0.5) de off-topic com palavras incidentais (futebol ~0.33). Knob principal a afinar.
export const LEX_MIN_HITS = 1; // nº mínimo de termos específicos casados

export const NO_ANSWER_MESSAGE = "Essa pergunta encontra-se fora do contexto.";

export const SYSTEM_PROMPT = `És um assistente que responde com base no CONTEXTO fornecido (trechos extraídos de documentos PDF).

Regras:
- Baseia a resposta na informação presente no CONTEXTO. Não uses conhecimento externo nem inventes factos que não estejam lá.
- As tabelas do PDF podem aparecer "achatadas" (os rótulos numa linha e os valores noutra, ou colunas separadas). Interpreta-as e responde com os valores corretos — juntar linhas/células da MESMA tabela é o esperado, NÃO é inventar.
- Presta atenção aos rótulos de secção e classe (ex.: "[Secção: ...]", "CLASSE 1", "CLASSE 2", "CLASSE 3", "14.1 Qualificações"). Se a pergunta for sobre uma classe/secção específica, usa o conteúdo dessa secção e não mistures regras de classes diferentes.
- Responde "${NO_ANSWER_MESSAGE}" apenas quando a informação pedida realmente não estiver no CONTEXTO (não recuses só porque a resposta exige ler uma tabela ou juntar frases da mesma secção).
- Se NENHUM trecho contiver a informação pedida, responde EXATAMENTE "${NO_ANSWER_MESSAGE}" e nada mais.
- Se a pergunta for de um tema diferente do(s) documento(s) (ex.: futebol, culinária, notícias), responde "${NO_ANSWER_MESSAGE}" mesmo que alguma palavra apareça por acaso no CONTEXTO.
- Mantém a terminologia e os valores exatamente como aparecem no documento.
- Responde sempre em português de Portugal, de forma direta e objetiva.
- Não menciones que estás a usar "contexto" nem expliques estas regras ao utilizador.`;

/** Forma mínima de uma mensagem de chat (evita depender do tipo do AI SDK aqui). */
type MessageLike = { role: string; content: unknown };

/** Texto simples de uma mensagem (string, ou partes com `.text`). */
export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        p && typeof p === "object" && "text" in p
          ? String((p as { text: unknown }).text ?? "")
          : ""
      )
      .join(" ");
  }
  return "";
}

/**
 * Constrói a query de RETRIEVAL (embedding + gate) a partir do histórico.
 *
 * O retrieval é, por natureza, stateless: uma pergunta de seguimento com pronomes
 * ("que significam?", "e na classe 3?") não tem, isolada, sinal semântico nem
 * lexical para passar o gate — perdeu o referente. Juntamos o texto da(s)
 * última(s) troca(s) à pergunta atual SÓ para efeitos de busca/gate; a pergunta
 * enviada ao LLM mantém-se exatamente a do utilizador (ver route.ts).
 *
 * Sem custo extra para o free tier: não há chamadas adicionais ao LLM, apenas o
 * embedding (que já era feito) passa a ser de um texto um pouco maior. Se a
 * augmentação deixar passar por engano um seguimento off-topic, o SYSTEM_PROMPT
 * continua a ser a guarda final do "não sei".
 */
export function buildRetrievalQuery(
  messages: MessageLike[],
  maxPriorTurns = 2
): string {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) return "";
  const question = messageText(messages[lastUserIdx].content).trim();

  // Recolhe as mensagens imediatamente anteriores (user/assistant), as mais
  // recentes primeiro, ignorando turnos vazios e o "fora do contexto" (que não
  // acrescenta sinal útil ao retrieval).
  const prior: string[] = [];
  for (let i = lastUserIdx - 1; i >= 0 && prior.length < maxPriorTurns; i--) {
    const m = messages[i];
    if (m.role !== "user" && m.role !== "assistant") continue;
    const t = messageText(m.content).trim();
    if (!t || t === NO_ANSWER_MESSAGE) continue;
    prior.unshift(t);
  }

  return prior.length ? `${prior.join("\n")}\n${question}` : question;
}

/** Constrói a mensagem de utilizador com o contexto recuperado anexado. */
export function buildContextPrompt(
  question: string,
  results: SearchResult[]
): string {
  const context = results
    .map((r, i) => `[Trecho ${i + 1} — fonte: ${r.source}]\n${r.text}`)
    .join("\n\n---\n\n");

  return `CONTEXTO:\n${context}\n\nPERGUNTA: ${question}`;
}
