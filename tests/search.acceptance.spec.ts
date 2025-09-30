import { describe, expect, it } from "vitest";
import { processSearch } from "@/app/api/search/route";

describe("Natural language search", () => {
  it("returns POST /todos as a top candidate for create-todo queries", async () => {
    const response = await processSearch("ToDo を作成するAPIは？");

    expect(response.candidates.length).toBeGreaterThan(0);

    const hasPostTodos = response.candidates.some(
      (candidate) => candidate.method === "POST" && candidate.path === "/todos"
    );

    expect(hasPostTodos).toBe(true);
  });

  it("returns POST /todos for タスク registration phrasing", async () => {
    const response = await processSearch("タスクを登録する機能のAPIは？");

    expect(response.candidates.length).toBeGreaterThan(0);

    const [first] = response.candidates;
    expect(first.method).toBe("POST");
    expect(first.path).toBe("/todos");
  });

  it("includes GET /todos/{id} when asking to retrieve a todo by ID", async () => {
    const response = await processSearch("todo IDで取得したい");

    const hasGetTodoById = response.candidates.some(
      (candidate) => candidate.method === "GET" && candidate.path === "/todos/{id}"
    );

    expect(hasGetTodoById).toBe(true);
  });

  it("surfaces DELETE /todos/{id} for Japanese removal phrasing", async () => {
    const response = await processSearch("ToDoを削除するAPI");

    expect(response.candidates.length).toBeGreaterThan(0);

    const [first] = response.candidates;
    expect(first.method).toBe("DELETE");
    expect(first.path).toBe("/todos/{id}");
  });

  it("prefers PATCH /todos/{id} when asked to update", async () => {
    const response = await processSearch("Todoを更新したい");

    expect(response.candidates.length).toBeGreaterThan(0);

  const [first] = response.candidates;
  expect(["PATCH", "PUT"]).toContain(first.method);
    expect(first.path).toBe("/todos/{id}");
  });

  it("surfaces operations that mention postalCode", async () => {
    const response = await processSearch("postalCode を扱うAPI");

    const includesPostalCode = response.candidates.some((candidate) => {
      return candidate.path === "/todos" && candidate.method === "POST";
    });

    expect(includesPostalCode).toBe(true);

    const propertyHighlight = response.candidates.find((candidate) => candidate.sourceType === "property");
    expect(propertyHighlight?.matchedPropertyPath).toContain("postalCode");
  });

  it("responds with a helpful message when no candidates meet the score threshold", async () => {
    const response = await processSearch("この質問は一致しない語彙です");

    expect(response.candidates).toHaveLength(0);
    expect(response.message).toBe("No matching API found. Try different terms.");
  });

  it("returns a stable ordering for identical queries", async () => {
  const first = await processSearch("ToDo API");
  const second = await processSearch("ToDo API");

    expect(second.candidates).toEqual(first.candidates);
  });
});
