<!--
Sync Impact Report
Version change: 0.1.0 → 0.1.0 (content simplified)
Modified principles: Removed Simplicity, refined Accuracy/Consistency/Scope language
Added sections: None
Removed sections: Prior governance amendment rules
Templates requiring updates:
- ✅ .specify/templates/plan-template.md
Follow-up TODOs: None
-->
# API Spec QA Agent Constitution (PoC)

## Core Principles
- **Accuracy**: Answer only from the provided OpenAPI YAML files. Do not invent information.
- **Consistency**: Always support both concise and detailed answers, include the source filename(s) as citation, and use any LLM strictly for formatting the extracted facts—never for sourcing new information.
- **Scope**: Respond only to API-related questions. Politely refuse unrelated queries. When the specification lacks the requested details, respond with "information unavailable" (or the localized equivalent 「提供されたOpenAPIファイルには情報がありません。」).

## Governance
- This constitution applies only for the PoC phase.
- You may edit or extend it freely as you refine the agent’s behavior.

**Version**: 0.1.0 | **Ratified**: 2025-10-01 | **Last Amended**: 2025-10-01