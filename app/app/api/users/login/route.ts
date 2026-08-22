import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { getRolePermissions } from "@/lib/rbac/role-permissions";
import { resolveNextStep, isPrivileged } from "@/lib/auth/next-step";
import { issueSession, issueChallenge } from "@/lib/auth/session-issue";

export const runtime = "nodejs";

/**
 * A valid bcrypt hash of a random string. Compared against when no user matches
 * so that "unknown username" and "wrong password" take the same time — without
 * this, response latency reveals which usernames exist.
 */
const DUMMY_HASH = "$2b$12$p1fh4OYbcwEjLqRDnLgGEOl6OLRq3yx1DjWpmsvdmJVehoewnZSq.";

const INVALID = () => NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

export async function POST(req: Request): Promise<Response> {
  if (!process.env.JWT_SECRET) {
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { success } = await checkRateLimit("login", ip);
  if (!success) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again in 15 minutes." },
      { status: 429 },
    );
  }

  let body: { username?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const username = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!username || !password) {
    return NextResponse.json({ error: "username and password are required" }, { status: 400 });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));

  // Always run one compare, even for an unknown username.
  const isValid = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
  if (!user || !isValid) return INVALID();

  const rolePerms = await getRolePermissions(user.role);
  const privileged = isPrivileged(user.role, user.isSystem, rolePerms);
  const step = resolveNextStep(user, privileged, false);

  if (step === "session") return issueSession(user);
  return issueChallenge(user.id, step, false);
}
