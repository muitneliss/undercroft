/**
 * What a tool call answers over `/mcp`: a result, or a refusal. ADR 0060, ADR 0122.
 *
 * A RESULT is bounded wherever a model might read it. It goes out as a JSON text and, beside it,
 * the same answer as `structuredContent`, and a client may put either in the model's context --
 * Claude Code puts the structured one. So both get the same clip: at most `ROWS_SHOWN` items of
 * any top-level list, with one worded note per cut, because a list cut off silently reads as all
 * the rows there are (rule 2). The text carries its notes as text beside it; the structured copy
 * carries them in its own `CLIPPED_NOTES_FIELD`. An answer still over `KILOBYTES` after that is
 * too big to be anyone's context: its text is cut at the bound and says so, and it has no
 * structured copy at all, which no tool needs -- none declares an `outputSchema`.
 *
 * The whole answer is not lost: the procedure's own filters and pages reach the rest, and a
 * widget, which needs every row it draws, gets it whole in `_meta` (`resultMeta` in
 * `mcpWidgets.ts`), the lane MCP Apps delivers to the widget and keeps from the model.
 *
 * A REFUSAL is `isError` with the surface's own `code` -- the one the CLI's envelope carries and
 * an agent matches on -- a sentence in the caller's language, the facts the router named, and
 * the request's trace id, which is the one handle that leads an operator to the server's side.
 * It is small, so its structured copy is never clipped.
 */

import type { CallToolResult } from "@modelcontextprotocol/server";
import type { TRPCError } from "@trpc/server";
import type { Locale } from "@undercroft/core";
import { currentTraceId } from "@undercroft/telemetry";
import { ZodError } from "zod";
import { messages } from "../i18n/index.ts";
import { BY_TRPC_CODE, type SurfaceErrorCode } from "./surface.ts";
import { refusalFacts } from "./trpc.ts";

/** How many items of any one top-level list a result carries before a note takes over. */
const ROWS_SHOWN = 50;
/** The ceiling on what a result carries for a model to read, in kilobytes of JSON. */
const KILOBYTES = 60;
const BOUND_BYTES = KILOBYTES * 1024;
/** A replacement character left where a byte cut split a UTF-8 sequence. */
const SPLIT_CHARACTER = /�$/u;

/**
 * The field of a clipped `structuredContent` that holds the worded notes on what was cut from it,
 * one per cut, in the caller's language; absent when nothing was cut. Spelled with a `/` so it
 * cannot be a procedure's own field, every one of which is a bare identifier. A widget reads it as
 * `typeof CLIPPED_NOTES_FIELD`, re-exported as a type by `surface.ts`.
 */
export const CLIPPED_NOTES_FIELD = "undercroft/clipped";

/** What a refusal is called here: the surface's codes, and the grant's own. */
export type RefusalCode = SurfaceErrorCode | "WRITES_DISABLED";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The answer as it would have crossed `/trpc` (`ToolContentOf` in `surface.ts`): JSON, no
 * transformer (`OutputOf`), so a `Date` is the ISO string the other doors see. Tool content must
 * be an object, so a list is `{ items }` and a bare value is `{ value }`. This is the WHOLE answer;
 * `answered` bounds it.
 */
export function toolContent(result: unknown): Record<string, unknown> {
  const wire: unknown = result === undefined ? null : JSON.parse(JSON.stringify(result));
  if (isRecord(wire)) {
    return wire;
  }
  return Array.isArray(wire) ? { items: wire } : { value: wire };
}

function texts(json: string, notes: readonly string[]): CallToolResult["content"] {
  return [
    { type: "text", text: json },
    ...notes.map((note) => ({ type: "text" as const, text: note })),
  ];
}

/**
 * A procedure's answer (`toolContent`), as a tool's result: the bounded text and structured
 * copy the module note describes. The whole answer is the caller's to carry elsewhere.
 */
export function answered(locale: Locale, whole: Record<string, unknown>): CallToolResult {
  const t = messages(locale);
  const notes: string[] = [];
  const shown: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(whole)) {
    if (Array.isArray(value) && value.length > ROWS_SHOWN) {
      shown[field] = value.slice(0, ROWS_SHOWN);
      notes.push(
        t("mcp.rowsClipped", { shown: String(ROWS_SHOWN), total: String(value.length), field }),
      );
    } else {
      shown[field] = value;
    }
  }
  const json = JSON.stringify(shown);
  const bytes = new TextEncoder().encode(json);
  if (bytes.length <= BOUND_BYTES) {
    return {
      structuredContent: notes.length === 0 ? shown : { ...shown, [CLIPPED_NOTES_FIELD]: notes },
      content: texts(json, notes),
    };
  }
  const cut = new TextDecoder().decode(bytes.subarray(0, BOUND_BYTES)).replace(SPLIT_CHARACTER, "");
  return {
    content: texts(cut, [...notes, t("mcp.textClipped", { kilobytes: String(KILOBYTES) })]),
  };
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
