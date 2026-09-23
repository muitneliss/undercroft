/**
 * The CLI's two files on disk, read and written the one way that cannot half-happen.
 *
 * A write goes to a temporary file beside the target and is renamed over it. A rename is
 * atomic on one filesystem, so a crash mid-write leaves the old file or the new one, never a
 * truncated one -- and a truncated `credentials.json` would sign a person out of every
 * environment at once, while a truncated `config.json` could lose the profile that says a
 * server does not allow writes.
 *
 * The mode is set on the temporary file BEFORE the secret is written into it, so a session
 * cookie is never readable by another user even for the moment between write and chmod.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** What a file held: its JSON, nothing because it is not there, or unreadable. */
export type Read = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

/** A file that does not exist reads as `undefined`; one that exists but is not JSON is refused. */
export function readJson(path: string): Read {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { ok: true, value: undefined };
    }
    return { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export function writeJson(path: string, value: unknown, mode: number): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temporary = join(dir, `.${randomUUID()}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode, flag: "wx" });
  renameSync(temporary, path);
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
