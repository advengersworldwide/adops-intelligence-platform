// Pure global z-score anomaly detection over a numeric series.
// z = (value - mean) / stdDev (population std-dev, dividing by n not n-1).
// A flat series (stdDev 0) can't produce a meaningful z-score, so every
// point is reported as z=0 / not-anomalous rather than NaN/Infinity.

export interface AnomalyPoint {
  index: number;
  value: number;
  z: number;
  isAnomaly: boolean;
}

/**
 * Flags points whose global z-score exceeds `threshold` (default 2.5).
 * Empty input → []. Flat input (stdDev 0) → all z=0, no anomalies.
 */
export function detectAnomalies(values: number[], threshold = 2.5): AnomalyPoint[] {
  const n = values.length;
  if (n === 0) return [];

  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  return values.map((value, index) => {
    const z = stdDev === 0 ? 0 : (value - mean) / stdDev;
    return { index, value, z, isAnomaly: Math.abs(z) > threshold };
  });
}
