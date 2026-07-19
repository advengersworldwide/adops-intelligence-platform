export interface FlowGraph {
  nodes: { name: string }[];
  links: { source: number; target: number; value: number }[];
}

export interface FlowRow {
  clientName: string;
  buyingHouseName: string | null;
  partnerName: string;
  spend: number;
}

const NO_BUYING_HOUSE = "(No Buying House)";

/**
 * Build a 3-layer Sankey (Client -> Buying House -> Partner) from flat spend rows.
 *
 * Node uniqueness is per-layer: a client and a partner may share a display name
 * without colliding, since each layer gets its own namespaced lookup key
 * (`c:`, `b:`, `p:`) while `node.name` stores only the plain display name.
 *
 * Link values are aggregated (summed) per (source, target) pair, so repeated
 * rows for the same client/buying-house/partner combination accumulate rather
 * than producing duplicate links.
 *
 * `buyingHouseName === null` is grouped under a single "(No Buying House)" node.
 */
export function buildFlow(rows: FlowRow[]): FlowGraph {
  const nodeIndex = new Map<string, number>();
  const nodes: { name: string }[] = [];
  const linkValues = new Map<string, number>();

  function getNodeIndex(layerKey: string, displayName: string): number {
    const existing = nodeIndex.get(layerKey);
    if (existing !== undefined) return existing;
    const idx = nodes.length;
    nodeIndex.set(layerKey, idx);
    nodes.push({ name: displayName });
    return idx;
  }

  function addLink(source: number, target: number, value: number): void {
    const key = `${source}->${target}`;
    linkValues.set(key, (linkValues.get(key) ?? 0) + value);
  }

  for (const row of rows) {
    const buyingHouseName = row.buyingHouseName ?? NO_BUYING_HOUSE;

    const clientIdx = getNodeIndex(`c:${row.clientName}`, row.clientName);
    const bhIdx = getNodeIndex(`b:${buyingHouseName}`, buyingHouseName);
    const partnerIdx = getNodeIndex(`p:${row.partnerName}`, row.partnerName);

    addLink(clientIdx, bhIdx, row.spend);
    addLink(bhIdx, partnerIdx, row.spend);
  }

  const links = Array.from(linkValues.entries()).map(([key, value]) => {
    const [source, target] = key.split("->").map(Number);
    return { source, target, value };
  });

  return { nodes, links };
}
