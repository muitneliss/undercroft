/**
 * A tenant's catalogue of document kinds: read it, edit it, publish it. ADR 0085.
 *
 * EDITS ARE DRAFTS; PUBLISHING IS WHAT COSTS. The worker classifies against the newest published
 * version, keyed by the hash of its canonical definition, so any change to the list re-classifies
 * every text. An admin may therefore make any number of edits and pay once, when they publish.
 * A publish whose definition hashes to the newest version's is the same catalogue and makes no
 * new version: publishing twice is not paying twice.
 *
 * `other` IS NOT OPTIONAL. Every definition carries it, whether or not the table has a row for
 * it, and it cannot be removed: a list with no way to say "none of these" forces every document
 * into a kind, and a forced answer is a guess (`CLAUDE.md` rule 2).
 */

import { createHash } from "node:crypto";

import {
  DOCUMENT_KIND_INSTRUCTION,
  DOCUMENT_KIND_MODEL,
  DOCUMENT_KINDS,
  OTHER_KIND,
} from "@undercroft/contracts";
import { canonicalJson } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import {
  type CatalogueKind,
  countReadableDocuments,
  deleteKind,
  insertKinds,
  insertVersion,
  latestVersion,
  listKinds,
  updateKindDescription,
} from "@undercroft/db/repos";

import { record as recordAudit } from "../repos/auditLog.ts";
import type { InitialiseOutcome, WorkerClient } from "./workerClient.ts";

/** Bumped when the shape below changes, so a new canonical form can never match an old hash. */
const DEFINITION_SCHEMA = "document-kind/1";

const GENERIC = new Map(DOCUMENT_KINDS.map((entry) => [entry.kind, entry.description]));

interface Definition {
  readonly schema: string;
  readonly instruction: string;
  readonly model: string;
  readonly kinds: readonly { readonly kind: string; readonly description: string }[];
}

/** The definition a catalogue publishes as: its kinds by name, and `other` always among them. */
function definitionOf(kinds: readonly CatalogueKind[]): Definition {
  const listed = kinds.map((k) => ({ kind: k.kind, description: k.description }));
  const withOther = listed.some((k) => k.kind === OTHER_KIND)
    ? listed
    : [
        ...listed,
        { kind: OTHER_KIND, description: GENERIC.get(OTHER_KIND) ?? "None of the above." },
      ];
  return {
    schema: DEFINITION_SCHEMA,
    instruction: DOCUMENT_KIND_INSTRUCTION,
    model: DOCUMENT_KIND_MODEL,
    kinds: [...withOther].sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)),
  };
}

function hashOf(definition: Definition): { json: string; hash: string } {
  // `canonicalJson` sorts keys and refuses a bare number, so the text -- and the hash -- depend
  // on nothing but what the definition says.
  const json = canonicalJson(definition);
  return { json, hash: createHash("sha256").update(json, "utf8").digest("hex") };
}

export interface CatalogueView {
  readonly kinds: readonly CatalogueKind[];
  /** Generic kinds the tenant does not have yet, to add from. */
  readonly available: readonly { kind: string; description: string }[];
  readonly published: { version: number; publishedAt: string; publishedBy: string } | null;
  /** The draft differs from the newest published version, so a publish would re-classify. */
  readonly unpublishedChanges: boolean;
  /** Readable documents: the most calls a publish would make, since copies are asked once. */
  readonly readableDocuments: number;
}

export async function list(exec: SqlExecutor, tenantId: string): Promise<CatalogueView> {
  const [kinds, published, readableDocuments] = await Promise.all([
    listKinds(exec, tenantId),
    latestVersion(exec, tenantId),
    countReadableDocuments(exec, tenantId),
  ]);
  const held = new Set(kinds.map((k) => k.kind));
  return {
    kinds,
    available: DOCUMENT_KINDS.filter((entry) => !held.has(entry.kind)).map((entry) => ({
      kind: entry.kind,
      description: entry.description,
    })),
    published:
      published === null
        ? null
        : {
            version: published.version,
            publishedAt: published.publishedAt,
            publishedBy: published.publishedBy,
          },
    unpublishedChanges:
      kinds.length > 0 && hashOf(definitionOf(kinds)).hash !== published?.definitionHash,
    readableDocuments,
  };
}

interface Actor {
  readonly tenantId: string;
  readonly actor: string;
  readonly actorId: string;
}

export type AddOutcome = { ok: true } | { ok: false; reason: "exists" | "description-required" };

/**
 * Add a kind. Named from the generic catalogue, it may omit its description and takes the
 * generic one; any other name is the admin's own and must say what it means, because the
 * description is what the classifier is told.
 */
export async function add(
  exec: SqlExecutor,
  input: Actor & { kind: string; description: string | null },
): Promise<AddOutcome> {
  const generic = GENERIC.get(input.kind);
  const description = input.description ?? generic;
  if (description === undefined) {
    return { ok: false, reason: "description-required" };
  }
  const origin = generic === undefined ? "admin" : "generic";
  const added = await insertKinds(
    exec,
    input.tenantId,
    [{ kind: input.kind, description, origin, sampleShare: null }],
    input.actorId,
  );
  if (added === 0) {
    return { ok: false, reason: "exists" };
  }
  await recordAudit(exec, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "documentKinds.add",
    detail: JSON.stringify({ kind: input.kind, origin }),
  });
  return { ok: true };
}

export async function update(
  exec: SqlExecutor,
  input: Actor & { kind: string; description: string },
): Promise<{ ok: true } | { ok: false; reason: "not-found" }> {
  const updated = await updateKindDescription(
    exec,
    input.tenantId,
    input.kind,
    input.description,
    input.actorId,
  );
  if (!updated) {
    return { ok: false, reason: "not-found" };
  }
  await recordAudit(exec, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "documentKinds.update",
    detail: JSON.stringify({ kind: input.kind }),
  });
  return { ok: true };
}

export async function remove(
  exec: SqlExecutor,
  input: Actor & { kind: string },
): Promise<{ ok: true } | { ok: false; reason: "not-found" | "required" }> {
  if (input.kind === OTHER_KIND) {
    return { ok: false, reason: "required" };
  }
  if (!(await deleteKind(exec, input.tenantId, input.kind))) {
    return { ok: false, reason: "not-found" };
  }
  await recordAudit(exec, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "documentKinds.remove",
    detail: JSON.stringify({ kind: input.kind }),
  });
  return { ok: true };
}

export type PublishOutcome =
  | { ok: true; version: number; changed: true }
  | { ok: true; version: number; changed: false }
  | { ok: false; reason: "empty" };

/**
 * Publish the draft. A catalogue with no kind of its own is refused: `other` alone would classify
 * every document as nothing, at full price.
 */
export async function publish(exec: SqlExecutor, input: Actor): Promise<PublishOutcome> {
  const kinds = await listKinds(exec, input.tenantId);
  if (!kinds.some((k) => k.kind !== OTHER_KIND)) {
    return { ok: false, reason: "empty" };
  }
  const { json, hash } = hashOf(definitionOf(kinds));
  const newest = await latestVersion(exec, input.tenantId);
  if (newest?.definitionHash === hash) {
    return { ok: true, version: newest.version, changed: false };
  }
  const published = await insertVersion(exec, input.tenantId, {
    definitionHash: hash,
    definitionJson: json,
    publishedBy: input.actorId,
  });
  await recordAudit(exec, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "documentKinds.publish",
    detail: JSON.stringify({ version: published.version, kinds: kinds.length }),
  });
  return { ok: true, version: published.version, changed: true };
}

/**
 * Draw the tenant's first catalogue from a sample of its own texts, as a worker run. The worker
 * reads the text, which the control plane may not, and refuses a tenant that has a catalogue.
 */
export async function initialise(
  exec: SqlExecutor,
  worker: WorkerClient,
  input: Actor,
): Promise<InitialiseOutcome> {
  const outcome = await worker.initialiseDocumentKinds({
    tenantId: input.tenantId,
    triggeredBy: input.actorId,
  });
  if (outcome.ok) {
    await recordAudit(exec, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: "documentKinds.initialise",
      detail: JSON.stringify({ runId: outcome.runId }),
    });
  }
  return outcome;
}
