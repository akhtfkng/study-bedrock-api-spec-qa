import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import type { ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import type { LlmAnswerPayload } from "@/lib/openapi-index";

const DEFAULT_DIRECTIVE = `あなたは提供された構造化データだけを使ってAPIエンドポイントに関する回答を書き直すアシスタントです。

ルール:
- 使用できるのは提供された項目（モード、メソッド、パス、パラメータ、リクエストボディ、レスポンス、引用）のみです。
- 新しい事実や例を推測・追加してはいけません。
- 引用元ファイル名をそのまま1回だけ記載してください。
- 情報が不足している場合は「提供されたOpenAPIファイルには情報がありません。」と正確に回答してください。
- 出力は必ず自然な日本語にしてください。`;

type FormatAnswerOptions = {
  fallbackText: string;
  timeoutMs?: number;
  maxOutputChars?: number;
};

const DEFAULT_REGION = "ap-northeast-1";
const DEFAULT_MODEL_ID = "anthropic.claude-3-5-sonnet-20240620-v1:0";
const DEFAULT_TIMEOUT_MS = 5000;
const MIN_TIMEOUT_MS = 3000;
const MAX_TIMEOUT_MS = 8000;
const CONCISE_CHAR_LIMIT = 1200;
const DETAILED_CHAR_LIMIT = 2400;
const MAX_ATTEMPTS = 2;
const MIN_MAX_TOKENS = 200;

let cachedClient: BedrockRuntimeClient | null = null;

function getRegion(): string {
  return process.env.BEDROCK_REGION?.trim() || DEFAULT_REGION;
}

function getModelId(): string | undefined {
  const modelId = process.env.BEDROCK_MODEL_ID?.trim() || DEFAULT_MODEL_ID;
  return modelId ? modelId : undefined;
}

function getClient(): BedrockRuntimeClient {
  if (!cachedClient) {
    cachedClient = new BedrockRuntimeClient({ region: getRegion() });
  }
  return cachedClient;
}

function resolveTimeout(timeoutMs: number | undefined): number {
  if (!timeoutMs || Number.isNaN(timeoutMs)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, timeoutMs));
}

function resolveOutputLimit(mode: "concise" | "detailed", override?: number): number {
  if (override && override > 0) {
    return override;
  }
  return mode === "detailed" ? DETAILED_CHAR_LIMIT : CONCISE_CHAR_LIMIT;
}

function buildPrompt(payload: LlmAnswerPayload, fallbackText: string): string {
  const lines: string[] = ["構造化された事実:"];

  const modeLabel = payload.mode === "detailed" ? "詳細" : "簡潔";
  lines.push(`- モード: ${modeLabel}`);
  lines.push(`- メソッド: ${payload.method}`);
  lines.push(`- パス: ${payload.path}`);

  if (payload.summary) {
    lines.push(`- 要約: ${payload.summary}`);
  }

  if (payload.description) {
    lines.push(`- 説明: ${payload.description}`);
  }

  if (payload.parameters.length > 0) {
    lines.push("- パラメータ:");
    for (const parameter of payload.parameters) {
      const parts = [`名称: ${parameter.name}`, `位置: ${parameter.in}`, `必須: ${parameter.required ? "はい" : "いいえ"}`];
      if (parameter.description) {
        parts.push(`説明: ${parameter.description}`);
      }
      lines.push(`  • ${parts.join(" | ")}`);
    }
  } else {
    lines.push("- パラメータ: 記載なし。");
  }

  if (payload.requestBody) {
    lines.push("- リクエストボディ:");
    if (payload.requestBody.description) {
      lines.push(`  • 説明: ${payload.requestBody.description}`);
    }
    if (payload.requestBody.schema) {
      lines.push(`  • スキーマ: ${payload.requestBody.schema}`);
    }
  }

  if (payload.responses.length > 0) {
    lines.push("- レスポンス:");
    for (const response of payload.responses) {
      const parts = [`ステータス: ${response.status}`];
      if (response.description) {
        parts.push(`説明: ${response.description}`);
      }
      if (response.schema) {
        parts.push(`スキーマ: ${response.schema}`);
      }
      lines.push(`  • ${parts.join(" | ")}`);
    }
  }

  lines.push(`- 引用: ${payload.citation}`);
  lines.push("", "ベースライン回答:", fallbackText);

  return lines.join("\n");
}

export async function formatAnswerWithLlm(
  payload: LlmAnswerPayload,
  options: FormatAnswerOptions
): Promise<string> {
  const modelId = getModelId();
  if (!modelId) {
    return options.fallbackText;
  }

  const timeoutMs = resolveTimeout(options.timeoutMs);
  const maxChars = resolveOutputLimit(payload.mode, options.maxOutputChars);
  const client = getClient();
  const prompt = buildPrompt(payload, options.fallbackText);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await client.send(
        new ConverseCommand({
          modelId,
          system: [{ text: DEFAULT_DIRECTIVE }],
          messages: [
            {
              role: "user",
              content: [{ text: prompt }]
            }
          ],
          inferenceConfig: {
            temperature: 0,
            topP: 0.9,
            maxTokens: Math.max(MIN_MAX_TOKENS, Math.round(maxChars / 4))
          }
        }),
        { abortSignal: controller.signal }
      );

      clearTimeout(timer);

      const textOutput = extractTextFromConverse(response);

      if (!textOutput) {
        throw new Error("Missing text output");
      }

      const normalized = textOutput.trim();
      if (!normalized) {
        throw new Error("Blank response");
      }

      const capped = normalized.length > maxChars ? `${normalized.slice(0, maxChars)}…` : normalized;
      return capped;
    } catch (error) {
      clearTimeout(timer);

      if (attempt >= MAX_ATTEMPTS) {
        console.warn("[llm:formatAnswer] falling back to deterministic answer", {
          reason: error instanceof Error ? error.message : "unknown error",
          mode: payload.mode,
          citation: payload.citation
        });
        return options.fallbackText;
      }
    }
  }

  return options.fallbackText;
}

function extractTextFromConverse(response: ConverseCommandOutput): string | null {
  const message = response.output?.message;
  if (message?.content && Array.isArray(message.content)) {
    const pieces = message.content
      .map((block) => {
        const maybeText = (block as { text?: unknown }).text;
        return typeof maybeText === "string" ? maybeText : null;
      })
      .filter((value): value is string => Boolean(value));

    if (pieces.length > 0) {
      return pieces.join("\n");
    }
  }

  const outputText = (response as unknown as { outputText?: unknown }).outputText;
  if (typeof outputText === "string" && outputText.trim()) {
    return outputText;
  }

  const legacyResults = (response as unknown as { results?: Array<{ outputText?: unknown }> }).results;
  if (Array.isArray(legacyResults)) {
    for (const entry of legacyResults) {
      if (typeof entry?.outputText === "string" && entry.outputText.trim()) {
        return entry.outputText;
      }
    }
  }

  return null;
}
