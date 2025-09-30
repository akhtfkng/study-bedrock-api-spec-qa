# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]

## Summary
[Extract from feature spec: primary requirement and scope for the PoC]

## Technical Context
**Language/Version**: [e.g., Python 3.11 or NEEDS CLARIFICATION]  
**Primary Dependencies**: [e.g., FastAPI, OpenAPI parser]  
**Storage**: [if applicable, e.g., none or simple file storage]  
**Project Type**: [e.g., Local test app, SaaS backend]

## Constitution Check
- Accuracy: [✓] Must answer only from OpenAPI YAML  
- Consistency: [✓] Concise & detailed answers, with citation  
- Scope: [✓] Only API-related questions  

## Behavior Notes
- Non-API Questions: This agent only handles API-related questions.
- Missing Information: Information unavailable in provided OpenAPI files.
- Response Modes: PoC requires returning both concise and detailed answers.

## Project Structure
specs/[###-feature]/
├── spec.md # Feature spec
├── plan.md # This file
└── notes.md # Optional notes during PoC

## Progress Tracking
- [ ] Spec defined  
- [ ] Plan written  
- [ ] Minimal prototype running  
- [ ] Answers verified against OpenAPI YAML  
