/**
 * `bi exports download`: save an export to a file (ADR 0111).
 *
 * `bi exports create` -- a procedure, so a command like every other -- answers with a link; this
 * fetches it with the person's own session or token, the way `remote.ts` calls `/trpc`, and
 * writes the rows to disk as they arrive. It is local only because a file on this machine is not
 * something a procedure can answer with.
 *
 * Two refusals are this command's own, and both are about not misleading anyone:
 *
 * - **A link to another server is refused before any request.** The session belongs to the
 *   origin that issued it (`credentials.ts`), and a link is text an agent may have read
 *   anywhere; sending the cookie -- or the token -- wherever a link points would hand it to
 *   whoever wrote one.
 * - **A download that was cut leaves no file.** The rows are written to `<out>.partial` and
 *   renamed into place only once the server has ended the body cleanly -- which the worker does
 *   only for a whole answer. A file that stops at row 40,000 would read as the whole export.
 */

import { open, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { BY_TRPC_CODE } from "virtual:surface";
import type { Translate } from "../i18n/index.ts";
import type { SurfaceErrorCode } from "../manifest.ts";
import { failure, type Refusal, success } from "../services/output.ts";
import { type Context, connect, type ParsedFlags, stringFlag } from "./context.ts";
import { type Noted, noted } from "./noted.ts";
import { type Connection, headersFor, signInRequired, unreachable } from "./remote.ts";

/**
 * How long a download may take, end to end. Longer than the worker's own ten-minute deadline,
 * which cuts the body itself, so this only catches a server that stopped answering at all.
 */
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;

/** The refusal codes a server can answer with, which are the control plane's own table. */
const SURFACE_CODES: ReadonlySet<string> = new Set(Object.values(BY_TRPC_CODE));

function isSurfaceCode(code: unknown): code is SurfaceErrorCode {
  return typeof code === "string" && SURFACE_CODES.has(code);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The route's JSON refusal (`{ error: { code, message, traceId } }`), as the CLI's -- in the
 * CLI's own words when it is about signing in, which only the CLI knows how it did (`remote.ts`).
 */
async function refusedBy(
  t: Translate,
  connection: Connection,
  response: Response,
): Promise<Refusal | null> {
  const body: unknown = await response.json().catch(() => null);
  const error = isRecord(body) ? body.error : null;
  if (!isRecord(error) || typeof error.message !== "string" || !isSurfaceCode(error.code)) {
    return null;
  }
  const refusal =
    error.code === "AUTHENTICATION_REQUIRED"
      ? signInRequired(t, connection)
      : failure(error.code, error.message);
  return typeof error.traceId === "string" && error.traceId !== ""
    ? { ok: false, error: { ...refusal.error, traceId: error.traceId } }
    : refusal;
}

/** The body, written to `path`; the bytes written, or `null` when the body was cut. */
async function save(body: ReadableStream<Uint8Array>, path: string): Promise<number | null> {
  const file = await open(path, "w");
  let bytes = 0;
  try {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return bytes;
      }
      await file.write(value);
      bytes += value.byteLength;
    }
  } catch {
    return null;
  } finally {
    await file.close();
  }
}

/** The link as a URL on this connection's origin, or the refusal for one that points elsewhere. */
function sameOrigin(t: Translate, connection: Connection, link: string): URL | Refusal {
  let url: URL;
  try {
    url = new URL(link, `${connection.url}/`);
  } catch {
    return failure(
      "INVALID_ARGUMENT",
      t("error.downloadElsewhere", { link, origin: connection.origin }),
    );
  }
  return url.origin === connection.origin
    ? url
    : failure(
        "INVALID_ARGUMENT",
        t("error.downloadElsewhere", { link: url.origin, origin: connection.origin }),
      );
}

/** The export's rows as they arrive, or why the server sent none. */
async function opened(
  t: Translate,
  connection: Connection,
  url: URL,
): Promise<ReadableStream<Uint8Array> | Refusal> {
  const sent = headersFor(t, connection);
  if (!sent.ok) {
    return sent;
  }
  connection.trace(`GET ${url.origin}${url.pathname}`);
  let response: Response;
  try {
    response = await connection.fetch(url, {
      headers: { ...sent.headers, accept: "application/json" },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch (error) {
    return unreachable(t, connection, error);
  }
  connection.trace(`-> ${String(response.status)}`);
  if (!response.ok || response.body === null) {
    return (await refusedBy(t, connection, response)) ?? unreachable(t, connection, null);
  }
  return response.body;
}

export async function downloadExport(
  ctx: Context,
  flags: ParsedFlags,
  link: string,
): Promise<Noted> {
  const connected = connect(ctx, flags);
  if ("ok" in connected) {
    return noted(connected);
  }
  const { connection } = connected;
  const url = sameOrigin(ctx.t, connection, link);
  if ("ok" in url) {
    return noted(url);
  }
  const out = resolve(ctx.cwd, stringFlag(flags, "out") ?? "");
  const body = await opened(ctx.t, connection, url);
  if ("ok" in body) {
    return noted(body);
  }

  const partial = `${out}.partial`;
  let bytes: number | null;
  try {
    bytes = await save(body, partial);
  } catch {
    return noted(failure("INVALID_ARGUMENT", ctx.t("error.outUnwritable", { path: out })));
  }
  if (bytes === null) {
    await rm(partial, { force: true });
    return noted(failure("NETWORK_ERROR", ctx.t("error.downloadCut")));
  }
  await rename(partial, out);
  return noted(
    success({ path: out, bytes }),
    ctx.t("note.downloaded", { bytes: String(bytes), path: out }),
  );
}
