/**
 * Every secret the stack needs, generated on this machine at install time.
 *
 * Nothing secret ships in the installer: each install gets its own, from the operating
 * system's CSPRNG. They are written once and then KEPT (`installation.ts`): a re-run that
 * regenerated them would lock the services out of their own Postgres and MinIO volumes, and a
 * new `UNDERCROFT_SECRET_KEY` cannot open a single token the old one sealed -- every connected
 * source would have to be connected again.
 *
 * The set is `deploy/compose/.env.example`'s secrets. `composeDrift.test.ts` checks every
 * variable the install compose file requires is one this module or the answers write.
 */

import { randomBytes } from "node:crypto";

/**
 * A password that travels inside a DSN (`postgres://user:<this>@host`) and a Kestra config,
 * so base64URL: no `+`, `/` or `=` for a URL parser to read as structure. 24 bytes, 192 bits.
 */
function password(): string {
  return randomBytes(24).toString("base64url");
}

/** A 32-byte key, standard base64 -- the form `packages/crypto/src/seal.ts` reads. */
function key(): string {
  return randomBytes(32).toString("base64");
}

/**
 * Kestra refuses a basic-auth password without an upper-case letter and a digit, and a random
 * base64url string lacks one of them now and then. A fixed prefix supplies both and costs no
 * entropy the random part does not already carry.
 */
function kestraPassword(): string {
  return `Uc1-${password()}`;
}

/** The names of every generated secret, in the order they are written. */
export const SECRET_NAMES = [
  "UNDERCROFT_PG_PASSWORD",
  "UNDERCROFT_APP_PG_PASSWORD",
  "UNDERCROFT_WORKER_PG_PASSWORD",
  "UNDERCROFT_KESTRA_PG_PASSWORD",
  "UNDERCROFT_KESTRA_PASSWORD",
  "UNDERCROFT_S3_ACCESS_KEY",
  "UNDERCROFT_S3_SECRET_KEY",
  "UNDERCROFT_SECRET_KEY",
  "UNDERCROFT_SESSION_SECRET",
  "UNDERCROFT_TRIGGER_TOKEN",
  "UNDERCROFT_ASSISTANT_APPROVAL_SECRET",
] as const;

export type SecretName = (typeof SECRET_NAMES)[number];

/** A fresh value for every secret. Called for the names an install does not hold yet. */
export function generateSecrets(): Record<SecretName, string> {
  return {
    UNDERCROFT_PG_PASSWORD: password(),
    UNDERCROFT_APP_PG_PASSWORD: password(),
    UNDERCROFT_WORKER_PG_PASSWORD: password(),
    UNDERCROFT_KESTRA_PG_PASSWORD: password(),
    UNDERCROFT_KESTRA_PASSWORD: kestraPassword(),
    // MinIO's root user is a login name, so it reads as one; its secret is the password.
    UNDERCROFT_S3_ACCESS_KEY: `undercroft-${randomBytes(6).toString("hex")}`,
    UNDERCROFT_S3_SECRET_KEY: password(),
    UNDERCROFT_SECRET_KEY: key(),
    UNDERCROFT_SESSION_SECRET: key(),
    UNDERCROFT_TRIGGER_TOKEN: password(),
    UNDERCROFT_ASSISTANT_APPROVAL_SECRET: key(),
  };
}
