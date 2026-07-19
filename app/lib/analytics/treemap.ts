export interface TreemapChild {
  name: string;
  size: number;
}

export interface TreemapNode {
  name: string;
  children: TreemapChild[];
}

/**
 * Group cells by client → children are that client's partners with size=revenue.
 * Client order = first-seen; partner children order = first-seen within the client.
 * Skips cells with revenue <= 0. Empty input → [].
 */
export function buildTreemap(cells: { client: string; partner: string; revenue: number }[]): TreemapNode[] {
  const clientOrder: string[] = [];
  const nodesByClient = new Map<string, TreemapNode>();

  for (const cell of cells) {
    if (cell.revenue <= 0) continue;

    let node = nodesByClient.get(cell.client);
    if (!node) {
      node = { name: cell.client, children: [] };
      nodesByClient.set(cell.client, node);
      clientOrder.push(cell.client);
    }

    node.children.push({ name: cell.partner, size: cell.revenue });
  }

  return clientOrder.map((client) => nodesByClient.get(client)!);
}
