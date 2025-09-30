import {
  listOperations,
  extractParameters,
  extractRequestBody,
  extractResponses,
  resolveRef,
  type HttpMethod,
  type OperationSummary,
  type ResolvedParameter,
  type ResolvedRequestBody,
  type ResolvedResponse
} from "@/lib/openapi-index";
import { loadCachedOpenApiIndex, onSpecCacheReset, resetSpecCaches } from "@/lib/spec-loader";
import type { OpenAPIV3 } from "openapi-types";

const DEFAULT_THRESHOLD = 0.2;
const DEFAULT_TOP_K = 3;
const DEFAULT_SCORE_GAP = 0.05;
const DEFAULT_EMBED_WEIGHT = 0.4;
const EMBEDDING_DIMENSION = 256;

export type SearchConfig = {
  threshold: number;
  topK: number;
  scoreGap: number;
};

export type SearchCandidate = {
  method: HttpMethod;
  path: string;
  summary: string | null;
  score: number;
  specName: string;
  sourceType?: "operation" | "property";
  matchedPropertyPath?: string | null;
};

type EmbeddingVector = {
  values: Float32Array;
  norm: number;
};

type SearchNodeType = "operation" | "property";

type SearchNode = {
  id: string;
  nodeType: SearchNodeType;
  operation: OperationSummary;
  tokens: string[];
  termFrequency: Map<string, number>;
  length: number;
  summary: string | null;
  specName: string;
  matchedPropertyPath?: string;
  embedding: EmbeddingVector | null;
};

type SearchIndex = {
  nodes: SearchNode[];
  idf: Map<string, number>;
  documentCount: number;
  averageDocumentLength: number;
};

type EmbeddingConfig = {
  enabled: boolean;
  weight: number;
};

let cachedIndexPromise: Promise<SearchIndex> | null = null;

export function resetSearchIndex(): void {
  cachedIndexPromise = null;
}

onSpecCacheReset(() => {
  resetSearchIndex();
});

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function parseNonNegativeNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return fallback;
}

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseWeight(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

function normalizeText(input: string): string {
  return input.normalize("NFKC");
}

function splitCamelCase(term: string): string {
  return term.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

function normalizePunctuation(term: string): string {
  return term.replace(/["'`’]/g, "").replace(/[_\-]+/g, " ");
}

function normalizeTerm(term: string): string {
  return normalizePunctuation(splitCamelCase(normalizeText(term))).toLowerCase();
}
export function getSearchConfig(): SearchConfig {
  const threshold = parsePositiveNumber(process.env.SEARCH_SCORE_THRESHOLD, DEFAULT_THRESHOLD);
  const topK = Math.max(1, Math.floor(parsePositiveNumber(process.env.SEARCH_TOP_K, DEFAULT_TOP_K)));
  const scoreGap = parseNonNegativeNumber(process.env.SEARCH_SCORE_GAP, DEFAULT_SCORE_GAP);

  return { threshold, topK, scoreGap };
}

function getEmbeddingConfig(): EmbeddingConfig {
  const enabled = parseBooleanFlag(process.env.EMBEDDINGS_ENABLED, false);
  const weight = parseWeight(process.env.EMBED_WEIGHT, DEFAULT_EMBED_WEIGHT);
  return { enabled, weight };
}
const TODO_SYNONYMS = ["todo", "todos", "タスク", "to-do"];
const CREATE_SYNONYMS = ["作成", "登録", "登録する", "追加", "新規", "作る", "生成", "create", "add", "register", "new"];
const RETRIEVE_SYNONYMS = ["取得", "参照", "照会", "読む", "get", "fetch", "read"];
const UPDATE_SYNONYMS = ["更新", "変更", "編集", "修正", "upsert", "update", "modify", "edit", "change"];
const DELETE_SYNONYMS = ["削除", "消去", "破棄", "削る", "delete", "remove", "destroy"];
const LIST_SYNONYMS = ["一覧", "検索", "絞り込み", "list", "find", "search", "query"];
const STATUS_SYNONYMS = ["完了", "完了済み", "ステータス", "状態", "done", "status", "completed"];
const POSTAL_SYNONYMS = ["郵便", "郵便番号", "postalcode", "postal_code", "zipcode"];

const SYNONYM_GROUPS: string[][] = [
  TODO_SYNONYMS,
  CREATE_SYNONYMS,
  RETRIEVE_SYNONYMS,
  UPDATE_SYNONYMS,
  DELETE_SYNONYMS,
  LIST_SYNONYMS,
  STATUS_SYNONYMS,
  POSTAL_SYNONYMS
];

function buildSynonymMap(groups: string[][]): Record<string, string[]> {
  const map = new Map<string, Set<string>>();

  const addRelation = (term: string, related: string): void => {
    if (!map.has(term)) {
      map.set(term, new Set());
    }
    map.get(term)!.add(related);
  };

  for (const group of groups) {
    const normalizedGroup = group.map((term) => normalizeTerm(term));
    for (let i = 0; i < normalizedGroup.length; i += 1) {
      const base = normalizedGroup[i];
      for (let j = 0; j < normalizedGroup.length; j += 1) {
        if (i === j) continue;
        addRelation(base, normalizedGroup[j]);
      }
    }
  }

  return Object.fromEntries(
    Array.from(map.entries()).map(([key, value]) => [key, Array.from(value)])
  );
}

const SYNONYM_MAP = buildSynonymMap(SYNONYM_GROUPS);

const TOKEN_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|[a-z0-9]+/gu;
const JAPANESE_CHAR_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const SYNONYM_ENTRIES = Object.entries(SYNONYM_MAP);

const BM25_K1 = 1.5;
const BM25_B = 0.75;

const METHOD_HINT_WEIGHT = 0.5;
const METHOD_HINTS: Partial<Record<HttpMethod, Set<string>>> = {
  POST: new Set(CREATE_SYNONYMS.map((term) => normalizeTerm(term))),
  PUT: new Set(UPDATE_SYNONYMS.map((term) => normalizeTerm(term))),
  PATCH: new Set(UPDATE_SYNONYMS.map((term) => normalizeTerm(term))),
  DELETE: new Set(DELETE_SYNONYMS.map((term) => normalizeTerm(term))),
  GET: new Set([...RETRIEVE_SYNONYMS, ...LIST_SYNONYMS, ...STATUS_SYNONYMS].map((term) => normalizeTerm(term)))
};

const EMPTY_STRING_SET = new Set<string>();

export function tokenize(text: string): string[] {
  if (!text) return [];

  const normalized = normalizeTerm(text);
  const tokens: string[] = [];

  let match: RegExpExecArray | null;
  TOKEN_REGEX.lastIndex = 0;
  while ((match = TOKEN_REGEX.exec(normalized)) !== null) {
    tokens.push(match[0]);
  }

  return tokens;
}

function generateCharacterNGrams(token: string): string[] {
  const ngrams: string[] = [];
  const length = token.length;
  for (let size = 2; size <= 3; size += 1) {
    if (length < size) continue;
    for (let index = 0; index <= length - size; index += 1) {
      const segment = token.slice(index, index + size);
      if (JAPANESE_CHAR_REGEX.test(segment)) {
        ngrams.push(segment);
      }
    }
  }
  return ngrams;
}

type QueryContext = {
  frequency: Map<string, number>;
  tokenSet: Set<string>;
};

function buildQueryContext(tokens: string[]): QueryContext {
  const frequency = new Map<string, number>();
  const tokenSet = new Set<string>();

  const addToken = (value: string, weight = 1): void => {
    if (!value) return;
    tokenSet.add(value);
    frequency.set(value, (frequency.get(value) ?? 0) + weight);
  };

  for (const token of tokens) {
    addToken(token);

    const synonyms = SYNONYM_MAP[token];
    if (synonyms) {
      for (const synonym of synonyms) {
        addToken(synonym);
      }
    }

    if (JAPANESE_CHAR_REGEX.test(token)) {
      const ngrams = generateCharacterNGrams(token);
      for (const gram of ngrams) {
        addToken(gram);
        const gramSynonyms = SYNONYM_MAP[gram];
        if (gramSynonyms) {
          for (const synonym of gramSynonyms) {
            addToken(synonym);
          }
        }
      }
    }

    for (const [root, rootSynonyms] of SYNONYM_ENTRIES) {
      if (root === token) continue;
      if (!JAPANESE_CHAR_REGEX.test(root)) continue;
      if (!token.includes(root)) continue;

      addToken(root);

      for (const synonym of rootSynonyms) {
        addToken(synonym);
      }
    }
  }

  return { frequency, tokenSet };
}

function computeMethodBias(method: HttpMethod, tokenSet: Set<string>): number {
  const hintSet = METHOD_HINTS[method] ?? EMPTY_STRING_SET;
  for (const hint of hintSet) {
    if (tokenSet.has(hint)) {
      return METHOD_HINT_WEIGHT;
    }
  }
  return 0;
}

function extractSchemaSnippet(schema?: string | null): string[] {
  if (!schema) return [];
  try {
    const parsed = JSON.parse(schema) as unknown;
    return tokenize(JSON.stringify(parsed));
  } catch {
    return tokenize(schema);
  }
}

function collectParameterTokens(parameters: ResolvedParameter[]): string[] {
  const tokens: string[] = [];
  for (const parameter of parameters) {
    tokens.push(...tokenize(parameter.name));
    tokens.push(...tokenize(parameter.in));
    if (parameter.description) {
      tokens.push(...tokenize(parameter.description));
    }
  }
  return tokens;
}

function collectRequestBodyTokens(requestBody: ResolvedRequestBody): string[] {
  if (!requestBody) {
    return [];
  }

  const tokens: string[] = [];
  if (requestBody.description) {
    tokens.push(...tokenize(requestBody.description));
  }
  tokens.push(...extractSchemaSnippet(requestBody.schema ?? null));
  return tokens;
}

function collectResponseTokens(responses: ResolvedResponse[]): string[] {
  const tokens: string[] = [];
  for (const response of responses) {
    tokens.push(...tokenize(response.status));
    if (response.description) {
      tokens.push(...tokenize(response.description));
    }
    tokens.push(...extractSchemaSnippet(response.schema));
  }
  return tokens;
}

type PropertyDescriptor = {
  path: string[];
  tokens: string[];
};

type PropertyAccumulatorEntry = {
  path: string[];
  tokens: Set<string>;
};

type PropertyAccumulator = Map<string, PropertyAccumulatorEntry>;

function normalizeIdentifier(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

function resolveSchemaObject(
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | undefined,
  document: OpenAPIV3.Document
): OpenAPIV3.SchemaObject | undefined {
  if (!schema) return undefined;
  if ("$ref" in schema) {
    const resolved = resolveRef(document, schema.$ref);
    if (resolved && typeof resolved === "object") {
      return resolved as OpenAPIV3.SchemaObject;
    }
    return undefined;
  }
  if (typeof schema === "boolean") {
    return undefined;
  }
  return schema;
}

function addTokens(entry: PropertyAccumulatorEntry, tokens: string[]): void {
  for (const token of tokens) {
    if (token) {
      entry.tokens.add(token);
    }
  }
}

function buildPropertyTokens(
  propertyName: string,
  baseTokens: string[],
  schema: OpenAPIV3.SchemaObject | undefined
): string[] {
  const tokens: string[] = [...baseTokens, ...tokenize(propertyName)];
  const normalized = normalizeIdentifier(propertyName);
  if (normalized) {
    tokens.push(normalized);
  }

  if (schema) {
    if (schema.title) {
      tokens.push(...tokenize(schema.title));
    }
    if (schema.description) {
      tokens.push(...tokenize(schema.description));
    }
    if (schema.type) {
      tokens.push(...tokenize(Array.isArray(schema.type) ? schema.type.join(" ") : schema.type));
    }
    if (schema.format) {
      tokens.push(...tokenize(schema.format));
    }
    if (Array.isArray(schema.enum)) {
      for (const enumValue of schema.enum) {
        tokens.push(...tokenize(String(enumValue)));
      }
    }
  }

  return tokens;
}

function collectSchemaPropertyDescriptors(
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
  document: OpenAPIV3.Document,
  pathSegments: string[],
  baseTokens: string[],
  accumulator: PropertyAccumulator,
  visited: WeakSet<OpenAPIV3.SchemaObject>
): void {
  const resolved = resolveSchemaObject(schema, document);
  if (!resolved) return;
  if (visited.has(resolved)) return;
  visited.add(resolved);

  const composite = [resolved.allOf, resolved.anyOf, resolved.oneOf].filter(Boolean) as OpenAPIV3.SchemaObject[][];
  for (const group of composite) {
    for (const item of group) {
      collectSchemaPropertyDescriptors(item, document, pathSegments, baseTokens, accumulator, visited);
    }
  }

  if (resolved.properties) {
    for (const [propertyName, propertySchema] of Object.entries(resolved.properties)) {
      const propertyPath = [...pathSegments, propertyName];
      const pathKey = propertyPath.join(".");
      const entry = accumulator.get(pathKey) ?? {
        path: propertyPath,
        tokens: new Set<string>()
      };

      const resolvedProperty = resolveSchemaObject(propertySchema, document);
      const propertyTokens = buildPropertyTokens(propertyName, baseTokens, resolvedProperty);
      addTokens(entry, propertyTokens);
      accumulator.set(pathKey, entry);

      const nextBaseTokens = [...baseTokens, ...tokenize(propertyName)];
      const normalized = normalizeIdentifier(propertyName);
      if (normalized) {
        nextBaseTokens.push(normalized);
      }

      if (resolvedProperty) {
        collectSchemaPropertyDescriptors(
          resolvedProperty,
          document,
          propertyPath,
          nextBaseTokens,
          accumulator,
          visited
        );
      }
    }
  }

  if (resolved.additionalProperties && typeof resolved.additionalProperties === "object") {
    collectSchemaPropertyDescriptors(
      resolved.additionalProperties as OpenAPIV3.SchemaObject,
      document,
      [...pathSegments, "additionalProperties"],
      [...baseTokens, "additional", "properties"],
      accumulator,
      visited
    );
  }

  if ("items" in resolved && resolved.items) {
    const items = resolved.items;
    if (Array.isArray(items)) {
      items.forEach((itemSchema, index) => {
        collectSchemaPropertyDescriptors(
          itemSchema,
          document,
          [...pathSegments, `items${index}`],
          [...baseTokens, "items"],
          accumulator,
          visited
        );
      });
    } else if (typeof items === "object") {
      collectSchemaPropertyDescriptors(
        items,
        document,
        [...pathSegments, "items"],
        [...baseTokens, "items"],
        accumulator,
        visited
      );
    }
  }
}

function collectPropertyDescriptorsForOperation(
  operation: OperationSummary,
  requestBody: ResolvedRequestBody,
  responses: ResolvedResponse[]
): PropertyDescriptor[] {
  const accumulator: PropertyAccumulator = new Map();

  if (requestBody?.schemaObject) {
    const baseTokens = [...tokenize("request body"), normalizeIdentifier("request body")].filter(Boolean) as string[];
    collectSchemaPropertyDescriptors(
      requestBody.schemaObject,
      operation.document,
      ["requestBody"],
      baseTokens,
      accumulator,
      new WeakSet()
    );
  }

  for (const response of responses) {
    if (!response.schemaObject) continue;
    const statusTokens = [...tokenize("response"), ...tokenize(response.status)];
    const normalizedStatus = normalizeIdentifier(response.status);
    if (normalizedStatus) {
      statusTokens.push(normalizedStatus);
    }
    collectSchemaPropertyDescriptors(
      response.schemaObject,
      operation.document,
      ["response", response.status],
      statusTokens,
      accumulator,
      new WeakSet()
    );
  }

  const descriptors: PropertyDescriptor[] = [];
  for (const entry of accumulator.values()) {
    const tokens = Array.from(entry.tokens);
    if (tokens.length === 0) continue;
    descriptors.push({ path: entry.path, tokens });
  }

  return descriptors;
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function createEmbedding(tokens: string[]): EmbeddingVector | null {
  if (tokens.length === 0) {
    return null;
  }

  const values = new Float32Array(EMBEDDING_DIMENSION);

  for (const token of tokens) {
    const hash = fnv1a(token);
    const index = hash % EMBEDDING_DIMENSION;
    const sign = (hash & 1) === 0 ? 1 : -1;
    const magnitude = 1 + ((hash >>> 1) & 0x7) / 8;
    values[index] += sign * magnitude;
  }

  let norm = 0;
  for (let i = 0; i < values.length; i += 1) {
    norm += values[i] * values[i];
  }
  norm = Math.sqrt(norm);

  return { values, norm };
}

function cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
  if (a.norm === 0 || b.norm === 0) {
    return 0;
  }

  let dot = 0;
  const length = Math.min(a.values.length, b.values.length);
  for (let i = 0; i < length; i += 1) {
    dot += a.values[i] * b.values[i];
  }

  return dot / (a.norm * b.norm);
}

function createSearchNode(options: {
  id: string;
  nodeType: SearchNodeType;
  operation: OperationSummary;
  tokens: string[];
  specName: string;
  matchedPropertyPath?: string;
}): SearchNode {
  const filteredTokens = options.tokens.filter(Boolean);
  const termFrequency = new Map<string, number>();
  for (const token of filteredTokens) {
    termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
  }

  const embedding = createEmbedding(filteredTokens);

  return {
    id: options.id,
    nodeType: options.nodeType,
    operation: options.operation,
    tokens: filteredTokens,
    termFrequency,
    length: filteredTokens.length,
    summary: options.operation.operation.summary ?? null,
    specName: options.specName,
    matchedPropertyPath: options.matchedPropertyPath,
    embedding
  };
}

function buildOperationNodes(operation: OperationSummary): SearchNode[] {
  const tokens: string[] = [];

  tokens.push(...tokenize(operation.method));
  tokens.push(...tokenize(operation.path));
  tokens.push(...tokenize(operation.normalizedPath));

  if (operation.operation.operationId) {
    tokens.push(...tokenize(operation.operation.operationId));
  }

  if (operation.operation.tags) {
    for (const tag of operation.operation.tags) {
      tokens.push(...tokenize(tag));
    }
  }

  if (operation.operation.summary) {
    tokens.push(...tokenize(operation.operation.summary));
  }

  if (operation.operation.description) {
    tokens.push(...tokenize(operation.operation.description));
  }

  const parameters = extractParameters(operation.operation, operation.document);
  tokens.push(...collectParameterTokens(parameters));

  const requestBody = extractRequestBody(operation.operation, operation.document);
  tokens.push(...collectRequestBodyTokens(requestBody));

  const responses = extractResponses(operation.operation, operation.document);
  tokens.push(...collectResponseTokens(responses));

  const descriptors = collectPropertyDescriptorsForOperation(operation, requestBody, responses);

  const nodeIdBase = buildOperationKey(operation.method, operation.path);
  const nodes: SearchNode[] = [];

  nodes.push(
    createSearchNode({
      id: `op:${nodeIdBase}`,
      nodeType: "operation",
      operation,
      tokens,
      specName: operation.specName
    })
  );

  for (const descriptor of descriptors) {
    nodes.push(
      createSearchNode({
        id: `prop:${nodeIdBase}:${descriptor.path.join(".")}`,
        nodeType: "property",
        operation,
        tokens: descriptor.tokens,
        specName: operation.specName,
        matchedPropertyPath: descriptor.path.join(".")
      })
    );
  }

  return nodes;
}

function buildOperationKey(method: HttpMethod, path: string): string {
  return `${method}:${path}`;
}

async function buildSearchIndex(): Promise<SearchIndex> {
  const index = await loadCachedOpenApiIndex();
  const operations = listOperations(index);

  const nodes: SearchNode[] = [];
  for (const operation of operations) {
    nodes.push(...buildOperationNodes(operation));
  }

  const nodesWithTokens = nodes.filter((node) => node.length > 0);
  const operationNodes = nodesWithTokens.filter((node) => node.nodeType === "operation");
  const documentFrequency = new Map<string, number>();

  const idfBaseNodes = operationNodes.length > 0 ? operationNodes : nodesWithTokens;

  for (const node of idfBaseNodes) {
    const seen = new Set<string>();
    for (const token of node.tokens) {
      if (seen.has(token)) continue;
      seen.add(token);
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const documentCount = idfBaseNodes.length || 1;
  const totalLength = idfBaseNodes.reduce((sum, node) => sum + node.length, 0);
  const averageDocumentLength = documentCount === 0 ? 0 : totalLength / documentCount;

  const idf = new Map<string, number>();
  for (const [token, df] of documentFrequency.entries()) {
    const value = Math.log((documentCount + 1) / (df + 1)) + 1;
    idf.set(token, value);
  }

  return {
    nodes,
    idf,
    documentCount,
    averageDocumentLength
  };
}

async function loadSearchIndex(options?: { forceReload?: boolean }): Promise<SearchIndex> {
  if (options?.forceReload) {
    cachedIndexPromise = null;
  }

  if (!cachedIndexPromise) {
    cachedIndexPromise = buildSearchIndex();
  }

  return cachedIndexPromise;
}

function computeBm25Score(
  node: SearchNode,
  queryFrequency: Map<string, number>,
  index: SearchIndex
): number {
  if (node.length === 0 || index.averageDocumentLength === 0) {
    return 0;
  }

  let score = 0;

  for (const [token, qFrequency] of queryFrequency.entries()) {
    const docFrequency = node.termFrequency.get(token);
    if (!docFrequency) continue;

    const inverseDocumentFrequency = index.idf.get(token) ?? Math.log((index.documentCount + 1) / 1) + 1;
    if (inverseDocumentFrequency === 0) continue;

    const numerator = docFrequency * (BM25_K1 + 1);
    const denominator = docFrequency + BM25_K1 * (1 - BM25_B + BM25_B * (node.length / index.averageDocumentLength));
    if (denominator === 0) continue;

    const docWeight = numerator / denominator;
    const queryWeight = 1 + Math.log(1 + qFrequency);

    score += docWeight * inverseDocumentFrequency * queryWeight;
  }

  return score;
}

export async function searchOperations(query: string, options?: { forceReload?: boolean }): Promise<SearchCandidate[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const config = getSearchConfig();
  const embeddingConfig = getEmbeddingConfig();

  if (options?.forceReload) {
    resetSpecCaches();
    resetSearchIndex();
  }

  const index = await loadSearchIndex(options);

  const rawTokens = tokenize(trimmed);
  if (rawTokens.length === 0) {
    return [];
  }

  const { frequency: queryFrequency, tokenSet: queryTokenSet } = buildQueryContext(rawTokens);
  const queryTokensForEmbedding = Array.from(queryTokenSet);
  const queryEmbedding = embeddingConfig.enabled ? createEmbedding(queryTokensForEmbedding) : null;

  const candidatesByOperation = new Map<string, { score: number; candidate: SearchCandidate }>();

  for (const node of index.nodes) {
    const bm25Score = computeBm25Score(node, queryFrequency, index);

  let fusedScore = bm25Score;

  fusedScore += computeMethodBias(node.operation.method, queryTokenSet);

    if (embeddingConfig.enabled && queryEmbedding && node.embedding) {
      const cosine = cosineSimilarity(queryEmbedding, node.embedding);
      const normalizedCosine = (cosine + 1) / 2;
      fusedScore = bm25Score * (1 - embeddingConfig.weight) + normalizedCosine * embeddingConfig.weight;
    }

    if (fusedScore < config.threshold) {
      continue;
    }

    const operationKey = buildOperationKey(node.operation.method, node.operation.path);
    const existing = candidatesByOperation.get(operationKey);

    const candidate: SearchCandidate = {
      method: node.operation.method,
      path: node.operation.path,
      summary: node.operation.operation.summary ?? null,
      score: fusedScore,
      specName: node.operation.specName,
      sourceType: node.nodeType,
      matchedPropertyPath: node.matchedPropertyPath ?? null
    };

    if (
      !existing ||
      fusedScore > existing.score ||
      (fusedScore === existing.score && existing.candidate.sourceType === "operation" && node.nodeType === "property")
    ) {
      candidatesByOperation.set(operationKey, { score: fusedScore, candidate });
    }
  }

  const candidates = Array.from(candidatesByOperation.values()).map((entry) => entry.candidate);

  candidates.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (a.path === b.path) {
      return a.method.localeCompare(b.method);
    }
    return a.path.localeCompare(b.path);
  });

  return candidates.slice(0, config.topK);

}
