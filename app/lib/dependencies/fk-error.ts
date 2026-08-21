import { NextResponse } from "next/server";

/**
 * Maps a Postgres foreign-key violation (23503) to a readable 409.
 * Returns null when the error is something else, so callers can rethrow.
 */
export function fkViolationResponse(err: unknown): Response | null {
  const e = err as { code?: string; cause?: { code?: string } };
  if ((e?.code ?? e?.cause?.code) !== "23503") return null;
  return NextResponse.json(
    { error: "Another record still depends on this. Remove the dependent records first, then try again." },
    { status: 409 },
  );
}
