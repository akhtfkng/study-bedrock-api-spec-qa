import { NextRequest, NextResponse } from "next/server";
import { searchOperations, type SearchCandidate } from "@/lib/search-index";

export const NOT_FOUND_MESSAGE = "No matching API found. Try different terms.";

export type SearchResponse = {
  candidates: SearchCandidate[];
  message?: string;
};

function parseRebuildFlag(request: NextRequest): boolean {
  const queryValue = request.nextUrl.searchParams.get("rebuild");
  return queryValue === "1" || queryValue === "true";
}

export async function processSearch(query: string, options?: { forceReload?: boolean }): Promise<SearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { candidates: [], message: NOT_FOUND_MESSAGE };
  }

  const candidates = await searchOperations(trimmed, { forceReload: options?.forceReload });

  if (candidates.length === 0) {
    return { candidates: [], message: NOT_FOUND_MESSAGE };
  }

  return { candidates };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { query?: unknown } | null;

  if (!body || typeof body.query !== "string") {
    return NextResponse.json({ error: "Invalid request. 'query' must be a string." }, { status: 400 });
  }

  const forceReload = parseRebuildFlag(request);
  const response = await processSearch(body.query, { forceReload });

  return NextResponse.json(response);
}
