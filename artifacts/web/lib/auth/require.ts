import { NextResponse } from "next/server";
import { getSession } from "./session";
import type { SessionUser } from "./jwt";

type AuthResult = { user: SessionUser } | Response;

export async function requireAuth(): Promise<AuthResult> {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return { user };
}

export async function requireAdmin(): Promise<AuthResult> {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (user.role !== "System Admin" && !user.isSystem)
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  return { user };
}

export function isAuthError(result: AuthResult): result is Response {
  return result instanceof Response;
}
