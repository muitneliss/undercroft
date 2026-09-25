/**
 * A trace id is only a handle if the server's own record of the request carries it too: the
 * id a person copies from a response must find the log lines written while serving it.
 */

import { expect, test } from "bun:test";
import { createLogger } from "@undercroft/core";
import { Hono } from "hono";
import { currentTraceId, traceRequests } from "./index.ts";

test("a line logged while serving a request carries the trace id that request answered with", async () => {
  const lines: string[] = [];
  const log = createLogger({
    component: "test",
    sink: (line) => lines.push(line),
    context: () => ({ traceId: currentTraceId() }),
  });
  const app = new Hono();
  app.use("*", traceRequests());
  app.get("/work", (c) => {
    log.info("working");
    return c.json({ ok: true });
  });
  log.info("booting");

  const response = await app.request("/work");

  const [booting, working] = lines.map((line) => JSON.parse(line) as { traceId?: string });
  expect(booting?.traceId).toBeUndefined();
  expect(working?.traceId).toBe(response.headers.get("x-trace-id") ?? "missing");
});
