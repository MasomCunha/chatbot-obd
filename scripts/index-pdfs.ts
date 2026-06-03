/**
 * Script de indexação: lê todos os PDFs de /pdfs, extrai e divide o texto em
 * chunks, gera o embedding local de cada chunk e grava data/index.json.
 *
 * Correr com: npm run index
 */
import "./_env"; // carrega .env.local (chave da API de embeddings) — tem de vir primeiro
import fs from "node:fs";
import path from "node:path";

import { extractText, chunkText, buildExerciseSummaries } from "../lib/pdf";
import { embedAll } from "../lib/embeddings";
import { INDEX_PATH, type IndexedChunk } from "../lib/vector-store";

const PDF_DIR = path.join(process.cwd(), "pdfs");

async function main() {
  if (!fs.existsSync(PDF_DIR)) {
    console.error(`Pasta de PDFs não encontrada: ${PDF_DIR}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(PDF_DIR)
    .filter((f) => f.toLowerCase().endsWith(".pdf"));

  if (files.length === 0) {
    console.error(`Nenhum PDF encontrado em ${PDF_DIR}. Coloca lá os ficheiros.`);
    process.exit(1);
  }

  console.log(`Encontrados ${files.length} PDF(s): ${files.join(", ")}`);

  // Recolhe todos os chunks de todos os PDFs primeiro, depois gera os embeddings
  // num único batch (embedAll) — menos chamadas à API.
  const pending: { text: string; source: string }[] = [];

  for (const file of files) {
    const buffer = fs.readFileSync(path.join(PDF_DIR, file));
    const text = await extractText(buffer);
    // Chunks normais + trechos-resumo com a lista completa de exercícios por
    // classe (número + título), para que perguntas do tipo "que exercícios
    // existem na classe 3?" recuperem os nomes e não só os números.
    const summaries = buildExerciseSummaries(text);
    const chunks = [...summaries, ...chunkText(text)];
    console.log(
      `  ${file}: ${chunks.length} chunk(s) (${summaries.length} resumo(s) de exercícios)`
    );
    for (const chunk of chunks) pending.push({ text: chunk.text, source: file });
  }

  console.log(`A gerar embeddings de ${pending.length} chunks via API...`);
  const embeddings = await embedAll(pending.map((p) => p.text));
  const indexed: IndexedChunk[] = pending.map((p, i) => ({
    text: p.text,
    source: p.source,
    embedding: embeddings[i],
  }));

  const dataDir = path.dirname(INDEX_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(indexed));

  console.log(
    `\nÍndice gravado em ${INDEX_PATH} (${indexed.length} chunks no total).`
  );
}

main().catch((err) => {
  console.error("Erro na indexação:", err);
  process.exit(1);
});
