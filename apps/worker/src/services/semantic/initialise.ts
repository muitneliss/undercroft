/**
 * Draw a tenant's first catalogue of document kinds from its own texts. ADR 0085.
 *
 * THE RULE the owner approved on 2026-09-29: classify a sample into the WHOLE generic catalogue
 * (`DOCUMENT_KINDS`), and keep every kind seen in at least `KEEP_SHARE` of either sample -- files,
 * and mail bodies, measured apart because what a file is and what a mail says differ (#330). The
 * tenant's admin then edits what was kept; nothing here publishes it.
 *
 * NEVER OVER A CATALOGUE THAT EXISTS. Initialising again would re-add kinds an admin removed, so a
 * tenant that has any kind is refused before a single text is sent.
 *
 * Each kind kept carries the larger of its two shares as `sample_share`, so an admin can see why
 * it is there -- and `other` is always kept, whatever it scored, for the reason `documentKinds.ts`
 * in the control plane gives.
 */

import { DOCUMENT_KIND_INSTRUCTION, DOCUMENT_KINDS, OTHER_KIND } from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";
import { insertKinds, listKinds } from "@undercroft/db/repos";

import { sampleTextByDigest, type TextPart } from "../../repos/documentText.ts";
import { IN_FLIGHT, MAX_CHARS, MIN_CHARS } from "./classify.ts";
import {
  judge,
  type SemanticAsk,
  type SemanticDefinition,
  SemanticProviderError,
} from "./definition.ts";
import { inFlight } from "./inFlight.ts";

/** A kind must be at least this share of a sample to be kept: one text in a hundred. */
export const KEEP_SHARE = 0.01;
/** Sample sizes, as measured on `tai-001`: enough for 1% to be three files and one or two mails. */
export const SAMPLE: Readonly<Record<Exclude<TextPart, "all">, number>> = {
  files: 300,
  bodies: 150,
};

const QUESTION = "document_kind";

const WHOLE_CATALOGUE: SemanticDefinition = {
  kind: "choice",
  instruction: DOCUMENT_KIND_INSTRUCTION,
  choices: Object.fromEntries(DOCUMENT_KINDS.map((entry) => [entry.kind, entry.description])),
};

export interface InitialiseDeps {
  readonly exec: SqlExecutor;
  readonly ask: SemanticAsk;
  readonly stop?: AbortSignal;
  readonly progress?: (done: number, total: number) => void;
}

export interface InitialiseTally {
  /** Texts the classifier answered, per part. */
  readonly answered: Readonly<Record<string, number>>;
  readonly providerErrors: number;
  /** Kinds written to the catalogue, `other` included. */
  readonly kept: readonly string[];
  readonly stopped: boolean;
}

/** `true` when the tenant has no catalogue yet, which is the only time it may be initialised. */
export async function mayInitialise(exec: SqlExecutor, tenantId: string): Promise<boolean> {
  return (await listKinds(exec, tenantId)).length === 0;
}

const PARTS = ["files", "bodies"] as const;

type SampledPart = (typeof PARTS)[number];

interface PartTally {
  /** Labels the classifier gave, with how often. */
  readonly labels: Map<string, number>;
  answered: number;
  providerErrors: number;
  stopped: boolean;
}

interface Progress {
  done: number;
  readonly total: number;
}

async function sampleOf(
  deps: InitialiseDeps,
  tenantId: string,
  part: SampledPart,
): Promise<string[]> {
  const texts = await sampleTextByDigest(deps.exec, {
    tenantId,
    limit: SAMPLE[part],
    maxChars: MAX_CHARS,
    part,
  });
  return texts.filter((text) => text.chars >= MIN_CHARS).map((text) => text.text);
}

/**
 * Classify one part's sample into the whole catalogue, `IN_FLIGHT` texts at once as a pass does
 * (ADR 0102), starting nothing more once a stop arrives.
 */
async function tallyPart(
  deps: InitialiseDeps,
  texts: readonly string[],
  progress: Progress,
): Promise<PartTally> {
  const tally: PartTally = { labels: new Map(), answered: 0, providerErrors: 0, stopped: false };
  const { stopped } = await inFlight(
    texts,
    IN_FLIGHT,
    async (text) => {
      try {
        const reply = await deps.ask(text, { [QUESTION]: WHOLE_CATALOGUE });
        const judged = judge(WHOLE_CATALOGUE, reply.answers[QUESTION]);
        if (judged.status === "classified" && judged.answer.kind === "choice") {
          tally.labels.set(judged.answer.label, (tally.labels.get(judged.answer.label) ?? 0) + 1);
          tally.answered += 1;
        }
      } catch (error) {
        if (!(error instanceof SemanticProviderError)) {
          throw error;
        }
        tally.providerErrors += 1;
      }
      progress.done += 1;
      deps.progress?.(progress.done, progress.total);
    },
    deps.stop,
  );
  tally.stopped = stopped;
  return tally;
}

/** Each label's share of the part it was seen in, the larger where it was seen in both. */
function sharesOf(tallies: readonly PartTally[]): Map<string, number> {
  const shares = new Map<string, number>();
  for (const tally of tallies) {
    for (const [kind, n] of tally.labels) {
      const share = tally.answered === 0 ? 0 : n / tally.answered;
      shares.set(kind, Math.max(shares.get(kind) ?? 0, share));
    }
  }
  return shares;
}

export async function initialiseCatalogue(
  deps: InitialiseDeps,
  tenantId: string,
  runId: string,
): Promise<InitialiseTally> {
  const samples = await Promise.all(PARTS.map((part) => sampleOf(deps, tenantId, part)));
  const progress: Progress = { done: 0, total: samples.reduce((sum, t) => sum + t.length, 0) };
  const tallies: PartTally[] = [];
  for (const texts of samples) {
    const tally = await tallyPart(deps, texts, progress);
    tallies.push(tally);
    if (tally.stopped) {
      break;
    }
  }
  const answered = Object.fromEntries(PARTS.map((part, i) => [part, tallies[i]?.answered ?? 0]));
  const providerErrors = tallies.reduce((sum, tally) => sum + tally.providerErrors, 0);

  // A catalogue drawn from a sample the stop cut short would be a guess about the rest.
  if (tallies.some((tally) => tally.stopped)) {
    return { answered, providerErrors, kept: [], stopped: true };
  }

  const shares = sharesOf(tallies);
  const kept = DOCUMENT_KINDS.filter(
    (entry) => entry.kind === OTHER_KIND || (shares.get(entry.kind) ?? 0) >= KEEP_SHARE,
  );
  await insertKinds(
    deps.exec,
    tenantId,
    kept.map((entry) => ({
      kind: entry.kind,
      description: entry.description,
      origin: "initialised" as const,
      sampleShare: shares.get(entry.kind)?.toFixed(4) ?? null,
    })),
    `run:${runId}`,
  );
  return { answered, providerErrors, kept: kept.map((entry) => entry.kind), stopped: false };
}
