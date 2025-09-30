# Tasks: Natural Language API Search PoC

**Input**: Design documents from `/specs/0002-natural-language-search/`
**Prerequisites**: plan.md (required)

## Format
- `[ID] Description`

## Tasks

### Setup
- [x] T201 Ensure existing OpenAPI specs (`public/specs/`) are accessible for indexing
- [x] T202 Review current `openapi-index.ts` helpers and identify reusable pieces

### Tests
- [x] T203 Add acceptance test: query "ToDo を作成するAPIは？" returns POST /todos in top 3
- [x] T204 Add acceptance test: query "ToDo IDで取得" returns GET /todos/{id}
- [x] T205 Add acceptance test: query "postalCode を扱うAPI" returns operation with postal code field
- [x] T206 Add acceptance test: low-scoring query returns "No matching API found. Try different terms."
- [x] T207 Add stability test: repeated identical queries yield identical ordering

### Core Implementation
- [x] T208 Create `lib/search-index.ts` with tokenization, document builder, scoring (BM25/TF-IDF-like), and top-K selection
- [x] T209 Implement `POST /api/search` route that loads/builds index, handles threshold, and returns candidates
- [x] T210 Update `app/page.tsx` with search input, candidate cards (method/path/summary/score), not-found message, and click-to-query behavior
- [x] T211 Integrate search module into app bootstrap (ensure index cached/reused similar to openapi index)
- [x] T212 Provide environment-driven configuration for threshold and max results (with defaults)

### Unified Flow
- [x] T216 Add `/api/unified` endpoint that orchestrates method+path vs. natural-language routing
- [x] T217 Update UI to a single textarea + Ask button with auto-answer status messaging
- [x] T218 Require a score margin (`SEARCH_SCORE_GAP`) before auto-answering a single candidate
- [x] T219 Default `/api/query` to deterministic output and gate LLM formatting via env flag
- [x] T220 Expand acceptance coverage with unified flow scenarios (direct, auto-answer, candidates, postalCode, not-found, stability)

### Polish
- [x] T213 Run full test suite (query + search) and ensure all acceptance cases pass
- [x] T214 Document search usage and configuration in `specs/0002-natural-language-search/notes.md`
- [x] T215 Review integration with deterministic answerer to confirm citations and modes remain intact
