/**
 * What a transcript keeps, and what it refuses to keep.
 *
 * The promise under test is the one a later reader is most likely to relax by accident: a
 * conversation may hold the words the reader and the assistant exchanged, and may NOT hold the
 * lake payloads a tool fetched along the way. It is pinned from both sides -- what survives, and
 * what does not -- because a digest that dropped everything would pass a leak test while making
 * the feature useless.
 *
 * Two tests go through PGlite rather than asserting on the function's return value,
 * because the real guarantee is the table's CHECK constraint: `transcript.ts` deciding correctly
 * is a habit, the constraint refusing is an invariant, and it is the constraint that still holds
 * when someone writes a second caller.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import type { UIMessage } from "ai";
import { openThread, saveTurn } from "../../repos/assistantThread.ts";
import { ERROR_NOT_KEPT, forStorage, restore, type Summarize } from "./transcript.ts";

let db: TestDatabase;
let threadId: string;

/** A summariser that answers for one tool and declines for every other, as a real one does. */
const summarize: Summarize = (tool, output) =>
  tool === "lakeRecords" ? `${(output as { rows: unknown[] }).rows.length} rows` : null;

/** The shape a lake read comes back in: a payload a human wrote, which must not come to rest. */
function conversation(): UIMessage[] {
  return [
    { id: "m1", role: "user", parts: [{ type: "text", text: "Hoá đơn tháng này về chưa?" }] },
    {
      id: "m2",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "The reader wants invoices; call lakeRecords for xero." },
        { type: "text", text: "Có 2 hoá đơn đã về." },
        {
          type: "tool-lakeRecords",
          toolCallId: "call-1",
          state: "output-available",
          input: { tenantId: "CASE-0042", source: "xero", entity: "invoices" },
          output: { rows: [{ contact: "Trần Thị Bích Hằng" }, { contact: "Acme Ltd" }] },
        },
      ],
    } as UIMessage,
  ];
}

describe("a transcript keeps the conversation", () => {
  it("the reader's question and the assistant's answer survive, in their own words", () => {
    const [question, answer] = forStorage(conversation(), summarize);
    expect(question?.parts).toEqual([{ type: "text", text: "Hoá đơn tháng này về chưa?" }]);
    expect(answer?.parts).toContainEqual({ type: "text", text: "Có 2 hoá đơn đã về." });
  });

  it("a tool's arguments survive, because a proof must say what it was pulled on", () => {
    const [, answer] = forStorage(conversation(), summarize);
    const tool = answer?.parts.find((p) => (p as { type: string }).type === "tool-lakeRecords");
    expect(tool).toMatchObject({
      toolCallId: "call-1",
      state: "output-available",
      input: { tenantId: "CASE-0042", source: "xero", entity: "invoices" },
    });
  });

  it("a summary the tool declared safe survives in place of the payload", () => {
    const [, answer] = forStorage(conversation(), summarize);
    const tool = answer?.parts.find((p) => (p as { type: string }).type === "tool-lakeRecords");
    expect(tool).toMatchObject({ digest: { kept: false, summary: "2 rows" } });
  });

  it("a tool that declares no safe summary is stored with none, not with a guess", () => {
    const messages: UIMessage[] = [
      {
        id: "m1",
        role: "assistant",
        parts: [
          {
            type: "tool-lakeQuery",
            toolCallId: "c9",
            state: "output-available",
            input: { sql: "select 1" },
            output: { rows: [{ secret: "Nguyễn Văn A" }] },
          },
        ],
      } as UIMessage,
    ];
    const [turn] = forStorage(messages, summarize);
    expect(turn?.parts[0]).toMatchObject({ digest: { kept: false } });
    expect(JSON.stringify(turn)).not.toContain("summary");
  });
});

describe("a transcript refuses to keep a payload", () => {
  it("the fetched rows are gone, names and all", () => {
    const stored = JSON.stringify(forStorage(conversation(), summarize));
    expect(stored).not.toContain("Trần Thị Bích Hằng");
    expect(stored).not.toContain("Acme Ltd");
    // The KEY, not the word: `output-available` is a legitimate state and contains it. The
    // absence of the key at any depth is what the table's CHECK enforces, and it is asserted
    // through the database two tests below rather than by reading JSON here.
    expect(stored).not.toContain('"output":');
  });

  it("a refusal's text is reduced to its shape, because Postgres quotes the value in it", () => {
    const messages: UIMessage[] = [
      {
        id: "m1",
        role: "assistant",
        parts: [
          {
            type: "tool-lakeQuery",
            toolCallId: "c2",
            state: "output-error",
            input: { sql: "insert into t values ('x')" },
            errorText: "duplicate key value violates unique constraint (name)=(Nguyễn Văn A)",
          },
        ],
      } as UIMessage,
    ];
    const [turn] = forStorage(messages, summarize);
    expect(turn?.parts[0]).toMatchObject({ state: "output-error", digest: { failed: true } });
    expect(JSON.stringify(turn)).not.toContain("Nguyễn Văn A");
  });

  it("the model's reasoning is dropped and named, since it quotes results freely", () => {
    const [, answer] = forStorage(conversation(), summarize);
    expect(answer?.parts).toContainEqual({
      type: "data-omitted",
      data: { partType: "reasoning" },
    });
  });

  it("a part kind carrying a filename is dropped and named, never stored", () => {
    // `source-document` carries `title` and `filename`. A filename is a name a human wrote, and
    // `pii.md` says one never reaches Postgres -- so the allowlist, not a per-kind rule, is what
    // makes a part kind the SDK adds later a decision rather than an accident.
    const messages: UIMessage[] = [
      {
        id: "m1",
        role: "assistant",
        parts: [
          {
            type: "source-document",
            sourceId: "s1",
            mediaType: "application/pdf",
            title: "Hợp đồng thuê nhà - Trần Thị Bích Hằng.pdf",
            filename: "Hợp đồng thuê nhà - Trần Thị Bích Hằng.pdf",
          },
        ],
      } as UIMessage,
    ];
    const [turn] = forStorage(messages, summarize);
    expect(turn?.parts).toEqual([{ type: "data-omitted", data: { partType: "source-document" } }]);
    expect(JSON.stringify(turn)).not.toContain("Trần Thị Bích Hằng");
  });
});

describe("the database refuses a payload even when the caller forgets to digest it", () => {
  // The only describe here that opens a database: everything else is `forStorage` and
  // `restore`, pure functions that pay nothing for a fixture they never read.
  beforeEach(async () => {
    db = await createMigratedTestDatabase();
    await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-0042')");
    const { rows } = await db.query<{ id: string }>(
      "INSERT INTO app.app_user (email) VALUES ('ops@example.test') RETURNING id",
    );
    // Seeded as the superuser; from here on every statement runs as the control plane does.
    await db.become("undercroft_app");
    threadId = await openThread(db, "CASE-0042", rows[0]!.id);
  });

  afterEach(async () => {
    await db.close();
  });

  it("an undigested result is rejected at rest, at any depth", async () => {
    await expect(
      saveTurn(db, threadId, {
        messageId: "m9",
        ordinal: 0,
        role: "assistant",
        parts: [{ type: "step", inner: { deeper: { output: { rows: ["Nguyễn Văn A"] } } } }],
      }),
    ).rejects.toThrow();
  });

  it("a digested turn is accepted, so the constraint is not simply refusing everything", async () => {
    const [, answer] = forStorage(conversation(), summarize);
    await saveTurn(db, threadId, {
      messageId: answer!.messageId,
      ordinal: answer!.ordinal,
      role: answer!.role,
      parts: answer!.parts,
    });
    const { rows } = await db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM app.assistant_turn WHERE thread_id = $1",
      [threadId],
    );
    expect(rows[0]?.n).toBe("1");
  });
});

describe("a restored transcript says what it does not have", () => {
  it("a digested result comes back as the digest, so the model re-runs rather than invents", () => {
    const stored = forStorage(conversation(), summarize);
    const [, answer] = restore(
      stored.map((t) => ({ messageId: t.messageId, role: t.role, parts: t.parts })),
    );
    const tool = answer?.parts.find((p) => (p as { type: string }).type === "tool-lakeRecords");
    expect(tool).toMatchObject({
      state: "output-available",
      output: { kept: false, summary: "2 rows" },
    });
  });

  it("an errored call comes back struck, with a sentinel the interleaf localises", () => {
    const stored = [
      {
        messageId: "m1",
        role: "assistant" as const,
        parts: [
          {
            type: "tool-lakeQuery",
            toolCallId: "c2",
            state: "output-error",
            input: { sql: "select 1" },
            digest: { kept: false, failed: true },
          },
        ],
      },
    ];
    const [turn] = restore(stored);
    expect(turn?.parts[0]).toMatchObject({
      state: "output-error",
      errorText: ERROR_NOT_KEPT,
    });
  });
});
