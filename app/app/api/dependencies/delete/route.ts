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
import type { Impact } from "@/lib/dependencies/types";

export const runtime = "nodejs";

const Body = z.object({
  table: z.string().min(1),
  id: z.number().int().positive(),
  fingerprint: z.string().min(1),
});

/** The impact moved under the user; carries the fresh tree back to the dialog. */
class StaleImpact extends Error {
  constructor(readonly impact: Impact) { super("Impact fingerprint no longer matches"); }
}
/** The fresh impact is not fully deletable by this caller. */
class BlockedImpact extends Error {
  constructor(readonly impact: Impact) { super("Impact is not fully deletable"); }
}

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

  try {
    const deleted = await db.transaction(async (tx) => {
      // Never trust the client's tree — re-resolve against current state, and do it
      // on `tx` so the tree that is reviewed, authorised and fingerprint-checked is
      // read on the same connection that then issues the deletes. Resolving before
      // opening the transaction left a window in which a row inserted mid-flight was
      // covered for blockers (Postgres RESTRICT → 23503 → 409) but silently
      // cascade-deleted without ever being reviewed.
      const impact = await resolveImpact(table, id, permissions, tx);
      if (impact.fingerprint !== fingerprint) throw new StaleImpact(impact);
      if (!impact.canDeleteAll) throw new BlockedImpact(impact);

      const targets = [...collectDeletableNodes(impact), { table, id }];
      for (const t of targets) {
        await tx.execute(sql`delete from ${sql.identifier(t.table)} where ${sql.identifier("id")} = ${t.id}`);
      }

      const byTable = new Map<string, number>();
      for (const t of targets) byTable.set(t.table, (byTable.get(t.table) ?? 0) + 1);
      return [...byTable].map(([t, count]) => ({ table: t, count }));
    });

    return NextResponse.json({ deleted });
  } catch (err) {
    if (err instanceof StaleImpact)
      return NextResponse.json({
        error: "This changed while you were reviewing it. Review the updated list before deleting.",
        impact: err.impact,
      }, { status: 409 });

    if (err instanceof BlockedImpact)
      return NextResponse.json({
        error: err.impact.blockedReason ?? "Forbidden",
        missingPermissions: err.impact.missingPermissions,
      }, { status: 403 });

    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });

    const e = err as { code?: string; cause?: { code?: string } };
    if ((e.code ?? e.cause?.code) === "23503")
      return NextResponse.json({ error: "A record outside the reviewed list still depends on this. Reopen and try again." }, { status: 409 });

    // Driver text leaks schema internals into a user-facing toast — that is how
    // `column "invoiceCode" does not exist` reached the UI. Log it, don't ship it.
    console.error("[POST /api/dependencies/delete] failed", { table, id }, err);
    return NextResponse.json({ error: "Failed to delete. Please try again." }, { status: 500 });
  }
}
