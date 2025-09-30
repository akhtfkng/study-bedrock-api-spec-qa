# Feature Specification: API Spec QA Agent (PoC)

- **Feature Branch:** `0001-api-spec-agent`
- **Created:** 2025-09-27
- **Status:** Draft
- **Input Summary:** Agent answers questions about OpenAPI (YAML) specs, returns concise or detailed answers with a source filename citation, and confines responses to API-related topics.

## User Scenarios & Testing

### Primary User Story

As an API developer, I ask questions about an OpenAPI spec and receive accurate answers with a source citation.

### Acceptance Scenarios

1. Given a valid OpenAPI YAML, when I ask “What parameters does POST /todos require?”, then I get a concise answer with a filename citation.
2. When I ask “Explain GET /todos/{id} in detail”, then I get a detailed answer with a filename citation.
3. When I ask a non-API question, the agent politely refuses.
4. If the operation is not found, the agent says “information unavailable” (no speculation).

## Requirements

### Functional Requirements (PoC-min)

- **FR-001:** MUST ingest and index OpenAPI YAML files and answer only from them.
- **FR-002:** MUST provide concise or detailed answers inferred automatically from the user’s phrasing.
- **FR-003:** MUST include the source filename in every answer.
- **FR-004:** MUST refuse non-API questions.
- **FR-005:** MUST say “information unavailable” when data is insufficient; MUST NOT fabricate details.
- **FR-006:** LLM is used only to rephrase/format the code-extracted facts provided by the server (no additional facts).

## Response Format (PoC-min)

The server returns a small JSON envelope:

```json
{
  "text": "string (human-readable answer)",
  "citation": "filename.yaml"
}
```
