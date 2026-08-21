// Time-to-hit presentation. A vanity search is geometric: never promise a
// single "ETA" — show the median, the mean (clearly labeled as not a
// deadline) and the 95th percentile (R4 findings 25-26).

export const SECONDS_PER_YEAR = 31_556_952;

export interface EtaEstimate {
  medianSeconds: number;
  meanSeconds: number;
  p95Seconds: number;
  /** True when even the 95th percentile exceeds a year at this rate. */
  infeasible: boolean;
}

/** Seconds until the q-quantile of the first hit, at `rate` candidates/sec. */
export function quantileSeconds(probability: number, rate: number, quantile: number): number {
  if (probability <= 0 || rate <= 0) return Infinity;
  if (probability >= 1) return 1 / rate;
  const trials = Math.log1p(-quantile) / Math.log1p(-probability);
  return trials / rate;
}

export function estimateEta(probability: number, rate: number): EtaEstimate {
  const medianSeconds = quantileSeconds(probability, rate, 0.5);
  const meanSeconds = probability > 0 && rate > 0 ? 1 / (probability * rate) : Infinity;
  const p95Seconds = quantileSeconds(probability, rate, 0.95);
  return { medianSeconds, meanSeconds, p95Seconds, infeasible: p95Seconds > SECONDS_PER_YEAR };
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'forever';
  if (seconds < 1) return 'under a second';
  if (seconds < 90) return `${Math.round(seconds)} s`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 36) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
  const days = hours / 24;
  if (days < 366) return `${days < 10 ? days.toFixed(1) : Math.round(days)} days`;
  const years = seconds / SECONDS_PER_YEAR;
  if (years < 1000) return `${years < 10 ? years.toFixed(1) : Math.round(years)} years`;
  return `${years.toExponential(1)} years`;
}

export function formatDifficulty(difficulty: number): string {
  if (!Number.isFinite(difficulty)) return 'impossible';
  if (difficulty < 1000) return `1 in ${Math.round(difficulty)}`;
  return `1 in ${difficulty.toPrecision(3).replace(/e\+?(\d+)/, '×10^$1')}`;
}
