// Importamos diretamente o módulo interno para evitar o bloco de "debug" do
// index.js do pdf-parse, que tenta abrir um PDF de teste e rebenta fora do package.
import pdfParse from "pdf-parse/lib/pdf-parse.js";

/** Extrai todo o texto de um buffer de PDF. */
export async function extractText(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return data.text;
}

export interface Chunk {
  text: string;
}

// Deteta cabeçalhos de secção (ex.: "CLASSE 2", "III. CLASSES...", "APÊNDICE 3").
// Usado para "carimbar" cada chunk com a secção a que pertence, evitando que
// tabelas fiquem sem rótulo e sejam atribuídas à classe errada.
const HEADING_RE =
  /(CLASSE\s+[1-3]\b[^\n]{0,45}|[IVX]{1,4}\.\s+[A-ZÀ-Ý][^\n]{0,55}|(?:CAP[IÍ]TULO|AP[ÊE]NDICE)\s*\d*[^\n]{0,45})/g;

interface Heading {
  index: number;
  text: string;
}

function findHeadings(clean: string): Heading[] {
  const out: Heading[] = [];
  for (const m of clean.matchAll(HEADING_RE)) {
    out.push({ index: m.index ?? 0, text: m[0].replace(/\s+/g, " ").trim() });
  }
  return out;
}

/** Cabeçalho de secção mais recente em (ou antes de) `pos`. */
function headingAt(headings: Heading[], pos: number): string | null {
  let current: string | null = null;
  for (const h of headings) {
    if (h.index <= pos) current = h.text;
    else break;
  }
  return current;
}

/**
 * Divide texto em chunks de ~`chunkSize` caracteres com `overlap` de sobreposição,
 * tentando cortar em fronteiras de parágrafo/frase. Cada chunk é prefixado com o
 * cabeçalho de secção mais recente, para preservar o contexto (ex.: a que classe
 * pertence uma tabela), mesmo quando o título fica num chunk anterior.
 */
export function chunkText(
  text: string,
  chunkSize = 1200,
  overlap = 200
): Chunk[] {
  // Normaliza espaços em branco e remove linhas vazias excessivas.
  const clean = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];

  // 1. Parte o texto em SECÇÕES nas fronteiras de cabeçalho. Cada secção pertence
  //    a um único título, garantindo que cada tabela fica com o rótulo correto.
  const headings = findHeadings(clean);
  const bounds = [0, ...headings.map((h) => h.index), clean.length];
  const uniqueBounds = [...new Set(bounds)].sort((a, b) => a - b);

  const chunks: Chunk[] = [];
  for (let s = 0; s < uniqueBounds.length - 1; s++) {
    const segStart = uniqueBounds[s];
    const segEnd = uniqueBounds[s + 1];
    const segment = clean.slice(segStart, segEnd).trim();
    if (!segment) continue;
    const heading = headingAt(headings, segStart);

    // 2. Dentro de cada secção, faz sliding-window se for grande demais.
    for (const piece of slidingWindow(segment, chunkSize, overlap)) {
      const text =
        heading && !piece.startsWith(heading)
          ? `[Secção: ${heading}]\n${piece}`
          : piece;
      chunks.push({ text });
    }
  }

  return chunks;
}

interface ExerciseEntry {
  cls: number;
  num: number;
  title: string;
  coeff?: string;
}

/** Limpa um título de exercício (espaços, bullets e pontuação nas pontas). */
function cleanTitle(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/^[•.\s]+/, "")
    .replace(/[•.\s]+$/, "")
    .trim();
}

/**
 * Constrói um chunk-resumo por classe com a LISTA COMPLETA de exercícios
 * (número + título + coeficiente), extraída dos cabeçalhos do PDF.
 *
 * Porquê: os títulos dos exercícios existem no documento, mas espalhados — cada
 * exercício está numa secção própria e não há nenhum trecho único com a lista
 * toda. Sem isto, perguntas como "que exercícios existem na classe 3?" só
 * recuperavam chunks soltos e o modelo respondia com números sem título
 * (ex.: "3.4, 3.6, 3.8, 3.10"). Estes resumos dão ao retrieval um trecho
 * canónico, legível, com todos os exercícios e os seus nomes.
 */
export function buildExerciseSummaries(text: string): Chunk[] {
  const clean = text.replace(/\r/g, "");
  const map = new Map<string, ExerciseEntry>();

  // 1. Forma AUTORITATIVA: "EXERCÍCIO 3.4 <título> [Coeff. 3]". O título é uma
  //    única linha (sem '[' nem quebra) terminada por [Coeff. N]. Isto ignora
  //    referências cruzadas em prosa (ex.: "Figura Exercício 1.5. Ver Capítulo..."),
  //    que não têm um [Coeff] logo a seguir na mesma linha.
  const withCoeff =
    /EXERC[ÍI]CIO\s+(\d)\.(\d+)\.?\s+([^[\n]{2,90}?)\s*\[Coeff\.?\s*(\d+)\s*\]/gi;
  let m: RegExpExecArray | null;
  while ((m = withCoeff.exec(clean)) !== null) {
    const cls = +m[1];
    const num = +m[2];
    const title = cleanTitle(m[3]);
    if (title) map.set(`${cls}.${num}`, { cls, num, title, coeff: m[4] });
  }

  // 1b. Fallback para exercícios SEM [Coeff] no cabeçalho (ex.: 3.6, que termina
  //     diretamente em "Comandos:"). Restrito a títulos limpos numa só linha que
  //     começam por maiúscula, para não apanhar prosa. Só preenche o que falta.
  const noCoeff =
    /EXERC[ÍI]CIO\s+(\d)\.(\d+)\.?\s+([A-ZÀ-Ý][^[\n]{2,70}?)\s*Comandos?\s*:/gi;
  while ((m = noCoeff.exec(clean)) !== null) {
    const cls = +m[1];
    const num = +m[2];
    const key = `${cls}.${num}`;
    if (map.has(key)) continue;
    const title = cleanTitle(m[3]);
    if (title) map.set(key, { cls, num, title });
  }

  // 2. Cabeçalhos combinados de exercícios de grupo:
  //    "EXERCÍCIOS 3.1 E 3.2  • <título1> [Coeff. 2]  • <título2> ...".
  //    Os exercícios de grupo (ex.: 3.1/3.2) só aparecem nesta forma.
  const combined =
    /EXERC[ÍI]CIOS\s+(\d)\.(\d+)\s+[Ee]\s+(\d)\.(\d+)([\s\S]{0,400}?)(?=Descri|Execu|Comandos?\s*:|EXERC[ÍI]CIO|Regulamento de Provas)/gi;
  while ((m = combined.exec(clean)) !== null) {
    const ids: Array<[number, number]> = [
      [+m[1], +m[2]],
      [+m[3], +m[4]],
    ];
    const bullets = [
      ...m[5].matchAll(/•\s*([^\n•]+?)\s*(?:\[Coeff\.?\s*(\d+)\s*\]|•|$)/g),
    ];
    bullets.forEach((b, i) => {
      if (i >= ids.length) return;
      const [cls, num] = ids[i];
      const key = `${cls}.${num}`;
      const title = cleanTitle(b[1]);
      // Só preenche o que os cabeçalhos individuais não cobriram.
      if (title && !map.has(key)) map.set(key, { cls, num, title, coeff: b[2] });
    });
  }

  // Agrupa por classe e gera um chunk-resumo por classe.
  const byClass = new Map<number, ExerciseEntry[]>();
  for (const e of map.values()) {
    if (!byClass.has(e.cls)) byClass.set(e.cls, []);
    byClass.get(e.cls)!.push(e);
  }

  const chunks: Chunk[] = [];
  for (const [cls, entries] of [...byClass.entries()].sort((a, b) => a[0] - b[0])) {
    entries.sort((a, b) => a.num - b.num);
    const lines = entries.map(
      (e) =>
        `${e.cls}.${e.num} — ${e.title}${e.coeff ? ` [Coeff. ${e.coeff}]` : ""}`
    );
    chunks.push({
      text:
        `[Secção: CLASSE ${cls} — Lista de exercícios]\n` +
        `Exercícios da Classe ${cls} (${entries.length} no total):\n` +
        lines.join("\n"),
    });
  }

  return chunks;
}

/** Divide um texto em janelas de ~`chunkSize` com `overlap`, em fronteiras limpas. */
function slidingWindow(text: string, chunkSize: number, overlap: number): string[] {
  if (text.length <= chunkSize) return [text];
  const out: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);
    if (end < text.length) {
      const slice = text.slice(start, end);
      const boundary = Math.max(
        slice.lastIndexOf("\n\n"),
        slice.lastIndexOf(". "),
        slice.lastIndexOf("\n")
      );
      if (boundary > chunkSize * 0.5) {
        end = start + boundary + 1;
      } else {
        const sp = slice.lastIndexOf(" ");
        if (sp > chunkSize * 0.5) end = start + sp;
      }
    }

    const piece = text.slice(start, end).trim();
    if (piece) out.push(piece);
    if (end >= text.length) break;

    let next = end - overlap;
    const nextSpace = text.indexOf(" ", next);
    if (nextSpace !== -1 && nextSpace < end) next = nextSpace + 1;
    start = next;
  }

  return out;
}
