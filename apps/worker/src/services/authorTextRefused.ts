import { UndercroftError } from "@undercroft/core";

/**
 * Text an author wrote was refused before it answered: their SQL by Postgres (`QueryFailed`), or
 * their model by dbt (`ModelCompileFailed`, ADR 0132). The message is the refuser's own account
 * of why, which quotes the author's text and no row, and is the one thing that lets them fix it.
 *
 * One base so the boundary decides once (`handlers/errors.ts`): each is a 400 with its `code`,
 * because the request was the fault, and the caller reads the code to know which text to fix.
 */
export abstract class AuthorTextRefused extends UndercroftError {
  abstract readonly code: "query_failed" | "compile_failed";
}
