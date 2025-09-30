# Feature Specification: Natural Language API Search PoC

**Feature Branch**: `[0002-natural-language-search]`  
**Created**: 2025-09-28  
**Status**: Updated  
**Input**: User description: "/spec Add a natural-language API search (LLM-free) to the API Spec QA Agent PoC."

## Overview

The PoC now exposes a **single unified input** that accepts either method+path prompts (e.g., `POST /todos`) or natural-language queries (e.g., `ToDo を作成するAPIは？`).
The backend orchestrates deterministic search and deterministic answers without invoking any LLM unless explicitly enabled via environment variables. Search combines BM25-style scoring with optional in-process hashed embeddings so that semantic matches (e.g., synonyms) boost candidates deterministically.

## User Scenarios & Testing

### Primary User Story
As a support engineer, I want to ask the QA agent either direct method/path prompts or vague natural-language questions so that I can quickly discover API operations and read deterministic answers sourced from bundled OpenAPI specs.

### Acceptance Scenarios
1. **Direct Path Answer** — Given the user enters `POST /todos`, when the unified endpoint evaluates the input, then it calls `/api/query` directly and shows the concise+ detailed deterministic answer with citation.
2. **Natural Query Auto-Answer** — Given the user enters `ToDo を作成するAPIは？`, when search finds a single high-confidence candidate whose score exceeds `SEARCH_SCORE_THRESHOLD + SEARCH_SCORE_GAP`, then the system automatically answers via `/api/query` and shows the deterministic response.
3. **Candidate Selection** — Given the user enters `ToDo IDで取得`, when multiple candidates exceed the threshold, then the UI shows clickable cards (e.g., GET /todos/{id}) and selecting one triggers `/api/query` to display the deterministic answer.
4. **Schema Property Match** — Given the user enters `postalCode を扱うAPI`, when search indexes request/response schemas, then an operation referencing `postalCode` appears in the candidate list with metadata identifying the matched property path.
5. **No Match Message** — Given the user enters a low-signal query, when no candidates pass the threshold, then the shared message “No matching API found. Try different terms.” is returned.
6. **Stability & Determinism** — Given the user repeats the same input, when the unified endpoint processes it, then the candidate ordering (if any) and direct-routing decisions remain consistent across requests.

### Edge Cases & Heuristics
- Inputs that mix casing or punctuation (e.g., `GET   /Todos??`) should normalize and still route correctly.
- Mixed-language queries (Japanese + English) should tokenize via existing best-effort normalization (lowercase, punctuation removal, camel/snake splitting, whitespace segmentation; no advanced morphological analysis).
- If multiple candidates remain but their scores are within the configured gap, the system should prefer showing cards over auto-answering.
- Method+path detection follows the regex `^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/` (case-insensitive). Everything else is treated as natural-language search.
- Short or noisy queries should not surface false positives above the threshold; default threshold (`SEARCH_SCORE_THRESHOLD=0.2`) and gap (`SEARCH_SCORE_GAP=0.05`) are adjustable.
- LLM formatting is disabled by default. If `USE_LLM=true` (or `ENABLE_LLM=true`), `/api/query` may call Bedrock for post-formatting but still falls back deterministically.

## Requirements

### Functional Requirements
- **FR-001**: Build a deterministic search index from bundled OpenAPI documents only. No external calls or speculative data.
- **FR-002**: Tokenize and normalize operation metadata (method, path, operationId, tags, summary, description, parameter names/descriptions, schema property names/descriptions) into search documents.
- **FR-003**: Score operations with a lightweight TF-IDF/BM25-style algorithm and optionally fuse deterministic hashing-based embeddings when `EMBEDDINGS_ENABLED` is true. Respect `SEARCH_SCORE_THRESHOLD` and cap results by `SEARCH_TOP_K` (default 3).
- **FR-004**: Expose `POST /api/search` for direct queries, returning `{ candidates, message? }` with consistent not-found messaging.
- **FR-005**: Expose `POST /api/unified` that accepts `{ input: string }`, detects method+path vs natural-language, and orchestrates `/api/query` or `/api/search` accordingly.
- **FR-006**: Auto-answer only when exactly one candidate exceeds the threshold by at least `SEARCH_SCORE_GAP`; otherwise show candidates.
- **FR-007**: UI presents a single textarea + “Ask” button. Responses render either (a) deterministic answer with citation, (b) candidate cards, or (c) the shared not-found message.
- **FR-008**: Candidate cards trigger `/api/query` with `Explain {METHOD} {PATH} in detail`, preserving the deterministic answerer flow.
- **FR-009**: `/api/query` MUST base responses solely on OpenAPI data and refuse non-API questions, returning predefined refusal/unknown messages when information is missing.
- **FR-010**: Optional LLM formatting MUST be gated behind `USE_LLM`/`ENABLE_LLM`; default behavior remains deterministic.
- **FR-011**: Property-level nodes surfaced from request/response schemas MUST return their `matchedPropertyPath` so the UI can highlight schema-driven matches.

### Configuration
- `SEARCH_SCORE_THRESHOLD` — Minimum score to keep a candidate (default 0.2).
- `SEARCH_TOP_K` — Maximum candidates to surface (default 3, must be ≥1).
- `SEARCH_SCORE_GAP` — Extra margin (`score - threshold`) required for the sole candidate to auto-answer (default 0.05).
- `EMBEDDINGS_ENABLED` — When `true`/`1`, generate deterministic hashed embeddings for query and node tokens and blend them with BM25 scores.
- `EMBED_WEIGHT` — Fusion weight between BM25 (1 - weight) and embedding cosine similarity (default 0.4, clamped 0–1).
- `USE_LLM` / `ENABLE_LLM` — Enable Bedrock-based formatting when set to `true`/`1`; otherwise the deterministic text is returned as-is.
- `POST /api/search?rebuild=1` — Forces cache and index rebuild, useful during development when specs change.

### Key Entities
- **SearchDocument**: Flattened representation of an OpenAPI operation with tokenized metadata for scoring.
- **SearchNode**: Operation or property record held in the hybrid index, including tokens, BM25 term frequencies, and deterministic embeddings.
- **SearchCandidate**: `{ method, path, summary, score, specName, sourceType?, matchedPropertyPath? }` returned by search.
- **UnifiedResponse**: `{ resultType: "answer" | "candidates" | "not_found", routedTo: "query" | "search", answer?, candidates?, message?, autoAnswered?, question? }`.

## Non-Functional Requirements
- Responses and candidate ordering must be deterministic across identical inputs.
- All logic must operate on the bundled OpenAPI YAML under `public/specs/`; no network access.
- API routes should share cached spec/index data to avoid redundant parsing but expose rebuild hooks for development/testing.

## Test Coverage
- Acceptance tests (`tests/search.acceptance.spec.ts`, `tests/query.acceptance.spec.ts`, `tests/unified.acceptance.spec.ts`) cover scenarios 1–6, refusal paths, not-found messaging, and LLM gating.
- Additional unit tests (tokenizer, score ordering) may be added as follow-up if relevancy heuristics change.
