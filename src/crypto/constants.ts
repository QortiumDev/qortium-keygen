export const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** QORT/Qortium address version byte (58). Every address starts with 'Q'. */
export const ADDRESS_VERSION = 0x3a;

/**
 * Fixed-version addresses are always exactly 34 base58 characters:
 * the 25-byte payload integer lies in [58*2^192, 59*2^192-1], and
 * 58^33 < 58*2^192 while 59*2^192-1 < 58^34.
 */
export const ADDRESS_LENGTH = 34;

/** version(1) || hash160(20) || checksum(4) */
export const PAYLOAD_BYTES = 25;

/** version(1) || hash160(20) — everything the checksum is computed over. */
export const CORE_BYTES = 21;

/** Payload-integer range for version 0x3A (see ADDRESS_LENGTH note). */
export const PAYLOAD_LO = 58n << 192n;
export const PAYLOAD_HI = (59n << 192n) - 1n;
/** Number of possible payload integers in range (2^192). */
export const PAYLOAD_RANGE = 1n << 192n;

export const BASE58_INDEX: ReadonlyMap<string, number> = new Map(
  [...BASE58_ALPHABET].map((ch, i) => [ch, i]),
);
