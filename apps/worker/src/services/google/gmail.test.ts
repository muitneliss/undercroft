/**
 * The label listing, which is the whole input to the scope picker's index.
 *
 * Both promises here fail silently. Drop `type` on the way through and the picker still
 * renders every label -- in one undifferentiated run, with the thirteen Gmail ships sitting
 * on top of the five an admin came to find, and nothing on the page to say a classification
 * was lost. Default an unclassified label to `user` and the screen states who made it, which
 * is a fact nobody supplied, on the screen where custody of a customer's mail is decided.
 *
 * A byte fetcher that REFUSES an unmodelled request, so a listing that called an endpoint
 * nobody recorded fails loudly here rather than reading as an empty mailbox.
 */

import { createPacer, InMemoryByteFetcher, TestClock } from "@undercroft/core";
import { beforeEach, expect, test as it } from "bun:test";

import { createGoogleApi } from "./api.ts";
import { listLabels } from "./gmail.ts";

const LABELS = "https://gmail.googleapis.com/gmail/v1/users/me/labels";

let fetcher: InMemoryByteFetcher;

beforeEach(() => {
  fetcher = new InMemoryByteFetcher();
});

function labels(): ReturnType<typeof listLabels> {
  const clock = new TestClock();
  return listLabels(
    createGoogleApi("gmail", {
      fetcher,
      token: () => Promise.resolve("tok"),
      clock,
      // No minimum interval: on a TestClock nothing advances, so a pacer that sleeps between
      // requests never wakes. Pacing is exercised against the clock it needs in `api.test.ts`.
      pacer: createPacer({}, clock),
    }),
  );
}

it("carries Gmail's own ownership of a label through to the picker", async () => {
  fetcher.on("GET", LABELS, {
    body: {
      labels: [
        { id: "INBOX", name: "INBOX", type: "system" },
        { id: "Label_7", name: "Kế toán", type: "user" },
      ],
    },
  });

  expect(await labels()).toEqual([
    { id: "INBOX", name: "INBOX", kind: "system" },
    { id: "Label_7", name: "Kế toán", kind: "user" },
  ]);
});

it("leaves a label Gmail did not classify unclassified rather than guessing an owner", async () => {
  // The quiet side of the same guard: `user` is the commoner answer and the tempting
  // default, and defaulting to it states who made a label on no evidence at all.
  fetcher.on("GET", LABELS, { body: { labels: [{ id: "Label_9", name: "Github" }] } });

  expect(await labels()).toEqual([{ id: "Label_9", name: "Github", kind: null }]);
});
