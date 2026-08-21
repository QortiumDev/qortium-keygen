// The exact second-character weights below come from the R4 review's interval
// analysis of version-0x3A payloads; the digit-DP must reproduce them.

import { describe, expect, it } from 'vitest';
import { charClass, estimateAnywhere, estimateEnd, estimateStart, secondCharacterSet } from './probability';

describe('charClass', () => {
  it('is exact when case-sensitive', () => {
    expect(charClass('A', false)).toHaveLength(1);
    expect(charClass('0', false)).toHaveLength(0);
    expect(charClass('O', false)).toHaveLength(0);
    expect(charClass('I', false)).toHaveLength(0);
    expect(charClass('l', false)).toHaveLength(0);
  });

  it('maps unpaired letters case-insensitively', () => {
    expect(charClass('l', true)).toHaveLength(1); // only L exists
    expect(charClass('O', true)).toHaveLength(1); // only o exists
    expect(charClass('I', true)).toHaveLength(1); // only i exists
    expect(charClass('a', true)).toHaveLength(2); // a and A both exist
    expect(charClass('7', true)).toHaveLength(1);
    expect(charClass('0', true)).toHaveLength(0);
  });
});

describe('estimateStart (digit-DP)', () => {
  it('reproduces the exact second-character distribution', () => {
    expect(estimateStart('L', false).probability).toBeCloseTo(0.017003040083, 9);
    expect(estimateStart('M', false).probability).toBeCloseTo(0.042848598996, 9);
    expect(estimateStart('T', false).probability).toBeCloseTo(0.042848598996, 9);
    expect(estimateStart('a', false).probability).toBeCloseTo(0.042848598996, 9);
    expect(estimateStart('i', false).probability).toBeCloseTo(0.042848598996, 9);
    expect(estimateStart('j', false).probability).toBeCloseTo(0.040327782013, 9);
  });

  it('rejects impossible second characters', () => {
    for (const ch of ['A', 'K', 'k', 'z', '1', '9']) {
      const estimate = estimateStart(ch, false);
      expect(estimate.ok).toBe(false);
      expect(estimate.probability).toBe(0);
    }
  });

  it('second-character probabilities sum to 1', () => {
    let total = 0;
    for (const ch of secondCharacterSet()) total += estimateStart(ch, false).probability;
    expect(total).toBeCloseTo(1, 9);
  });

  it('later characters contribute roughly 1/58 each', () => {
    const one = estimateStart('T', false);
    const two = estimateStart('Ta', false);
    expect(two.probability / one.probability).toBeCloseTo(1 / 58, 6);
  });

  it('case-insensitive doubles paired letters but never the second character', () => {
    const sensitive = estimateStart('Ta', false);
    const insensitive = estimateStart('Ta', true);
    // 'T' after Q: T and t… t is valid base58, but as the SECOND character
    // only T survives; 'a' at position 2 doubles to [aA].
    expect(insensitive.probability / sensitive.probability).toBeCloseTo(2, 4);
  });

  it('flags invalid characters', () => {
    expect(estimateStart('a0b', true).ok).toBe(false);
    expect(estimateStart('Ol', false).ok).toBe(false);
  });
});

describe('estimateEnd', () => {
  it('uses 58^-k per concrete character', () => {
    expect(estimateEnd('ab', false).probability).toBeCloseTo(58 ** -2, 12);
    expect(estimateEnd('abc', true).probability).toBeCloseTo((2 / 58) ** 3, 12);
  });

  it('handles unpaired case classes', () => {
    expect(estimateEnd('L', true).probability).toBeCloseTo(1 / 58, 12);
  });
});

describe('estimateAnywhere', () => {
  it('is close to positions × per-position probability for rare patterns', () => {
    const estimate = estimateAnywhere('abcd', false);
    // 34-4+1 = 31 windows; leading windows contribute little; expect within 20%.
    const naive = 31 * 58 ** -4;
    expect(estimate.probability).toBeGreaterThan(naive * 0.8);
    expect(estimate.probability).toBeLessThan(naive * 1.2);
    expect(estimate.approximate).toBe(true);
  });

  it('is more likely than start or end anchoring for the same pattern', () => {
    const anywhere = estimateAnywhere('abc', false).probability;
    expect(anywhere).toBeGreaterThan(estimateEnd('abc', false).probability);
    expect(anywhere).toBeGreaterThan(estimateStart('abc', false).probability);
  });
});
