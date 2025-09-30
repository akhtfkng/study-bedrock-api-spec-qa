# Tasks: [FEATURE NAME]

**Input**: Design documents from `/specs/[###-feature-name]/`
**Prerequisites**: plan.md (required)

## Format
- `[ID] Description`

## Tasks

### Setup
- [ ] T001 Create minimal project structure
- [ ] T002 Install dependencies (e.g., OpenAPI parser, basic test framework)

### Tests
- [ ] T003 Write a simple test that queries an OpenAPI YAML file
- [ ] T004 Add a test for citation output (source filename)
- [ ] T005 Add a test to reject non-API questions
- [ ] T006 Add a test to return "information unavailable" when operations are missing

### Core Implementation
- [ ] T007 Implement parser to load OpenAPI YAML
- [ ] T008 Implement concise answer generation
- [ ] T009 Implement detailed answer generation
- [ ] T010 Ensure both concise and detailed modes are always supported
- [ ] T011 Include filename in all responses
- [ ] T012 Add filter to refuse non-API queries

### Polish
- [ ] T013 Run tests and confirm all pass
- [ ] T014 Write short usage notes in docs/notes.md