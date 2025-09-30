# Implementation Plan: API Spec QA Agent (PoC)

**Branch**: `[0001-api-spec-agent]` | **Date**: 2025-09-27 | **Spec**: `./specs/0001-api-spec-agent/spec.md`

## Summary
- Build a minimal local web PoC that answers API questions from bundled OpenAPI YAML files.
- Provide concise or detailed answers with citations, refusing non-API or unsupported queries.
- Deliver a lightweight Next.js UI and route handler backed by an in-memory OpenAPI index.
- When rephrasing responses, use an LLM strictly to format facts already extracted from the OpenAPI documents—never to introduce new information.

## Technical Context
**Language/Version**: Node.js 20 / TypeScript 5 (NEEDS CLARIFICATION if different)  
**Primary Dependencies**: Next.js (App Router), yaml, openapi-types, @aws-sdk/client-bedrock-runtime  
**Storage**: None (in-memory index built from static YAML files)  
**Project Type**: Local development / single Node.js process  
**LLM Usage**: Optional formatting step only—Amazon Bedrock (via AWS SDK) receives structured facts from the server and returns a rephrased response without adding new content.

## Constitution Check
- Accuracy: [✓] Plan relies solely on bundled OpenAPI YAML and refuses non-supported questions.  
- Consistency: [✓] Both concise and detailed responses planned, always with citations and LLM usage limited to rephrasing extracted facts.  
- Scope: [✓] Only API-related queries handled; non-API questions return polite refusals.  

## Behavior Notes
- Non-API Questions: This agent only handles API-related questions.
- Missing Information: Information unavailable in provided OpenAPI files.
- Response Modes: PoC requires returning both concise and detailed answers.

## Project Structure
specs/0001-api-spec-agent/  
├── spec.md # Feature spec  
├── plan.md # This file  
└── notes.md # Optional notes during PoC  

app/  
├── api/query/route.ts # Next.js route handler  
├── page.tsx # Single-page UI  
└── layout.tsx (if needed by Next.js)  

lib/  
└── openapi-index.ts # Indexing utilities  

public/specs/  
└── todos.yaml  

tests/  
└── query.spec.ts  

## Progress Tracking
- [x] Spec defined  
- [x] Plan written  
- [ ] Minimal prototype running  
- [ ] Answers verified against OpenAPI YAML  
