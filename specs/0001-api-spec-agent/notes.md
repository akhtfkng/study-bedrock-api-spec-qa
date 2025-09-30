# Usage Notes: API Spec QA Agent (PoC)

- Install dependencies and start the dev server:
  - `npm install`
  - `npm run dev`
- Ask API-related questions using the provided UI at http://localhost:3000.
  - Include an HTTP method and path (e.g., `POST /todos`).
  - モード選択は不要で、質問文から自動的に concise/detailed を判断します。
- The backend indexes OpenAPI YAML files under `public/specs/` on startup. Add new specs there and restart the server to refresh the index.
- Tests (`npm test`) validate key scenarios: parameter listing, detailed responses, refusal of non-API questions, and missing operation handling.
