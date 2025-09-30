import { beforeEach, describe, expect, it } from "vitest";
import { processUnified } from "@/app/api/unified/route";
import { resetSpecCaches } from "@/lib/spec-loader";
import { resetSearchIndex } from "@/lib/search-index";

function resetEnv() {
  delete process.env.SEARCH_SCORE_THRESHOLD;
  delete process.env.SEARCH_SCORE_GAP;
  delete process.env.SEARCH_TOP_K;
}

describe("Unified input flow", () => {
  beforeEach(() => {
    resetSpecCaches();
    resetSearchIndex();
    resetEnv();
  });

  it("routes direct method+path inputs to the deterministic answerer", async () => {
    const response = await processUnified("POST /todos");

    expect(response.resultType).toBe("answer");
    expect(response.routedTo).toBe("query");
  expect(response.answer?.citation).toBe("todos.yaml");
  });

  it("auto answers when a single high-confidence candidate is found", async () => {
    process.env.SEARCH_SCORE_THRESHOLD = "5";
    process.env.SEARCH_SCORE_GAP = "0.5";

    const response = await processUnified("ToDo を作成するAPIは？");

    expect(response.resultType).toBe("answer");
    expect(response.routedTo).toBe("search");
    expect(response.autoAnswered).toBe(true);
  expect(response.answer?.citation).toBe("todos.yaml");
  });

  it("returns candidates when multiple plausible matches exist", async () => {
    const response = await processUnified("todo IDで取得");

    expect(response.resultType).toBe("candidates");
    expect(response.candidates?.length).toBeGreaterThan(0);
    expect(
      response.candidates?.some((candidate) => candidate.method === "GET" && candidate.path === "/todos/{id}")
    ).toBe(true);
  });

  it("includes operations referencing postalCode in candidate list", async () => {
    const response = await processUnified("postalCode を扱うAPI");

    expect(response.resultType).toBe("candidates");
    expect(
      response.candidates?.some((candidate) => candidate.method === "POST" && candidate.path === "/todos")
    ).toBe(true);
  });

  it("returns the shared not-found message for low-signal inputs", async () => {
    const response = await processUnified("まったく関係のない問い");

    expect(response.resultType).toBe("not_found");
    expect(response.message).toBe("No matching API found. Try different terms.");
  });

  it("maintains stable candidate ordering and deterministic routing", async () => {
    const first = await processUnified("todo API");
    const second = await processUnified("todo API");
    const direct = await processUnified("GET /todos");

    expect(first.resultType).toBe("candidates");
    expect(second.resultType).toBe("candidates");
    expect(second.candidates).toEqual(first.candidates);
    expect(direct.routedTo).toBe("query");
    expect(direct.resultType).toBe("answer");
  });
});
