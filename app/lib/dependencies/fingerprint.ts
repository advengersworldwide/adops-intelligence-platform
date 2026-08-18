import { createHash } from "node:crypto";

/** Stable hash over a node set — order-independent, so a re-resolve matches. */
export function fingerprintOf(nodes: { table: string; id: number | string }[]): string {
  const keys = nodes.map(n => `${n.table}:${n.id}`).sort();
  return createHash("sha1").update(keys.join("|")).digest("hex");
}
