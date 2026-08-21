import { CHALLENGE_COOKIE } from "./cookies";
import { getSession } from "./session";
import { verifyChallenge, type ChallengePurpose } from "./jwt";

export function readChallengeCookie(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  const match = header.match(new RegExp(`${CHALLENGE_COOKIE}=([^;]+)`));
  return match?.[1] ?? null;
}

/**
 * Enrolment and forced password change are reachable two ways: by an already
 * signed-in user changing their own settings, or by a half-authenticated user
 * mid-login holding a challenge token. This resolves the acting user id from
 * whichever is present, and returns null when neither is valid.
 */
export async function resolveActor(req: Request, purpose: ChallengePurpose): Promise<number | null> {
  const session = await getSession();
  if (session) return session.sub;

  const token = readChallengeCookie(req);
  if (!token) return null;
  try {
    const claims = await verifyChallenge(token, purpose);
    return claims.sub;
  } catch {
    return null;
  }
}
