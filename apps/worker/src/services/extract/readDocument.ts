/**
 * A landed document opened: its bytes fetched from the lake, written where a reader binary can
 * open them by name, and read. The one way the extract pass opens a document, whether reading it
 * for the first time or again for a workbook's rows (ADR 0104).
 */

import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { LakeStore } from "@undercroft/lake";

import type { Spawn } from "../transform.ts";
import { type Extracted, extractDocument } from "./extractText.ts";

/** What opening a document needs: the lake, and how a reader binary is run. */
export interface OpenDeps {
  readonly lake: LakeStore;
  readonly spawn: Spawn;
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Read one document's bytes onto disk so a program can open it by name.
 *
 * On disk rather than through stdin because the binaries differ on what they accept, and a
 * path works for all of them. The file is removed whether the read succeeded or not; a run
 * over a large tenant would otherwise leave hundreds of megabytes behind in the temp dir.
 */
async function withBytesOnDisk<T>(
  dir: string,
  documentId: string,
  bytes: Uint8Array,
  use: (path: string) => Promise<T>,
): Promise<T> {
  // The provider's own id is opaque, but it is not a filename: a Drive id is safe, a Gmail
  // document id carries a colon. Hashing is overkill; replacing what a path cannot hold is not.
  const path = join(dir, `doc-${documentId.replaceAll(/[^\w.-]/gu, "_")}`);
  await writeFile(path, bytes);
  try {
    return await use(path);
  } finally {
    await rm(path, { force: true });
  }
}

/**
 * A document's bytes, fetched from the lake and read; `null` when the lake did not hand them
 * back. The one way a pass opens a document, whether reading it first or again for its rows.
 */
export async function readBytes(
  deps: OpenDeps,
  scratch: string,
  document: { readonly documentId: string; readonly lakeKey: string; readonly contentType: string },
): Promise<Extracted | null> {
  let bytes: Uint8Array;
  try {
    bytes = await deps.lake.read(document.lakeKey);
  } catch {
    return null;
  }
  return await withBytesOnDisk(scratch, document.documentId, bytes, (path) =>
    extractDocument(
      { spawn: deps.spawn, workDir: scratch, ...(deps.env === undefined ? {} : { env: deps.env }) },
      { contentType: document.contentType, bytes, path },
    ),
  );
}
