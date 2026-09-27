/**
 * The offline half of the HubSpot → lake check: the readers and the comparison, driven by
 * in-memory seams that answer only what they were given and refuse everything else. No network,
 * no credential, no mock -- a request nobody recorded fails the test that made it.
 *
 * All ids and values are invented.
 */

import { describe, expect, test as it } from "bun:test";
import { compare, compareLinks } from "./compare.ts";
import {
  batchRead,
  dealCompanies,
  type Http,
  type HttpRequest,
  type HttpResponse,
  listIds,
  ReadOnlyRefusal,
  readOnly,
} from "./hubspotApi.ts";
import type { CrmRecord } from "./json.ts";
import { type Cli, lakeRows, lastRunStart } from "./lakeCli.ts";

function requestKey(request: HttpRequest): string {
  return `${request.method} ${request.path} ${request.body ?? ""}`;
}

/** HubSpot in memory: one recorded answer per method, path and body; anything else refused. */
function hubspotAnswering(answers: readonly (readonly [HttpRequest, number, unknown])[]): Http {
  const recorded = new Map<string, HttpResponse>(
    answers.map(([request, status, body]) => [
      requestKey(request),
      { status, text: JSON.stringify(body) },
    ]),
  );
  return {
    send(request: HttpRequest): Promise<HttpResponse> {
      const response = recorded.get(requestKey(request));
      return response === undefined
        ? Promise.reject(new Error(`nothing recorded for ${requestKey(request)}`))
        : Promise.resolve(response);
    },
  };
}

/** The CLI in memory: one recorded envelope per argument list; anything else refused. */
function cliAnswering(answers: readonly (readonly [readonly string[], unknown])[]): Cli {
  const recorded = new Map<string, string>(
    answers.map(([args, envelope]) => [args.join(" "), JSON.stringify(envelope)]),
  );
  return {
    run(args: readonly string[]): Promise<string> {
      const stdout = recorded.get(args.join(" "));
      return stdout === undefined
        ? Promise.reject(new Error(`nothing recorded for undercroft ${args.join(" ")}`))
        : Promise.resolve(stdout);
    },
  };
}

function record(id: string, updatedAt: string, properties: CrmRecord["properties"]): CrmRecord {
  return { id, updatedAt, archived: false, properties };
}

const LIST = "/crm/v3/objects/contacts?limit=100&archived=false";
const BATCH = "/crm/v3/objects/contacts/batch/read";

describe("readOnly", () => {
  it("refuses a POST that writes, before it reaches HubSpot", async () => {
    const create: HttpRequest = { method: "POST", path: "/crm/v3/objects/contacts", body: "{}" };
    const http = readOnly(hubspotAnswering([[create, 201, { id: "1" }]]));
    await expect(http.send(create)).rejects.toBeInstanceOf(ReadOnlyRefusal);
  });

  it("lets a batch read and a GET through", async () => {
    const read: HttpRequest = { method: "POST", path: BATCH, body: "{}" };
    const list: HttpRequest = { method: "GET", path: LIST };
    const http = readOnly(
      hubspotAnswering([
        [read, 200, { results: [] }],
        [list, 200, { results: [] }],
      ]),
    );
    expect((await http.send(read)).status).toBe(200);
    expect((await http.send(list)).status).toBe(200);
  });
});

describe("listIds", () => {
  it("follows HubSpot's cursor to the last page", async () => {
    const http = hubspotAnswering([
      [
        { method: "GET", path: LIST },
        200,
        { results: [{ id: "101" }, { id: "102" }], paging: { next: { after: "102" } } },
      ],
      [{ method: "GET", path: `${LIST}&after=102` }, 200, { results: [{ id: "103" }] }],
    ]);
    expect(await listIds(http, "contacts")).toEqual(["101", "102", "103"]);
  });
});

describe("batchRead", () => {
  const request: HttpRequest = {
    method: "POST",
    path: BATCH,
    body: JSON.stringify({ inputs: [{ id: "101" }, { id: "102" }], properties: ["email"] }),
  };
  const found = {
    id: "101",
    updatedAt: "2026-01-02T03:04:05.000Z",
    archived: false,
    properties: { email: "a@example.test" },
  };

  it("keeps an id HubSpot no longer finds apart from the records", async () => {
    const http = hubspotAnswering([
      [
        request,
        207,
        { results: [found], errors: [{ category: "OBJECT_NOT_FOUND", context: { ids: ["102"] } }] },
      ],
    ]);
    const { records, gone } = await batchRead(http, "contacts", ["101", "102"], ["email"]);
    expect([...records.keys()]).toEqual(["101"]);
    expect([...gone]).toEqual(["102"]);
  });

  it("fails on any other error, rather than reading it as a missing record", async () => {
    const http = hubspotAnswering([
      [request, 207, { results: [found], errors: [{ category: "VALIDATION_ERROR" }] }],
    ]);
    await expect(batchRead(http, "contacts", ["101", "102"], ["email"])).rejects.toThrow(
      "VALIDATION_ERROR",
    );
  });
});

describe("dealCompanies", () => {
  it("gives every deal asked about a set, empty when HubSpot links it to nothing", async () => {
    const http = hubspotAnswering([
      [
        {
          method: "POST",
          path: "/crm/v4/associations/deals/companies/batch/read",
          body: JSON.stringify({ inputs: [{ id: "7" }, { id: "8" }] }),
        },
        207,
        { results: [{ from: { id: "7" }, to: [{ toObjectId: 70 }, { toObjectId: 71 }] }] },
      ],
    ]);
    const links = await dealCompanies(http, ["7", "8"]);
    expect([...(links.get("7") ?? [])]).toEqual(["70", "71"]);
    expect([...(links.get("8") ?? [])]).toEqual([]);
  });
});

describe("the lake through the CLI", () => {
  const base = ["lake", "records", "--tenant-id", "CASE-0042", "--source", "hubspot"];
  const page = [...base, "--entity", "deals", "--limit", "50"];

  it("pages lake records to the end and reads a payload sent as text", async () => {
    const cli = cliAnswering([
      [
        page,
        {
          ok: true,
          data: { items: [{ sourceRecordId: "7", payload: '{"id":"7"}' }], nextCursor: "c1" },
        },
      ],
      [
        [...page, "--cursor", "c1"],
        {
          ok: true,
          data: { items: [{ sourceRecordId: "8", payload: { id: "8" }, deletedAt: "2026-01-01" }] },
        },
      ],
    ]);
    const rows = await lakeRows(cli, "CASE-0042", "deals");
    expect(rows.map((row) => row.sourceRecordId)).toEqual(["7", "8"]);
    expect(rows[0]?.payload).toEqual({ id: "7" });
    expect(rows[1]?.deletedAt).toBe("2026-01-01");
  });

  it("fails when the CLI answers an error instead of data", async () => {
    const cli = cliAnswering([[page, { ok: false, error: { code: "UNAUTHORIZED" } }]]);
    await expect(lakeRows(cli, "CASE-0042", "deals")).rejects.toThrow("UNAUTHORIZED");
  });

  it("finds the newest HubSpot ingest run and skips every other kind", async () => {
    const runs = [
      { source: "xero", kind: "ingest", startedAt: "2026-01-03T00:00:00Z" },
      { source: "hubspot", kind: "transform", startedAt: "2026-01-02T12:00:00Z" },
      { source: "hubspot", kind: "ingest", startedAt: "2026-01-02T00:00:00Z" },
    ];
    const cli = cliAnswering([
      [
        ["runs", "list", "--tenant-id", "CASE-0042", "--limit", "50"],
        { ok: true, data: { items: runs } },
      ],
    ]);
    expect(await lastRunStart(cli, "CASE-0042")).toBe("2026-01-02T00:00:00Z");
  });
});

describe("compare", () => {
  const at = "2026-01-02T00:00:00.000Z";
  const source = record("101", at, { email: "a@example.test", phone: null });

  it("passes the same version with the same values", () => {
    const lake = record("101", at, { email: "a@example.test", phone: null });
    expect(compare(source, lake, null)).toEqual({ kind: "same" });
  });

  it("names a record HubSpot has and the lake does not", () => {
    expect(compare(source, undefined, null)).toEqual({ kind: "missing" });
  });

  it("names each property whose value differs, and one only one side has", () => {
    const lake = record("101", at, { email: "b@example.test" });
    expect(compare(source, lake, null)).toEqual({
      kind: "different",
      properties: ["email", "phone"],
    });
  });

  it("tells null apart from a value", () => {
    const lake = record("101", at, { email: "a@example.test", phone: "" });
    expect(compare(source, lake, null)).toEqual({ kind: "different", properties: ["phone"] });
  });

  it("calls a HubSpot change after the last run started pending, and one before it stale", () => {
    const newer = record("101", "2026-01-03T00:00:00.000Z", {});
    const lake = record("101", at, {});
    expect(compare(newer, lake, "2026-01-02T12:00:00.000Z")).toEqual({ kind: "pending" });
    expect(compare(newer, lake, "2026-01-04T00:00:00.000Z")).toEqual({ kind: "stale" });
  });

  it("calls a lake version newer than HubSpot's ahead", () => {
    const lake = record("101", "2026-01-03T00:00:00.000Z", {});
    expect(compare(source, lake, null)).toEqual({ kind: "ahead" });
  });
});

describe("compareLinks", () => {
  it("names the links each side lacks, and nothing when they agree", () => {
    expect(compareLinks(new Set(["70", "71"]), new Set(["71", "72"]))).toEqual({
      missing: ["70"],
      extra: ["72"],
    });
    expect(compareLinks(new Set(["70"]), new Set(["70"]))).toEqual({ missing: [], extra: [] });
  });
});
