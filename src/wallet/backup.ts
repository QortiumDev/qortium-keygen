// Qortal Hub wallet-backup (v2) creation and decryption, byte-compatible
// with Qortal-Hub (verified natively against Hub source, 2026-08-21):
//   - KDF: for nonce 0..15, bcrypt( base64(SHA512(staticSalt+password+nonce))
//     [0:72], staticBcryptSalt ), then SHA512(staticSalt + concat(results))
//     — Hub src/encryption/kdf.ts + src/constants/decryptWallet.ts.
//     The per-wallet random `salt` field is stored but NOT consumed by the
//     KDF (Hub quirk, kept for compatibility).
//   - encryptionKey = key[0:32]; macKey = key[32:63] — 31 bytes, another Hub
//     quirk (slice(32, 63)) that must be preserved exactly.
//   - encryptedSeed = AES-256-CBC(seed64, no padding); mac = HMAC-SHA512.
//     — Hub src/utils/generateWallet/storeWallet.ts / src/utils/decryptWallet.ts.
// The bcrypt library is the same one Hub uses (bcryptjs).

import bcrypt from 'bcryptjs';
import { cbc } from '@noble/ciphers/aes.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { referenceCrypto } from '../crypto/backends';
import { base58Decode, base58Encode } from '../crypto/base58';
import { addressFromMasterSeed } from '../crypto/derive';

export const WALLET_VERSION = 2;
export const KDF_THREADS = 16;
const STATIC_SALT = '4ghkVQExoneGqZqHTMMhhFfxXsVg2A75QeS1HCM5KAih';
const STATIC_BCRYPT_SALT = '$2a$11$IxVE941tXVUD4cW0TNVm.O';

export interface HubBackupJson {
  address0: string;
  encryptedSeed: string;
  salt: string;
  iv: string;
  version: number;
  mac: string;
  kdfThreads: number;
}

const utf8 = (text: string) => new TextEncoder().encode(text);

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 (matches asmcrypto's bytes_to_base64 used by Hub). */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? BASE64_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? BASE64_ALPHABET[b2 & 63] : '=';
  }
  return out;
}

/**
 * Hub's 16-way bcrypt-over-SHA512 KDF. Deliberately slow (~seconds); run it
 * inside a worker in UI contexts. The wallet-file salt does not participate
 * (matching Hub exactly).
 */
export function qortalKdf(password: string): Uint8Array {
  const parts: string[] = [];
  for (let nonce = 0; nonce < KDF_THREADS; nonce++) {
    const digest = sha512(utf8(`${STATIC_SALT}${password}${nonce}`));
    const input = bytesToBase64(digest).substring(0, 72);
    parts.push(bcrypt.hashSync(input, STATIC_BCRYPT_SALT));
  }
  return sha512(utf8(STATIC_SALT + parts.join('')));
}

export interface CreateBackupOptions {
  /** Fixed randomness for tests; never pass in production. */
  fixedSalt?: Uint8Array;
  fixedIv?: Uint8Array;
}

export function createHubBackup(
  masterSeed64: Uint8Array,
  password: string,
  options: CreateBackupOptions = {},
): HubBackupJson {
  if (masterSeed64.length !== 64) throw new Error('master seed must be 64 bytes');

  const salt = options.fixedSalt ?? crypto.getRandomValues(new Uint8Array(32));
  const iv = options.fixedIv ?? crypto.getRandomValues(new Uint8Array(16));

  const key = qortalKdf(password);
  const encryptionKey = key.slice(0, 32);
  const macKey = key.slice(32, 63); // 31 bytes — Hub quirk, do not "fix"

  const encryptedSeed = cbc(encryptionKey, iv, { disablePadding: true }).encrypt(masterSeed64);
  const mac = hmac(sha512, macKey, encryptedSeed);

  return {
    address0: addressFromMasterSeed(referenceCrypto(), masterSeed64),
    encryptedSeed: base58Encode(encryptedSeed),
    salt: base58Encode(salt),
    iv: base58Encode(iv),
    version: WALLET_VERSION,
    mac: base58Encode(mac),
    kdfThreads: KDF_THREADS,
  };
}

function timingSafeEqualish(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Decrypt a Hub v2 backup. Throws on wrong password / tampered file. */
export function decryptHubBackup(backup: HubBackupJson, password: string): Uint8Array {
  if (backup.version !== WALLET_VERSION) {
    throw new Error(`Unsupported wallet version ${backup.version}; only v2 is supported.`);
  }
  const encryptedSeed = base58Decode(backup.encryptedSeed);
  const iv = base58Decode(backup.iv);

  const key = qortalKdf(password);
  const encryptionKey = key.slice(0, 32);
  const macKey = key.slice(32, 63);

  const mac = hmac(sha512, macKey, encryptedSeed);
  if (!timingSafeEqualish(mac, base58Decode(backup.mac))) {
    throw new Error('Incorrect password (or corrupted backup file).');
  }
  return cbc(encryptionKey, iv, { disablePadding: true }).decrypt(encryptedSeed);
}

export function backupFileName(address0: string): string {
  return `qortal_backup_${address0}.json`;
}
