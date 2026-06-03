# CLAUDE.md

Guia para agentes a trabalhar neste repositório.

## Visão geral

Chatbot **RAG** (Retrieval-Augmented Generation) em Next.js que responde
**exclusivamente** com base no conteúdo de PDFs. Se a resposta não estiver nos
documentos, responde "Essa pergunta encontra-se fora do contexto.".

Domínio atual: **Regulamento de Provas de Obediência canina FCI 2025**
(`pdfs/regulamento-obedience-2025-em-portugues.pdf`). Todo o conteúdo e as
respostas são em **português de Portugal**.

## Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind** + **shadcn/ui** (componentes em `components/`)
- **Google Gemini** (`gemini-2.5-flash`, free tier) via **Vercel AI SDK** — streaming
- **Embeddings locais** com `@huggingface/transformers` (transformers.js):
  `Xenova/paraphrase-multilingual-MiniLM-L12-v2`, 384 dims, CPU, sem custo de API
- **Busca híbrida em memória**: cosine (densa) + lexical (palavras-chave/bigramas),
  fundidas por Reciprocal Rank Fusion
- PDFs fixos numa pasta, indexados por um script para `data/index.json`

> **Runtime tem de ser Node, não Edge** — transformers.js + ONNX precisam de CPU
> (ver `export const runtime = "nodejs"` em `app/api/chat/route.ts` e
> `next.config.ts`).

## Comandos

```bash
npm install        # instalar dependências
npm run dev        # arrancar dev server em http://localhost:3000
npm run build      # build de produção
npm start          # arrancar produção (depois do build)
npm run index      # (RE)indexar os PDFs -> gera data/index.json
npm run verify     # teste offline do gate de relevância (NÃO precisa de API key)
npm run lint       # ESLint (next lint)
```

## Setup

1. `npm install`
2. Criar `.env.local` a partir de `.env.local.example` e preencher
   `GOOGLE_GENERATIVE_AI_API_KEY` (chave gratuita do Google AI Studio).
3. Colocar PDFs em `pdfs/`.
4. `npm run index` — **correr sempre que os PDFs mudarem** (a 1ª execução faz
   download do modelo de embeddings ~25 MB para a cache local).
5. `npm run dev`.

A chave Gemini **nunca** vai no código; em produção é env var da plataforma.
`data/index.json` e os PDFs são commitados, por isso o deploy vai pronto (não
re-indexa). Deploy recomendado: **Render** ou **Railway** (Web Service Node).

## Arquitetura e ficheiros-chave

| Ficheiro | Papel |
|---|---|
| `app/page.tsx` | UI do chat (cliente) |
| `app/api/chat/route.ts` | Endpoint do chat: retrieval → **gate de relevância** → streaming Gemini |
| `lib/embeddings.ts` | `embed()` — geração de embeddings (singleton da pipeline). Usar a MESMA função na indexação e na query |
| `lib/vector-store.ts` | `loadIndex()`, `cosineSimilarity()`, `search()` (busca híbrida + sinal de resgate lexical), document-frequency |
| `lib/prompt.ts` | `SYSTEM_PROMPT`, `NO_ANSWER_MESSAGE`, thresholds do gate, `buildContextPrompt()` |
| `lib/pdf.ts` | Extração de texto + `chunkText()` (chunking por secção, prefixa cada chunk com o cabeçalho ex.: `[Secção: CLASSE 2]`) |
| `scripts/index-pdfs.ts` | Script de indexação (`npm run index`) |
| `scripts/verify-rag.mts` | Teste offline do gate (`npm run verify`) |
| `data/index.json` | Índice de chunks com embeddings (commitado) |
| `pdfs/` | PDFs-fonte (base de conhecimento) |

## Como funciona o RAG

1. **Indexação** (`scripts/index-pdfs.ts` → `lib/pdf.ts`): extrai texto dos PDFs,
   divide em chunks por secção (cada chunk prefixado com o seu cabeçalho), gera
   embeddings locais e grava `data/index.json`.
2. **Por pergunta** (`app/api/chat/route.ts`): gera o embedding da pergunta →
   `search()` faz busca híbrida (cosine + lexical, fundidas por RRF) e devolve os
   top-8 trechos + sinais de gate → aplica o **gate de relevância** → se passar,
   envia os trechos como CONTEXTO ao Gemini com o `SYSTEM_PROMPT` restritivo.

### Gate de relevância (importante)

Decide se a pergunta é respondida ou recebe `NO_ANSWER_MESSAGE` **sem chamar o LLM**
(poupa uma chamada e funciona sem API key). É **híbrido** — passa se:

```
maxScore >= RELEVANCE_THRESHOLD   (relevância densa/cosine)
  OU  lexicalRescue               (correspondência lexical específica)
```

`lexicalRescue` (em `search()`) dispara quando algum trecho top-k tem:
- **(A)** um **bigrama exato** da pergunta presente no texto (`phraseHits >= 1`), ou
- **(B)** um **termo específico/raro** casado (`specificHits >= LEX_MIN_HITS`, df ≤
  `LEX_MAX_DF_RATIO * n`) **E** a pergunta cobre boa parte do trecho (`lex >= LEX_MIN_OVERLAP`).

Porquê: o cosine sozinho rejeitava perguntas curtas/coloquiais com palavra-chave
exata (ex.: "o que acontece quando tenho amarelo?") que caíam no ruído denso
(~0.3–0.4), apesar de a resposta existir. O ramo lexical resgata-as; o
`LEX_MIN_OVERLAP` separa perguntas focadas num termo de domínio (overlap alto) de
off-topic longas que só casam palavras incidentais (ex.: "campeonato do mundo de
futebol"). O `SYSTEM_PROMPT` é a **guarda final** do "não sei" para o que escapar.

### Knobs de afinação (todos em `lib/prompt.ts`)

- `RELEVANCE_THRESHOLD` (0.45) — gate denso. **Não baixar** (abre o gate a todo o ruído).
- `LEX_MIN_OVERLAP` (0.4) — knob principal do resgate lexical.
- `LEX_MAX_DF_RATIO` (0.08), `LEX_MIN_HITS` (1) — definição de "termo específico".
- `SYSTEM_PROMPT` — comportamento e regras de recusa.
- Chunking (`chunkText`) em `lib/pdf.ts`; top-K do retrieval em `app/api/chat/route.ts`.

**Depois de mexer no gate, correr `npm run verify`** — testa, contra o índice real,
que perguntas dentro do tema passam e perguntas fora do tema (ex.: receitas,
futebol) ficam fora. Adicionar novos casos `DENTRO`/`FORA` nesse script ao afinar.

## Notas e limitações

- O bot **não usa conhecimento externo** — só o CONTEXTO recuperado.
- Tabelas compactas/numéricas do PDF podem sair incompletas (difíceis para busca
  semântica) — ver `README.md`.
- Mudar o(s) PDF(s) obriga a `npm run index` para regenerar `data/index.json`.
