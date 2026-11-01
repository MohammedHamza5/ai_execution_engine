import { randomBytes } from "node:crypto";

/**
 * Standard RFC 9562 UUIDv7 generator.
 * Combines 48-bit millisecond timestamp with cryptographically random bits.
 * Guarantees time-ordered sortability for B-tree index efficiency.
 */
export function generateUUIDv7(): string {
  const value = randomBytes(16);
  const now = Date.now();

  // Timestamp: 48 bits (6 bytes)
  value[0] = (now / 0x10000000000) & 0xff;
  value[1] = (now / 0x100000000) & 0xff;
  value[2] = (now / 0x1000000) & 0xff;
  value[3] = (now / 0x10000) & 0xff;
  value[4] = (now / 0x100) & 0xff;
  value[5] = now & 0xff;

  // Version: 4 bits set to 0111 (UUIDv7)
  value[6] = (value[6] & 0x0f) | 0x70;

  // Variant: 2 bits set to 10 (RFC 4122 / 9562)
  value[8] = (value[8] & 0x3f) | 0x80;

  return [
    value.subarray(0, 4).toString("hex"),
    value.subarray(4, 6).toString("hex"),
    value.subarray(6, 8).toString("hex"),
    value.subarray(8, 10).toString("hex"),
    value.subarray(10, 16).toString("hex"),
  ].join("-");
}

/**
 * Validates whether a given string is a valid UUID format.
 */
export function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}
