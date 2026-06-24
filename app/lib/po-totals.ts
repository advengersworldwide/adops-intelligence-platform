export interface PoLineInput {
  cacRate: number;
  eventCount: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function lineBudget(cacRate: number, eventCount: number): number {
  return round2(cacRate * eventCount);
}

export function totalBudget(items: PoLineInput[]): number {
  return round2(items.reduce((sum, i) => sum + i.cacRate * i.eventCount, 0));
}
