/**
 * What the Lark seam promises: a notice Lark refused is never reported as posted.
 *
 * Lark refuses with HTTP 200 and a non-zero `code`, so reading the status alone would count a
 * card nobody received. Driven by an injected `fetch` returning real `Response` objects.
 */

import { expect, test as it } from "bun:test";

import { type LarkFetch, larkMessage, postLark } from "./index.ts";

const CFG = { url: "https://lark.example.test/hook/abc", secret: "" };
const MESSAGE = larkMessage({ title: "t", tone: "blue", facts: [], body: "", links: [] });

function larkAnswering(status: number, body: unknown): LarkFetch {
  return () => Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function now(): number {
  return 1_700_000_000_000;
}

it("fails the send when Lark answers HTTP 200 with a non-zero code", async () => {
  const refusing = larkAnswering(200, { code: 19_021, msg: "sign match fail" });

  await expect(postLark(CFG, MESSAGE, { fetch: refusing, now })).rejects.toThrow("19021");
});

it("completes the send when Lark answers code 0", async () => {
  const accepting = larkAnswering(200, { code: 0, msg: "success", data: {} });

  await expect(postLark(CFG, MESSAGE, { fetch: accepting, now })).resolves.toBeUndefined();
});
