// Single source of truth for FX conversion + compact money formatting.
// Consolidates the convert()/fmt() logic previously duplicated in
// app/app/(dashboard)/page.tsx and analytics/page.tsx.

export type Rates = Record<string, number>;

export const DEFAULT_RATES: Rates = {
  usd: 1.0, eur: 0.92, gbp: 0.79, inr: 83.0, jpy: 155.0,
  cad: 1.36, aud: 1.5, pkr: 278.0, sar: 3.75, aed: 3.67,
};

/** Convert `amount` expressed in `from` currency into base currency. */
export function convertTo(amount: number, from: string, rates: Rates): number {
  const rate = rates[(from || "USD").toLowerCase()];
  return rate && rate > 0 ? amount / rate : amount;
}

export function formatMoney(n: number, currency = "USD"): string {
  const prefix = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : `${currency} `;
  const neg = n < 0;
  const abs = Math.abs(n);
  const val = abs >= 1_000_000 ? `${(abs / 1_000_000).toFixed(1)}M`
    : abs >= 1_000 ? `${(abs / 1_000).toFixed(1)}K`
    : abs.toFixed(0);
  return `${neg ? "-" : ""}${prefix}${val}`;
}
