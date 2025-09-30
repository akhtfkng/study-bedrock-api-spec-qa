"use client";

import { ChangeEvent, FormEvent, useState } from "react";

type QueryResponse = {
  text: string;
  citation: string;
};

type SearchCandidate = {
  method: string;
  path: string;
  summary: string | null;
  score: number;
  specName: string;
};

type UnifiedResponse = {
  resultType: "answer" | "candidates" | "not_found";
  routedTo: "query" | "search";
  answer?: QueryResponse;
  candidates?: SearchCandidate[];
  message?: string;
  autoAnswered?: boolean;
  question?: string;
};

export default function Page() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [resultQuestion, setResultQuestion] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [autoAnswerInfo, setAutoAnswerInfo] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<SearchCandidate[]>([]);

  async function fetchAnswer(question: string) {
    const trimmed = question.trim();
    if (!trimmed) {
      setError("Enter a question about the API specs.");
      return;
    }

    setLoading(true);
    setError(null);
    setAutoAnswerInfo(null);
    setMessage(null);
    setResult(null);

    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed })
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Request failed with status ${response.status}`);
      }

      const data = (await response.json()) as QueryResponse;
      setResult(data);
      setResultQuestion(trimmed);
    } catch (err) {
      setResult(null);
      setResultQuestion(null);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function submitUnified(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = input.trim();
    if (!trimmed) {
      setError("Enter a question or search query.");
      setResult(null);
      setResultQuestion(null);
      setMessage(null);
      setAutoAnswerInfo(null);
      setCandidates([]);
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);
    setAutoAnswerInfo(null);
    setResult(null);
    setResultQuestion(null);
    setCandidates([]);

    try {
      const response = await fetch("/api/unified", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: trimmed })
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Request failed with status ${response.status}`);
      }

      const data = (await response.json()) as UnifiedResponse;

      if (data.resultType === "answer" && data.answer) {
        setResult(data.answer);
        setResultQuestion(data.question ?? trimmed);
        setCandidates([]);
        if (data.autoAnswered && data.candidates && data.candidates.length > 0) {
          const candidate = data.candidates[0];
          setAutoAnswerInfo(`Auto-answered using ${candidate.method} ${candidate.path}`);
        }
      } else if (data.resultType === "candidates" && data.candidates) {
        setCandidates(data.candidates);
      } else if (data.resultType === "not_found") {
        setMessage(data.message ?? "No matching API found. Try different terms.");
      }

      if (data.resultType !== "answer") {
        setResult(null);
        setResultQuestion(null);
      }

      if (data.resultType !== "not_found") {
        setMessage(data.message ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setResult(null);
      setResultQuestion(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleCandidateClick(candidate: SearchCandidate) {
    const detailedQuestion = `Explain ${candidate.method} ${candidate.path} in detail`;
    await fetchAnswer(detailedQuestion);
  }

  return (
    <main style={{ padding: "2rem", maxWidth: "720px", margin: "0 auto", display: "grid", gap: "2rem" }}>
      <header>
        <h1 style={{ fontSize: "2rem", marginBottom: "0.25rem" }}>API Spec QA Agent (PoC)</h1>
        <p style={{ color: "#4b5563" }}>Search for APIs and inspect deterministic answers backed by OpenAPI specs.</p>
      </header>

      <section style={{ display: "grid", gap: "1rem" }}>
        <h2 style={{ fontSize: "1.5rem" }}>Unified Input</h2>
        <form onSubmit={submitUnified} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <label style={{ display: "grid", gap: "0.25rem" }}>
            <span>Question or search query</span>
            <textarea
              value={input}
              rows={3}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setInput(event.target.value)}
              placeholder="例: POST /todos または ToDo を作成するAPIは？"
              style={{ padding: "0.75rem", resize: "vertical", fontSize: "1rem", borderRadius: "0.5rem", border: "1px solid #d1d5db" }}
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            style={{
              alignSelf: "flex-start",
              backgroundColor: "#2563eb",
              color: "white",
              border: "none",
              borderRadius: "0.5rem",
              padding: "0.75rem 1.5rem",
              fontSize: "1rem",
              cursor: "pointer"
            }}
          >
            {loading ? "Working..." : "Ask"}
          </button>
        </form>

        {error && (
          <p style={{ color: "#dc2626" }}>
            <strong>Error:</strong> {error}
          </p>
        )}

        {message && <p style={{ color: "#6b7280" }}>{message}</p>}
        {autoAnswerInfo && <p style={{ color: "#059669" }}>{autoAnswerInfo}</p>}

        {candidates.length > 0 && (
          <div style={{ display: "grid", gap: "1rem" }}>
            {candidates.map((candidate) => (
              <button
                key={`${candidate.method}-${candidate.path}`}
                type="button"
                onClick={() => handleCandidateClick(candidate)}
                disabled={loading}
                style={{
                  textAlign: "left",
                  backgroundColor: "white",
                  border: "1px solid #e5e7eb",
                  borderRadius: "0.75rem",
                  padding: "1rem",
                  boxShadow: "0 1px 3px rgba(15, 23, 42, 0.08)",
                  cursor: "pointer"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1rem" }}>
                  <span
                    style={{
                      backgroundColor: "#dbeafe",
                      color: "#1d4ed8",
                      padding: "0.2rem 0.6rem",
                      borderRadius: "9999px",
                      fontSize: "0.85rem",
                      fontWeight: 600
                    }}
                  >
                    {candidate.method}
                  </span>
                  <span style={{ fontSize: "0.85rem", color: "#6b7280" }}>score: {candidate.score.toFixed(3)}</span>
                </div>
                <p style={{ fontSize: "1.1rem", fontWeight: 600, margin: "0.75rem 0 0.5rem" }}>{candidate.path}</p>
                <p style={{ fontSize: "0.95rem", color: "#4b5563", marginBottom: "0.75rem" }}>
                  {candidate.summary ?? "(No summary provided)"}
                </p>
                <p style={{ fontSize: "0.8rem", color: "#6b7280" }}>Source: {candidate.specName}</p>
              </button>
            ))}
          </div>
        )}

        {result && (
          <section
            style={{
              marginTop: "0.5rem",
              padding: "1.5rem",
              backgroundColor: "white",
              borderRadius: "0.75rem",
              boxShadow: "0 1px 4px rgba(15, 23, 42, 0.1)"
            }}
          >
            {resultQuestion && (
              <header style={{ marginBottom: "0.75rem", color: "#4b5563", fontSize: "0.95rem" }}>
                Answering: <span style={{ fontWeight: 600 }}>{resultQuestion}</span>
              </header>
            )}
            <p style={{ whiteSpace: "pre-wrap" }}>{result.text}</p>
            <footer style={{ marginTop: "1.5rem", fontSize: "0.9rem", color: "#4b5563" }}>Source: {result.citation}</footer>
          </section>
        )}
      </section>
    </main>
  );
}
