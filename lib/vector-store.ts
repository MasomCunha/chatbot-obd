import fs from "node:fs";
import path from "node:path";

import {
  LEX_MAX_DF_RATIO,
  LEX_MIN_OVERLAP,
  LEX_MIN_HITS,
} from "./prompt";

export interface IndexedChunk {
  text: string;
  source: string;
  embedding: number[];
}

export const INDEX_PATH = path.join(process.cwd(), "data", "index.json");

let cache: IndexedChunk[] | null = null;
let docFreqCache: { df: Map<string, number>; n: number } | null = null;

/** Carrega o índice de embeddings (data/index.json) para memória, com cache. */
export function loadIndex(): IndexedChunk[] {
  if (cache) return cache;
  if (!fs.existsSync(INDEX_PATH)) {
    throw new Error(
      `Índice não encontrado em ${INDEX_PATH}. Coloca PDFs em /pdfs e corre "npm run index".`
    );
  }
  const raw = fs.readFileSync(INDEX_PATH, "utf-8");
  cache = JSON.parse(raw) as IndexedChunk[];
  return cache;
}

/** Similaridade do coseno entre dois vetores (assume vetores já normalizados). */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

// --- Lado lexical (palavras-chave) para retrieval híbrido ---

// Remove acentos e baixa para minúsculas.
function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Stemming PT muito simples: tira plural comum. Resolve "exercicios" vs "exercicio".
function stem(t: string): string {
  return t.replace(/(oes|es|s)$/, "");
}

const STOPWORDS = new Set([
  "que", "de", "do", "da", "dos", "das", "a", "o", "as", "os", "e", "em",
  "para", "com", "um", "uma", "se", "na", "no", "nas", "nos", "qual", "quais",
  "quantos", "quantas", "entre", "tem", "ser", "por", "ao", "aos", "the",
]);

// Mantém tokens com >1 caráter OU dígitos isolados (ex.: "2" em "CLASSE 2").
function keepToken(t: string): boolean {
  return t.length > 1 || /^\d$/.test(t);
}

// Termos de conteúdo (sem stopwords), na ordem original e com stemming.
function contentTerms(s: string): string[] {
  return normalize(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => keepToken(t) && !STOPWORDS.has(t))
    .map(stem);
}

// Conjunto de TODOS os tokens do chunk (stemmed) para teste de pertença.
function tokenSet(s: string): Set<string> {
  return new Set(
    normalize(s).split(/[^a-z0-9]+/).filter(keepToken).map(stem)
  );
}

/**
 * Document-frequency (lazy + cache): nº de chunks em que cada termo (stemmed)
 * aparece, e total de chunks `n`. Usado para distinguir termos ESPECÍFICOS do
 * domínio (raros: "amarelo", "excelente") de palavras incidentais comuns, no
 * resgate lexical do gate.
 */
function getDocFreq(): { df: Map<string, number>; n: number } {
  if (docFreqCache) return docFreqCache;
  const index = loadIndex();
  const df = new Map<string, number>();
  for (const c of index) {
    for (const t of tokenSet(c.text)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  docFreqCache = { df, n: index.length };
  return docFreqCache;
}

// Bigramas contíguos dos termos de conteúdo da pergunta (ex.: "classe 2").
function bigrams(terms: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < terms.length - 1; i++) out.push(terms[i] + " " + terms[i + 1]);
  return out;
}

const PHRASE_WEIGHT = 1.5; // um bigrama exato vale mais que vários unigramas

// Score lexical: overlap de unigramas (0..1) + bónus por cada expressão exata.
function lexicalScore(
  qTerms: string[],
  qBigrams: string[],
  chunkTokens: Set<string>,
  chunkNorm: string
): number {
  if (qTerms.length === 0) return 0;
  let uni = 0;
  for (const t of qTerms) if (chunkTokens.has(t)) uni++;
  let phrase = 0;
  for (const b of qBigrams) if (chunkNorm.includes(b)) phrase++;
  return uni / qTerms.length + phrase * PHRASE_WEIGHT;
}

export interface SearchResult extends IndexedChunk {
  score: number; // cosine (densa) — usado para a decisão de relevância
  lex: number; // overlap lexical 0..1
  phraseHits: number; // bigramas exatos da pergunta presentes neste chunk
  specificHits: number; // termos de conteúdo casados que são "específicos" (df baixo)
}

export interface SearchOutput {
  results: SearchResult[];
  maxScore: number; // melhor cosine sobre TODO o índice (guarda do "fora do contexto")
  maxLex: number; // melhor overlap lexical entre os resultados (diagnóstico)
  lexicalRescue: boolean; // sinal híbrido: há correspondência lexical específica que justifica passar o gate
}

/**
 * Busca HÍBRIDA: combina semântica (cosine) + palavras-chave (lexical) via
 * Reciprocal Rank Fusion. Isto recupera bem tanto perguntas em linguagem natural
 * como conteúdo tabular/termos específicos (ex.: "CLASSE 2", "box") que a busca
 * puramente densa falha. Devolve os top-`k` e o melhor cosine global.
 */
export function search(
  queryEmbedding: number[],
  queryText: string,
  k = 6
): SearchOutput {
  const index = loadIndex();
  const qTerms = contentTerms(queryText);
  // Bigramas a partir dos termos normalizados (não-stemmed) para casar frases.
  const qSurface = normalize(queryText)
    .split(/[^a-z0-9]+/)
    .filter((t) => keepToken(t) && !STOPWORDS.has(t));
  const qBigrams = bigrams(qSurface);

  // Termos de conteúdo da pergunta que são "específicos" do domínio (df baixo).
  const { df, n } = getDocFreq();
  const dfCutoff = LEX_MAX_DF_RATIO * n;
  const qSpecific = qTerms.filter((t) => (df.get(t) ?? 0) <= dfCutoff);

  const scored: SearchResult[] = index.map((c) => {
    const tokens = tokenSet(c.text);
    const norm = normalize(c.text);
    return {
      ...c,
      score: cosineSimilarity(queryEmbedding, c.embedding),
      lex: lexicalScore(qTerms, qBigrams, tokens, norm),
      phraseHits: qBigrams.filter((b) => norm.includes(b)).length,
      specificHits: qSpecific.filter((t) => tokens.has(t)).length,
    };
  });

  const maxScore = scored.reduce((m, s) => Math.max(m, s.score), 0);

  // Duas ordenações independentes.
  const byDense = [...scored].sort((a, b) => b.score - a.score);
  const byLex = [...scored].sort((a, b) => b.lex - a.lex);

  // Reciprocal Rank Fusion (escala-invariante): junta as duas listas.
  const RRF_K = 60;
  const fusion = new Map<SearchResult, number>();
  byDense.forEach((c, i) => fusion.set(c, (fusion.get(c) ?? 0) + 1 / (RRF_K + i)));
  byLex.forEach((c, i) => {
    // Só conta o lado lexical se o chunk tiver algum termo (evita ruído de empates a 0).
    if (c.lex > 0) fusion.set(c, (fusion.get(c) ?? 0) + 1 / (RRF_K + i));
  });

  const fused = [...scored].sort(
    (a, b) => (fusion.get(b) ?? 0) - (fusion.get(a) ?? 0)
  );

  const results = fused.slice(0, k);

  // Resgate lexical (aditivo ao gate denso): há algum trecho top-k com uma
  // correspondência lexical ESPECÍFICA? (A) um bigrama exato da pergunta, ou
  // (B) um termo específico (raro) casado E a pergunta cobre boa parte do
  // trecho (overlap lexical alto). O overlap separa perguntas focadas num termo
  // de domínio (ex.: "tenho amarelo?", lex~0.5) de off-topic longas que só casam
  // palavras incidentais (ex.: "campeonato do mundo de futebol", lex~0.33).
  const maxLex = results.reduce((m, r) => Math.max(m, r.lex), 0);
  const lexicalRescue = results.some(
    (r) =>
      r.phraseHits >= 1 ||
      (r.specificHits >= LEX_MIN_HITS && r.lex >= LEX_MIN_OVERLAP)
  );

  return { results, maxScore, maxLex, lexicalRescue };
}
