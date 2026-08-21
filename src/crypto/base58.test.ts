import { describe, expect, it } from 'vitest';
import { base58Decode, base58Encode, bigintToBytes, bytesToBigint } from './base58';

describe('base58', () => {
  it('encodes known vectors', () => {
    expect(base58Encode(new Uint8Array([]))).toBe('');
    expect(base58Encode(new Uint8Array([0]))).toBe('1');
    expect(base58Encode(new Uint8Array([0, 0, 1]))).toBe('112');
    expect(base58Encode(Uint8Array.from([0x61]))).toBe('2g');
    expect(base58Encode(Uint8Array.from([0x62, 0x62, 0x62]))).toBe('a3gV');
  });

  it('round-trips random payloads', () => {
    for (let i = 0; i < 200; i++) {
      const bytes = crypto.getRandomValues(new Uint8Array(25));
      expect(base58Decode(base58Encode(bytes))).toEqual(bytes);
    }
  });

  it('round-trips bigint conversion', () => {
    for (let i = 0; i < 100; i++) {
      const bytes = crypto.getRandomValues(new Uint8Array(25));
      expect(bigintToBytes(bytesToBigint(bytes), 25)).toEqual(bytes);
    }
  });

  it('rejects invalid characters on decode', () => {
    expect(() => base58Decode('0')).toThrow();
    expect(() => base58Decode('O')).toThrow();
    expect(() => base58Decode('I')).toThrow();
    expect(() => base58Decode('l')).toThrow();
  });
});
