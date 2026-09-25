/**
 * What a tool call answers over `/mcp`: a result, or a refusal. ADR 0059.
 *
 * A RESULT is the whole answer in `structuredContent`, as it would have crossed `/trpc`, and a
 * JSON text for the model beside it. The text is bounded -- a model's context is not a data
 * channel -- and every cut is named in a worded note, because a list cut off silently reads as
 * all the rows there are (rule 2). Nothing is ever cut from `structuredContent`.
 *
 * A REFUSAL is `isError` with the surface's own `code` -- the one the CLI's envelope carries and
 * an agent matches on -- a sentence in the caller's language, the facts the router named, and
 * the request's trace id, which is the one handle that leads an operator to the server's side.
 */

import type { CallToolResult } from "@modelcontextprotocol/server";
import type { TRPCError } from "@trpc/server";
import type { Locale } from "@undercroft/core";
import { currentTraceId } from "@undercroft/telemetry";
import { ZodError } from "zod";
import { messages } from "../i18n/index.ts";
import { BY_TRPC_CODE, type SurfaceErrorCode } from "./surface.ts";
import { refusalFacts } from "./trpc.ts";

/** How many items of any one list the model's text carries before the note takes over. */
const ROWS_IN_TEXT = 50;
/** The ceiling on the model's text, in kilobytes. The structured result is never clipped. */
const TEXT_KILOBYTES = 60;
const TEXT_BYTES = TEXT_KILOBYTES * 1024;
/** A replacement character left where a byte cut split a UTF-8 sequence. */
const SPLIT_CHARACTER = /�$/u;

/** What a refusal is called here: the surface's codes, and the grant's own. */
export type RefusalCode = SurfaceErrorCode | "WRITES_DISABLED";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The answer as it would have crossed `/trpc`: JSON, no transformer (`OutputOf` in
 * `surface.ts`), so a `Date` is the ISO string the other doors see. `structuredContent` must
 * be an object, so a list is `{ items }` and a bare value is `{ value }`.
 */
function structured(result: unknown): Record<string, unknown> {
  const wire: unknown = result === undefined ? null : JSON.parse(JSON.stringify(result));
  if (isRecord(wire)) {
    return wire;
  }
  return Array.isArray(wire) ? { items: wire } : { value: wire };
}

/**
 * The text the model reads: the same JSON, clipped to `ROWS_IN_TEXT` items per top-level list
 * and to `TEXT_KILOBYTES`, with one worded note per cut naming what was cut.
 */
function forTheModel(locale: Locale, result: Record<string, unknown>): CallToolResult["content"] {
  const t = messages(locale);
  const notes: string[] = [];
  const shown: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(result)) {
    if (Array.isArray(value) && value.length > ROWS_IN_TEXT) {
      shown[field] = value.slice(0, ROWS_IN_TEXT);
      notes.push(
        t("mcp.rowsClipped", { shown: String(ROWS_IN_TEXT), total: String(value.length), field }),
      );
    } else {
      shown[field] = value;
    }
  }
  let text = JSON.stringify(shown);
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > TEXT_BYTES) {
    text = new TextDecoder().decode(bytes.subarray(0, TEXT_BYTES)).replace(SPLIT_CHARACTER, "");
    notes.push(t("mcp.textClipped", { kilobytes: String(TEXT_KILOBYTES) }));
  }
  return [{ type: "text", text }, ...notes.map((note) => ({ type: "text" as const, text: note }))];
}

/** A procedure's answer, as a tool's result. */
export function answered(locale: Locale, result: unknown): CallToolResult {
  const whole = structured(result);
  return { structuredContent: whole, content: forTheModel(locale, whole) };
}

export function refused(code: RefusalCode, message: string, details?: unknown): CallToolResult {
  const answer = {
    code,
    message,
    ...(details === undefined ? {} : { details }),
    traceId: currentTraceId(),
  };
  return {
    isError: true,
    structuredContent: answer,
    content: [{ type: "text", text: JSON.stringify(answer) }],
  };
}

/**
 * A `TRPCError`, as this door says it -- the wording rules `apps/cli`'s `remote.ts` applies to
 * the same errors arriving over HTTP, applied here to the error itself:
 *
 * - an input the procedure's zod refused carries its issues as `details.issues`, under a
 *   sentence of this door's own, because the issues are data and unreadable as prose;
 * - a refusal the router worded keeps its sentence and its facts (`refusal` in `trpc.ts`);
 * - one it deliberately left unworded -- UNAUTHORIZED, NOT_FOUND, which must confirm nothing --
 *   and an internal failure, whose text may hold a row, get this door's sentence for the code.
 */
export function refusedBy(locale: Locale, error: TRPCError): CallToolResult {
  const t = messages(locale);
  const code = BY_TRPC_CODE[error.code];
  if (error.cause instanceof ZodError) {
    return refused(code, t("mcp.refused.VALIDATION_FAILED"), { issues: error.cause.issues });
  }
  const worded = code !== "INTERNAL_ERROR" && error.message !== "" && error.message !== error.code;
  return refused(
    code,
    worded ? error.message : t(`mcp.refused.${code}`),
    refusalFacts(error) ?? undefined,
  );
}
