import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "./lib/auth/cookies";
import { verifySession } from "./lib/auth/jwt";
import { checkRateLimit } from "./lib/rate-limit";

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { success } = await checkRateLimit("global", ip);
  if (!success) {
    return new NextResponse("Too Many Requests", { status: 429 });
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  let authenticated = false;
  if (token) {
    try {
      await verifySession(token);
      authenticated = true;
    } catch {
      authenticated = false;
    }
  }

  if (!authenticated) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Guard all page routes except login, the mid-login challenge pages, api,
    // and static/internal assets. change-password and enroll-2fa authenticate
    // via the challenge cookie, which is not a session.
    "/((?!login|change-password|enroll-2fa|api|_next/static|_next/image|favicon.ico).*)",
  ],
};
