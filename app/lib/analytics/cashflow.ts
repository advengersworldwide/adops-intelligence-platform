// Pure running-balance accumulator for the cash-flow timeline.
// Currency-agnostic: operates on already-single-currency numbers — the caller
// (CashFlowChart) is responsible for converting native-currency amounts into
// the base currency before calling this.

export interface CashFlowInput {
  date: string;
  inflow: number;
  outflow: number;
  fundedOut: number;
  unfundedOut: number;
}

export interface CashFlowPoint extends CashFlowInput {
  balance: number;
}

/** Sort rows ascending by date, accumulate balance += inflow - outflow. Returns points with cumulative balance. */
export function runningBalance(rows: CashFlowInput[]): CashFlowPoint[] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  let balance = 0;
  return sorted.map((row) => {
    balance += row.inflow - row.outflow;
    return { ...row, balance };
  });
}
