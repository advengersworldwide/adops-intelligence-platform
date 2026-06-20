import { NextResponse } from "next/server";
import { SESSION_COOKIE, buildCookieOptions } from "@/lib/auth/cookies";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", buildCookieOptions({ maxAge: 0 }));
  return res;
}
