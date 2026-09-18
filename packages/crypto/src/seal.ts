/**
 * Sealing per-tenant credentials at rest.
 *
 * The control plane holds one OAuth refresh token per customer per source. Those tokens
 * read a company's email and its accounting system, so they do not sit in the database in
 * the clear -- a Postgres dump, a misdirected backup or an over-broad GRANT would
 * otherwise hand over every customer's data at once.
 *
 * **Why here and not the lake.** A token rotates. The raw lake forbids overwriting an
 * object in place -- which is exactly what rotation is -- so it cannot hold mutable
 * credential state without giving up the property that makes it an archive.
 *
 * **The key is resolved from the environment at the moment it is used**, never at import.
 * A frozen config object is logged and inspected freely, and a secret does not belong in
 * one.
 *
 * **Rotation is additive.** Each sealed blob records the key version that sealed it. A new
 * key is added under a new version and becomes the one used for writes; existing rows stay
 * readable until something rewrites them. Nothing re-encrypts the table in one
 * transaction, which is the migration everybody puts off and then does badly.
 *
 * ## Layout
 *
 * A sealed value is one self-contained blob: `nonce(12) || ciphertext || tag(16)`.
 *
 * Node's AES-GCM returns the authentication tag from a *separate* `getAuthTag()` call,
 * unlike Python's `AESGCM.encrypt` which appends it. Forgetting to store the tag produces
 * code that encrypts fine and cannot decrypt -- discovered at the worst moment, when a
 * customer reconnects. Packing it into the blob here removes that trap.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import process from "node:process";

const KEY_ENV = "UNDERCROFT_SECRET_KEY";

/** AES-256. Not negotiable by configuration: a key length an env var can shorten will be. */
const KEY_BYTES = 32;
/** 96 bits, the length AES-GCM is specified for. */
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export class SecretKeyMissing extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretKeyMissing";
  }
}

export interface Sealed {
  readonly blob: Uint8Array;
  readonly keyVersion: number;
}

/**
 * Parse the configured master key(s).
 *
 * One key is `<base64>`. Several are `<version>:<base64>` comma-separated, highest version
 * wins for new writes: `UNDERCROFT_SECRET_KEY=1:aGVsbG8...,2:d29ybGQ...`
 */
function keys(env: NodeJS.ProcessEnv = process.env): Map<number, Buffer> {
  const raw = (env[KEY_ENV] ?? "").trim();
  if (raw === "") {
    throw new SecretKeyMissing(
      `${KEY_ENV} is required to seal or open a credential. Generate one with ` +
        "`node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"`.",
    );
  }

  const out = new Map<number, Buffer>();
  for (const entry of raw.split(",")) {
    const part = entry.trim();
    if (part === "") {
      continue;
    }
    const colon = part.lastIndexOf(":");
    const versionText = colon === -1 ? "" : part.slice(0, colon);
    const material = colon === -1 ? part : part.slice(colon + 1);

    const key = Buffer.from(material, "base64");
    if (key.byteLength !== KEY_BYTES) {
      // Checked, never padded or hashed into shape. Silently stretching a short key
      // produces something that encrypts and decrypts while having far less entropy than
      // it claims.
      throw new SecretKeyMissing(
        `${KEY_ENV} must decode to ${KEY_BYTES} bytes for AES-256; got ${key.byteLength}`,
      );
    }
    // parseInt, not Number(): the money lint rule bans Number() everywhere, and a key
    // version is an integer index, not an amount. NaN from a non-numeric version is
    // caught by the isInteger check below.
    const version = versionText === "" ? 1 : Number.parseInt(versionText, 10);
    if (!Number.isInteger(version)) {
      throw new SecretKeyMissing(
        `${KEY_ENV} version ${JSON.stringify(versionText)} is not an integer`,
      );
    }
    out.set(version, key);
  }
  if (out.size === 0) {
    throw new SecretKeyMissing(`${KEY_ENV} is set but contains no key`);
  }
  return out;
}

export function currentKeyVersion(env?: NodeJS.ProcessEnv): number {
  return Math.max(...keys(env).keys());
}

export function seal(
  plaintext: string,
  opts: { keyVersion?: number; env?: NodeJS.ProcessEnv } = {},
): Sealed {
  const table = keys(opts.env);
  const version = opts.keyVersion ?? Math.max(...table.keys());
  const key = table.get(version);
  if (key === undefined) {
    throw new SecretKeyMissing(`${KEY_ENV} has no key for version ${version}`);
  }

  // A nonce is never reused: GCM's confidentiality and its authentication both collapse if
  // one is, so it is random per call rather than derived from anything about the row.
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { blob: Buffer.concat([nonce, ciphertext, tag]), keyVersion: version };
}

/**
 * Open a sealed value.
 *
 * Any failure -- wrong key, truncated blob, tampered bytes -- throws rather than returning
 * `null` or `""`. A credential that silently opened as empty would be presented as a
 * connection that exists and does not work, the failure that takes longest to diagnose.
 */
export function unseal(sealed: Sealed, env?: NodeJS.ProcessEnv): string {
  const table = keys(env);
  const key = table.get(sealed.keyVersion);
  if (key === undefined) {
    throw new SecretKeyMissing(
      `${KEY_ENV} has no key for version ${sealed.keyVersion}; a key was rotated out while ` +
        "rows sealed under it still exist",
    );
  }

  const blob = Buffer.from(sealed.blob);
  if (blob.byteLength < NONCE_BYTES + TAG_BYTES) {
    throw new Error("sealed blob is truncated: shorter than a nonce plus a tag");
  }
  const nonce = blob.subarray(0, NONCE_BYTES);
  const tag = blob.subarray(blob.byteLength - TAG_BYTES);
  const ciphertext = blob.subarray(NONCE_BYTES, blob.byteLength - TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
