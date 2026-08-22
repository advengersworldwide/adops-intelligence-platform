import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { db, usersTable } from "@workspace/db";
import { resolveActor } from "@/lib/auth/actor";
import { generateSecret, buildOtpauthUri } from "@/lib/auth/totp";
import { encryptSecret } from "@/lib/auth/secret-crypto";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const userId = await resolveActor(req, "totp_enroll");
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (user.twoFactorEnabledAt) {
    return NextResponse.json({ error: "Two-factor authentication is already enabled" }, { status: 400 });
  }

  // Stored immediately but left inactive (two_factor_enabled_at stays NULL) so
  // /enable can verify the user actually scanned this exact secret.
  const secret = generateSecret();
  await db
    .update(usersTable)
    .set({ twoFactorSecret: encryptSecret(secret) })
    .where(eq(usersTable.id, userId));

  const uri = buildOtpauthUri(secret, user.username);
  return NextResponse.json({ secret, otpauthUri: uri, qrDataUrl: await QRCode.toDataURL(uri) });
}
