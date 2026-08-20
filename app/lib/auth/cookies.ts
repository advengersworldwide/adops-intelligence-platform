export const SESSION_COOKIE = "adops-session";

export interface CookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
}

export function buildCookieOptions(
  overrides: Partial<CookieOptions> = {},
  nodeEnv: string = process.env.NODE_ENV ?? "development",
): CookieOptions {
  return {
    httpOnly: true,
    secure: nodeEnv === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24, // 24h, matches JWT expiry
    ...overrides,
  };
}

export const CHALLENGE_COOKIE = "adops-challenge";

/** Same protections as the session cookie, but scoped to the challenge TTL. */
export function buildChallengeCookieOptions(
  maxAgeSeconds: number,
  nodeEnv: string = process.env.NODE_ENV ?? "development",
): CookieOptions {
  return buildCookieOptions({ maxAge: maxAgeSeconds }, nodeEnv);
}
