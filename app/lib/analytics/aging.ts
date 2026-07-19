// Pure AR/AP aging bucketing. Buckets outstanding amounts by age in days as of a reference date.
// Currency-agnostic: callers decide what "amount" means (AR is PKR, AP is USD — see analytics/aging route).

export interface AgingBuckets {
  "0-30": number;
  "31-60": number;
  "61-90": number;
  "90+": number;
}

export interface AgingItem {
  amount: number;
  date: string | Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Sum amounts into age buckets by days between item.date and asOf.
 * age<=30 -> "0-30"; 31..60 -> "31-60"; 61..90 -> "61-90"; >90 -> "90+".
 * Null/absent date is treated as age 0 ("0-30"). Negative/zero amounts are skipped by the CALLER, not here.
 */
export function bucketByAge(items: AgingItem[], asOf: Date): AgingBuckets {
  const buckets: AgingBuckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const item of items) {
    const age = item.date == null ? 0 : Math.floor((asOf.getTime() - new Date(item.date).getTime()) / DAY_MS);
    const key: keyof AgingBuckets = age <= 30 ? "0-30" : age <= 60 ? "31-60" : age <= 90 ? "61-90" : "90+";
    buckets[key] += item.amount;
  }
  return buckets;
}
