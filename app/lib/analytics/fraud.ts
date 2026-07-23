export interface FraudPoint {
  period: string;
  pins: number;
  fraudPins: number;
  validPins: number;
  fraudRatePct: number;
}

/** fraudRatePct = total>0 ? fraud/total*100 : 0. */
export function fraudRate(fraudPins: number, pins: number): number {
  return pins > 0 ? (fraudPins / pins) * 100 : 0;
}

/**
 * Aggregate rows by period (sum pins), compute validPins = pins - fraud and
 * fraudRatePct, sorted ascending by period. Empty input → [].
 */
export function buildFraudSeries(
  rows: { period: string; pins: number; fraudPins: number }[]
): FraudPoint[] {
  const byPeriod = new Map<string, { pins: number; fraudPins: number }>();

  for (const row of rows) {
    const existing = byPeriod.get(row.period) ?? { pins: 0, fraudPins: 0 };
    existing.pins += row.pins;
    existing.fraudPins += row.fraudPins;
    byPeriod.set(row.period, existing);
  }

  return Array.from(byPeriod.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, { pins, fraudPins }]) => ({
      period,
      pins,
      fraudPins,
      validPins: pins - fraudPins,
      fraudRatePct: fraudRate(fraudPins, pins),
    }));
}
