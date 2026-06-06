// Mirrors artifacts/api-server/src/lib/computeRow.ts — keep both in sync when formula changes.

export interface ComputeRowInput {
  appsflyerPins: number;
  fraudPins: number;
  payoutRate: number;
  marginPct: number;
  forexSellingRate: number;
  forexBuyingRate: number;
  salesTaxPct: number;
  remittanceTaxPct: number;
  withholdingTaxPct: number;
  bulkDiscountPct: number;
  platformBulkDiscountPct: number;
}

export interface ComputeRowResult {
  actualPins: number;
  netAmtUsd: number;
  netAmtPkr: number;
  grossAmtPkr: number;
  salesTax: number;
  totalAmtPkr: number;
  bulkDiscountAmt: number;
  amtAfterDiscount: number;
  wht: number;
  receivablePkr: number;
  netPayableUsd: number;
  remittanceTax: number;
  totalPayableUsd: number;
  platformDiscountAmt: number;
  totalPayablePkr: number;
  netMarginPkr: number;
}

export function computeRow(r: ComputeRowInput): ComputeRowResult {
  const { appsflyerPins, fraudPins, payoutRate, marginPct,
    forexSellingRate, forexBuyingRate, salesTaxPct, remittanceTaxPct,
    withholdingTaxPct, bulkDiscountPct, platformBulkDiscountPct } = r;

  const actualPins = appsflyerPins - fraudPins;
  const netAmtUsd = actualPins * payoutRate;
  const netAmtPkr = netAmtUsd * forexSellingRate;
  const grossAmtPkr = marginPct > 0 ? netAmtPkr / (1 - marginPct / 100) : netAmtPkr;
  const salesTax = grossAmtPkr * (salesTaxPct / 100);
  const totalAmtPkr = grossAmtPkr + salesTax;
  const bulkDiscountAmt = totalAmtPkr * (bulkDiscountPct / 100);
  const amtAfterDiscount = totalAmtPkr - bulkDiscountAmt;
  const wht = amtAfterDiscount * (withholdingTaxPct / 100);
  const receivablePkr = amtAfterDiscount - wht - salesTax;

  const netPayableUsd = netAmtUsd * (1 - marginPct / 100);
  const remittanceTax = netPayableUsd * (remittanceTaxPct / 100);
  const totalPayableUsd = netPayableUsd + remittanceTax;
  const platformDiscountAmt = totalPayableUsd * (platformBulkDiscountPct / 100);
  const totalPayablePkr = (totalPayableUsd - platformDiscountAmt) * forexBuyingRate;
  const netMarginPkr = receivablePkr - totalPayablePkr;

  return {
    actualPins, netAmtUsd, netAmtPkr, grossAmtPkr,
    salesTax, totalAmtPkr, bulkDiscountAmt, amtAfterDiscount, wht,
    receivablePkr, netPayableUsd, remittanceTax, totalPayableUsd,
    platformDiscountAmt, totalPayablePkr, netMarginPkr,
  };
}
