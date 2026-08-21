// Difficulty estimation for vanity patterns, following the R4 review design:
// model the 25-byte payload as a uniform integer in [58*2^192, 59*2^192-1]
// (an excellent random-oracle surrogate for the checksum-constrained space at
// practical pattern lengths) and count matching integers exactly with BigInt
// digit dynamic programming. Addresses are always exactly 34 characters, the
// first is always 'Q', and the second character is strongly non-uniform.

import {
  ADDRESS_LENGTH,
  BASE58_ALPHABET,
  BASE58_INDEX,
  PAYLOAD_HI,
  PAYLOAD_LO,
  PAYLOAD_RANGE,
} from '../crypto/constants';

export type AnchorMode = 'start' | 'end' | 'anywhere';

export interface PatternEstimate {
  ok: boolean;
  issues: string[];
  /** Probability that one random candidate matches (0 when ok is false). */
  probability: number;
  /** 1/probability, Infinity when impossible. */
  difficulty: number;
  /** True when the number is a positional approximation (anywhere mode). */
  approximate: boolean;
}

const Q_DIGIT = BASE58_INDEX.get('Q')!;

/** Allowed base58 digit values for one pattern character. */
export function charClass(ch: string, ignoreCase: boolean): number[] {
  if (!ignoreCase) {
    const digit = BASE58_INDEX.get(ch);
    return digit === undefined ? [] : [digit];
  }
  const digits = new Set<number>();
  for (const variant of [ch.toLowerCase(), ch.toUpperCase()]) {
    const digit = BASE58_INDEX.get(variant);
    if (digit !== undefined) digits.add(digit);
  }
  return [...digits].sort((a, b) => a - b);
}

function toBase58Digits(value: bigint, length: number): number[] {
  const digits = new Array<number>(length).fill(0);
  for (let i = length - 1; i >= 0; i--) {
    digits[i] = Number(value % 58n);
    value /= 58n;
  }
  return digits;
}

const LO_DIGITS = toBase58Digits(PAYLOAD_LO, ADDRESS_LENGTH);
const HI_DIGITS = toBase58Digits(PAYLOAD_HI, ADDRESS_LENGTH);

/**
 * Count payload integers in [PAYLOAD_LO, PAYLOAD_HI] whose 34-digit base58
 * representation has digit i inside constraints[i] (null = unconstrained).
 */
export function countMatchingPayloads(constraints: ReadonlyArray<readonly number[] | null>): bigint {
  if (constraints.length !== ADDRESS_LENGTH) throw new Error('constraints must cover all 34 digits');

  // memo key: position * 4 + tightLo * 2 + tightHi
  const memo = new Map<number, bigint>();

  const count = (pos: number, tightLo: boolean, tightHi: boolean): bigint => {
    if (pos === ADDRESS_LENGTH) return 1n;
    const key = pos * 4 + (tightLo ? 2 : 0) + (tightHi ? 1 : 0);
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    const lo = tightLo ? LO_DIGITS[pos] : 0;
    const hi = tightHi ? HI_DIGITS[pos] : 57;
    const allowed = constraints[pos];
    let total = 0n;

    if (allowed === null) {
      for (let digit = lo; digit <= hi; digit++) {
        total += count(pos + 1, tightLo && digit === lo, tightHi && digit === hi);
      }
    } else {
      for (const digit of allowed) {
        if (digit < lo || digit > hi) continue;
        total += count(pos + 1, tightLo && digit === LO_DIGITS[pos], tightHi && digit === HI_DIGITS[pos]);
      }
    }

    memo.set(key, total);
    return total;
  };

  return count(0, true, true);
}

function probabilityFromCount(count: bigint): number {
  const SCALE = 10n ** 18n;
  return Number((count * SCALE) / PAYLOAD_RANGE) / 1e18;
}

/** Exact probability that a random address's character at `pos` equals digit. */
const secondCharWeights = new Map<number, number>();
function secondCharWeight(digit: number): number {
  let weight = secondCharWeights.get(digit);
  if (weight === undefined) {
    const constraints: (number[] | null)[] = new Array(ADDRESS_LENGTH).fill(null);
    constraints[0] = [Q_DIGIT];
    constraints[1] = [digit];
    weight = probabilityFromCount(countMatchingPayloads(constraints));
    secondCharWeights.set(digit, weight);
  }
  return weight;
}

function findInvalidChars(pattern: string, ignoreCase: boolean): string[] {
  return [...pattern].filter((ch) => charClass(ch, ignoreCase).length === 0);
}

function describeInvalid(chars: string[], ignoreCase: boolean): string {
  const unique = [...new Set(chars)].map((ch) => JSON.stringify(ch)).join(', ');
  const hint = ignoreCase
    ? 'not in the base58 alphabet'
    : 'not in the base58 alphabet (with case-insensitive off, 0, O, I and l are impossible)';
  return `${unique}: ${hint}`;
}

/**
 * Probability for a pattern anchored at the start of the address. The fixed
 * leading 'Q' is NOT part of the pattern; position 0 of the pattern is the
 * address's second character.
 */
export function estimateStart(pattern: string, ignoreCase: boolean): PatternEstimate {
  const issues: string[] = [];
  const invalid = findInvalidChars(pattern, ignoreCase);
  if (invalid.length > 0) issues.push(describeInvalid(invalid, ignoreCase));
  if (pattern.length > ADDRESS_LENGTH - 1) issues.push('Pattern is longer than an address.');
  if (issues.length > 0) return { ok: false, issues, probability: 0, difficulty: Infinity, approximate: false };

  const constraints: (number[] | null)[] = new Array(ADDRESS_LENGTH).fill(null);
  constraints[0] = [Q_DIGIT];
  for (let i = 0; i < pattern.length; i++) constraints[i + 1] = charClass(pattern[i], ignoreCase);

  const probability = probabilityFromCount(countMatchingPayloads(constraints));
  if (probability === 0) {
    issues.push(
      `No address can start with "Q${pattern}". The character right after Q is always one of L, M, N, P–Z, a–j.`,
    );
    return { ok: false, issues, probability: 0, difficulty: Infinity, approximate: false };
  }
  return { ok: true, issues, probability, difficulty: 1 / probability, approximate: false };
}

/** Probability for a pattern anchored at the end of the address. */
export function estimateEnd(pattern: string, ignoreCase: boolean): PatternEstimate {
  const issues: string[] = [];
  const invalid = findInvalidChars(pattern, ignoreCase);
  if (invalid.length > 0) issues.push(describeInvalid(invalid, ignoreCase));
  if (pattern.length > ADDRESS_LENGTH - 1) issues.push('Pattern is longer than an address.');
  if (issues.length > 0) return { ok: false, issues, probability: 0, difficulty: Infinity, approximate: false };

  // Trailing characters are checksum-influenced and effectively uniform
  // (R4 finding 21): each character contributes classSize/58.
  let probability = 1;
  for (const ch of pattern) probability *= charClass(ch, ignoreCase).length / 58;
  return { ok: true, issues, probability, difficulty: 1 / probability, approximate: false };
}

/**
 * Probability for a pattern appearing anywhere in the address. Positional
 * rare-event approximation (R4 finding 23): exact per-position weights for the
 * fixed 'Q' and the second character, 1/58 elsewhere, combined with
 * p = 1 - exp(-lambda). Good for the UI; an exact digit-DP + KMP automaton can
 * replace it later without changing callers.
 */
export function estimateAnywhere(pattern: string, ignoreCase: boolean): PatternEstimate {
  const issues: string[] = [];
  const invalid = findInvalidChars(pattern, ignoreCase);
  if (invalid.length > 0) issues.push(describeInvalid(invalid, ignoreCase));
  if (pattern.length > ADDRESS_LENGTH) issues.push('Pattern is longer than an address.');
  if (issues.length > 0) return { ok: false, issues, probability: 0, difficulty: Infinity, approximate: true };

  const classes = [...pattern].map((ch) => charClass(ch, ignoreCase));

  const positionWeight = (position: number, allowed: number[]): number => {
    if (position === 0) return allowed.includes(Q_DIGIT) ? 1 : 0;
    if (position === 1) return allowed.reduce((sum, digit) => sum + secondCharWeight(digit), 0);
    return allowed.length / 58;
  };

  let lambda = 0;
  for (let startPos = 0; startPos + pattern.length <= ADDRESS_LENGTH; startPos++) {
    let occurrence = 1;
    for (let t = 0; t < classes.length && occurrence > 0; t++) {
      occurrence *= positionWeight(startPos + t, classes[t]);
    }
    lambda += occurrence;
  }

  const probability = -Math.expm1(-lambda);
  if (probability === 0) {
    issues.push('This pattern cannot occur anywhere in an address.');
    return { ok: false, issues, probability: 0, difficulty: Infinity, approximate: true };
  }
  return { ok: true, issues, probability, difficulty: 1 / probability, approximate: true };
}

export function estimatePattern(pattern: string, mode: AnchorMode, ignoreCase: boolean): PatternEstimate {
  if (pattern.length === 0) {
    return { ok: false, issues: ['Enter a pattern.'], probability: 0, difficulty: Infinity, approximate: false };
  }
  switch (mode) {
    case 'start':
      return estimateStart(pattern, ignoreCase);
    case 'end':
      return estimateEnd(pattern, ignoreCase);
    case 'anywhere':
      return estimateAnywhere(pattern, ignoreCase);
  }
}

/** Characters that can appear right after the fixed 'Q' (informational UI). */
export function secondCharacterSet(): string {
  return [...BASE58_ALPHABET]
    .filter((_, digit) => secondCharWeight(digit) > 0)
    .join('');
}
