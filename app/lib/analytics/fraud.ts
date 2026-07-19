export interface FraudPoint {
  period: string;
  appsflyerPins: number;
  fraudPins: number;
  validPins: number;
  fraudRatePct: number;
}

/** fraudRatePct = total>0 ? fraud/total*100 : 0. */
export function fraudRate(fraudPins: number, appsflyerPins: number): number {
  return appsflyerPins > 0 ? (fraudPins / appsflyerPins) * 100 : 0;
}

/**
 * Aggregate rows by period (sum pins), compute validPins = appsflyer - fraud and
 * fraudRatePct, sorted ascending by period. Empty input → [].
 */
export function buildFraudSeries(
  rows: { period: string; appsflyerPins: number; fraudPins: number }[]
): FraudPoint[] {
  const byPeriod = new Map<string, { appsflyerPins: number; fraudPins: number }>();

  for (const row of rows) {
    const existing = byPeriod.get(row.period) ?? { appsflyerPins: 0, fraudPins: 0 };
    existing.appsflyerPins += row.appsflyerPins;
    existing.fraudPins += row.fraudPins;
    byPeriod.set(row.period, existing);
  }

  return Array.from(byPeriod.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, { appsflyerPins, fraudPins }]) => ({
      period,
      appsflyerPins,
      fraudPins,
      validPins: appsflyerPins - fraudPins,
      fraudRatePct: fraudRate(fraudPins, appsflyerPins),
    }));
}
