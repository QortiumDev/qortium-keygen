import { describe, expect, it } from 'vitest';
import { estimateEta, formatDuration, quantileSeconds, SECONDS_PER_YEAR } from './eta';

describe('eta', () => {
  it('matches the small-p closed forms', () => {
    const p = 1e-6;
    const rate = 1000;
    const eta = estimateEta(p, rate);
    expect(eta.medianSeconds).toBeCloseTo(0.693147 / (p * rate), 1);
    expect(eta.meanSeconds).toBeCloseTo(1 / (p * rate), 6);
    expect(eta.p95Seconds).toBeCloseTo(2.995732 / (p * rate), 0);
    expect(eta.infeasible).toBe(false);
  });

  it('orders median < mean < p95', () => {
    const eta = estimateEta(1e-4, 500);
    expect(eta.medianSeconds).toBeLessThan(eta.meanSeconds);
    expect(eta.meanSeconds).toBeLessThan(eta.p95Seconds);
  });

  it('flags infeasible searches at the one-year p95 threshold', () => {
    expect(estimateEta(1e-12, 1000).infeasible).toBe(true);
  });

  it('handles degenerate inputs', () => {
    expect(quantileSeconds(0, 1000, 0.5)).toBe(Infinity);
    expect(quantileSeconds(0.5, 0, 0.5)).toBe(Infinity);
    expect(estimateEta(1, 1).meanSeconds).toBe(1);
  });

  it('formats durations readably', () => {
    expect(formatDuration(0.5)).toBe('under a second');
    expect(formatDuration(30)).toBe('30 s');
    expect(formatDuration(3600)).toBe('60 min');
    expect(formatDuration(SECONDS_PER_YEAR * 2)).toBe('2.0 years');
    expect(formatDuration(Infinity)).toBe('forever');
  });
});
