// SERVER-ONLY — never import this in a "use client" file or any client-side module.
// Install the "server-only" package if you want the Next.js build to enforce this.
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO     = "aes-256-gcm";
const IV_BYTES  = 12; // NIST-recommended IV length for GCM
const TAG_BYTES = 16; // GCM auth tag — appended to ciphertext in storage

function getKey(): Buffer {
  const hex = process.env.KEY_ENCRYPTION_SECRET;
  if (!hex || hex.length !== 64) {
    throw new Error("KEY_ENCRYPTION_SECRET must be a 64-character hex string (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypts plaintext with AES-256-GCM.
 * Returns "ivBase64:ciphertextWithTagBase64".
 * A fresh 12-byte IV is generated on every call — never reused.
 */
export function encrypt(plaintext: string): string {
  const key    = getKey();
  const iv     = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag       = cipher.getAuthTag(); // 16-byte GCM authentication tag

  // Store iv and (ciphertext || tag) as two base64 segments separated by ":"
  return `${iv.toString("base64")}:${Buffer.concat([encrypted, tag]).toString("base64")}`;
}

/**
 * Decrypts a value produced by encrypt().
 * Throws on malformed input, wrong key, or tampered ciphertext (GCM auth tag mismatch).
 * Never catch the auth-tag error — let it propagate so tampering is visible.
 */
export function decrypt(stored: string): string {
  const sep = stored.indexOf(":");
  if (sep === -1) throw new Error("Invalid encrypted key format: missing separator");

  const iv      = Buffer.from(stored.slice(0, sep), "base64");
  const payload = Buffer.from(stored.slice(sep + 1), "base64");

  if (payload.length <= TAG_BYTES) throw new Error("Encrypted payload too short");

  const ct  = payload.subarray(0, payload.length - TAG_BYTES);
  const tag = payload.subarray(payload.length - TAG_BYTES);

  const key      = getKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);

  // decipher.final() throws "Unsupported state or unable to authenticate data"
  // if the auth tag does not match — this is the tamper signal; do not swallow it.
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
