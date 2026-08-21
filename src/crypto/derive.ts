// QORT address derivation, byte-identical to Qortal Hub / Qortal UI
// PhraseWallet v2 and to Qortium Core (verified against the archived Q-Keys
// wallet spec's golden vectors; see derive.test.ts).
//
// Two entry points matter for vanity search:
//  - master-seed mode (Qortal Hub compatible): random 64-byte master seed ->
//    index-0 address seed via double SHA-512 -> ed25519 -> address.
//  - raw-seed mode (Qortium Home / CLI compatible): random 32-byte ed25519
//    seed -> address directly, skipping both SHA-512 passes.

import type { SyncCrypto } from './backends';
import { base58Encode } from './base58';
import { ADDRESS_VERSION, CORE_BYTES, PAYLOAD_BYTES } from './constants';

/** int32be(0) || seed64 || int32be(0) -> double SHA-512 -> first 32 bytes. */
export function masterSeedToAddressSeed(crypto: SyncCrypto, masterSeed64: Uint8Array): Uint8Array {
  if (masterSeed64.length !== 64) throw new Error('master seed must be 64 bytes');
  const input = new Uint8Array(72);
  input.set(masterSeed64, 4);
  const s1 = crypto.sha512(input);
  const combined = new Uint8Array(s1.length + input.length);
  combined.set(s1, 0);
  combined.set(input, s1.length);
  return crypto.sha512(combined).slice(0, 32);
}

/** version(1) || RIPEMD160(SHA256(publicKey)) — the checksum input. */
export function publicKeyToCore(crypto: SyncCrypto, publicKey: Uint8Array): Uint8Array {
  const core = new Uint8Array(CORE_BYTES);
  core[0] = ADDRESS_VERSION;
  core.set(crypto.ripemd160(crypto.sha256(publicKey)), 1);
  return core;
}

export function coreChecksum(crypto: SyncCrypto, core: Uint8Array): Uint8Array {
  return crypto.sha256(crypto.sha256(core)).slice(0, 4);
}

export function coreToAddress(crypto: SyncCrypto, core: Uint8Array): string {
  const payload = new Uint8Array(PAYLOAD_BYTES);
  payload.set(core, 0);
  payload.set(coreChecksum(crypto, core), CORE_BYTES);
  return base58Encode(payload);
}

export function addressFromRawSeed(crypto: SyncCrypto, seed32: Uint8Array): string {
  return coreToAddress(crypto, publicKeyToCore(crypto, crypto.ed25519PublicFromSeed(seed32)));
}

export function addressFromMasterSeed(crypto: SyncCrypto, masterSeed64: Uint8Array): string {
  return addressFromRawSeed(crypto, masterSeedToAddressSeed(crypto, masterSeed64));
}
