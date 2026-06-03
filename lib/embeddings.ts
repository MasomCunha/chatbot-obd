import { pipeline } from "@huggingface/transformers";

// Modelo de embeddings local/open-source MULTILINGUE (inclui português).
// Importante para um corpus em PT: o all-MiniLM-L6-v2 (só inglês) comprime os
// embeddings PT numa banda estreita e não separa bem dentro/fora do domínio.
// Este modelo dá 384 dimensões e corre em CPU sem custo de API.
const MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

// Tipo mínimo da pipeline de feature-extraction. Usamos um tipo próprio (em vez
// do tipo exportado pela lib) porque este é uma união enorme que faz o TS rebentar.
type Extractor = (
  text: string,
  options: { pooling: "mean"; normalize: boolean }
) => Promise<{ data: Float32Array }>;

// Carregamos a pipeline uma única vez (singleton) e reutilizamos. A primeira
// chamada faz download do modelo para a cache local; as seguintes são rápidas.
let extractorPromise: Promise<Extractor> | null = null;

function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = pipeline(
      "feature-extraction",
      MODEL_ID
    ) as unknown as Promise<Extractor>;
  }
  return extractorPromise;
}

/**
 * Gera o embedding (normalizado) de um texto. Usar SEMPRE esta função tanto na
 * indexação como na query, para que os vetores sejam comparáveis.
 */
export async function embed(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

/** Gera embeddings para vários textos, um a um (suficiente para indexação local). */
export async function embedAll(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (const t of texts) {
    out.push(await embed(t));
  }
  return out;
}
