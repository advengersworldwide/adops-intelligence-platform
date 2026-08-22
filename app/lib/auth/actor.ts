import { CHALLENGE_COOKIE } from "./cookies";
import { getSession } from "./session";
import { verifyChallenge, type ChallengePurpose } from "./jwt";
import { isCurrentSession } from "./require";

export function readChallengeCookie(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  // Anchored on a cookie boundary (start-of-header or after "; ") so a cookie
  // named e.g. "xadops-challenge" cannot match as a substring of its name.
  const match = header.match(new RegExp(`(?:^|;\\s*)${CHALLENGE_COOKIE}=([^;]+)`));
  return match?.[1] ?? null;
}

/**
 * Enrolment and forced password change are reachable two ways: by an already
 * signed-in user changing their own settings, or by a half-authenticated user
 * mid-login holding a challenge token. This resolves the acting user id from
 * whichever is present, and returns null when neither is valid.
 *
 * The session branch is revocation-checked via `isCurrentSession` (the same
 * tokenVersion comparison `requireAuth` performs) — a stale JWT signature
 * alone is not proof of a live session. A session that fails that check is
 * treated the same as no session at all and falls through to the challenge
 * path, rather than failing the whole resolution outright: `issueChallenge`
 * (session-issue.ts) never clears an old session cookie when it hands out a
 * fresh enrolment challenge, so a privileged user forced back through
 * `enroll_2fa` after e.g. an admin 2FA reset would otherwise be locked out
 * by their own leftover, now-revoked session cookie.
 */
export async function resolveActor(req: Request, purpose: ChallengePurpose): Promise<number | null> {
  const session = await getSession();
  if (session && (await isCurrentSession(session))) return session.sub;

  const token = readChallengeCookie(req);
  if (!token) return null;
  try {
    const claims = await verifyChallenge(token, purpose);
    return claims.sub;
  } catch {
    return null;
  }
}
