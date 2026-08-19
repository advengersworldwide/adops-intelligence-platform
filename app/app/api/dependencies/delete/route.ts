import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { getSession } from "@/lib/auth/session";
import { getRolePermissions } from "@/lib/rbac/role-permissions";
import { effectivePermissions } from "@/lib/rbac/can";
import { getDescriptor, hasDescriptor } from "@/lib/dependencies/descriptors";
import { resolveImpact, collectDeletableNodes } from "@/lib/dependencies/resolve";
import { NotFoundError } from "@/lib/dependencies/errors";

export const runtime = "nodejs";

const Body = z.object({
  table: z.string().min(1),
  id: z.number().int().positive(),
  fingerprint: z.string().min(1),
});

export async function POST(req: Request): Promise<Response> {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { table, id, fingerprint } = parsed.data;

  if (!hasDescriptor(table)) return NextResponse.json({ error: `Unknown table "${table}"` }, { status: 400 });

  const rolePerms = await getRolePermissions(user.role);
  const permissions = effectivePermissions({ role: user.role, isSystem: user.isSystem }, rolePerms);
  if (!permissions.has(getDescriptor(table).deletePermission))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Never trust the client's tree — re-resolve against current state.
  let impact;
  try {
    impact = await resolveImpact(table, id, permissions);
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to resolve dependencies" },
      { status: 500 },
    );
  }

  if (impact.fingerprint !== fingerprint)
    return NextResponse.json({
      error: "This changed while you were reviewing it. Review the updated list before deleting.",
      impact,
    }, { status: 409 });

  if (!impact.canDeleteAll)
    return NextResponse.json({
      error: impact.blockedReason ?? "Forbidden",
      missingPermissions: impact.missingPermissions,
    }, { status: 403 });

  const targets = [...collectDeletableNodes(impact), { table, id }];

  try {
    await db.transaction(async (tx) => {
      for (const t of targets) {
        await tx.execute(sql`delete from ${sql.identifier(t.table)} where ${sql.identifier("id")} = ${t.id}`);
      }
    });
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    if ((e.code ?? e.cause?.code) === "23503")
      return NextResponse.json({ error: "A record outside the reviewed list still depends on this. Reopen and try again." }, { status: 409 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to delete" }, { status: 500 });
  }

  const byTable = new Map<string, number>();
  for (const t of targets) byTable.set(t.table, (byTable.get(t.table) ?? 0) + 1);

  return NextResponse.json({ deleted: [...byTable].map(([t, count]) => ({ table: t, count })) });
}
