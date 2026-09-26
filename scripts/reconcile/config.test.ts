/**
 * The live configuration's guards: the committed example parses, and a run is refused before it
 * starts when its evidence would land inside the repository. Reads files; writes none.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { loadConfig, parseConfig } from "./config.ts";

const HERE = import.meta.dirname;
const REPO = resolve(HERE, "..", "..");
const EXAMPLE = join(HERE, "reconcile.config.example.json");
const REAL_ADDRESS = /@(?!example\.test)[a-z0-9.-]+\.[a-z]{2,}/iu;

describe("CT-CFG the live configuration", () => {
  it("CT-CFG-001 the committed example parses, and carries placeholders only", () => {
    const text = readFileSync(EXAMPLE, "utf8");
    const config = parseConfig(JSON.parse(text));
    expect(config.clients.map((client) => client.label)).toEqual(["CASE-00"]);
    expect(REAL_ADDRESS.test(text)).toBe(false);
  });

  it("CT-CFG-002 an outDir inside the repository is refused before anything runs", () => {
    expect(() => loadConfig(EXAMPLE, REPO)).not.toThrow();
    // The same example, judged against a "repository" that contains its outDir.
    expect(() => loadConfig(EXAMPLE, "/path")).toThrow("inside the repository");
  });

  it("CT-CFG-003 a client listed twice is refused", () => {
    const body = JSON.parse(readFileSync(EXAMPLE, "utf8"));
    body.clients = [...body.clients, ...body.clients];
    expect(() => parseConfig(body)).toThrow("appears twice");
  });
});
