/**
 * The semantic verbs over HTTP: not configured is said, initialising keeps what a sample shows,
 * and a catalogue that exists is never initialised over. ADR 0085.
 *
 * The classifier is an in-memory table that refuses a text it was not given. Real PGlite, as the
 * worker; the catalogue is read back as the control plane would see it.
 */

import { createStampSource, TestClock } from "@undercroft/core";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import { drainJobs } from "../services/jobs.ts";
import type { ProviderReply, SemanticAsk } from "../services/semantic/definition.ts";
import { createLakeApi } from "./lake.ts";

const TENANT = "CASE-0042";
const TOKEN = "trigger-token";

let db: TestDatabase;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await drainJobs();
  await db.close();
});

function api(semanticAsk?: SemanticAsk) {
  return createLakeApi({
    lake: new LakeStore(new InMemoryObjectStore(), { stamps: createStampSource(new TestClock()) }),
    exec: db,
    serviceToken: TOKEN,
    ...(semanticAsk === undefined ? {} : { semanticAsk }),
  });
}

function post(body: unknown) {
  return {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** A readable file text, long enough to be asked about, under its own digest. */
async function land(n: number, text: string): Promise<void> {
  const digest = n.toString(16).padStart(64, "0");
  await db.query(
    `INSERT INTO raw.documents (source, tenant_id, document_id, lake_key, sha256, byte_length,
       content_type, observed_at, run_id)
     VALUES ('drive', $1, $2, 'k', $3, '10', 'application/pdf', now(), 'r')`,
    [TENANT, `f${String(n)}`, digest],
  );
  await db.query(
    `INSERT INTO raw.document_text (source, tenant_id, document_id, source_sha256, method, text,
       chars, extracted_at, run_id)
     VALUES ('drive', $1, $2, $3, 'pdf_text', $4, $5, now(), 'r')`,
    [TENANT, `f${String(n)}`, digest, text, text.length],
  );
}

function chose(label: string): ProviderReply {
  return {
    model: "jev-1.13.0",
    inputTokens: 1,
    outputTokens: 1,
    answers: {
      document_kind: { kind: "choice", label, confidence: 0.9, probabilities: { [label]: 0.9 } },
    },
  };
}

/** Answers exactly the texts it was given, and refuses any other. */
function provider(replies: ReadonlyMap<string, ProviderReply>): SemanticAsk {
  return (text) => {
    const reply = replies.get(text);
    return reply === undefined
      ? Promise.reject(new Error("unmodelled text"))
      : Promise.resolve(reply);
  };
}

describe("without a classifier key", () => {
  it("says the verb is not configured, and lists nothing as due", async () => {
    const app = api();

    const started = await app.request(
      "/v1/runs/semantic",
      post({ tenantId: TENANT, source: "drive" }),
    );
    const due = await app.request("/v1/runs/semantic-due", {
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(started.status).toBe(400);
    expect(await due.json()).toEqual({ due: [] });
  });
});

describe("initialising a catalogue", () => {
  it("keeps every kind seen in at least 1% of the sample, and other, with its share", async () => {
    // 100 files: 60 invoices, 39 contracts, 1 receipt. The receipt is exactly the threshold.
    const replies = new Map<string, ProviderReply>();
    for (let n = 0; n < 100; n += 1) {
      const label = n < 60 ? "invoice" : n < 99 ? "contract" : "receipt";
      const text = `Document ${String(n)} of the tenant, long enough to be worth asking about.`;
      await land(n, text);
      replies.set(text, chose(label));
    }

    const started = await api(provider(replies)).request(
      "/v1/runs/semantic-init",
      post({ tenantId: TENANT, triggeredBy: "u1" }),
    );
    await drainJobs();

    expect(started.status).toBe(202);
    const { rows } = await db.query<{ kind: string; origin: string; sample_share: string | null }>(
      `SELECT kind, origin, sample_share::text AS sample_share FROM app.document_kind
        WHERE tenant_id = $1 ORDER BY kind`,
      [TENANT],
    );
    expect(rows).toEqual([
      { kind: "contract", origin: "initialised", sample_share: "0.3900" },
      { kind: "invoice", origin: "initialised", sample_share: "0.6000" },
      { kind: "other", origin: "initialised", sample_share: null },
      { kind: "receipt", origin: "initialised", sample_share: "0.0100" },
    ]);
  });

  it("refuses a tenant that already has a catalogue, before sending anything", async () => {
    await db.asSuperuser((tx) =>
      tx.query(
        `INSERT INTO app.document_kind (tenant_id, kind, description, origin)
         VALUES ($1, 'invoice', 'A bill.', 'admin')`,
        [TENANT],
      ),
    );

    const refused = await api(provider(new Map())).request(
      "/v1/runs/semantic-init",
      post({ tenantId: TENANT, triggeredBy: "u1" }),
    );

    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { code: string }).code).toBe("catalogue_exists");
  });
});
