// Golden vectors from the archived Q-Keys wallet spec (docs/qortal_wallet_spec.md,
// "Worked Example"), which R1 independently re-verified against the archived
// worker. These pin the derivation to Qortal Hub / Qortium byte-for-byte.

import { describe, expect, it } from 'vitest';
import { initSyncCrypto, referenceCrypto, type SyncCrypto } from './backends';
import { base58Encode } from './base58';
import {
  addressFromMasterSeed,
  addressFromRawSeed,
  masterSeedToAddressSeed,
} from './derive';

const MASTER_SEED_HEX =
  '15b5eafd352f70aec08ef3345b6f6f2d7425ba813c06686e778cb259d3a8d94f' +
  '1aec93c818bdf629540b0cc6fcbc8c78eeee21410e02f151e9513eaf4e9c7aed';
const ADDRESS_SEED_HEX = '9ee5d5f00a306b1392217f10c8fa75cf8c0852c58f6a36c5c2ec83cb53e0b8f3';
const ADDRESS = 'QakZhC6cAUS4WJhswccb7p18xjSH9Kf6Qz';
const PUBLIC_KEY_BASE58 = 'XQHpCR1XW2pxEWwJw2N32c8Qve6L9KDgFW6g7WDUeK9';
const ADDRESS_SEED_BASE58 = 'BhGggJxFLMj7Lwjtn5PYAV6tE1FRsbHFGzRGsVnUZQ4z';

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function runGoldenVectors(name: string, engine: SyncCrypto) {
  describe(name, () => {
    it('derives the index-0 address seed from the master seed', () => {
      const addressSeed = masterSeedToAddressSeed(engine, hexToBytes(MASTER_SEED_HEX));
      expect(bytesToHex(addressSeed)).toBe(ADDRESS_SEED_HEX);
      expect(base58Encode(addressSeed)).toBe(ADDRESS_SEED_BASE58);
    });

    it('derives the documented public key', () => {
      const publicKey = engine.ed25519PublicFromSeed(hexToBytes(ADDRESS_SEED_HEX));
      expect(base58Encode(publicKey)).toBe(PUBLIC_KEY_BASE58);
    });

    it('derives the documented address from the master seed', () => {
      expect(addressFromMasterSeed(engine, hexToBytes(MASTER_SEED_HEX))).toBe(ADDRESS);
    });

    it('derives the same address from the raw address seed (fast path)', () => {
      expect(addressFromRawSeed(engine, hexToBytes(ADDRESS_SEED_HEX))).toBe(ADDRESS);
    });
  });
}

runGoldenVectors('reference pipeline (noble + tweetnacl)', referenceCrypto());

describe('fast pipeline (hash-wasm + libsodium when available)', async () => {
  const engine = await initSyncCrypto();

  runGoldenVectors(`selected backends: ${engine.info.hashes} + ${engine.info.ed25519}`, engine);

  it('agrees with the reference pipeline on random seeds', () => {
    const reference = referenceCrypto();
    for (let i = 0; i < 25; i++) {
      const master = crypto.getRandomValues(new Uint8Array(64));
      expect(addressFromMasterSeed(engine, master)).toBe(addressFromMasterSeed(reference, master));
      const raw = crypto.getRandomValues(new Uint8Array(32));
      expect(addressFromRawSeed(engine, raw)).toBe(addressFromRawSeed(reference, raw));
    }
  });

  it('every derived address is 34 characters starting with Q', () => {
    for (let i = 0; i < 50; i++) {
      const address = addressFromRawSeed(engine, crypto.getRandomValues(new Uint8Array(32)));
      expect(address).toMatch(/^Q[1-9A-HJ-NP-Za-km-z]{33}$/);
    }
  });
});
