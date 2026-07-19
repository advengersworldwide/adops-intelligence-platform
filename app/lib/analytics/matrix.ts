export interface MatrixCell {
  client: string;
  partner: string;
  marginPct: number;
  revenue: number;
}

export interface Matrix {
  clients: string[];
  partners: string[];
  cells: MatrixCell[];
}

/**
 * Distinct clients + partners (first-seen order). One cell per (client,partner)
 * present in rows, marginPct = spend>0 ? profit/spend*100 : 0, revenue = spend.
 * Empty input → { clients:[], partners:[], cells:[] }.
 */
export function buildMatrix(rows: { client: string; partner: string; spend: number; profit: number }[]): Matrix {
  const clients: string[] = [];
  const partners: string[] = [];
  const seenClients = new Set<string>();
  const seenPartners = new Set<string>();

  for (const row of rows) {
    if (!seenClients.has(row.client)) {
      seenClients.add(row.client);
      clients.push(row.client);
    }
    if (!seenPartners.has(row.partner)) {
      seenPartners.add(row.partner);
      partners.push(row.partner);
    }
  }

  const cells: MatrixCell[] = rows.map(row => ({
    client: row.client,
    partner: row.partner,
    marginPct: row.spend > 0 ? (row.profit / row.spend) * 100 : 0,
    revenue: row.spend,
  }));

  return { clients, partners, cells };
}
