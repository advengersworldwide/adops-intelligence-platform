import { SignJWT, jwtVerify } from "jose";

export interface SessionUser {
  sub: number;
  name: string;
  username: string;
  email: string;
  role: string;
  isSystem: boolean;
  tokenVersion: number;
}

export type ChallengePurpose = "totp" | "password_change" | "totp_enroll";

export const CHALLENGE_TTL_SECONDS: Record<ChallengePurpose, number> = {
  totp: 5 * 60,
  password_change: 10 * 60,
  totp_enroll: 10 * 60,
};

export interface ChallengeClaims {
  sub: number;
  purpose: ChallengePurpose;
  /** True once the second factor has been satisfied earlier in this login. */
  totpDone: boolean;
}

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    isSystem: user.isSystem,
    tokenVersion: user.tokenVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.sub))
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(getSecretKey());
}

export async function verifySession(token: string): Promise<SessionUser> {
  const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: ["HS256"] });

  // A challenge token is issued BEFORE the second factor is verified. Accepting
  // one here would let a caller skip 2FA entirely by presenting it as a session
  // cookie. This check is the boundary between half-authenticated and
  // authenticated — do not remove it.
  if ("purpose" in payload) {
    throw new Error("Challenge token cannot be used as a session");
  }

  return {
    sub: Number(payload.sub),
    name: String(payload.name),
    username: String(payload.username),
    email: String(payload.email),
    role: String(payload.role),
    isSystem: Boolean(payload.isSystem),
    tokenVersion: Number(payload.tokenVersion ?? 0),
  };
}

export async function signChallenge(
  sub: number,
  purpose: ChallengePurpose,
  totpDone = false,
): Promise<string> {
  return new SignJWT({ purpose, totpDone })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(sub))
    .setIssuedAt()
    .setExpirationTime(`${CHALLENGE_TTL_SECONDS[purpose]}s`)
    .sign(getSecretKey());
}

export async function verifyChallenge(
  token: string,
  expected: ChallengePurpose,
): Promise<ChallengeClaims> {
  const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: ["HS256"] });
  if (payload.purpose !== expected) {
    throw new Error("Challenge purpose mismatch");
  }
  return {
    sub: Number(payload.sub),
    purpose: expected,
    totpDone: Boolean(payload.totpDone),
  };
}
