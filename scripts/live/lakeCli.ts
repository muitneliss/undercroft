/**
 * Reading the lake through the Undercroft CLI's read commands, never its database.
 *
 * `lake records` and `runs list` are both `read` in `undercroft describe`. Each call runs in
 * agent mode and answers one JSON envelope; the {@link Cli} handed in runs the real binary with
 * the developer's own signed-in profile, and the offline suite hands in recorded envelopes.
 */

import { parseLossless } from "@undercroft/core";
import { arrayAt, objectAt, parse, textAt } from "./json.ts";

export interface Cli {
  /** Run `undercroft <args> --agent` and return its stdout. */
  run: (args: readonly string[]) => Promise<string>;
}

/**
 * One lake row: its key, its payload, and whether the lake marks it deleted at source.
 *
 * The payload is read with `lossless-json`, so a number keeps the digits the source sent: a
 * Xero amount stays a string of digits and never passes through a float.
 */
export interface LakeRow {
  readonly sourceRecordId: string;
  readonly payload: unknown;
  readonly deletedAt: string | null;
}

/** The `data` of one envelope, or the CLI's own error. */
async function agentData(cli: Cli, args: readonly string[]): Promise<unknown> {
  const where = `undercroft ${args.slice(0, 2).join(" ")}`;
  const envelope = objectAt(parse(await cli.run(args), where), where);
  if (envelope.ok !== true) {
    throw new Error(`${where} failed: ${JSON.stringify(envelope.error ?? null)}`);
  }
  return envelope.data;
}

function payloadOf(raw: unknown): unknown {
  if (typeof raw !== "string") {
    return raw;
  }
  try {
    return parseLossless(raw);
  } catch (error) {
    throw new Error("lake payload: the payload is not JSON", { cause: error });
  }
}

/** Every row of one entity of one source, paged until the CLI's cursor runs out. */
export async function lakeRows(
  cli: Cli,
  tenant: string,
  entity: string,
  source = "hubspot",
): Promise<LakeRow[]> {
  const rows: LakeRow[] = [];
  const base = ["lake", "records", "--tenant-id", tenant, "--source", source];
  let cursor: string | null = null;
  do {
    const args = [...base, "--entity", entity, "--limit", "50"];
    const page = objectAt(
      await agentData(cli, cursor === null ? args : [...args, "--cursor", cursor]),
      "lake records",
    );
    for (const [index, item] of arrayAt(page.items, "lake records items").entries()) {
      const row = objectAt(item, `lake records #${index}`);
      rows.push({
        sourceRecordId: textAt(row.sourceRecordId, `lake records #${index}.sourceRecordId`),
        payload: payloadOf(row.payload),
        deletedAt: typeof row.deletedAt === "string" ? row.deletedAt : null,
      });
    }
    const { nextCursor } = page;
    cursor = typeof nextCursor === "string" && nextCursor !== "" ? nextCursor : null;
  } while (cursor !== null);
  return rows;
}

/** When the newest ingest run of one source started, or null if there has been none. */
export async function lastRunStart(
  cli: Cli,
  tenant: string,
  source = "hubspot",
): Promise<string | null> {
  const data = await agentData(cli, ["runs", "list", "--tenant-id", tenant, "--limit", "50"]);
  const items = Array.isArray(data) ? data : arrayAt(objectAt(data, "runs list").items, "runs");
  for (const item of items) {
    const run = objectAt(item, "runs list item");
    if (run.source === source && run.kind === "ingest") {
      return textAt(run.startedAt, "runs list startedAt");
    }
  }
  return null;
}
