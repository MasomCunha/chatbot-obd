import { google } from "@ai-sdk/google";
import { embed as aiEmbed, embedMany } from "ai";

// Embeddings via API do Google (modelo gratuito text-embedding-004, 768 dims).
// Antes usávamos um modelo local (transformers.js/ONNX), mas carregá-lo em RAM
// estourava os 512 MB do free tier do Render (OOM). Movendo os embeddings para a
// API, o servidor deixa de carregar qualquer modelo — footprint mínimo.
// Usa a MESMA chave GOOGLE_GENERATIVE_AI_API_KEY do chat (lida pelo AI SDK).
// gemini-embedding-001 permite escolher a dimensão; 768 chega e mantém o índice
// compacto. Nesta dimensão os vetores não vêm normalizados — a l2normalize trata.
const MODEL_ID = "gemini-embedding-001";
const model = google.textEmbeddingModel(MODEL_ID, { outputDimensionality: 768 });

// cosineSimilarity (vector-store) assume vetores normalizados (só produto
// interno). Os embeddings do Google não vêm garantidamente unitários, por isso
// normalizamos aqui (L2). Indexação e query passam pela mesma função => vetores
// comparáveis.
function l2normalize(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  return norm === 0 ? v : v.map((x) => x / norm);
}

/**
 * Gera o embedding (normalizado) de um texto. Usar SEMPRE esta função tanto na
 * indexação como na query, para que os vetores sejam comparáveis.
 */
export async function embed(text: string): Promise<number[]> {
  const { embedding } = await aiEmbed({ model, value: text });
  return l2normalize(embedding);
}

/**
 * Gera embeddings para vários textos — usado na indexação. Limites do free tier
 * do Google: máx. 100 por batch e ~100 embeddings/minuto. Por isso processamos em
 * lotes de 90 e fazemos uma pausa de ~1 min entre lotes (indexação é pontual).
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function embedAll(texts: string[]): Promise<number[][]> {
  // Free tier do Google: ~100 pedidos/minuto. Usamos lotes pequenos (50) com pausa
  // de ~1 min entre eles (fica bem abaixo do limite) e desligamos as retentativas
  // automáticas do SDK (maxRetries: 0) — senão um 429 dispara repetições do lote
  // inteiro e a "tempestade" nunca recupera. Fazemos a nossa própria retentativa.
  const BATCH = 50;
  const multi = texts.length > BATCH;
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH) {
    if (multi) await sleep(62_000); // pausa/arrefecimento antes de cada lote
    const slice = texts.slice(i, i + BATCH);

    let embeddings: number[][] | null = null;
    for (let attempt = 1; attempt <= 4 && !embeddings; attempt++) {
      try {
        const res = await embedMany({ model, values: slice, maxRetries: 0 });
        embeddings = res.embeddings;
      } catch (err) {
        if (attempt === 4) throw err;
        console.log(`  lote ${i / BATCH + 1}: limite atingido, a aguardar 62s (tentativa ${attempt})...`);
        await sleep(62_000);
      }
    }

    out.push(...embeddings!.map(l2normalize));
    if (multi) console.log(`  embeddings: ${out.length}/${texts.length}`);
  }
  return out;
}
