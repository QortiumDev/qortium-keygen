import { describe, expect, it } from 'vitest';
import { base58Decode } from '../crypto/base58';
import {
  backupFileName,
  bytesToBase64,
  createHubBackup,
  decryptHubBackup,
  qortalKdf,
  type HubBackupJson,
} from './backup';

// Real Qortal Hub backup fixture from the archived Q-Keys docs
// (keytest_qortal_backup_ADDRESSHERE.json, password "abc123"), whose decrypted
// seed is the same golden wallet pinned in src/crypto/derive.test.ts.
const FIXTURE: HubBackupJson = {
  address0: 'ADDRESSHERE',
  encryptedSeed:
    'mk3mDsJmtyfTgrNPCFb8eqj8AnKndmaEJ7mAo9RqSdFyoovn5AmjG1aDEv45Ps1JXc7Ab4SbcMnmpHmZQkRKM8F',
  salt: 'Dc79MVQ25KZszDKayFRfm7PD9wc6keaY5NedKzyzEsd4',
  iv: '6Ho373VyqX11wTpwSgn9iV',
  version: 2,
  mac: '3VKDdKeASvPZat2Xrtyw7s59JVoMpmea35Fbp2v5qzch3UBf4yUVhewj22jbrKEX4obG5vY6sYr6rD43VXXRxYa8',
  kdfThreads: 16,
};
const FIXTURE_PASSWORD = 'abc123';
const FIXTURE_SEED_HEX =
  '15b5eafd352f70aec08ef3345b6f6f2d7425ba813c06686e778cb259d3a8d94f' +
  '1aec93c818bdf629540b0cc6fcbc8c78eeee21410e02f151e9513eaf4e9c7aed';
const FIXTURE_ADDRESS = 'QakZhC6cAUS4WJhswccb7p18xjSH9Kf6Qz';

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

describe('bytesToBase64', () => {
  it('matches standard base64 with padding', () => {
    for (const length of [1, 2, 3, 31, 64]) {
      const bytes = crypto.getRandomValues(new Uint8Array(length));
      expect(bytesToBase64(bytes)).toBe(btoa(String.fromCharCode(...bytes)));
    }
  });
});

describe('Hub backup v2', () => {
  it('decrypts the real Hub fixture with the documented password', { timeout: 60_000 }, () => {
    const seed = decryptHubBackup(FIXTURE, FIXTURE_PASSWORD);
    expect(bytesToHex(seed)).toBe(FIXTURE_SEED_HEX);
  });

  it('rejects a wrong password on the fixture', { timeout: 60_000 }, () => {
    expect(() => decryptHubBackup(FIXTURE, 'abc124')).toThrow(/password/i);
  });

  it('round-trips create -> decrypt and derives the right address0', { timeout: 60_000 }, () => {
    const seed = hexToBytes(FIXTURE_SEED_HEX);
    const backup = createHubBackup(seed, 'correct horse battery staple');
    expect(backup.version).toBe(2);
    expect(backup.kdfThreads).toBe(16);
    expect(backup.address0).toBe(FIXTURE_ADDRESS);
    expect(bytesToHex(decryptHubBackup(backup, 'correct horse battery staple'))).toBe(FIXTURE_SEED_HEX);
    expect(backupFileName(backup.address0)).toBe(`qortal_backup_${FIXTURE_ADDRESS}.json`);
  });

  it('reproduces the fixture ciphertext exactly with the fixture salt/iv', { timeout: 60_000 }, () => {
    // Byte-for-byte compatibility: same seed + password + iv must reproduce
    // the exact encryptedSeed and mac that Qortal Hub produced.
    const backup = createHubBackup(hexToBytes(FIXTURE_SEED_HEX), FIXTURE_PASSWORD, {
      fixedSalt: base58Decode(FIXTURE.salt),
      fixedIv: base58Decode(FIXTURE.iv),
    });
    expect(backup.encryptedSeed).toBe(FIXTURE.encryptedSeed);
    expect(backup.mac).toBe(FIXTURE.mac);
  });

  it('rejects a tampered ciphertext', { timeout: 60_000 }, () => {
    const tampered = { ...FIXTURE, encryptedSeed: `${FIXTURE.encryptedSeed.slice(0, -1)}1` };
    expect(() => decryptHubBackup(tampered, FIXTURE_PASSWORD)).toThrow();
  });

  it('kdf output is 64 bytes and deterministic', { timeout: 60_000 }, () => {
    const a = qortalKdf('x');
    expect(a.length).toBe(64);
    expect(bytesToHex(qortalKdf('x'))).toBe(bytesToHex(a));
  });
});
