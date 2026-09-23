/**
 * The feed's promises: what it keeps, what it drops, and that it says when it has dropped
 * something. A run's narration is only worth reading if the silences are honest.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TestClock } from "@undercroft/core";
import { eventsFor, openRun } from "@undercroft/db/repos";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { createRunJournal, MAX_EVENTS_PER_RUN, PROGRESS_INTERVAL_MS } from "./runJournal.ts";

let db: TestDatabase;
let clock: TestClock;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.exec("INSERT INTO ops.tenant (id) VALUES ('CASE-0042')");
  await db.become("undercroft_worker");
  await openRun(db, {
    id: "r1",
    tenantId: "CASE-0042",
    source: "gmail",
    verb: "ingest",
    trigger: "manual",
  });
  clock = new TestClock();
});

afterEach(async () => {
  await db.close();
});

describe("what a run narrates", () => {
  it("keeps its milestones in order, with the counts they carried", async () => {
    const journal = createRunJournal({ exec: db, runId: "r1", clock });

    journal.info("work_listed", { entity: "messages", total: 12_431 });
    journal.warn("no_models");
    await journal.flush();

    const events = await eventsFor(db, "r1");
    expect(events.map((e) => [e.event, e.level, e.entity])).toEqual([
      ["work_listed", "info", "messages"],
      ["no_models", "warn", null],
    ]);
    expect(events[0]?.detail).toEqual({ total: 12_431 });
  });

  it("stamps each event when it happened, not when it was written", async () => {
    const journal = createRunJournal({ exec: db, runId: "r1", clock });

    journal.info("entity_started", { entity: "messages" });
    await clock.advance(60_000);
    journal.info("entity_done", { entity: "messages" });
    await journal.flush();

    const [started, done] = await eventsFor(db, "r1");
    expect(new Date(done?.at ?? "").getTime() - new Date(started?.at ?? "").getTime()).toBe(60_000);
  });
});

describe("progress is a dial, read at an interval and kept in one place", () => {
  it("a second progress line too soon after the first is dropped", async () => {
    const journal = createRunJournal({ exec: db, runId: "r1", clock });

    journal.progress("records_read", { entity: "messages", read: 100 });
    journal.progress("records_read", { entity: "messages", read: 200 });
    await journal.flush();

    expect((await eventsFor(db, "r1")).map((e) => e.detail.read)).toEqual([100]);
  });

  it("once the interval has passed the reading is taken, and it replaces the last one", async () => {
    const journal = createRunJournal({ exec: db, runId: "r1", clock });

    journal.progress("records_read", { entity: "messages", read: 100 });
    await clock.advance(PROGRESS_INTERVAL_MS);
    journal.progress("records_read", { entity: "messages", read: 200 });
    await journal.flush();

    expect((await eventsFor(db, "r1")).map((e) => e.detail.read)).toEqual([200]);
  });

  it("two entities do not silence each other", async () => {
    const journal = createRunJournal({ exec: db, runId: "r1", clock });

    journal.progress("records_read", { entity: "messages", read: 100 });
    journal.progress("records_read", { entity: "files", read: 7 });
    await journal.flush();

    expect((await eventsFor(db, "r1")).map((e) => e.entity)).toEqual(["messages", "files"]);
  });

  it("a milestone is an occurrence and still appends, however many there are", async () => {
    const journal = createRunJournal({ exec: db, runId: "r1", clock });

    journal.info("entity_started", { entity: "messages" });
    journal.info("entity_started", { entity: "messages" });
    await journal.flush();

    expect(await eventsFor(db, "r1")).toHaveLength(2);
  });
});

describe("the feed is capped, and says so rather than looking complete", () => {
  it("past the cap an ordinary line is refused and the truncation is recorded once", async () => {
    const journal = createRunJournal({ exec: db, runId: "r1", clock });

    for (let n = 0; n < MAX_EVENTS_PER_RUN + 5; n += 1) {
      journal.info("entity_started", { entity: "messages", n });
    }
    await journal.flush();

    const events = await eventsFor(db, "r1", MAX_EVENTS_PER_RUN + 10);
    expect(events.filter((e) => e.event === "events_truncated")).toHaveLength(1);
    expect(events).toHaveLength(MAX_EVENTS_PER_RUN + 1);
  });

  it("a failure still gets through after the cap, which is the whole point of the exception", async () => {
    const journal = createRunJournal({ exec: db, runId: "r1", clock });

    for (let n = 0; n < MAX_EVENTS_PER_RUN + 5; n += 1) {
      journal.info("entity_started", { entity: "messages", n });
    }
    journal.error("run_failed", { errorType: "ConnectorError" });
    await journal.flush();

    const events = await eventsFor(db, "r1", MAX_EVENTS_PER_RUN + 10);
    expect(events.at(-1)?.event).toBe("run_failed");
  });

  it("a run past the cap keeps reading its dial: the counter is what a watcher is watching", async () => {
    const journal = createRunJournal({ exec: db, runId: "r1", clock });

    for (let n = 0; n < MAX_EVENTS_PER_RUN + 5; n += 1) {
      journal.info("entity_started", { entity: "messages", n });
    }
    await clock.advance(PROGRESS_INTERVAL_MS);
    journal.progress("records_read", { entity: "messages", read: 7786 });
    await journal.flush();

    const events = await eventsFor(db, "r1", MAX_EVENTS_PER_RUN + 10);
    const gauge = events.find((e) => e.event === "records_read");
    expect(gauge?.detail).toEqual({ read: 7786 });
  });
  // The quiet side -- a run under the cap records no truncation -- is the first test in this
  // file, which asserts an under-cap run's whole event list.
});

describe("the feed carries no sentence a provider wrote", () => {
  it("a fault's type is recorded and its message is not, though the log gets both", async () => {
    const journal = createRunJournal({ exec: db, runId: "r1", clock });

    journal.error("run_failed", {
      errorType: "ConnectorError",
      errorMessage: "failed on record {id: 42, email: someone@example.test}",
    });
    await journal.flush();

    const [failure] = await eventsFor(db, "r1");
    expect(failure?.detail).toEqual({ errorType: "ConnectorError" });
  });
});

describe("narrating never costs the run", () => {
  it("a feed that cannot be written leaves the caller unharmed", async () => {
    // A run whose row does not exist: the foreign key refuses every event, which is the
    // nearest honest stand-in for a database that will not take the write.
    const journal = createRunJournal({ exec: db, runId: "no-such-run", clock });

    journal.info("entity_started", { entity: "messages" });
    await journal.flush();

    expect(await eventsFor(db, "no-such-run")).toEqual([]);
  });
});
