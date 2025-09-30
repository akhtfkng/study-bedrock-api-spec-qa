import { NextRequest, NextResponse } from "next/server";
import { answerQuestion } from "@/lib/openapi-index";
import { formatAnswerWithLlm } from "@/lib/llm";
import { loadCachedOpenApiIndex } from "@/lib/spec-loader";

function isLlmEnabled(): boolean {
  const flag = process.env.USE_LLM ?? process.env.ENABLE_LLM ?? "";
  const normalized = flag.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { question?: unknown } | null;

  if (!body || typeof body.question !== "string") {
    return NextResponse.json({ error: "Invalid request. 'question' must be a string." }, { status: 400 });
  }

  const question = body.question as string;
  const response = await processQuestion(question);

  return NextResponse.json(response);
}

export async function processQuestion(question: string) {
  const index = await loadCachedOpenApiIndex();
  const deterministic = answerQuestion(index, question);

  if (deterministic.reason !== "ok" || !deterministic.payload || !isLlmEnabled()) {
    return {
      text: deterministic.text,
      citation: deterministic.citation
    };
  }

  try {
    const formattedText = await formatAnswerWithLlm(deterministic.payload, {
      fallbackText: deterministic.text,
      timeoutMs: deterministic.mode === "detailed" ? 7000 : 5000
    });

    return {
      text: formattedText,
      citation: deterministic.citation
    };
  } catch (error) {
    console.warn("[api/query] LLM formatting failed, using deterministic answer", {
      reason: error instanceof Error ? error.message : "unknown error",
      mode: deterministic.mode,
      citation: deterministic.citation
    });

    return {
      text: deterministic.text,
      citation: deterministic.citation
    };
  }
}
