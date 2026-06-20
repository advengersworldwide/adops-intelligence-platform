import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./cookies";
import { verifySession, type SessionUser } from "./jwt";

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await verifySession(token);
  } catch {
    return null;
  }
}
