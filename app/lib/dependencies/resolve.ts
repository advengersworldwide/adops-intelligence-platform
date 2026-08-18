import { sql } from "drizzle-orm";
import { db, dependentsOf, isBlocking, type FkEdge } from "@workspace/db";
import { getDescriptor, hasDescriptor } from "./descriptors";
import { fingerprintOf } from "./fingerprint";
import {
  MAX_DEPTH, MAX_ROWS_PER_LEVEL, CASCADE_SAMPLE_SIZE,
  type Impact, type ImpactNode, type CascadeGroup, type NullifyGroup,
} from "./types";

type Row = Record<string, unknown>;

async function selectRows(table: string, column: string, value: unknown, columns: string[], limit: number): Promise<Row[]> {
  const list = sql.join(columns.map(c => sql.identifier(c)), sql`, `);
  const res = await db.execute(sql`
    select ${list} from ${sql.identifier(table)}
    where ${sql.identifier(column)} = ${value}
    order by ${sql.identifier("id")} limit ${limit}
  `);
  return (res.rows ?? []) as Row[];
}

async function countRows(table: string, column: string, value: unknown): Promise<number> {
  const res = await db.execute(sql`
    select count(*)::int as n from ${sql.identifier(table)}
    where ${sql.identifier(column)} = ${value}
  `);
  return Number(((res.rows ?? [])[0] as { n?: number } | undefined)?.n ?? 0);
}

/** Total rows destroyed when `table`/`id` is deleted, following cascade edges only. */
async function cascadeTotal(table: string, id: unknown, depth: number): Promise<number> {
  if (depth > MAX_DEPTH) return 0;
  let total = 1;
  for (const edge of dependentsOf.get(table) ?? []) {
    if (edge.onDelete !== "cascade") continue;
    const rows = await selectRows(edge.childTable, edge.childColumn, id, ["id"], MAX_ROWS_PER_LEVEL);
    const count = await countRows(edge.childTable, edge.childColumn, id);
    // Sampled sub-walk: exact for small sets, approximated by count for large ones.
    if (count <= rows.length) {
      for (const r of rows) total += await cascadeTotal(edge.childTable, r.id, depth + 1);
    } else {
      total += count;
    }
  }
  return total;
}

function toNode(edge: FkEdge, row: Row, permissions: Set<string>): ImpactNode {
  const d = getDescriptor(edge.childTable);
  const id = row.id as number | string;
  return {
    table: edge.childTable,
    id,
    label: d.labelWith(row),
    singular: d.singular,
    href: d.href ? d.href(id) : null,
    canDelete: permissions.has(d.deletePermission),
    requiredPermission: d.deletePermission,
    deleteEndpoint: d.deleteEndpoint ? d.deleteEndpoint(id) : null,
    children: [],
    truncated: false,
  };
}

async function resolveBlockers(table: string, id: unknown, permissions: Set<string>, depth: number): Promise<{ nodes: ImpactNode[]; truncated: boolean }> {
  if (depth >= MAX_DEPTH) return { nodes: [], truncated: true };
  const nodes: ImpactNode[] = [];
  let truncated = false;

  for (const edge of dependentsOf.get(table) ?? []) {
    if (!isBlocking(edge.onDelete)) continue;
    const d = getDescriptor(edge.childTable);
    const rows = await selectRows(edge.childTable, edge.childColumn, id, d.labelColumns, MAX_ROWS_PER_LEVEL + 1);
    if (rows.length > MAX_ROWS_PER_LEVEL) {
      truncated = true;
      rows.length = MAX_ROWS_PER_LEVEL;
    }
    for (const row of rows) {
      const node = toNode(edge, row, permissions);
      const child = await resolveBlockers(edge.childTable, node.id, permissions, depth + 1);
      node.children = child.nodes;
      node.truncated = child.truncated;
      if (child.truncated) truncated = true;
      nodes.push(node);
    }
  }
  return { nodes, truncated };
}

export async function resolveImpact(table: string, id: number | string, permissions: Set<string>): Promise<Impact> {
  if (!hasDescriptor(table)) throw new Error(`No dependency descriptor registered for table "${table}"`);
  const targetDesc = getDescriptor(table);

  const [targetRow] = await selectRows(table, "id", id, targetDesc.labelColumns, 1);
  if (!targetRow) throw new Error(`${targetDesc.singular} not found`);

  const { nodes: blockers, truncated } = await resolveBlockers(table, id, permissions, 0);

  const cascades: CascadeGroup[] = [];
  const nullifies: NullifyGroup[] = [];

  for (const edge of dependentsOf.get(table) ?? []) {
    if (edge.onDelete === "cascade") {
      const count = await countRows(edge.childTable, edge.childColumn, id);
      if (count === 0) continue;
      const d = getDescriptor(edge.childTable);
      const sampleRows = await selectRows(edge.childTable, edge.childColumn, id, d.labelColumns, CASCADE_SAMPLE_SIZE);
      let transitive = 0;
      for (const r of sampleRows) transitive += await cascadeTotal(edge.childTable, r.id, 1);
      const perRow = sampleRows.length > 0 ? transitive / sampleRows.length : 1;
      cascades.push({
        table: edge.childTable,
        label: d.plural,
        count: Math.round(count * perRow),
        sample: sampleRows.map(r => toNode(edge, r, permissions)),
        canDelete: permissions.has(d.deletePermission),
        requiredPermission: d.deletePermission,
      });
    } else if (edge.onDelete === "set null" || edge.onDelete === "set default") {
      const count = await countRows(edge.childTable, edge.childColumn, id);
      if (count === 0) continue;
      const d = getDescriptor(edge.childTable);
      nullifies.push({ table: edge.childTable, column: edge.childColumn, label: d.plural, count });
    }
  }

  const missing = new Set<string>();
  const walk = (ns: ImpactNode[]) => ns.forEach(n => {
    if (!n.canDelete) missing.add(n.requiredPermission);
    walk(n.children);
  });
  walk(blockers);
  for (const c of cascades) if (!c.canDelete) missing.add(c.requiredPermission);

  const blockerCount = (function count(ns: ImpactNode[]): number {
    return ns.reduce((s, n) => s + 1 + count(n.children), 0);
  })(blockers);

  const touchesFinancial =
    targetDesc.financial ||
    cascades.some(c => getDescriptor(c.table).financial) ||
    (function anyFinancial(ns: ImpactNode[]): boolean {
      return ns.some(n => getDescriptor(n.table).financial || anyFinancial(n.children));
    })(blockers);

  const nodeKeys = [
    { table, id },
    ...(function flatten(ns: ImpactNode[]): { table: string; id: number | string }[] {
      return ns.flatMap(n => [{ table: n.table, id: n.id }, ...flatten(n.children)]);
    })(blockers),
    ...cascades.map(c => ({ table: c.table, id: `count:${c.count}` })),
  ];

  const blockedReason = truncated
    ? "This entity has more dependents than can be safely reviewed at once. Delete some individually first."
    : missing.size > 0
      ? "You do not have permission to delete every affected record."
      : null;

  return {
    target: { table, id, label: targetDesc.labelWith(targetRow), singular: targetDesc.singular },
    blockers,
    cascades,
    nullifies,
    canDeleteAll: !truncated && missing.size === 0,
    blockedReason,
    missingPermissions: [...missing].sort(),
    totals: {
      // +1 counts the target row itself — deletes is the true blast radius,
      // not just what's destroyed in addition to it. Do not remove the +1.
      deletes: blockerCount + cascades.reduce((s, c) => s + c.count, 0) + 1,
      nullifies: nullifies.reduce((s, n) => s + n.count, 0),
      touchesFinancial,
    },
    fingerprint: fingerprintOf(nodeKeys),
  };
}

/** Blocker nodes flattened deepest-first — the order they must be deleted in. */
export function collectDeletableNodes(impact: Pick<Impact, "blockers">): { table: string; id: number | string }[] {
  const out: { table: string; id: number | string }[] = [];
  const walk = (ns: ImpactNode[]) => {
    for (const n of ns) {
      walk(n.children);
      out.push({ table: n.table, id: n.id });
    }
  };
  walk(impact.blockers);
  return out;
}
