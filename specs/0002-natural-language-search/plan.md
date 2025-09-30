# Implementation Plan: Natural Language API Search PoC

**Branch**: `[0002-natural-language-search]` | **Date**: 2025-09-28 | **Spec**: `./specs/0002-natural-language-search/spec.md`

## Summary
- Deliver a unified deterministic input flow: a single textarea where users can type either method+path or natural-language questions.
- Reuse existing `/api/query` and `/api/search` endpoints behind a new `/api/unified` orchestrator that decides whether to fetch candidates or return an answer immediately.
- Preserve PoC constraints: operate solely on bundled OpenAPI YAML, keep behavior deterministic, and avoid LLM usage unless explicitly enabled via env vars.
- Surface configuration knobs (`SEARCH_SCORE_THRESHOLD`, `SEARCH_SCORE_GAP`, `SEARCH_TOP_K`, optional `USE_LLM`) while defaulting to safe deterministic values. Add `EMBEDDINGS_ENABLED`/`EMBED_WEIGHT` for hybrid BM25 + hashed embedding fusion without external services.

## Technical Context
**Language/Version**: Node.js 20 / TypeScript 5  
**Primary Dependencies**: Next.js App Router, yaml, openapi-types, vitest  
**Storage**: None (specs and indexes cached in memory)  
**Project Type**: Next.js API + app router PoC

## Constitution Check
- Accuracy: [✓] Search and answers reference only bundled OpenAPI YAML (`public/specs/`).
- Consistency: [✓] Deterministic answerer remains the final authority; LLM formatting is optional/fallback only.
- Scope: [✓] Non-API questions and low-confidence hits return predefined refusal/not-found messages.
- Stability: [✓] Candidate ordering and routing decisions are deterministic across identical inputs.

## Behavior Notes
- Method+path detection uses `^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/` (case-insensitive).
- Natural-language inputs trigger search; auto-answer occurs only when a single candidate exceeds `SEARCH_SCORE_THRESHOLD + SEARCH_SCORE_GAP`.
- Candidate cards invoke `/api/query` with `Explain {METHOD} {PATH} in detail` to reuse the existing deterministic answer pipeline.
- Tokenization: lowercase, punctuation removal, camel/snake splitting, whitespace segmentation; no advanced morphological analysis. Schema properties become dedicated nodes so that property hits surface with explicit `matchedPropertyPath` metadata.
- Optional deterministic embeddings are generated via hashing to improve recall without external calls; fusion weight is tunable via `EMBED_WEIGHT` when `EMBEDDINGS_ENABLED` is true.
- `USE_LLM` / `ENABLE_LLM` gate Bedrock formatting; default deployments remain LLM-free.

## Project Structure
specs/0002-natural-language-search/  
├── spec.md # Feature spec (updated with unified flow)  
├── plan.md # This plan  
└── notes.md # Operational notes & configuration tips  

app/  
├── api/query/route.ts # Deterministic answerer (LLM optional via env flag)  
├── api/search/route.ts # Deterministic natural-language search API (hybrid BM25 + embeddings)  
├── api/unified/route.ts # NEW orchestrator for single-input UX  
├── layout.tsx # Base layout  
└── page.tsx # Unified textarea UI with candidates + answer rendering  

lib/  
├── openapi-index.ts # Shared OpenAPI indexing utilities  
├── search-index.ts # Tokenization, hybrid BM25 + hashed embedding scoring, property node indexing, configuration helpers  
└── spec-loader.ts # Spec/index caching with rebuild hooks  

tests/  
├── query.acceptance.spec.ts # Deterministic answerer scenarios (LLM gating)  
├── search.acceptance.spec.ts # Natural-language search scenarios  
└── unified.acceptance.spec.ts # Unified input routing (direct, auto-answer, cards, stability)

## Progress Tracking
- [x] Spec defined  
- [x] Plan written  
- [x] Search index + unified API implemented  
- [x] Acceptance tests green (search + unified scenarios)

## Additional Implementation Notes
- Cache spec files and search index using `spec-loader` + `search-index` caches; expose `?rebuild=1` for development resets.
- `/api/unified` returns `{ resultType, routedTo, answer?, candidates?, message?, autoAnswered?, question? }` for the UI to render appropriately.
- Auto-answer margin is governed by `SEARCH_SCORE_GAP`; setting it to `0` disables the extra buffer.
- Update documentation (notes.md, spec.md) whenever configuration knobs or routing rules change to keep stakeholders aligned.
