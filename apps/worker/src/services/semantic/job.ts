/**
 * The semantic verb as a run in the ledger: open, classify a batch, close. ADR 0085.
 *
 * ITS OWN RUN, per (tenant, source), exactly as `extract` is and for the same reason: a
 * provider's pace and its outages are facts about classifying, not about reading or syncing, and
 * one status must not carry two of them. The partial unique index on `(tenant_id, source, verb)`
 * makes a second start a 409 that the flow ignores.
 *
 * WHAT IT CLASSIFIES AGAINST is the tenant's newest published catalogue, read here, and copied to
 * `raw.document_kind_definition` before anything is asked -- so the view a model reads says which
 * answers are current from the moment a run starts. A tenant with nothing published has nothing
 * due; a run started for one anyway closes `ok` saying so.
 *
 * A TEXT THE PROVIDER COULD NOT ANSWER IS NOT A FAILED RUN. It is a row with its reason, asked
 * again by the next run. What fails the run is being unable to reach the database at all.
 */

import { DOCUMENT_KIND_INSTRUCTION } from "@undercroft/contracts";
import { describeError, getPath, getStringPath, newRunId } from "@undercroft/core";
import {
  closeRun,
  MAX_ERROR_CHARS,
  openRun,
  recordEntities,
  recordPendingBefore,
  type RunTrigger,
} from "@undercroft/db/repos";

import {
  countDueTexts,
  type CurrentDefinition,
  currentDefinition,
  type SemanticScope,
  semanticDueScopes,
  syncDefinition,
} from "../../repos/documentKindResults.ts";
import { RunInProgress } from "../ingest.ts";
import { type JobDeps, track } from "../jobs.ts";
import { createRunJournal } from "../runJournal.ts";
import { turnsFor } from "../slots.ts";
import { type Catalogue, type ClassifyDeps, type ClassifyTally, classifyPass } from "./classify.ts";
import type { SemanticAsk } from "./definition.ts";
import { initialiseCatalogue, mayInitialise } from "./initialise.ts";

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_CHARS);
}

/**
 * The published definition as the classifier's question. Read field by field: it is JSON the
 * control plane wrote, and a catalogue this code cannot read is a failed run, never a guess.
 */
export function catalogueOf(current: CurrentDefinition): Catalogue {
  const kinds: Record<string, string> = {};
  const listed = getPath(current.definition, "kinds");
  for (const entry of Array.isArray(listed) ? listed : []) {
    const kind = getStringPath(entry, "kind");
    const description = getStringPath(entry, "description");
    if (kind !== null && description !== null) {
      kinds[kind] = description;
    }
  }
  const model = getStringPath(current.definition, "model");
  if (Object.keys(kinds).length === 0 || model === null) {
    throw new Error(`published catalogue version ${String(current.version)} cannot be read`);
  }
  return {
    version: current.version,
    definitionHash: current.definitionHash,
    model,
    instruction: getStringPath(current.definition, "instruction") ?? DOCUMENT_KIND_INSTRUCTION,
    kinds,
  };
}

type Journal = ReturnType<typeof createRunJournal>;
type SemanticDeps = JobDeps & { readonly semanticAsk: SemanticAsk };

const NOTHING: ClassifyTally = {
  asked: 0,
  classified: 0,
  tooShort: 0,
  invalid: 0,
  providerErrors: 0,
  stopped: false,
};

interface Opening {
  readonly tenantId: string;
  readonly source: string;
  readonly verb: "semantic" | "semantic-init";
  readonly trigger: RunTrigger;
  readonly triggeredBy: string;
}

/** Open the run and its journal; a second start for the same key is `RunInProgress`. */
async function openSemanticRun(
  deps: JobDeps,
  opening: Opening,
): Promise<{ runId: string; journal: Journal }> {
  const runId = newRunId();
  const opened = await openRun(deps.exec, {
    id: runId,
    ...opening,
    parentRunId: null,
    releaseTag: deps.releaseTag ?? "",
  });
  if (!opened.ok) {
    throw new RunInProgress(opening.verb, opening.tenantId, opened.runId);
  }
  const log = deps.log?.child({ runId, tenantId: opening.tenantId, source: opening.source });
  const journal = createRunJournal({
    exec: deps.exec,
    runId,
    ...(log === undefined ? {} : { log }),
  });
  journal.info("run_opened", { verb: opening.verb, trigger: opening.trigger });
  return { runId, journal };
}

/**
 * Run `work` in the background once it has its turn (ADR 0088); whatever it throws -- a stop
 * while it waited included -- closes the run failed with the reason.
 */
function runTracked(
  deps: JobDeps,
  runId: string,
  journal: Journal,
  work: () => Promise<void>,
): void {
  const turned = turnsFor(deps.turns, "semantic").run(work, {
    ...(deps.stop === undefined ? {} : { stop: deps.stop }),
    onWait: (waiting) => journal.info("run_waiting", { waiting }),
  });
  track(
    turned.then(
      () => journal.flush(),
      async (error: unknown) => {
        await closeRun(deps.exec, runId, { status: "failed", error: messageOf(error) });
        journal.error("run_failed", describeError(error));
        await journal.flush();
      },
    ),
  );
}

function passDeps(deps: SemanticDeps, journal: Journal): ClassifyDeps {
  return {
    exec: deps.exec,
    ask: deps.semanticAsk,
    ...(deps.stop === undefined ? {} : { stop: deps.stop }),
    progress: (read: number, total: number): void =>
      journal.progress("records_read", { entity: "documents", read, total }),
  };
}

async function settle(
  deps: JobDeps,
  runId: string,
  journal: Journal,
  tally: ClassifyTally,
): Promise<void> {
  const refused = tally.tooShort + tally.invalid + tally.providerErrors;
  await recordEntities(deps.exec, runId, [
    {
      entity: "documents",
      landed: tally.classified + refused,
      created: tally.classified,
      changed: 0,
      unchanged: 0,
      refused,
    },
  ]);
  await closeRun(deps.exec, runId, { status: "ok", created: tally.classified, refused });
  journal.info("run_closed", { status: "ok", created: tally.classified });
}

async function classifyRun(
  deps: SemanticDeps,
  runId: string,
  journal: Journal,
  scope: SemanticScope,
): Promise<void> {
  const current = await currentDefinition(deps.exec, scope.tenantId);
  if (current === null) {
    journal.info("work_listed", { entity: "documents", total: 0, reason: "nothing-published" });
    await settle(deps, runId, journal, NOTHING);
    return;
  }
  const catalogue = catalogueOf(current);
  await syncDefinition(deps.exec, scope.tenantId, current);
  const pending = await countDueTexts(deps.exec, scope);
  await recordPendingBefore(deps.exec, runId, pending);
  journal.info("work_listed", { entity: "documents", total: pending, version: current.version });
  const tally = await classifyPass(passDeps(deps, journal), scope, catalogue, runId);
  await settle(deps, runId, journal, tally);
}

export async function startSemanticJob(
  deps: SemanticDeps,
  input: { source: string; tenantId: string; trigger: RunTrigger; triggeredBy: string },
): Promise<{ runId: string }> {
  const { runId, journal } = await openSemanticRun(deps, { ...input, verb: "semantic" });
  const scope = { tenantId: input.tenantId, source: input.source };
  runTracked(deps, runId, journal, () => classifyRun(deps, runId, journal, scope));
  return { runId };
}

/** The pairs the scheduler should start a semantic run for: work outstanding, not a cadence. */
export function listSemanticDue(exec: JobDeps["exec"]): Promise<SemanticScope[]> {
  return semanticDueScopes(exec);
}

export type InitialiseStart = { ok: true; runId: string } | { ok: false; reason: "exists" };

async function initialiseRun(
  deps: SemanticDeps,
  runId: string,
  journal: Journal,
  tenantId: string,
): Promise<void> {
  const tally = await initialiseCatalogue(passDeps(deps, journal), tenantId, runId);
  const answered = Object.values(tally.answered).reduce((sum, n) => sum + n, 0);
  await recordEntities(deps.exec, runId, [
    {
      entity: "documents",
      landed: answered + tally.providerErrors,
      created: answered,
      changed: 0,
      unchanged: 0,
      refused: tally.providerErrors,
    },
  ]);
  if (tally.stopped) {
    // Nothing was written: a catalogue from a cut sample would be a guess about the rest.
    await closeRun(deps.exec, runId, {
      status: "failed",
      error: "stopped before the sample was classified; nothing was written",
    });
    return;
  }
  await closeRun(deps.exec, runId, {
    status: "ok",
    created: tally.kept.length,
    refused: tally.providerErrors,
  });
  journal.info("run_closed", { status: "ok", created: tally.kept.length });
}

/**
 * Initialise a tenant's catalogue as a run, per tenant (`source` is `*`, as a transform's is).
 * Refused before a run opens when the tenant already has a catalogue.
 */
export async function startSemanticInitJob(
  deps: SemanticDeps,
  input: { tenantId: string; triggeredBy: string },
): Promise<InitialiseStart> {
  if (!(await mayInitialise(deps.exec, input.tenantId))) {
    return { ok: false, reason: "exists" };
  }
  const { runId, journal } = await openSemanticRun(deps, {
    tenantId: input.tenantId,
    source: "*",
    verb: "semantic-init",
    trigger: "manual",
    triggeredBy: input.triggeredBy,
  });
  runTracked(deps, runId, journal, () => initialiseRun(deps, runId, journal, input.tenantId));
  return { ok: true, runId };
}
