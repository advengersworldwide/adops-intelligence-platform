import { NextResponse } from "next/server";
import type { User } from "@workspace/db";
import { signSession, signChallenge, CHALLENGE_TTL_SECONDS, type ChallengePurpose } from "./jwt";
import { SESSION_COOKIE, CHALLENGE_COOKIE, buildCookieOptions, buildChallengeCookieOptions } from "./cookies";
import type { NextStep } from "./next-step";

/** Maps a pending step onto the challenge purpose that gates it. */
const STEP_PURPOSE: Record<Exclude<NextStep, "session">, ChallengePurpose> = {
  totp: "totp",
  password_change: "password_change",
  enroll_2fa: "totp_enroll",
};

/** Issues the real session cookie and clears any in-flight challenge. */
export async function issueSession(user: User): Promise<NextResponse> {
  const token = await signSession({
    sub: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    isSystem: user.isSystem,
    tokenVersion: user.tokenVersion,
  });

  const res = NextResponse.json({
    next: "session",
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
      isSystem: user.isSystem,
    },
  });
  res.cookies.set(SESSION_COOKIE, token, buildCookieOptions());
  res.cookies.set(CHALLENGE_COOKIE, "", buildChallengeCookieOptions(0));
  return res;
}

/** Issues a short-lived challenge cookie. Never sets the session cookie. */
export async function issueChallenge(
  userId: number,
  step: Exclude<NextStep, "session">,
  totpDone: boolean,
): Promise<NextResponse> {
  const purpose = STEP_PURPOSE[step];
  const token = await signChallenge(userId, purpose, totpDone);
  const res = NextResponse.json({ next: step });
  res.cookies.set(CHALLENGE_COOKIE, token, buildChallengeCookieOptions(CHALLENGE_TTL_SECONDS[purpose]));
  return res;
}
