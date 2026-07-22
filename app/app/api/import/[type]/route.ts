// app/app/api/import/[type]/route.ts
import { NextResponse } from "next/server";
import { RunImportBody, RunImportParams } from "@workspace/api-zod";
import { getSession } from "@/lib/auth/session";
import { getDescriptor } from "@/lib/import/registry";
import { runImport } from "@/lib/import/run-import";
import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ type: string }> },
): Promise<Response> {
  const auth = await requirePermission("upload:data");
  if (isAuthError(auth)) return auth;
  const { type } = await params;
  const p = RunImportParams.safeParse({ type });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });

  const descriptor = getDescriptor(type);
  if (!descriptor) return NextResponse.json({ error: `Unknown import type: ${type}` }, { status: 400 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = RunImportBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const session = await getSession();
  const result = await runImport(descriptor, parsed.data.rows, parsed.data.mapping, {
    dryRun: parsed.data.dryRun,
    session: { userId: session?.sub ?? null },
  });
  return NextResponse.json(result);
}
