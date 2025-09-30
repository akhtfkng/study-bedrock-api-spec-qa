import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";
import { OpenAPIV3 } from "openapi-types";
import yaml from "yaml";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export type LlmAnswerPayload = {
  mode: "concise" | "detailed";
  method: HttpMethod;
  path: string;
  summary?: string | null;
  description?: string | null;
  parameters: Array<{
    name: string;
    in: string;
    required: boolean;
    description?: string | null;
  }>;
  requestBody?: {
    description?: string | null;
    schema?: string | null;
  };
  responses: Array<{
    status: string;
    description?: string | null;
    schema?: string | null;
  }>;
  citation: string;
};

export type DeterministicAnswer = {
  text: string;
  citation: string;
  mode: "concise" | "detailed";
  reason: "ok" | "refusal" | "unknown";
  payload?: LlmAnswerPayload;
};

export type OperationRecord = {
  method: HttpMethod;
  path: string;
  normalizedPath: string;
  pathRegex: RegExp;
  specName: string;
  document: OpenAPIV3.Document;
  operation: OpenAPIV3.OperationObject;
};

export type ResolvedParameter = {
  name: string;
  in: string;
  required: boolean;
  description?: string;
};

export type ResolvedRequestBody = {
  description?: string | null;
  schema?: string | null;
  schemaObject?: OpenAPIV3.SchemaObject | null;
} | null;

export type ResolvedResponse = {
  status: string;
  description?: string;
  schema?: string;
  schemaObject?: OpenAPIV3.SchemaObject;
};

export type OperationSummary = {
  method: HttpMethod;
  path: string;
  normalizedPath: string;
  specName: string;
  document: OpenAPIV3.Document;
  operation: OpenAPIV3.OperationObject;
};

export type SpecFile = {
  name: string;
  document: OpenAPIV3.Document;
};

export type OpenApiIndex = {
  operations: OperationRecord[];
};

const REFUSAL_TEXT = "HTTPメソッドとパスを含むAPIに関する質問のみに回答できます。";
const UNKNOWN_TEXT = "提供されたOpenAPIファイルには情報がありません。";
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_SCHEMA_LENGTH = 1000;
const MAX_RESPONSE_ENTRIES = 5;

export async function loadSpecFiles(specDir: string): Promise<SpecFile[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(specDir, { withFileTypes: true });
  } catch (error) {
    const err = error as { code?: string } | undefined;
    if (err?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const specs: SpecFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.ya?ml$/i.test(entry.name)) continue;

    const filePath = path.join(specDir, entry.name);
    const content = await fs.readFile(filePath, "utf8");
    const document = yaml.parse(content) as OpenAPIV3.Document | undefined;

    if (!document || typeof document !== "object" || !("openapi" in document || "swagger" in document)) {
      continue;
    }

    specs.push({ name: entry.name, document });
  }

  return specs;
}

export function buildIndex(specFiles: SpecFile[]): OpenApiIndex {
  const operations: OperationRecord[] = [];

  for (const spec of specFiles) {
    const { document, name } = spec;
    if (!document.paths) continue;

    for (const [rawPath, pathItem] of Object.entries(document.paths)) {
      if (!pathItem) continue;
      const normalizedPath = normalizePath(rawPath);
      const pathRegex = buildPathRegex(normalizedPath);

      for (const method of HTTP_METHODS) {
        const key = method.toLowerCase() as keyof OpenAPIV3.PathItemObject;
        const candidate = (pathItem as OpenAPIV3.PathItemObject)[key];
        if (!isOperationObject(candidate)) continue;

        operations.push({
          method,
          path: rawPath,
          normalizedPath,
          pathRegex,
          specName: name,
          document,
          operation: candidate
        });
      }
    }
  }

  return { operations };
}

export function listOperations(index: OpenApiIndex): OperationSummary[] {
  return index.operations.map((record) => ({
    method: record.method,
    path: record.path,
    normalizedPath: record.normalizedPath,
    specName: record.specName,
    document: record.document,
    operation: record.operation
  }));
}

export function answerQuestion(index: OpenApiIndex, question: string): DeterministicAnswer {
  const trimmed = question.trim();
  if (!trimmed) {
    return { text: REFUSAL_TEXT, citation: "N/A", mode: "concise", reason: "refusal" };
  }

  const mode = inferMode(trimmed);
  const parsed = parseQuestion(trimmed);

  if (!parsed) {
    return { text: REFUSAL_TEXT, citation: "N/A", mode, reason: "refusal" };
  }

  const record = findOperation(index, parsed.method, parsed.path);

  if (!record) {
    return { text: UNKNOWN_TEXT, citation: "N/A", mode, reason: "unknown" };
  }

  const { operation, document } = record;
  const parameters = extractParameters(operation, document);
  const requestBody = extractRequestBody(operation, document);
  const responses = extractResponses(operation, document);

  const parts: string[] = [];

  if (operation.summary) {
    parts.push(`${parsed.method} ${record.path} — ${operation.summary}。`);
  } else {
    parts.push(`${parsed.method} ${record.path}。`);
  }

  if (parameters.length > 0) {
    const parameterSummary = parameters
      .map((parameter) => {
        const status = parameter.required ? "必須" : "任意";
        const details = parameter.description ? `・${parameter.description}` : "";
        return `${parameter.name}（${parameter.in}・${status}${details}）`;
      })
      .join("、 ");
    parts.push(`パラメータ: ${parameterSummary}。`);
  } else {
    parts.push("パラメータ: 定義されていません。");
  }

  if (mode === "detailed") {
    if (requestBody) {
      const details: string[] = [];
      if (requestBody.description) {
        details.push(`説明: ${requestBody.description}`);
      }
      if (requestBody.schema) {
        details.push(`スキーマ: ${requestBody.schema}`);
      }
      if (details.length > 0) {
        parts.push(`リクエストボディ: ${details.join(" ")}。`);
      }
    }

    if (responses.length > 0) {
      const responseSummary = responses
        .map((response) => {
          const segments: string[] = [response.status];
          if (response.description) {
            segments.push(response.description);
          }
          if (response.schema) {
            segments.push(`スキーマ: ${response.schema}`);
          }
          return segments.join(" — ");
        })
        .join(" | ");
      parts.push(`レスポンス: ${responseSummary}。`);
    }
  }

  if (!operation.summary && mode === "concise") {
    parts.push("仕様には要約が記載されていません。");
  }

  const payload: LlmAnswerPayload = {
    mode,
    method: parsed.method,
    path: record.path,
    summary: truncate(operation.summary, MAX_DESCRIPTION_LENGTH),
    description: truncate(operation.description, MAX_DESCRIPTION_LENGTH),
    parameters: parameters.map((parameter) => ({
      name: parameter.name,
      in: parameter.in,
      required: parameter.required,
      description: truncate(parameter.description, MAX_DESCRIPTION_LENGTH)
    })),
    requestBody: requestBody
      ? {
          description: truncate(requestBody.description, MAX_DESCRIPTION_LENGTH),
          schema: truncate(requestBody.schema, MAX_SCHEMA_LENGTH)
        }
      : undefined,
    responses: responses
      .slice(0, MAX_RESPONSE_ENTRIES)
      .map((response) => ({
        status: response.status,
        description: truncate(response.description, MAX_DESCRIPTION_LENGTH),
        schema: truncate(response.schema, MAX_SCHEMA_LENGTH)
      })),
    citation: record.specName
  };

  return {
    text: parts.join(" "),
    citation: record.specName,
    mode,
    reason: "ok",
    payload
  };
}

export function normalizePath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "/";
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const collapsed = withLeadingSlash.replace(/\/+/g, "/");
  if (collapsed.length === 1) {
    return collapsed;
  }
  const withoutTrailing = collapsed.replace(/\/+$/u, "");
  return withoutTrailing.length ? withoutTrailing : "/";
}

function parseQuestion(question: string): { method: HttpMethod; path: string } | null {
  const match = question.match(/\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b\s+([^\s?]+)/i);
  if (!match) return null;

  const method = match[1].toUpperCase() as HttpMethod;
  let path = match[2];
  path = path.replace(/[.,!?;:]+$/, "");
  path = normalizePath(path);

  return { method, path };
}

function inferMode(question: string): "concise" | "detailed" {
  if (/(detail|detailed|explain|full)/i.test(question) || /詳細|詳しく/.test(question)) {
    return "detailed";
  }
  return "concise";
}

function findOperation(index: OpenApiIndex, method: HttpMethod, path: string): OperationRecord | undefined {
  const normalizedTargetPath = normalizePath(path);

  let fallbackMatch: OperationRecord | undefined;

  for (const record of index.operations) {
    if (record.method !== method) continue;

    if (record.normalizedPath === normalizedTargetPath) {
      return record;
    }

    if (!fallbackMatch && record.pathRegex.test(normalizedTargetPath)) {
      fallbackMatch = record;
    }
  }

  return fallbackMatch;
}

export function extractParameters(operation: OpenAPIV3.OperationObject, document: OpenAPIV3.Document): ResolvedParameter[] {
  const result: ResolvedParameter[] = [];
  const seen = new Set<string>();

  const parameters = operation.parameters ?? [];
  for (const entry of parameters) {
    const resolved = resolveMaybeReference<OpenAPIV3.ParameterObject>(entry, document);
    if (!resolved) continue;

    const key = `${resolved.name}:${resolved.in}`;
    if (seen.has(key)) continue;
    seen.add(key);

    result.push({
      name: resolved.name,
      in: resolved.in,
      required: Boolean(resolved.required),
      description: resolved.description ?? undefined
    });
  }

  return result;
}

export function extractRequestBody(operation: OpenAPIV3.OperationObject, document: OpenAPIV3.Document): ResolvedRequestBody {
  if (!operation.requestBody) return null;
  const resolved = resolveMaybeReference<OpenAPIV3.RequestBodyObject>(operation.requestBody, document);
  if (!resolved) return null;

  const jsonContent = resolved.content?.["application/json"];
  let schemaObject: OpenAPIV3.SchemaObject | null = null;
  let schema: string | null = null;

  if (jsonContent?.schema) {
    const resolvedSchema = resolveMaybeReference(jsonContent.schema, document);
    if (isSchemaObject(resolvedSchema)) {
      schemaObject = resolvedSchema;
      schema = formatJson(resolvedSchema) ?? null;
    } else {
      schema = formatJson(resolvedSchema) ?? null;
    }
  }

  return {
    description: resolved.description ?? null,
    schema,
    schemaObject
  };
}

export function extractResponses(operation: OpenAPIV3.OperationObject, document: OpenAPIV3.Document): ResolvedResponse[] {
  const responses: ResolvedResponse[] = [];
  if (!operation.responses) return responses;

  for (const [status, entry] of Object.entries(operation.responses)) {
    const resolved = resolveMaybeReference<OpenAPIV3.ResponseObject>(entry, document);
    if (!resolved) continue;

    const jsonContent = resolved.content?.["application/json"];
    let schemaObject: OpenAPIV3.SchemaObject | undefined;
    let schema: string | undefined;

    if (jsonContent?.schema) {
      const resolvedSchema = resolveMaybeReference(jsonContent.schema, document);
      if (isSchemaObject(resolvedSchema)) {
        schemaObject = resolvedSchema;
        schema = formatJson(resolvedSchema);
      } else {
        schema = formatJson(resolvedSchema);
      }
    }

    responses.push({
      status,
      description: resolved.description ?? undefined,
      schema,
      schemaObject
    });
  }

  return responses;
}

function resolveMaybeReference<T>(component: T | OpenAPIV3.ReferenceObject, document: OpenAPIV3.Document): T | undefined {
  if (!component) return undefined;
  if (isReferenceObject(component)) {
    return resolveRef(document, component.$ref) as T | undefined;
  }
  return component as T;
}

export function resolveRef(document: OpenAPIV3.Document, ref: string): unknown {
  if (!ref.startsWith("#/")) {
    return undefined;
  }

  const pathParts = ref.replace(/^#\//, "").split("/");
  let current: any = document;

  for (const part of pathParts) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (current && typeof current === "object" && key in current) {
      current = current[key];
    } else {
      return undefined;
    }
  }

  if (isReferenceObject(current)) {
    if (current.$ref === ref) {
      return undefined;
    }
    return resolveRef(document, current.$ref);
  }

  return current;
}

function isReferenceObject(value: unknown): value is OpenAPIV3.ReferenceObject {
  return Boolean(value && typeof value === "object" && "$ref" in value);
}

function isOperationObject(value: unknown): value is OpenAPIV3.OperationObject {
  return Boolean(value && typeof value === "object" && "responses" in value);
}

function isSchemaObject(value: unknown): value is OpenAPIV3.SchemaObject {
  return Boolean(value && typeof value === "object");
}

function buildPathRegex(normalizedPath: string): RegExp {
  const segments = normalizedPath
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith("{") && segment.endsWith("}")) {
        return "[^/]+";
      }
      return escapeRegex(segment);
    });

  const pattern = `^/${segments.join("/")}$`;
  return new RegExp(pattern, "i");
}

function escapeRegex(segment: string): string {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatJson(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return undefined;
  }
}

function truncate(value: string | null | undefined, limit: number): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }

  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}…`;
}
