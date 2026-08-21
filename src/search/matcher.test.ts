// Property test: the numeric interval matcher must agree exactly with plain
// string matching on the fully-derived address, for every candidate —
// including synthetic boundary candidates whose payload interval straddles a
// base58 digit boundary (the case where the checksum decides).

import { describe, expect, it } from 'vitest';
import { referenceCrypto } from '../crypto/backends';
import { base58Encode, bigintToBytes, bytesToBigint } from '../crypto/base58';
import { CORE_BYTES, PAYLOAD_BYTES } from '../crypto/constants';
import { coreChecksum, coreToAddress, publicKeyToCore } from '../crypto/derive';
import { buildMatchSpec, IntervalMatcher, PatternCompileError } from './matcher';

const engine = referenceCrypto();

function addressAndCoreFromRandomSeed(): { core: Uint8Array; address: string } {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const core = publicKeyToCore(engine, engine.ed25519PublicFromSeed(seed));
  return { core, address: coreToAddress(engine, core) };
}

function matcherDecision(matcher: IntervalMatcher, core: Uint8Array): boolean {
  const verdict = matcher.testCore(core);
  if (verdict === 'reject') return false;
  if (verdict === 'match') return true;
  const payload = new Uint8Array(PAYLOAD_BYTES);
  payload.set(core, 0);
  payload.set(coreChecksum(engine, core), CORE_BYTES);
  return matcher.testPayload(payload);
}

describe('buildMatchSpec', () => {
  it('compiles start patterns to intervals', () => {
    // Second character must be one of L..j, so start with a valid one.
    const spec = buildMatchSpec('TB', 'start', false);
    expect(spec.kind).toBe('intervals');
  });

  it('rejects start patterns with an impossible second character', () => {
    expect(() => buildMatchSpec('AB', 'start', false)).toThrow(PatternCompileError);
  });

  it('compiles end/anywhere patterns to regexes', () => {
    expect(buildMatchSpec('AB', 'end', false).kind).toBe('regex');
    expect(buildMatchSpec('AB', 'anywhere', false).kind).toBe('regex');
  });

  it('rejects impossible patterns', () => {
    expect(() => buildMatchSpec('0', 'start', false)).toThrow(PatternCompileError);
    expect(() => buildMatchSpec('1', 'start', false)).toThrow(PatternCompileError); // bad second char
  });

  it('case-expands into multiple intervals', () => {
    const spec = buildMatchSpec('ab', 'start', true);
    if (spec.kind !== 'intervals') throw new Error('expected intervals');
    // 'a' after Q: a and A, but A is an impossible second character -> only a.
    // 'b' doubles to b/B: 2 intervals.
    expect(spec.intervals.length).toBe(2);
  });
});

describe('IntervalMatcher agrees with string matching', () => {
  it('on random candidates for short patterns', { timeout: 30_000 }, () => {
    const patterns: Array<[string, boolean]> = [
      ['a', false],
      ['L', false],
      ['a', true],
      ['ab', true],
    ];
    for (const [pattern, ignoreCase] of patterns) {
      const spec = buildMatchSpec(pattern, 'start', ignoreCase);
      if (spec.kind !== 'intervals') throw new Error('expected intervals');
      const matcher = new IntervalMatcher(spec.intervals);
      const regex = new RegExp(
        `^Q${[...pattern].map((ch) => (ignoreCase ? `[${ch.toLowerCase()}${ch.toUpperCase()}]` : ch)).join('')}`,
      );
      for (let i = 0; i < 40; i++) {
        const { core, address } = addressAndCoreFromRandomSeed();
        expect(matcherDecision(matcher, core)).toBe(regex.test(address));
      }
    }
  });

  it('on synthetic boundary candidates', () => {
    // Build cores whose 2^32-wide payload interval straddles interval edges,
    // so the checksum decides. Verify against the actual encoded address.
    const spec = buildMatchSpec('Test', 'start', false);
    if (spec.kind !== 'intervals') throw new Error('expected intervals');
    const matcher = new IntervalMatcher(spec.intervals);

    for (const interval of spec.intervals) {
      for (const edge of [interval.lo, interval.hi]) {
        const edgeValue = bytesToBigint(edge);
        for (const delta of [-1n, 0n, 1n]) {
          const coreValue = edgeValue / (1n << 32n) + delta;
          const core = bigintToBytes(coreValue, CORE_BYTES);
          const payload = new Uint8Array(PAYLOAD_BYTES);
          payload.set(core, 0);
          payload.set(coreChecksum(engine, core), CORE_BYTES);
          const address = base58Encode(payload);
          expect(matcherDecision(matcher, core)).toBe(address.startsWith('QTest'));
        }
      }
    }
  });

  it('never returns match/reject that the checksum could overturn', () => {
    // For 500 random cores, a definite verdict must match the string result.
    const spec = buildMatchSpec('QQ', 'start', false);
    if (spec.kind !== 'intervals') throw new Error('expected intervals');
    const matcher = new IntervalMatcher(spec.intervals);
    for (let i = 0; i < 500; i++) {
      const core = new Uint8Array(CORE_BYTES);
      core[0] = 0x3a;
      crypto.getRandomValues(core.subarray(1));
      const verdict = matcher.testCore(core);
      if (verdict === 'needs-checksum') continue;
      const startsWith = coreToAddress(engine, core).startsWith('QQQ');
      expect(verdict === 'match').toBe(startsWith);
    }
  });
});
