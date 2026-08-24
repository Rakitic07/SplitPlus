import { createHash, randomBytes } from "node:crypto";

// Unambiguous alphabet (no 0/O/1/I) so codes are easy to read/type.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(groups: number, groupLen: number): string {
  const bytes = randomBytes(groups * groupLen);
  let out = "";
  for (let i = 0; i < groups * groupLen; i++) {
    if (i > 0 && i % groupLen === 0) out += "-";
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

// ~20 chars / ~80 bits — shown once at signup, e.g. "K7QF-9MTX-2PWH-4RJD".
export const generateRecoveryCode = () => randomCode(4, 4);

export const normalizeCode = (c: string) =>
  c.trim().toUpperCase().replace(/\s+/g, "");

export const hashCode = (code: string) =>
  createHash("sha256").update(normalizeCode(code)).digest("hex");

// One-time ticket the user keeps to check the status of an admin reset request,
// e.g. "TQ4K-8PZM-3WRN". Hashed at rest like recovery codes.
export const generateTicket = () => randomCode(3, 4);
export const hashTicket = (t: string) =>
  createHash("sha256").update(normalizeCode(t)).digest("hex");
