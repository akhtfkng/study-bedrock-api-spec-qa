# Tasks: API Spec QA Agent (PoC)

**Input**: Design documents from `/specs/0001-api-spec-agent/`
**Prerequisites**: plan.md (required)

## Format
- `[ID] Description`

## Tasks

### Setup
- [ ] T001 Create minimal project structure for the Next.js PoC
- [ ] T002 Install dependencies (Next.js, TypeScript, yaml, openapi-types, testing libs)

### Tests
- [ ] T003 Write a test that queries POST /todos parameters with a concise response and citation
- [ ] T004 Write a detailed-answer test for GET /todos/{id} including source citation
- [ ] T005 Write a test ensuring non-API questions receive a polite refusal
- [ ] T006 Write a test ensuring missing operations return "information unavailable" without speculation

### Core Implementation
- [ ] T007 Implement OpenAPI index utilities in `lib/openapi-index.ts` (buildIndex, resolveRef, normalizePath, findOperation)
- [ ] T008 Implement `/api/query` route handler (load specs, in-memory index, query flow, responses)
- [ ] T009 Implement `app/page.tsx` UI with input, result rendering, and citation display (mode inferred automatically)
- [ ] T010 Ensure `public/specs/todos.yaml` is bundled (additional sample files are out of scope for the PoC)
- [x] T011 Integrate optional LLM formatting step that rephrases extracted facts without introducing new information

### Polish
- [ ] T012 Run the test suite and confirm all acceptance checks pass
- [ ] T013 Document quick usage notes in `specs/0001-api-spec-agent/notes.md`
