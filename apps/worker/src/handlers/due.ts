/**
 * How the three due lists answer Kestra: the pairs to start, and the pairs set aside.
 *
 * One function for the three routes (`/v1/runs/due`, `extract-due`, `semantic-due`) because the
 * one thing they must not do differently is how a skipped pair is reported. The flows loop over
 * `due` and nothing else, so `skipped` changes nothing they start; it rides in the body Kestra
 * keeps with the execution, and the same pairs go to the log as one line, so a customer whose
 * syncs stopped because it was deactivated (ADR 0110) can be told from one whose syncs broke.
 * CLAUDE.md rule 2: set aside and said, never silently left out.
 */

import type { Context } from "hono";

import type { DueList } from "../services/schedule.ts";
import type { LakeApiDeps } from "./lake.ts";

export function answerDue(
  c: Context,
  deps: LakeApiDeps,
  list: "ingest" | "extract" | "semantic",
  answer: DueList,
): Response {
  if (answer.skipped.length > 0) {
    deps.log?.info("due_skipped", { list, skipped: answer.skipped });
  }
  return c.json(answer, 200);
}
