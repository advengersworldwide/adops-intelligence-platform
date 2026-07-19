export interface ParetoPoint {
  name: string;
  revenue: number;
  cumulativePct: number;
}

export interface Concentration {
  points: ParetoPoint[];
  hhi: number;
  top5Pct: number;
}

/**
 * Revenue concentration analysis: Pareto (80/20) points + Herfindahl-Hirschman Index.
 *
 * Sorts items descending by revenue; cumulativePct is the running revenue as a
 * percentage of total. hhi sums the squared percentage share of each item
 * (0..10000 — 10000 means a single item holds 100% of revenue). top5Pct is the
 * cumulative percentage held by the top 5 items (or fewer, if there aren't 5).
 */
export function concentration(items: { name: string; revenue: number }[]): Concentration {
  if (items.length === 0) return { points: [], hhi: 0, top5Pct: 0 };

  const sorted = [...items].sort((a, b) => b.revenue - a.revenue);
  const total = sorted.reduce((sum, item) => sum + item.revenue, 0);

  let cumulative = 0;
  let hhi = 0;
  const points: ParetoPoint[] = sorted.map((item) => {
    cumulative += item.revenue;
    const sharePct = total > 0 ? (item.revenue / total) * 100 : 0;
    hhi += sharePct * sharePct;
    return {
      name: item.name,
      revenue: item.revenue,
      cumulativePct: total > 0 ? (cumulative / total) * 100 : 0,
    };
  });

  const top5Pct = points[Math.min(4, points.length - 1)].cumulativePct;

  return { points, hhi, top5Pct };
}
