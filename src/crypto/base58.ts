import { BASE58_ALPHABET, BASE58_INDEX } from './constants';

/** Reference base58 encoder (Bitcoin alphabet, leading-zero aware). */
export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';

  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);

  let out = '';
  while (value > 0n) {
    out = BASE58_ALPHABET[Number(value % 58n)] + out;
    value /= 58n;
  }

  return '1'.repeat(zeros) + out;
}

export function base58Decode(text: string): Uint8Array {
  let zeros = 0;
  while (zeros < text.length && text[zeros] === '1') zeros++;

  let value = 0n;
  for (const ch of text) {
    const digit = BASE58_INDEX.get(ch);
    if (digit === undefined) throw new Error(`Invalid base58 character: ${JSON.stringify(ch)}`);
    value = value * 58n + BigInt(digit);
  }

  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }

  return Uint8Array.from([...Array<number>(zeros).fill(0), ...bytes]);
}

export function bigintToBytes(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  if (value > 0n) throw new Error('Value does not fit in the requested length');
  return out;
}

export function bytesToBigint(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}
