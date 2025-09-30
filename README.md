# API Spec QA Agent

A Next.js (App Router) application that answers ad-hoc questions about your OpenAPI specifications and surfaces likely REST endpoints by combining BM25 ranking, synonym-aware Japanese tokenization, and optional Amazon Bedrock powered formatting.

## Features
- **OpenAPI-driven knowledge**: Loads specs from `public/specs/` and exposes `/api/query` for deterministic Q&A with source citations.
- **Natural-language search**: `/api/search` ranks endpoints using BM25 with synonym expansion, Japanese n-grams, and optional embedding fusion.
- **Unified entry point**: `/api/unified` routes user input to search or Q&A and can auto-answer when a single confident match is found.
- **Bedrock-assisted responses**: When `USE_LLM=true`, the deterministic answer is polished via Amazon Bedrock (Anthropic Claude) while preserving factual grounding.
- **Spec-first workflow**: Companion planning documents live under `specs/` and `.specify/` to support the Spec-Driven Development process.

## Project structure
- `app/` – Next.js App Router pages and API routes (`search`, `query`, `unified`).
- `lib/` – Search index, synonym handling, Bedrock LLM adapter, and OpenAPI indexing utilities.
- `public/specs/` – Source OpenAPI YAML files served with the app.
- `specs/` – Working documents (plan, spec, tasks) for each feature slice.
- `tests/` – Vitest acceptance suites covering search, query, and unified flows.

## Prerequisites
- Node.js 18.17+ (Next.js 14 requirement).
- npm 9+ (or another compatible package manager).
- AWS credentials with access to Amazon Bedrock (only if you enable LLM formatting).

## Installation
```bash
cd /path/to/your/workspace
npm install
```

## Configuration
Copy `.env.example` to `.env` and adjust as needed:

```bash
cp .env.example .env
```

Key variables:

| Variable | Description | Default |
| --- | --- | --- |
| `BEDROCK_REGION` | Target AWS region for Bedrock runtime. | `ap-northeast-1` |
| `BEDROCK_MODEL_ID` | Claude model identifier used for formatting. | `anthropic.claude-sonnet-4-20250514-v1:0` |
| `USE_LLM` / `ENABLE_LLM` | Enable Bedrock formatting when set to `true`. | disabled |
| `SEARCH_SCORE_THRESHOLD` | BM25 acceptance floor for candidates. | `0.2` |
| `SEARCH_TOP_K` | Maximum candidates returned per query. | `3` |
| `EMBEDDINGS_ENABLED` | Toggle embedding fusion in ranking. | disabled |
| `EMBED_WEIGHT` | Weight applied to cosine similarity when embeddings are enabled. | `0.4` |

> When Bedrock variables are omitted, the app falls back to deterministic, citation-only answers.

## Development workflow
Start the dev server on `http://localhost:3000`:

```bash
npm run dev
```

Trigger a production build:

```bash
npm run build
```

## Testing
Vitest covers search, query, and unified endpoints:

```bash
npm test
```

## API endpoints
| Route | Method | Purpose |
| --- | --- | --- |
| `/api/search` | `POST` | `{ query: string }` → ranked endpoint candidates with optional property highlights. Supports `?rebuild=1` to refresh the in-memory index. |
| `/api/query` | `POST` | `{ question: string }` → textual answer with citation drawn from OpenAPI specs; optionally reformatted by Bedrock. |
| `/api/unified` | `POST` | `{ input: string }` → smart router that returns either an answer or a candidate list based on confidence heuristics. |

## Working with specs
- Place additional OpenAPI documents under `public/specs/` (and update supporting metadata in `specs/` if you follow the Spec-Driven Development flow).
- The search index is built lazily on first request and cached; use `/api/search?rebuild=1` (or restart the server) after changing specs.

## Troubleshooting
- **No candidates returned**: confirm your query language matches the spec vocab or adjust `SEARCH_SCORE_THRESHOLD` downward.
- **Bedrock errors**: ensure AWS credentials are available and the chosen `BEDROCK_MODEL_ID` is accessible in the configured region.
- **Stale results**: trigger the rebuild flag or clear the Next.js server cache when specs or synonyms change.

## Next steps
- Wire in Amazon OpenSearch Serverless if you need persistent, large-scale indexing.
- Expand `SYNONYM_GROUPS` in `lib/search-index.ts` to teach the searcher additional domain language.
- Add more acceptance tests under `tests/` as you introduce new specs or behaviors.
