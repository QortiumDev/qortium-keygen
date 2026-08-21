// Match specifications for the search hot loop.
//
// Start-anchored patterns compile to sorted numeric payload intervals
// (R4 finding 41): a candidate's 21-byte core pins its payload integer to
// [core*2^32, core*2^32 + 2^32 - 1], so most candidates are rejected by a
// byte comparison without computing the checksum or any base58. End/anywhere
// patterns need the full address string; the checksum + one encode is cheap
// next to the ed25519 work, so they compile to a regular expression.

import { bigintToBytes } from '../crypto/base58';
import {
  ADDRESS_LENGTH,
  BASE58_ALPHABET,
  CORE_BYTES,
  PAYLOAD_BYTES,
  PAYLOAD_HI,
  PAYLOAD_LO,
} from '../crypto/constants';
import { charClass, type AnchorMode } from '../estimator/probability';

/** Above this many case-expansion variants, fall back to string matching. */
const MAX_INTERVAL_VARIANTS = 4096;

export interface PayloadInterval {
  lo: Uint8Array; // 25 bytes inclusive
  hi: Uint8Array; // 25 bytes inclusive
}

export type MatchSpec =
  | { kind: 'intervals'; intervals: PayloadInterval[] }
  | { kind: 'regex'; source: string; flags: string };

export class PatternCompileError extends Error {}

function classesFor(pattern: string, ignoreCase: boolean): number[][] {
  return [...pattern].map((ch) => {
    const digits = charClass(ch, ignoreCase);
    if (digits.length === 0) throw new PatternCompileError(`Impossible character ${JSON.stringify(ch)}`);
    return digits;
  });
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function buildIntervals(pattern: string, ignoreCase: boolean): PayloadInterval[] | null {
  const classes = classesFor(pattern, ignoreCase);
  const variantCount = classes.reduce((product, cls) => product * cls.length, 1);
  if (variantCount > MAX_INTERVAL_VARIANTS) return null;

  // Enumerate concrete digit sequences for the pattern (after the fixed 'Q').
  const span = 58n ** BigInt(ADDRESS_LENGTH - 1 - pattern.length);
  const intervals: PayloadInterval[] = [];

  const emit = (prefixValue: bigint) => {
    const lo = prefixValue * span;
    const hi = lo + span - 1n;
    const clampedLo = lo < PAYLOAD_LO ? PAYLOAD_LO : lo;
    const clampedHi = hi > PAYLOAD_HI ? PAYLOAD_HI : hi;
    if (clampedLo > clampedHi) return; // impossible (e.g. second char outside L..j)
    intervals.push({
      lo: bigintToBytes(clampedLo, PAYLOAD_BYTES),
      hi: bigintToBytes(clampedHi, PAYLOAD_BYTES),
    });
  };

  const qDigit = BigInt(BASE58_ALPHABET.indexOf('Q'));
  const walk = (index: number, value: bigint) => {
    if (index === classes.length) {
      emit(value);
      return;
    }
    for (const digit of classes[index]) walk(index + 1, value * 58n + BigInt(digit));
  };
  walk(0, qDigit);

  intervals.sort((a, b) => compareBytes(a.lo, b.lo));
  return intervals;
}

function regexSource(pattern: string, mode: AnchorMode, ignoreCase: boolean): string {
  const body = [...pattern]
    .map((ch) => {
      const digits = charClass(ch, ignoreCase);
      if (digits.length === 0) throw new PatternCompileError(`Impossible character ${JSON.stringify(ch)}`);
      const chars = digits.map((digit) => BASE58_ALPHABET[digit]).join('');
      return chars.length === 1 ? chars : `[${chars}]`;
    })
    .join('');
  if (mode === 'start') return `^Q${body}`;
  if (mode === 'end') return `${body}$`;
  return body;
}

export function buildMatchSpec(pattern: string, mode: AnchorMode, ignoreCase: boolean): MatchSpec {
  if (pattern.length === 0) throw new PatternCompileError('Empty pattern');
  if (mode === 'start') {
    const intervals = buildIntervals(pattern, ignoreCase);
    if (intervals !== null) {
      if (intervals.length === 0) {
        throw new PatternCompileError('No address can start with this pattern.');
      }
      return { kind: 'intervals', intervals };
    }
  }
  return { kind: 'regex', source: regexSource(pattern, mode, ignoreCase), flags: '' };
}

export type CoreTestResult = 'reject' | 'match' | 'needs-checksum';

/**
 * Runtime matcher over sorted intervals. Reusable across candidates with no
 * allocation: callers pass the same scratch buffers each time.
 */
export class IntervalMatcher {
  private readonly intervals: PayloadInterval[];
  private readonly candidateLo = new Uint8Array(PAYLOAD_BYTES);
  private readonly candidateHi = new Uint8Array(PAYLOAD_BYTES);

  constructor(intervals: PayloadInterval[]) {
    this.intervals = intervals;
    this.candidateHi.fill(0xff, CORE_BYTES);
  }

  /**
   * Classify a candidate by its 21-byte core alone. 'match' means every
   * possible checksum keeps the address inside a target interval; 'reject'
   * means none does; 'needs-checksum' is the rare boundary case.
   */
  testCore(core: Uint8Array): CoreTestResult {
    this.candidateLo.set(core, 0);
    this.candidateHi.set(core, 0);

    // Binary search for the first interval whose hi >= candidateLo.
    let low = 0;
    let high = this.intervals.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (compareBytes(this.intervals[mid].hi, this.candidateLo) >= 0) {
        found = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    if (found === -1) return 'reject';

    const interval = this.intervals[found];
    if (compareBytes(this.candidateHi, interval.lo) < 0) return 'reject';
    if (
      compareBytes(this.candidateLo, interval.lo) >= 0 &&
      compareBytes(this.candidateHi, interval.hi) <= 0
    ) {
      return 'match';
    }
    return 'needs-checksum';
  }

  /** Exact membership test for a full 25-byte payload (boundary case). */
  testPayload(payload: Uint8Array): boolean {
    for (const interval of this.intervals) {
      if (compareBytes(payload, interval.lo) >= 0 && compareBytes(payload, interval.hi) <= 0) return true;
    }
    return false;
  }
}
