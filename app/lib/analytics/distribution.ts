export interface MarginBucket {
  label: string;
  min: number;
  max: number;
  count: number;
  isNegative: boolean;
}

/**
 * Contiguous fixed-width buckets from floor(min/binSize)*binSize up to the
 * bucket containing max. Each bucket covers [min, min+binSize).
 * isNegative = bucket.min < 0. Empty input → [].
 */
export function bucketMargins(values: number[], binSize: number = 10): MarginBucket[] {
  if (values.length === 0) return [];

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);

  const startMin = Math.floor(minValue / binSize) * binSize;
  const endMin = Math.floor(maxValue / binSize) * binSize;

  const buckets: MarginBucket[] = [];
  for (let min = startMin; min <= endMin; min += binSize) {
    const max = min + binSize;
    buckets.push({ label: `${min}–${max}%`, min, max, count: 0, isNegative: min < 0 });
  }

  for (const v of values) {
    const bucketMin = Math.floor(v / binSize) * binSize;
    const index = Math.round((bucketMin - startMin) / binSize);
    if (index >= 0 && index < buckets.length) buckets[index].count += 1;
  }

  return buckets;
}
