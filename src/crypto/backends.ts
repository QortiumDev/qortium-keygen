// Crypto backend selection: fast WASM (hash-wasm + libsodium) with pure-JS
// fallbacks (@noble/hashes + tweetnacl) for hosts whose CSP blocks WASM.
// Everything is initialized ONCE; the returned functions are all synchronous
// so the search hot loop never awaits (R1/R4 review finding: per-candidate
// awaits were the old Q-Keys app's biggest self-inflicted cost).

import { createSHA256, createSHA512, createRIPEMD160 } from 'hash-wasm';
import type { IHasher } from 'hash-wasm/dist/lib/WASMInterface';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { sha512 as nobleSha512 } from '@noble/hashes/sha2.js';
import { ripemd160 as nobleRipemd160 } from '@noble/hashes/legacy.js';
import nacl from 'tweetnacl';
import sodium from 'libsodium-wrappers';

export type HashBackendId = 'hash-wasm' | 'noble-js';
export type Ed25519BackendId = 'libsodium' | 'tweetnacl';

export interface BackendInfo {
  hashes: HashBackendId;
  ed25519: Ed25519BackendId;
}

export interface SyncCrypto {
  info: BackendInfo;
  sha256(data: Uint8Array): Uint8Array;
  sha512(data: Uint8Array): Uint8Array;
  ripemd160(data: Uint8Array): Uint8Array;
  /** Ed25519 public key (32 bytes) from a 32-byte seed. */
  ed25519PublicFromSeed(seed32: Uint8Array): Uint8Array;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`initialization timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function hasherToSync(hasher: IHasher): (data: Uint8Array) => Uint8Array {
  return (data) => {
    hasher.init();
    hasher.update(data);
    return hasher.digest('binary');
  };
}

async function initWasmHashes(): Promise<Pick<SyncCrypto, 'sha256' | 'sha512' | 'ripemd160'> | null> {
  try {
    const [h256, h512, h160] = await withTimeout(
      Promise.all([createSHA256(), createSHA512(), createRIPEMD160()]),
      5000,
    );
    return {
      sha256: hasherToSync(h256),
      sha512: hasherToSync(h512),
      ripemd160: hasherToSync(h160),
    };
  } catch {
    return null;
  }
}

async function initSodium(): Promise<((seed32: Uint8Array) => Uint8Array) | null> {
  try {
    await withTimeout(sodium.ready, 5000);
    // Smoke-test once so a broken WASM instantiation fails here, not mid-scan.
    const probe = sodium.crypto_sign_seed_keypair(new Uint8Array(32));
    if (!(probe.publicKey instanceof Uint8Array) || probe.publicKey.length !== 32) return null;
    return (seed32) => sodium.crypto_sign_seed_keypair(seed32).publicKey;
  } catch {
    return null;
  }
}

/**
 * Initialize the fastest available synchronous crypto pipeline.
 * Async once, at startup; every returned function is synchronous.
 */
export async function initSyncCrypto(): Promise<SyncCrypto> {
  const [wasmHashes, sodiumKeypair] = await Promise.all([initWasmHashes(), initSodium()]);

  const hashes = wasmHashes ?? {
    sha256: (data: Uint8Array) => nobleSha256(data),
    sha512: (data: Uint8Array) => nobleSha512(data),
    ripemd160: (data: Uint8Array) => nobleRipemd160(data),
  };

  const ed25519PublicFromSeed =
    sodiumKeypair ?? ((seed32: Uint8Array) => nacl.sign.keyPair.fromSeed(seed32).publicKey);

  return {
    info: {
      hashes: wasmHashes ? 'hash-wasm' : 'noble-js',
      ed25519: sodiumKeypair ? 'libsodium' : 'tweetnacl',
    },
    ...hashes,
    ed25519PublicFromSeed,
  };
}

/**
 * A deliberately independent pure-JS pipeline used to re-verify every hit
 * before it is shown or exported (R4 recommendation 40). Never used for
 * searching, so its speed does not matter.
 */
export function referenceCrypto(): SyncCrypto {
  return {
    info: { hashes: 'noble-js', ed25519: 'tweetnacl' },
    sha256: (data) => nobleSha256(data),
    sha512: (data) => nobleSha512(data),
    ripemd160: (data) => nobleRipemd160(data),
    ed25519PublicFromSeed: (seed32) => nacl.sign.keyPair.fromSeed(seed32).publicKey,
  };
}
