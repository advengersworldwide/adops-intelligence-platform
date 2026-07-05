// Single source of truth for billing math (server + client), mirroring
// the pattern of compute-row.ts. All *Pct inputs are percentages (15 = 15%).

export interface BillingEventInput {
  eventCount: number;
  billableRate: number; // client rate, USD
  payoutRate: number;   // partner rate, USD
}

export interface ComputeBillingInput {
  events: BillingEventInput[];
  forexSellingRate: number;
  forexBuyingRate: number;
  remittanceTaxPct: number;
  salesTaxPct: number;
  withholdingTaxPct: number;
  bulkDiscountPct: number;
  whtApplied: boolean;
}

export interface ComputeBillingResult {
  netTotalUsd: number;
  netTotalPkr: number;
  grossTotalPkr: number;
  salesTax: number;
  totalInvoice: number;
  lessWht: number;
  lessSst: number;
  lessBd: number;
  netReceivable: number;
  netPayableUsd: number;
  netPayablePkr: number;
  netMargin: number;
}

/** g = ((1+ST)·WHT) / (1 − (1+ST)·WHT), where ST and WHT are fractions. */
export function whtGrossUpRate(salesTaxPct: number, withholdingTaxPct: number): number {
  const k = (1 + salesTaxPct / 100) * (withholdingTaxPct / 100);
  return k / (1 - k);
}

export function computeBilling(input: ComputeBillingInput): ComputeBillingResult {
  const {
    events, forexSellingRate, forexBuyingRate,
    remittanceTaxPct, salesTaxPct, withholdingTaxPct, bulkDiscountPct, whtApplied,
  } = input;

  const netTotalUsd = events.reduce((s, e) => s + e.eventCount * e.billableRate, 0);
  const netTotalPkr = netTotalUsd * forexSellingRate;

  let grossTotalPkr = netTotalPkr / (1 - remittanceTaxPct / 100);
  if (whtApplied) grossTotalPkr *= 1 + whtGrossUpRate(salesTaxPct, withholdingTaxPct);

  const salesTax = grossTotalPkr * (salesTaxPct / 100);
  const totalInvoice = grossTotalPkr + salesTax;

  const lessWht = totalInvoice * (withholdingTaxPct / 100);
  const lessSst = salesTax;
  const lessBd = grossTotalPkr * (bulkDiscountPct / 100);
  const netReceivable = totalInvoice - lessWht - lessSst - lessBd;

  const netPayableUsd = events.reduce((s, e) => s + e.eventCount * e.payoutRate, 0);
  const netPayablePkr = netPayableUsd * forexBuyingRate;
  const netMargin = netReceivable - netPayablePkr;

  return {
    netTotalUsd, netTotalPkr, grossTotalPkr, salesTax, totalInvoice,
    lessWht, lessSst, lessBd, netReceivable, netPayableUsd, netPayablePkr, netMargin,
  };
}
