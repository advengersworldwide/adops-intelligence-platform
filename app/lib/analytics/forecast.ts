// Pure ordinary-least-squares linear forecast over an equally-spaced series.
// Fits a line through (x=0..n-1, y=values[x]) and projects it `horizon` steps
// beyond the last index. The confidence band is +/-1.96 * the residual
// standard deviation (using n-2 degrees of freedom, the usual estimator for
// simple linear regression), so a perfect fit collapses the band to zero.

export interface ForecastPoint {
  value: number;
  lower: number;
  upper: number;
}

/**
 * Ordinary least-squares linear trend over the sequence of values (x = 0..n-1),
 * projected `horizon` steps beyond the last index. Band = +/-1.96 * residual
 * std-dev (0 when fewer than 3 points or a perfect fit). Returns exactly
 * `horizon` points.
 *
 * Empty/single-value input can't define a slope, so it falls back to a flat
 * forecast at the last value (or 0 when there's no value at all) with a
 * zero-width band.
 */
export function linearForecast(values: number[], horizon: number): ForecastPoint[] {
  const n = values.length;

  if (n < 2) {
    const last = n === 1 ? values[0] : 0;
    return Array.from({ length: horizon }, () => ({ value: last, lower: last, upper: last }));
  }

  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, v) => sum + v, 0) / n;

  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - meanX;
    sxy += dx * (values[i] - meanY);
    sxx += dx * dx;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = meanY - slope * meanX;

  let band = 0;
  if (n >= 3) {
    const ssr = values.reduce((sum, v, i) => {
      const residual = v - (intercept + slope * i);
      return sum + residual * residual;
    }, 0);
    const stdDev = Math.sqrt(Math.max(ssr / (n - 2), 0));
    band = 1.96 * stdDev;
  }

  const points: ForecastPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    const x = n - 1 + h;
    const value = intercept + slope * x;
    points.push({ value, lower: value - band, upper: value + band });
  }
  return points;
}
