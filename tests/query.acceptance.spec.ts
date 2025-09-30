import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processQuestion } from "@/app/api/query/route";
import { formatAnswerWithLlm } from "@/lib/llm";

vi.mock("@/lib/llm", async () => {
  const actual = await vi.importActual<typeof import("@/lib/llm")>("@/lib/llm");
  return {
    ...actual,
    formatAnswerWithLlm: vi.fn()
  };
});

const formatAnswerWithLlmMock = vi.mocked(formatAnswerWithLlm);

describe("API Spec QA Agent query processing", () => {
  beforeEach(() => {
    delete process.env.USE_LLM;
    delete process.env.ENABLE_LLM;
  });

  afterEach(() => {
    formatAnswerWithLlmMock.mockReset();
  });

  it("returns deterministic concise answers without using the LLM by default", async () => {
  const response = await processQuestion("POST /todos にはどのパラメータが必要ですか？");

    expect(formatAnswerWithLlmMock).not.toHaveBeenCalled();
    expect(response.text).toContain("パラメータ");
  expect(response.citation).toBe("todos.yaml");
  });

  it("can optionally format answers with the LLM when enabled", async () => {
    process.env.USE_LLM = "true";
    formatAnswerWithLlmMock.mockResolvedValueOnce(
  "GET /todos/{id} はToDoの詳細を返します。レスポンスには200と404が含まれます。引用: todos.yaml"
    );

  const response = await processQuestion("GET /todos/{id} を詳しく説明してください");

    expect(formatAnswerWithLlmMock).toHaveBeenCalledTimes(1);
    const [payload, options] = formatAnswerWithLlmMock.mock.calls[0];

    expect(payload.mode).toBe("detailed");
    expect(options.timeoutMs).toBe(7000);
    expect(response.text).toContain("レスポンス");
  expect(response.citation).toBe("todos.yaml");
  });

  it("falls back to deterministic text when the LLM call fails", async () => {
    process.env.USE_LLM = "true";
    formatAnswerWithLlmMock.mockRejectedValueOnce(new Error("LLM unavailable"));

  const response = await processQuestion("POST /todos にはどのパラメータが必要ですか？");

    expect(formatAnswerWithLlmMock).toHaveBeenCalledTimes(1);
    expect(response.text).toContain("パラメータ");
  expect(response.citation).toBe("todos.yaml");
  });

  it("refuses non-API questions without calling the LLM", async () => {
  const response = await processQuestion("今日の天気はどうですか？");

    expect(formatAnswerWithLlmMock).not.toHaveBeenCalled();
    expect(response.citation).toBe("N/A");
    expect(response.text).toBe("HTTPメソッドとパスを含むAPIに関する質問のみに回答できます。");
  });

  it("returns information unavailable for missing operations without LLM", async () => {
  const response = await processQuestion("DELETE /todos/{id}/archive について教えてください");

    expect(formatAnswerWithLlmMock).not.toHaveBeenCalled();
    expect(response.citation).toBe("N/A");
    expect(response.text).toBe("提供されたOpenAPIファイルには情報がありません。");
  });
});
