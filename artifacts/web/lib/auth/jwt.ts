import { SignJWT, jwtVerify } from "jose";

export interface SessionUser {
  sub: number;
  name: string;
  email: string;
  role: string;
  isSystem: boolean;
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
    email: user.email,
    role: user.role,
    isSystem: user.isSystem,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.sub))
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(getSecretKey());
}

export async function verifySession(token: string): Promise<SessionUser> {
  const { payload } = await jwtVerify(token, getSecretKey());
  return {
    sub: Number(payload.sub),
    name: String(payload.name),
    email: String(payload.email),
    role: String(payload.role),
    isSystem: Boolean(payload.isSystem),
  };
}
