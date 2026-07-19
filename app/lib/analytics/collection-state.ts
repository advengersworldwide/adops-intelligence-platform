// Pure invoice collection-state classifier. Currency-agnostic — callers pass net receivable
// and collected amounts in whatever currency they've already computed (see analytics/invoice-funnel route).

export type CollectionState = "paid" | "partial" | "outstanding";

const EPSILON = 1e-6;

/**
 * paid when collected >= net (within epsilon); partial when 0 < collected < net; else outstanding.
 * A zero/negative net (e.g. fully credited billing) is always "paid".
 */
export function collectionState(net: number, collected: number): CollectionState {
  if (net <= 0) return "paid";
  if (collected >= net - EPSILON) return "paid";
  if (collected > 0) return "partial";
  return "outstanding";
}
