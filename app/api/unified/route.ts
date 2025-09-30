import { NextRequest, NextResponse } from "next/server";
import { processQuestion } from "@/app/api/query/route";
import { NOT_FOUND_MESSAGE, processSearch } from "@/app/api/search/route";
import { getSearchConfig, type SearchCandidate } from "@/lib/search-index";

const METHOD_PATH_REGEX = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\//i;

export type UnifiedResponse = {
  resultType: "answer" | "candidates" | "not_found";
  routedTo: "query" | "search";
  answer?: { text: string; citation: string };
  candidates?: SearchCandidate[];
  message?: string;
  autoAnswered?: boolean;
  question?: string;
};

function looksLikeMethodAndPath(input: string): boolean {
  return METHOD_PATH_REGEX.test(input);
}

function shouldAutoAnswer(candidates: SearchCandidate[]): boolean {
  if (candidates.length !== 1) {
    return false;
  }

  const config = getSearchConfig();
  const [topCandidate] = candidates;

  if (topCandidate.score < config.threshold) {
    return false;
  }

  const margin = topCandidate.score - config.threshold;
  return margin >= config.scoreGap;
}

export async function processUnified(input: string): Promise<UnifiedResponse> {
  const trimmed = input.trim();

  if (!trimmed) {
    return {
      resultType: "not_found",
      routedTo: "search",
      message: NOT_FOUND_MESSAGE
    };
  }

  if (looksLikeMethodAndPath(trimmed)) {
    const answer = await processQuestion(trimmed);
    return {
      resultType: "answer",
      routedTo: "query",
      answer,
      question: trimmed
    };
  }

  const searchResponse = await processSearch(trimmed);

  if (searchResponse.candidates.length === 0) {
    return {
      resultType: "not_found",
      routedTo: "search",
      message: searchResponse.message ?? NOT_FOUND_MESSAGE
    };
  }

  if (shouldAutoAnswer(searchResponse.candidates)) {
    const topCandidate = searchResponse.candidates[0];
    const detailedQuestion = `Explain ${topCandidate.method} ${topCandidate.path} in detail`;
    const answer = await processQuestion(detailedQuestion);

    return {
      resultType: "answer",
      routedTo: "search",
      answer,
      autoAnswered: true,
      question: detailedQuestion,
      candidates: searchResponse.candidates
    };
  }

  return {
    resultType: "candidates",
    routedTo: "search",
    candidates: searchResponse.candidates
  };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { input?: unknown } | null;

  if (!body || typeof body.input !== "string") {
    return NextResponse.json({ error: "Invalid request. 'input' must be a string." }, { status: 400 });
  }

  const response = await processUnified(body.input);
  return NextResponse.json(response);
}
