# Chatbot PDF (RAG)

Chat em Next.js que responde **exclusivamente** com base no conteúdo de ficheiros PDF.
Se a pergunta não estiver coberta pelos documentos, responde que não sabe.

## Stack

- **Next.js** (App Router) + TypeScript + Tailwind + **shadcn/ui**
- **Google Gemini** (`gemini-2.5-flash`, free tier) via Vercel AI SDK — streaming de respostas
- **RAG vetorial em memória**: embeddings locais/open-source com `transformers.js`
  (`Xenova/all-MiniLM-L6-v2`) + busca por similaridade do coseno
- PDFs fixos numa pasta, indexados por um script

## Setup

1. Instalar dependências:

   ```bash
   npm install
   ```

2. Obter uma API key gratuita em [Google AI Studio](https://aistudio.google.com/app/apikey)
   e copiar o ficheiro de exemplo:

   ```bash
   cp .env.local.example .env.local
   ```

   Preencher `GOOGLE_GENERATIVE_AI_API_KEY` no `.env.local`.

3. Colocar um ou mais PDFs na pasta `pdfs/`.

4. Gerar o índice de embeddings (correr sempre que os PDFs mudarem):

   ```bash
   npm run index
   ```

   > A primeira execução faz download do modelo de embeddings (~25 MB) para a cache local.

5. Arrancar a app:

   ```bash
   npm run dev
   ```

   Abrir [http://localhost:3000](http://localhost:3000).

## Como funciona

- **Indexação** (`scripts/index-pdfs.ts`): extrai texto dos PDFs → divide em chunks
  **por secção** (cada chunk é prefixado com o seu cabeçalho, ex.: `[Secção: CLASSE 2]`,
  para preservar o contexto) → gera embeddings locais → grava `data/index.json`.
- **Por cada pergunta** (`app/api/chat/route.ts`): gera o embedding da pergunta →
  faz **busca híbrida** (semântica por cosine **+** lexical por palavras-chave/expressões,
  fundidas por Reciprocal Rank Fusion em `lib/vector-store.ts`) → se nada no índice for
  relevante o suficiente (`RELEVANCE_THRESHOLD` em `lib/prompt.ts`) responde "fora do
  contexto" sem chamar o LLM → caso contrário, envia os melhores trechos como contexto
  ao Gemini com um system prompt restritivo.

> Nota sobre limitações: a busca funciona bem para perguntas factuais específicas.
> Perguntas que pedem a reprodução de uma **tabela inteira** podem sair incompletas —
> tabelas compactas/numéricas são difíceis para busca semântica.

## Deploy

A chave do Gemini **não** vai no código — em produção é uma **variável de ambiente**
da plataforma (`GOOGLE_GENERATIVE_AI_API_KEY`). O índice (`data/index.json`) e os PDFs
são comitados, por isso o deploy já vai com tudo pronto (não é preciso re-indexar).

⚠️ **Requisito importante:** os embeddings correm em Node (transformers.js + ONNX),
logo a app precisa de um **runtime de servidor Node** (não Edge) com RAM suficiente.
Recomendado: **Render** ou **Railway** (Web Service Node) — simples e sem limites
serverless. Em Vercel grátis o modelo de embeddings pode exceder os limites das
funções; nesse caso seria preciso trocar para embeddings via API.

Passos (Render/Railway): ligar o repositório → build `npm install && npm run build`
→ start `npm start` → definir a env var `GOOGLE_GENERATIVE_AI_API_KEY`.

## Verificação rápida (sem API key)

`npm run verify` — testa, contra o índice real, que perguntas dentro do tema têm
score alto e perguntas fora do tema ficam abaixo do threshold (a guarda do "não sei").

## Afinação

- `RELEVANCE_THRESHOLD` e `SYSTEM_PROMPT` — em [lib/prompt.ts](lib/prompt.ts).
- Tamanho/sobreposição dos chunks — em [lib/pdf.ts](lib/pdf.ts) (`chunkText`).
- Nº de trechos recuperados (top-K) — em [app/api/chat/route.ts](app/api/chat/route.ts).
