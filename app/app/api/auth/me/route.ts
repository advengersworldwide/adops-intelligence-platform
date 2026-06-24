import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  return NextResponse.json({
    id: user.sub,
    name: user.name,
    email: user.email,
    role: user.role,
    isSystem: user.isSystem ?? false,
  });
}
