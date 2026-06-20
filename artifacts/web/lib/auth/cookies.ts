export const SESSION_COOKIE = "adops-session";

export interface CookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
}

export function buildCookieOptions(
  nodeEnv: string = process.env.NODE_ENV ?? "development",
): CookieOptions {
  return {
    httpOnly: true,
    secure: nodeEnv === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24, // 24h, matches JWT expiry
  };
}
