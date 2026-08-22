import { NextResponse } from "next/server";
import { SESSION_COOKIE, CHALLENGE_COOKIE, buildCookieOptions, buildChallengeCookieOptions } from "@/lib/auth/cookies";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", buildCookieOptions({ maxAge: 0 }));
  // A user who abandons login mid-2FA and signs out would otherwise leave a
  // live challenge cookie behind for up to its 10-minute TTL. Cleared the
  // same way issueSession does.
  res.cookies.set(CHALLENGE_COOKIE, "", buildChallengeCookieOptions(0));
  return res;
}
