import { NextResponse } from "next/server";
import { eq, or } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { requirePermission, isAuthError } from "@/lib/auth/require";
import { validatePassword } from "@/lib/auth/password-policy";
import { generateTempPassword } from "@/lib/auth/credentials";

export const runtime = "nodejs";

const BCRYPT_ROUNDS = 12;

function publicUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    email: u.email,
    role: u.role,
    isSystem: u.isSystem,
    mustChangePassword: u.mustChangePassword,
    twoFactorEnabled: Boolean(u.twoFactorEnabledAt),
  };
}

export async function GET(): Promise<Response> {
  const auth = await requirePermission("settings.users:manage");
  if (isAuthError(auth)) return auth;
  try {
    const rows = await db.select().from(usersTable).orderBy(usersTable.id);
    return NextResponse.json(rows.map(publicUser));
  } catch {
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requirePermission("settings.users:manage");
  if (isAuthError(auth)) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  const username = String(body.username ?? "").trim().toLowerCase();
  const email = String(body.email ?? "").trim().toLowerCase();
  const role = String(body.role ?? "").trim();
  const password = body.password ? String(body.password) : null;

  if (!name || !username || !email || !role) {
    return NextResponse.json(
      { error: "name, username, email, and role are required" },
      { status: 400 },
    );
  }

  try {
    const matches = await db
      .select()
      .from(usersTable)
      .where(or(eq(usersTable.username, username), eq(usersTable.email, email)));

    const byUsername = matches.find((m) => m.username === username);
    const byEmail = matches.find((m) => m.email === email);

    // Update path: the account is identified by email, as it was before.
    if (byEmail) {
      if (byEmail.isSystem) {
        return NextResponse.json({ error: "Cannot modify system accounts" }, { status: 400 });
      }
      if (byUsername && byUsername.id !== byEmail.id) {
        return NextResponse.json({ error: "That username is already taken" }, { status: 409 });
      }

      const updates: Record<string, unknown> = {
        name,
        username,
        role,
        updatedAt: new Date(),
        // Bumped unconditionally, not only when a password is supplied: role
        // authority is baked into the JWT, so a demotion made here would
        // otherwise stay live under the user's existing session for up to 24h.
        // An admin editing a user's record is exactly when that session should
        // be re-established.
        tokenVersion: byEmail.tokenVersion + 1,
      };
      if (password) {
        const validation = await validatePassword(password);
        if (!validation.ok) return NextResponse.json({ errors: validation.errors }, { status: 400 });
        updates.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
        updates.passwordChangedAt = new Date();
      }
      const [updated] = await db
        .update(usersTable)
        .set(updates)
        .where(eq(usersTable.email, email))
        .returning();
      return NextResponse.json(publicUser(updated));
    }

    if (byUsername) {
      return NextResponse.json({ error: "That username is already taken" }, { status: 409 });
    }

    // Create path. An admin-supplied password must still pass policy; otherwise
    // we generate one and force a change at first login.
    let initialPassword = password;
    if (initialPassword) {
      const validation = await validatePassword(initialPassword);
      if (!validation.ok) return NextResponse.json({ errors: validation.errors }, { status: 400 });
    } else {
      initialPassword = generateTempPassword();
    }

    const [inserted] = await db
      .insert(usersTable)
      .values({
        name,
        username,
        email,
        password: await bcrypt.hash(initialPassword, BCRYPT_ROUNDS),
        role,
        isSystem: false,
        mustChangePassword: true,
        passwordChangedAt: new Date(),
      })
      .returning();

    // Returned once so the admin can hand it over. Never stored in plaintext.
    return NextResponse.json({ ...publicUser(inserted), tempPassword: initialPassword }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to save user" }, { status: 500 });
  }
}
