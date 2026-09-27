/**
 * HubSpot → lake, one test per record, against a real portal and a real tenant.
 *
 *   UNDERCROFT_LIVE=1 bun test ./scripts/live/hubspot.live.ts
 *
 * Every record HubSpot holds live becomes one test that passes only if the lake has it at the
 * same version with the same property values; every deal becomes one test of its company links;
 * every lake record HubSpot no longer holds becomes one test that the lake marks it deleted at
 * source. The `.live.ts` name is outside `bun test`'s default pattern, so neither `bun run test`
 * nor CI ever collects this file; see `README.md` beside it.
 *
 * This file is the composition root: it reads the local configuration, builds the real seams
 * (`fetch` to HubSpot with the token added, the Undercroft CLI in agent mode), reads both sides,
 * and only then declares the tests.
 */

import { describe, expect, test as it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import process from "node:process";
import { compare, compareLinks, type Verdict } from "./compare.ts";
import {
  batchRead,
  type CrmObject,
  dealCompanies,
  type Http,
  type HttpRequest,
  type HttpResponse,
  listIds,
  OBJECTS,
  readOnly,
} from "./hubspotApi.ts";
import { type CrmRecord, crmRecord, objectAt, textAt } from "./json.ts";
import { type Cli, type LakeRow, lakeRows, lastRunStart } from "./lakeCli.ts";

const REPO = join(import.meta.dirname, "..", "..");
const HUBSPOT = "https://api.hubapi.com";

interface Config {
  readonly tenant: string;
  /** The CLI's argv, e.g. `["undercroft"]` or `["npx", "-y", "--package=<tgz>", "undercroft"]`. */
  readonly cli: readonly string[];
  /** A file holding the HubSpot private-app token, read-only scopes only. */
  readonly tokenFile: string;
  readonly requestsPerMinute: number;
}

function repoPath(path: string): string {
  return isAbsolute(path) ? path : join(REPO, path);
}

function loadConfig(): Config {
  const path = repoPath(process.env.UNDERCROFT_LIVE_CONFIG ?? "fixtures/live/hubspot.json");
  if (!existsSync(path)) {
    throw new Error(`no live configuration at ${path}; see scripts/live/README.md`);
  }
  const raw = objectAt(JSON.parse(readFileSync(path, "utf8")), path);
  const cli = Array.isArray(raw.cli) ? raw.cli.map((part) => textAt(part, `${path} cli`)) : [];
  const rate = typeof raw.requestsPerMinute === "number" ? raw.requestsPerMinute : 80;
  return {
    tenant: textAt(raw.tenant, `${path} tenant`),
    cli: cli.length === 0 ? ["undercroft"] : cli,
    tokenFile: textAt(raw.tokenFile, `${path} tokenFile`),
    requestsPerMinute: rate,
  };
}

/**
 * HubSpot over Bun's own `fetch`: the token added here, one request at a time under the rate
 * given.
 *
 * `Bun.fetch`, not the global: `bunfig.toml` preloads happy-dom for every `bun test` process,
 * and happy-dom's `fetch` is a browser's -- it refuses a cross-origin read with "Cross-Origin
 * Request Blocked" before any request leaves.
 */
function hubspotHttp(token: string, requestsPerMinute: number): Http {
  const spacing = 60_000 / requestsPerMinute;
  let next = 0;
  async function send(request: HttpRequest, attempt = 0): Promise<HttpResponse> {
    const wait = next - Date.now();
    next = Math.max(next, Date.now()) + spacing;
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    const response = await Bun.fetch(`${HUBSPOT}${request.path}`, {
      method: request.method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(request.body === undefined ? {} : { body: request.body }),
    });
    const text = await response.text();
    if (response.status === 429 && attempt < 5) {
      const seconds = Number.parseInt(response.headers.get("retry-after") ?? "10", 10);
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      return send(request, attempt + 1);
    }
    return { status: response.status, text };
  }
  return { send: (request) => send(request) };
}

/** The Undercroft CLI in agent mode, with the developer's own signed-in profile. */
function undercroftCli(argv: readonly string[]): Cli {
  return {
    async run(args: readonly string[]): Promise<string> {
      const child = Bun.spawn([...argv, ...args, "--agent"], { stdout: "pipe", stderr: "pipe" });
      const stdout = await new Response(child.stdout).text();
      await child.exited;
      return stdout;
    },
  };
}

interface Side {
  readonly lake: Map<string, { record: CrmRecord; deletedAt: string | null }>;
  readonly live: readonly string[];
  readonly source: Map<string, CrmRecord>;
  readonly gone: ReadonlySet<string>;
}

async function readObject(http: Http, rows: readonly LakeRow[], object: CrmObject): Promise<Side> {
  const lake = new Map(
    rows.map((row) => [
      row.sourceRecordId,
      { record: crmRecord(row.payload, `lake ${object}`), deletedAt: row.deletedAt },
    ]),
  );
  const names = new Set<string>();
  for (const { record } of lake.values()) {
    for (const name of Object.keys(record.properties)) {
      names.add(name);
    }
  }
  const live = await listIds(http, object);
  const { records, gone } = await batchRead(http, object, live, [...names].sort());
  return { lake, live, source: records, gone };
}

function lakeLinks(rows: readonly LakeRow[]): Map<string, Set<string>> {
  const links = new Map<string, Set<string>>();
  for (const row of rows) {
    const payload = objectAt(row.payload, "lake association");
    const to = Array.isArray(payload.to) ? payload.to : [];
    links.set(
      row.sourceRecordId,
      new Set(to.map((edge) => String(objectAt(edge, "lake association to").toObjectId))),
    );
  }
  return links;
}

function says(verdict: Verdict): string {
  return verdict.kind === "different"
    ? `different at the same version: ${verdict.properties.join(", ")}`
    : verdict.kind;
}

function declareObject(object: CrmObject, side: Side, lastRun: string | null): void {
  describe(`HubSpot ${object} → lake`, () => {
    for (const id of side.live) {
      const source = side.source.get(id);
      if (source === undefined) {
        // biome-ignore lint/suspicious/noSkippedTests: reported as skipped on purpose -- HubSpot removed it mid-read.
        it.skip(`${object} ${id}: removed from HubSpot between its list and its read`, () => {
          // Nothing to compare: HubSpot answered "not found" for a record it had just listed.
        });
        continue;
      }
      const verdict = compare(source, side.lake.get(id)?.record, lastRun);
      if (verdict.kind === "pending") {
        // biome-ignore lint/suspicious/noSkippedTests: reported as skipped on purpose -- the next run reads it.
        it.skip(`${object} ${id}: changed in HubSpot after the last run began`, () => {
          // The next run reads it; this run could not have.
        });
        continue;
      }
      it(`${object} ${id}: in the lake at the same version with the same values`, () => {
        expect(says(verdict)).toBe("same");
      });
    }
  });
  describe(`lake ${object} → HubSpot`, () => {
    const live = new Set(side.live);
    for (const [id, { deletedAt }] of side.lake) {
      if (!(live.has(id) || side.gone.has(id))) {
        it(`${object} ${id}: gone from HubSpot, so the lake marks it deleted at source`, () => {
          expect(deletedAt).not.toBeNull();
        });
      }
    }
  });
}

if (process.env.UNDERCROFT_LIVE === "1") {
  const config = loadConfig();
  const http = readOnly(
    hubspotHttp(readFileSync(repoPath(config.tokenFile), "utf8").trim(), config.requestsPerMinute),
  );
  const cli = undercroftCli(config.cli);
  const runBefore = await lastRunStart(cli, config.tenant);
  const lake = await Promise.all(
    [...OBJECTS, "associations"].map((entity) => lakeRows(cli, config.tenant, entity)),
  );
  const sides = new Map<CrmObject, Side>();
  for (const [index, object] of OBJECTS.entries()) {
    sides.set(object, await readObject(http, lake[index] ?? [], object));
  }
  const deals = sides.get("deals")?.live ?? [];
  const sourceLinks = await dealCompanies(http, deals);
  const linksInLake = lakeLinks(lake[OBJECTS.length] ?? []);
  // A run that began while either side was being read makes the two snapshots disagree for
  // reasons that are not the lake's; refuse the comparison rather than report them.
  if ((await lastRunStart(cli, config.tenant)) !== runBefore) {
    throw new Error("a HubSpot run began while this check was reading; run it again");
  }

  for (const [object, side] of sides) {
    declareObject(object, side, runBefore);
  }
  describe("HubSpot deal → company links → lake", () => {
    for (const id of deals) {
      it(`deal ${id}: the lake links it to the same companies`, () => {
        const inLake = linksInLake.get(id) ?? new Set<string>();
        expect(compareLinks(sourceLinks.get(id) ?? new Set<string>(), inLake)).toEqual({
          missing: [],
          extra: [],
        });
      });
    }
  });
} else {
  // biome-ignore lint/suspicious/noSkippedTests: off unless asked for; the skip is the visible reason.
  it.skip("HubSpot → lake: set UNDERCROFT_LIVE=1 and fixtures/live/hubspot.json", () => {
    // Off unless asked for: it reads a real portal and a real tenant.
  });
}
