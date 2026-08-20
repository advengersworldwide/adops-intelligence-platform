import { CHALLENGE_COOKIE } from "./cookies";

export function readChallengeCookie(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  const match = header.match(new RegExp(`${CHALLENGE_COOKIE}=([^;]+)`));
  return match?.[1] ?? null;
}
