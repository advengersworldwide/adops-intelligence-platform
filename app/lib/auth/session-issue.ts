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

/**
 * Issues the real session cookie and clears any in-flight challenge.
 *
 * `extra` merges additional fields into the JSON body (e.g. one-time backup
 * codes from 2FA enrolment) without duplicating the cookie logic below.
 */
export async function issueSession(user: User, extra?: Record<string, unknown>): Promise<NextResponse> {
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
    ...extra,
  });
  res.cookies.set(SESSION_COOKIE, token, buildCookieOptions());
  res.cookies.set(CHALLENGE_COOKIE, "", buildChallengeCookieOptions(0));
  return res;
}

/**
 * Issues a short-lived challenge cookie. Never sets the session cookie.
 *
 * `extra` merges additional fields into the JSON body, same as `issueSession`.
 */
export async function issueChallenge(
  userId: number,
  step: Exclude<NextStep, "session">,
  totpDone: boolean,
  extra?: Record<string, unknown>,
): Promise<NextResponse> {
  const purpose = STEP_PURPOSE[step];
  const token = await signChallenge(userId, purpose, totpDone);
  const res = NextResponse.json({ next: step, ...extra });
  res.cookies.set(CHALLENGE_COOKIE, token, buildChallengeCookieOptions(CHALLENGE_TTL_SECONDS[purpose]));
  return res;
}
