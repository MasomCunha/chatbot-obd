// Carrega o .env.local para process.env quando corremos scripts fora do Next
// (npm run index / npm run verify). O Next.js carrega isto sozinho, os scripts não.
// Necessário porque os embeddings passaram a usar a API do Google (precisa da
// GOOGLE_GENERATIVE_AI_API_KEY). Importar este módulo PRIMEIRO no script.
import fs from "node:fs";

const ENV_PATH = ".env.local";
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, key, rawVal] = m;
    if (process.env[key] !== undefined) continue;
    let val = rawVal;
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
