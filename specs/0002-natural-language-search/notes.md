# Notes: Natural Language API Search PoC

## TODO / Questions
- (Resolved) Search index reuses `openapi-index.ts` summaries plus property traversal for schema nodes.
- UX detail: highlight the candidate that matches best? (Out of scope for PoC.)

## Configuration
- `SEARCH_SCORE_THRESHOLD` — Minimum BM25スコアを指定。未設定時は 0.2 を使用。
- `SEARCH_TOP_K` — 返却する候補数の最大値。未設定時は 3。0 以下や非数値は自動的にデフォルトへフォールバック。
- `SEARCH_SCORE_GAP` — 自動回答を許可する際に必要なトップ候補の余剰スコア（`score - threshold`）。未設定時は 0.05。0 以上の値を指定可能。
- `EMBEDDINGS_ENABLED` — `true`/`1` の場合、BM25に加えてハッシュベースの埋め込みコサイン類似度を融合。デフォルトは `false`。
- `EMBED_WEIGHT` — 埋め込みスコアに割り当てる重み（0〜1）。デフォルトは 0.4、値は自動でクランプされる。
- `USE_LLM` / `ENABLE_LLM` — `true`/`1` の場合のみ `/api/query` が LLM フォーマットを試行。PoC では未設定（=決定論的テキストのみ）。

## Specs
- OpenAPI YAML は Next.js の `public/specs/` 配下に配置する。ビルド後もファイルは `/specs/*.yaml` として配信され、`lib/spec-loader.ts` がこのディレクトリを読み込んでインデックス化する。
- ディレクトリが存在しない場合でも `loadSpecFiles` が安全に空配列を返すため、必要なファイルが揃っているかは初回起動前に確認しておく。
- 新しい spec を追加したらサーバーを再起動するか `POST /api/search?rebuild=1` でキャッシュをクリアすると即時反映される。

## Usage
1. 依存関係をインストールし、開発サーバーを起動する。
   ```bash
   npm install
   npm run dev
   ```
2. ブラウザで `http://localhost:3000` を開き、単一の「Unified Input」にメソッド+パス（例: `POST /todos`）または自然文質問（例: `ToDo を作成するAPIは？`）を入力し、「Ask」を押す。
3. 入力がメソッド+パスの場合は即座に `/api/query` を呼び出して決定論的回答を表示する。
4. 自然文の場合は `/api/unified` が `/api/search` を利用して候補を算出。しきい値を満たす候補が1件のみで、そのスコアが `SEARCH_SCORE_THRESHOLD + SEARCH_SCORE_GAP` を上回れば自動的に `/api/query` による回答が表示される。`EMBEDDINGS_ENABLED` を有効にすると、BM25スコアと埋め込みスコアの融合により似た語句の検出精度が上がる。
5. 複数候補が残った場合はカードを表示する。カードをクリックすると `Explain {METHOD} {PATH} in detail` で `/api/query` が呼ばれ、詳細回答が描画される。
6. 候補が見つからなければ共通メッセージ「No matching API found. Try different terms.」を表示する。
## Reusable helpers
- `loadSpecFiles(specDir)` — 指定ディレクトリ配下の YAML/JSON を解析し、`SpecFile` 配列として返す。`ENOENT` を握り潰して空配列を返すため、テストや SSR 環境でも扱いやすい。
- `buildIndex(specFiles)` — `openapi-index` や検索インデックスに共有できる `operations` 一覧を構築。仕様ファイル名（`specName`）や正規化済みパス（`normalizedPath`）を含む。
- `listOperations(index)` — UI などで軽量に利用できる `OperationSummary` を抽出。メタデータのみ必要なケースで利用する。
- `extractParameters` / `extractRequestBody` / `extractResponses` — $ref 解決込みで整形済みテキストを返す。LLM へのプロンプトやエンドポイント詳細表示に再利用可能。
- `answerQuestion(index, question)` — 既存の決定論的回答エンジン。検索結果に対する説明生成など、QA 以外のユースケースでも流用できる。

## API access
- `POST /api/search` に `{ "query": "注文を作成するAPIは？" }` を送ると JSON で候補が返る。レスポンス候補には `sourceType` と `matchedPropertyPath`（プロパティ由来の場合）が含まれる。
- 再インデックスが必要な場合は `?rebuild=1` を付与して呼び出すとスペック＆検索キャッシュがクリアされる。
   ```bash
   curl -s "http://localhost:3000/api/search?rebuild=1" \
      -H "Content-Type: application/json" \
      -d '{"query":"注文を作成するAPIは？"}'
   ```
- `/api/query` へは `question` フィールドに HTTP メソッド／パスを含む文字列を渡す。
- `/api/unified` に `{ "input": "注文を作成するAPIは？" }` を渡すとルーティング結果（answer/candidates/not_found）が返る。`routedTo` で `query` or `search`、`autoAnswered` で自動回答の有無を判別可能。

## Deterministic answer integration
- 検索UIの候補カードは `Explain {METHOD} {PATH} in detail` を生成して `/api/query` に渡すため、既存の決定論的回答フロー（LLM有無に関わらずcitation付きレスポンス）がそのまま利用される。プロパティ一致により自動回答された場合も `matchedPropertyPath` を利用して UI でハイライト可能。
- `tests/query.acceptance.spec.ts` ではデフォルトが決定論的回答であること、環境変数で LLM を任意に有効化できることを検証している。
- `tests/unified.acceptance.spec.ts` で単一入力フローのルーティング、安定性、共通メッセージを確認済み。
- `/api/query` は `lib/spec-loader` のキャッシュを共有するため、`?rebuild=1` で再索引した後も最新のスペックに対して検索→回答が一貫して動作する。

## Implementation Sketch
1. Extend `openapi-index.ts` (or new module) to expose a list of operations including method, path, summary, description, parameters, request/response schemas.
2. Build flattened text document for each operation including metadata and schema field names/descriptions.
3. Tokenize documents: lowercase, remove punctuation, split camelCase/snake_case, split on whitespace (Japanese support is best-effort via whitespace; no morphological analysis). Normalize paths so `/todos` and `/todos/`, `{id}` and `:id` style placeholders align.
4. Implement lightweight TF-IDF-style scoring (BM25-like optional):
   - Pre-compute document frequencies and average document length.
   - Score query tokens for each document and sum normalized scores.
   - Apply deterministic ordering: score descending, tie-break by path ascending.
5. Create `/api/search` route:
   - Accept `{ query }`, reject empty queries.
   - Tokenize query using same rules; compute scores; sort; apply threshold; return up to `SEARCH_TOP_K` candidates.
   - Support `?rebuild=1` query param in development to force index rebuild after spec updates.
   - Return `{ candidates: [], message: "No matching API found. Try different terms." }` when no candidate passes the threshold (UI should display `message` when present).
6. Update UI (`app/page.tsx`):
   - Add search input separate from Q&A form.
   - Display candidate cards with method/path/summary/score.
   - Selecting a card triggers existing Q&A form for that operation.
7. Tests:
   - Acceptance tests for the 4 scenarios + stability ordering.
   - Unit tests covering tokenizer behavior: punctuation removal, camel/snake splitting, lowercase normalization (at least one case each) to aid debugging.

## Open Questions / Future Work
- Consider caching index at build/startup vs. on demand; `/api/search` must remain purely deterministic (no LLM/external calls, even if Bedrock env vars are present).
- Potential future upgrade: synonyms or simple heuristics for Japanese verbs/nouns without LLM.
- Explore configuration for weighting fields (summary vs. schema fields) if time allows.
- Keep "No matching API found. Try different terms." as the shared not-found message across API and UI.
