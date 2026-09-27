/**
 * What a tab does when a deploy has taken away the chunk it was about to load. Both failures
 * are expensive: too eager, and the reload throws away a half-written model the store holds
 * only in memory, or loops forever on a chunk that is missing for another reason; too shy, and
 * the page stays blank until somebody thinks to press F5. ADR 0070.
 *
 * The store is the real one, written through `setState` the way its own actions write it, and
 * the storage is a real in-memory `Storage` -- no mocks.
 */

import { afterEach, describe, expect, test as it } from "bun:test";

import { draftFrom } from "@/lib/modelDraft.ts";
import {
  type ChunkRecoveryDeps,
  isStaleChunk,
  recoverFromStaleChunks,
  recoverStaleChunk,
} from "@/lib/staleChunk.ts";
import { holdsUnsavedWork, useUiStore } from "@/store.ts";

const RELOADED_AT = "undercroft.staleChunkReloadedAt";

/** `sessionStorage` as the recovery reads it, held in a map. */
function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const held = new Map<string, string>();
  return {
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => {
      held.set(key, value);
    },
  };
}

/** A browser that refuses storage outright, as a locked-down or private window may. */
const refusingStorage: Pick<Storage, "getItem" | "setItem"> = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("SecurityError");
  },
};

function deps(overrides: Partial<ChunkRecoveryDeps> = {}): ChunkRecoveryDeps {
  return {
    hasUnsavedWork: () => false,
    storage: memoryStorage(),
    now: () => 1_000_000,
    reload: () => undefined,
    ...overrides,
  };
}

function importFailure(): TypeError {
  return new TypeError("Failed to fetch dynamically imported module: /assets/Models-old.js");
}

describe("recoverStaleChunk", () => {
  it("reloads a tab that holds nothing unsaved, and remembers when", () => {
    const storage = memoryStorage();

    expect(recoverStaleChunk(importFailure(), deps({ storage }))).toBe("reload");
    expect(storage.getItem(RELOADED_AT)).toBe("1000000");
  });

  it("keeps a tab that holds unsaved work, so the reader decides", () => {
    const storage = memoryStorage();

    expect(recoverStaleChunk(importFailure(), deps({ storage, hasUnsavedWork: () => true }))).toBe(
      "keep",
    );
    expect(storage.getItem(RELOADED_AT)).toBeNull();
  });

  it("does not reload again right after a reload, so a chunk missing for another reason cannot loop", () => {
    const storage = memoryStorage();
    recoverStaleChunk(importFailure(), deps({ storage, now: () => 1_000_000 }));

    expect(recoverStaleChunk(importFailure(), deps({ storage, now: () => 1_030_000 }))).toBe(
      "keep",
    );
  });

  it("reloads for a later deploy once the last reload is long past", () => {
    const storage = memoryStorage();
    recoverStaleChunk(importFailure(), deps({ storage, now: () => 1_000_000 }));

    expect(
      recoverStaleChunk(importFailure(), deps({ storage, now: () => 1_000_000 + 3_600_000 })),
    ).toBe("reload");
  });

  it("keeps the tab when it cannot record the reload, rather than risk reloading forever", () => {
    expect(recoverStaleChunk(importFailure(), deps({ storage: refusingStorage }))).toBe("keep");
  });

  it("keeps the tab when what it recorded cannot be read back", () => {
    const storage = memoryStorage();
    storage.setItem(RELOADED_AT, "not a time");

    expect(recoverStaleChunk(importFailure(), deps({ storage }))).toBe("keep");
  });

  it("marks the failure as a stale chunk whichever way it decides", () => {
    const kept = importFailure();
    const reloaded = importFailure();

    recoverStaleChunk(kept, deps({ hasUnsavedWork: () => true }));
    recoverStaleChunk(reloaded, deps());

    expect(isStaleChunk(kept)).toBe(true);
    expect(isStaleChunk(reloaded)).toBe(true);
  });

  it("does not call any other error a stale chunk", () => {
    expect(isStaleChunk(importFailure())).toBe(false);
    expect(isStaleChunk(new Error("a page that threw while rendering"))).toBe(false);
    expect(isStaleChunk(null)).toBe(false);
  });
});

describe("recoverFromStaleChunks", () => {
  it("answers the event Vite dispatches when a dynamic import fails", () => {
    const target = new EventTarget();
    const storage = memoryStorage();
    const failure = importFailure();
    recoverFromStaleChunks(target, deps({ storage }));

    target.dispatchEvent(Object.assign(new Event("vite:preloadError"), { payload: failure }));

    expect(isStaleChunk(failure)).toBe(true);
    expect(storage.getItem(RELOADED_AT)).toBe("1000000");
  });
});

describe("holdsUnsavedWork", () => {
  afterEach(() => {
    useUiStore.setState({
      modelDraft: null,
      assistantDraft: "",
      cronDraft: null,
      scopeDraft: null,
      lakeSql: {},
    });
  });

  it("holds nothing in a tab that has only been read", () => {
    expect(holdsUnsavedWork(useUiStore.getState())).toBe(false);
  });

  it("does not count a draft the server already holds", () => {
    useUiStore.setState({
      modelDraft: draftFrom("CASE-0042", {
        name: "stg_deals",
        sql: "select 1 as deal_id",
        tests: { columns: {} },
        updatedAt: "2026-09-17T10:00:00.000Z",
        updatedBy: "u-1",
        lastBuild: null,
      }),
    });

    expect(holdsUnsavedWork(useUiStore.getState())).toBe(false);
  });

  it("counts a model edited since it was saved", () => {
    const seeded = draftFrom("CASE-0042", {
      name: "stg_deals",
      sql: "select 1 as deal_id",
      tests: { columns: {} },
      updatedAt: "2026-09-17T10:00:00.000Z",
      updatedBy: "u-1",
      lastBuild: null,
    });
    useUiStore.setState({ modelDraft: { ...seeded, sql: "select 2 as deal_id" } });

    expect(holdsUnsavedWork(useUiStore.getState())).toBe(true);
  });

  it("counts a sentence typed to the assistant and not yet sent", () => {
    useUiStore.getState().setAssistantDraft("why did the last run refuse rows?");

    expect(holdsUnsavedWork(useUiStore.getState())).toBe(true);
  });

  it("counts a schedule being written", () => {
    useUiStore.getState().setCronDraft("CASE-0042", "gmail", "0 9 * * *");

    expect(holdsUnsavedWork(useUiStore.getState())).toBe(true);
  });

  it("counts a source's read scope being chosen, which holds no saved copy to compare", () => {
    useUiStore.getState().setScopeDraft({
      source: "gmail",
      labels: ["INBOX"],
      files: [],
      organisation: null,
      entities: [],
      fileTypes: [],
      recurse: false,
      properties: {},
    });

    expect(holdsUnsavedWork(useUiStore.getState())).toBe(true);
  });

  it("counts a query in the lake console", () => {
    useUiStore.getState().setLakeSql("CASE-0042", "select 1");

    expect(holdsUnsavedWork(useUiStore.getState())).toBe(true);
  });
});
