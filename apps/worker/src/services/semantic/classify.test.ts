/**
 * A classifying pass: what it asks, what it stores, and what it asks again. ADR 0085, and ADR
 * 0093 for what a document shows while a new catalogue is being asked.
 *
 * Real PGlite, as the worker. The classifier is an in-memory table keyed by the text it is asked
 * about, and it REFUSES a text it was not given -- so a pass that sends a text it must not (one
 * too short, one already answered) fails here rather than being answered by a fake that agrees.
 */

import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import { currentDefinition, syncDefinition } from "../../repos/documentKindResults.ts";
import { classifyPass } from "./classify.ts";
import { type ProviderReply, type SemanticAsk, SemanticProviderError } from "./definition.ts";
import { catalogueOf } from "./job.ts";

const TENANT = "CASE-0042";
const SCOPE = { tenantId: TENANT, source: "drive" };
const INVOICE = "Tax invoice 17 from Acme Supplies, payable within thirty days of the date above.";
const CONTRACT = "This agreement is made between Acme Holdings and Example Trading for services.";

let db: TestDatabase;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

/** A readable document whose bytes hash to `digest`, the way an extract leaves one. */
async function land(documentId: string, digest: string, text: string): Promise<void> {
  await db.query(
    `INSERT INTO raw.documents (source, tenant_id, document_id, lake_key, sha256, byte_length,
       content_type, observed_at, run_id)
     VALUES ('drive', $1, $2, 'k', $3, '10', 'text/plain', now(), 'r')`,
    [TENANT, documentId, digest],
  );
  await db.query(
    `INSERT INTO raw.document_text (source, tenant_id, document_id, source_sha256, method, text,
       chars, extracted_at, run_id)
     VALUES ('drive', $1, $2, $3, 'txt', $4, $5, now(), 'r')`,
    [TENANT, documentId, digest, text, text.length],
  );
}

/** Publish a catalogue, as the control plane does; the worker may only read the table. */
async function publish(version: number, kinds: Record<string, string>): Promise<void> {
  const definition = {
    schema: "document-kind/1",
    instruction: "Classify the primary type of this document.",
    model: "jev-1.13.0",
    kinds: Object.entries(kinds).map(([kind, description]) => ({ kind, description })),
  };
  await db.asSuperuser((tx) =>
    tx.query(
      `INSERT INTO app.document_kind_version (tenant_id, version, definition_hash, definition)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [TENANT, version, String(version).repeat(64), JSON.stringify(definition)],
    ),
  );
}

function chose(label: string): ProviderReply {
  return {
    model: "jev-1.13.0",
    inputTokens: 1,
    outputTokens: 1,
    answers: {
      document_kind: { kind: "choice", label, confidence: 0.97, probabilities: { [label]: 0.97 } },
    },
  };
}

/** Answers exactly the texts it was given, and refuses any other. */
function provider(
  replies: Readonly<Record<string, ProviderReply | SemanticProviderError>>,
): SemanticAsk {
  return (text) => {
    const reply = replies[text];
    if (reply === undefined) {
      return Promise.reject(new Error(`unmodelled text: ${text.slice(0, 40)}`));
    }
    return reply instanceof SemanticProviderError ? Promise.reject(reply) : Promise.resolve(reply);
  };
}

async function pass(ask: SemanticAsk) {
  const current = await currentDefinition(db, TENANT);
  if (current === null) {
    throw new Error("nothing published");
  }
  await syncDefinition(db, TENANT, current);
  return classifyPass({ exec: db, ask }, SCOPE, catalogueOf(current), "run-1");
}

/** A run starting under the newest catalogue: the view learns which version is current. */
async function startNewest(): Promise<void> {
  const current = await currentDefinition(db, TENANT);
  if (current !== null) {
    await syncDefinition(db, TENANT, current);
  }
}

/** The document as a tenant's model reads it, through the view. */
async function seen(): Promise<
  { accepted: string | null; lastAccepted: string | null; current: boolean; version: number }[]
> {
  const { rows } = await db.query<{
    accepted: string | null;
    lastAccepted: string | null;
    current: boolean;
    version: number;
  }>(
    `SELECT accepted_kind AS accepted, last_accepted_kind AS "lastAccepted", current, version
       FROM raw.document_kinds WHERE tenant_id = $1 ORDER BY document_id`,
    [TENANT],
  );
  return rows;
}

async function stored(): Promise<{ status: string; kind: string | null; version: number }[]> {
  const { rows } = await db.query<{ status: string; kind: string | null; version: number }>(
    "SELECT status, kind, version FROM raw.document_kind WHERE tenant_id = $1 ORDER BY source_sha256",
    [TENANT],
  );
  return rows;
}

const KINDS = { invoice: "A bill.", contract: "An agreement.", other: "None of the above." };

describe("classifyPass", () => {
  it("answers a due text once, and the next pass asks nothing", async () => {
    await land("f1", "a".repeat(64), INVOICE);
    await publish(1, KINDS);

    const first = await pass(provider({ [INVOICE]: chose("invoice") }));
    const second = await pass(provider({}));

    expect(first.classified).toBe(1);
    expect(second.asked).toBe(0);
    expect(await stored()).toEqual([{ status: "classified", kind: "invoice", version: 1 }]);
  });

  it("records a text too short to be a document without asking the classifier", async () => {
    await land("f1", "a".repeat(64), "BANK napas 24 QR");
    await publish(1, KINDS);

    await pass(provider({}));

    expect(await stored()).toEqual([{ status: "too-short", kind: null, version: 1 }]);
  });

  it("never stores a label the catalogue did not offer", async () => {
    await land("f1", "a".repeat(64), INVOICE);
    await publish(1, KINDS);

    await pass(provider({ [INVOICE]: chose("receipt") }));

    expect(await stored()).toEqual([{ status: "invalid-response", kind: null, version: 1 }]);
  });

  it("asks again, on the next pass, a text the provider could not answer", async () => {
    await land("f1", "a".repeat(64), INVOICE);
    await publish(1, KINDS);

    await pass(provider({ [INVOICE]: new SemanticProviderError("http-429") }));
    const after = await stored();
    await pass(provider({ [INVOICE]: chose("invoice") }));

    expect(after).toEqual([{ status: "provider-error", kind: null, version: 1 }]);
    expect(await stored()).toEqual([{ status: "classified", kind: "invoice", version: 1 }]);
  });

  it("asks every text again once a changed catalogue is published", async () => {
    await land("f1", "a".repeat(64), INVOICE);
    await land("f2", "b".repeat(64), CONTRACT);
    await publish(1, KINDS);
    await pass(provider({ [INVOICE]: chose("invoice"), [CONTRACT]: chose("contract") }));

    await publish(2, { ...KINDS, receipt: "A record of a payment received." });
    const again = await pass(
      provider({ [INVOICE]: chose("invoice"), [CONTRACT]: chose("contract") }),
    );

    expect(again.classified).toBe(2);
    expect((await stored()).map((row) => row.version)).toEqual([2, 2]);
  });
});

describe("while a new catalogue is being asked", () => {
  it("a document keeps its last accepted kind, marked as not current", async () => {
    await land("f1", "a".repeat(64), INVOICE);
    await publish(1, KINDS);
    await pass(provider({ [INVOICE]: chose("invoice") }));

    await publish(2, { ...KINDS, receipt: "A record of a payment received." });
    await startNewest();

    expect(await seen()).toEqual([
      { accepted: null, lastAccepted: "invoice", current: false, version: 1 },
    ]);
  });

  it("a provider failure under the new catalogue does not erase the answer it replaces", async () => {
    await land("f1", "a".repeat(64), INVOICE);
    await publish(1, KINDS);
    await pass(provider({ [INVOICE]: chose("invoice") }));
    await publish(2, { ...KINDS, receipt: "A record of a payment received." });

    await pass(provider({ [INVOICE]: new SemanticProviderError("http-429") }));
    const during = await seen();
    await pass(provider({ [INVOICE]: chose("invoice") }));

    expect(during).toEqual([
      { accepted: null, lastAccepted: "invoice", current: false, version: 1 },
    ]);
    expect(await seen()).toEqual([
      { accepted: "invoice", lastAccepted: "invoice", current: true, version: 2 },
    ]);
  });
});
