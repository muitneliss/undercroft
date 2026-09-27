/**
 * The verdicts of the Drive reconciliation, one per record: pure functions over what the reads
 * returned, so every rule here is pinned offline (`drive.test.ts`).
 *
 * SOURCE -> LAKE, AND THE SOURCE IS THE TRUTH. Every file the connection's picks hold in Drive,
 * of a type the connection takes, must be in the lake once, with Drive's own fields and bytes.
 * Every lake record the picked tree no longer holds must be explained by the lake itself.
 *
 * ABSENCE IS NOT ALWAYS A DEFECT. A file created or modified after the start of the last
 * completed `files` run is `NOT_YET_SYNCED`. An older file the lake lacks is `BLOCKED`, never
 * `MISSING`: Undercroft keeps no record of which folders a past run read, and a file moved into a
 * picked folder keeps its `modifiedTime`, so "it was in scope when the run read" has no evidence.
 * `MISSING` stands only where the lake's own contract gives the evidence -- a `files` record
 * without its document, which ADR 0035 says cannot be released.
 */

import type { DriveFile } from "./driveApi.ts";
import { exportOf, landedTypeOf, overCeiling } from "./driveRules.ts";
import type { LakeDocument, LakeFile } from "./undercroftCli.ts";

export type Verdict =
  | "MATCH"
  | "MISSING"
  | "CONTENT_MISMATCH"
  | "OUT_OF_SCOPE"
  | "NOT_YET_SYNCED"
  | "EXCLUDED_BY_RULE"
  | "BLOCKED";

/** The verdicts that fail a test: the lake disagrees with Drive for no declared reason. */
export const DEFECTS: ReadonlySet<Verdict> = new Set<Verdict>(["MISSING", "CONTENT_MISMATCH"]);

/** One record's result. `fields` names what differs -- never a value, which can be a name. */
export interface Judged {
  readonly id: string;
  readonly verdict: Verdict;
  readonly reason: string;
  readonly fields: readonly string[];
}

/** Every refusal the connection's `files` runs recorded, from the whole run ledger. */
export interface Ledger {
  readonly reasons: ReadonlyMap<string, readonly string[]>;
  /** The ledger was walked to its end and no run's refusal list was cut short. */
  readonly complete: boolean;
  /** Runs that kept an account of their files; a run the worker lost keeps none. */
  readonly accounted: ReadonlySet<string>;
}

/** What one connection's judgement needs: the tree now, the lake, and the last completed run. */
export interface Evidence {
  /** Start of the last completed `files` run that read something; null while none has. */
  readonly mark: number | null;
  readonly folders: ReadonlySet<string>;
  readonly files: ReadonlyMap<string, LakeFile>;
  readonly documents: ReadonlyMap<string, LakeDocument>;
  readonly ledger: Ledger | null;
}

const CEILING = /ceiling/u;

function judged(id: string, verdict: Verdict, reason = "", fields: string[] = []): Judged {
  return { id, verdict, reason, fields };
}

/** Created and last modified before the mark; an unknown mark is never "before". */
export function settledBefore(file: DriveFile, mark: number | null): boolean {
  const times = [file.createdTime, file.modifiedTime].filter((at) => at.length > 0);
  return mark !== null && times.length > 0 && times.every((at) => Date.parse(at) < mark);
}

/**
 * The record's fields against Drive's. Drive gives a Google-native file no size and no md5; the
 * connector writes those as "0" and "", a spelling of "none" compared as such.
 */
function parents(values: readonly string[]): string {
  return [...values].sort().join(",");
}

export function fieldDiffs(file: DriveFile, record: LakeFile): string[] {
  return [
    ["mimeType", file.mimeType === record.mimeType],
    ["size", (file.size ?? "0") === record.size],
    ["md5Checksum", (file.md5 ?? "") === record.md5],
    ["modifiedTime", Date.parse(file.modifiedTime) === Date.parse(record.modifiedTime)],
    ["parents", parents(file.parents) === parents(record.parents)],
  ]
    .filter(([, equal]) => equal === false)
    .map(([field]) => String(field));
}

/** A file over the ceiling lands no bytes; the promise is a refusal that says why. */
function refusal(file: DriveFile, record: LakeFile, ledger: Ledger | null): Judged | null {
  if ((ledger?.reasons.get(file.id) ?? []).some((reason) => CEILING.test(reason))) {
    return null;
  }
  if (ledger === null || !ledger.complete) {
    return judged(file.id, "BLOCKED", "over the ceiling; the run ledger could not be read whole");
  }
  if (!ledger.accounted.has(record.runId)) {
    return judged(
      file.id,
      "BLOCKED",
      "over the ceiling, no refusal; the run that landed the record kept no account of its files",
    );
  }
  return judged(file.id, "MISSING", "over the ceiling, and no run refused it with the reason", [
    "refusal",
  ]);
}

/** The document the lake must hold beside a record: present, of the landed type, whole. */
function documentCheck(file: DriveFile, record: LakeFile, evidence: Evidence): Judged | null {
  const native = exportOf(file.mimeType) !== null;
  if (!native && overCeiling(file.size)) {
    return refusal(file, record, evidence.ledger);
  }
  const document = evidence.documents.get(file.id);
  if (document === undefined) {
    return judged(file.id, "MISSING", "a files record without its document (ADR 0035)", [
      "document",
    ]);
  }
  if (document.deletedAt !== null) {
    return judged(
      file.id,
      "BLOCKED",
      "document marked deleted while the file is in the picked tree: the last run did not list it, or it moved in after",
    );
  }
  const fields: string[] = [];
  if (document.contentType !== landedTypeOf(file.mimeType, file.extension)) {
    fields.push("contentType");
  }
  if (native ? document.bytes <= 0 : String(document.bytes) !== file.size) {
    fields.push("bytes");
  }
  return fields.length === 0
    ? null
    : judged(file.id, "CONTENT_MISMATCH", "the stored document is not the file", fields);
}

/** One file of the picked tree, of a type the connection takes: in the lake, equal, whole. */
export function judgeFile(file: DriveFile, evidence: Evidence): Judged {
  const settled = settledBefore(file, evidence.mark);
  const record = evidence.files.get(file.id);
  if (record === undefined) {
    return settled
      ? judged(
          file.id,
          "BLOCKED",
          "absent; Undercroft records no scope per run and a moved-in file keeps its modifiedTime, so no evidence it was in scope when the last run read",
        )
      : judged(file.id, "NOT_YET_SYNCED", "created or modified after the last completed run");
  }
  const diffs = fieldDiffs(file, record);
  const document = documentCheck(file, record, evidence);
  if (diffs.length === 0 && document === null) {
    return judged(file.id, "MATCH");
  }
  const fields = [...diffs, ...(document?.fields ?? [])];
  if (!settled) {
    return judged(file.id, "NOT_YET_SYNCED", "changed after the last completed run", fields);
  }
  // A move without an edit is the rule, so the document decides; with no document issue either,
  // the move alone is reported apart.
  const movedOnly = diffs.every((field) => field === "parents");
  if (movedOnly && document !== null) {
    return document;
  }
  if (movedOnly) {
    return judged(
      file.id,
      "EXCLUDED_BY_RULE",
      "moved without an edit: a held file is re-read only when modifiedTime moves (ADR 0033)",
      fields,
    );
  }
  return judged(file.id, "CONTENT_MISMATCH", "the record's fields are not Drive's", fields);
}

/**
 * A lake record (or live document) the picked tree does not hold, judged by what the lake says
 * and where the file is in Drive now (`now`, null for a 404). Drive keeps no history of moves,
 * so "outside the tree now" alone is never a defect.
 */
export function judgeLakeOnly(id: string, now: DriveFile | null, evidence: Evidence): Judged {
  const document = evidence.documents.get(id);
  if (document !== undefined && document.deletedAt !== null) {
    return judged(
      id,
      "OUT_OF_SCOPE",
      "retained by policy: document marked deleted, the record is kept (ADR 0035)",
    );
  }
  if (now === null) {
    return judged(id, "BLOCKED", "Drive answers 404 (deleted or unshared) and gives no time");
  }
  const { mark } = evidence;
  const changed = [now.modifiedTime, now.trashedTime ?? ""].filter((at) => at.length > 0);
  if (mark === null || changed.some((at) => Date.parse(at) >= mark)) {
    return judged(id, "NOT_YET_SYNCED", "changed or trashed after the last completed run");
  }
  const inTree = now.parents.some((parent) => evidence.folders.has(parent));
  if (now.trashed && now.trashedTime !== null && inTree && document !== undefined) {
    return judged(
      id,
      "CONTENT_MISMATCH",
      "trashed in the picked tree before the last completed run, document not marked deleted",
      ["deletedAt"],
    );
  }
  return judged(
    id,
    "BLOCKED",
    document === undefined
      ? "only in the lake, no document to carry a deletion mark; Drive keeps no history of moves"
      : "only in the lake, document not marked deleted; Drive keeps no history of moves",
  );
}

/** At most eight of the largest band: each is up to 25 MiB of download. */
function cap(stratum: string, n: number): number {
  return stratum.endsWith(">=10MB") ? Math.min(n, 8) : n;
}

const BANDS: readonly (readonly [string, number])[] = [
  ["<100KB", 100 * 1024],
  ["100KB-1MB", 1024 * 1024],
  ["1-10MB", 10 * 1024 * 1024],
  [">=10MB", Number.POSITIVE_INFINITY],
];

/**
 * A stratified sample of files to download and hash: only files already judged MATCH, stored as
 * themselves (not exports, which are not byte-stable) with a Drive md5. Strata are the landed
 * type and a size band, each asked at least three times (at most eight of the largest band); the
 * rest of the budget goes by stratum size. The order inside a stratum is a hash of the id, so
 * the same lake gives the same sample.
 */
export function hashSample(
  files: readonly DriveFile[],
  verdicts: ReadonlyMap<string, Judged>,
  evidence: Evidence,
  size: number,
): DriveFile[] {
  const strata = new Map<string, { order: string; file: DriveFile }[]>();
  for (const file of files) {
    const document = evidence.documents.get(file.id);
    if (
      verdicts.get(file.id)?.verdict !== "MATCH" ||
      file.md5 === null ||
      exportOf(file.mimeType) !== null ||
      overCeiling(file.size) ||
      document === undefined
    ) {
      continue;
    }
    const band = BANDS.find(([, below]) => document.bytes < below)?.[0] ?? ">=10MB";
    const stratum = `${landedTypeOf(file.mimeType, file.extension)}|${band}`;
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(`drive-hash-sample:${file.id}`);
    strata.set(stratum, [...(strata.get(stratum) ?? []), { order: hasher.digest("hex"), file }]);
  }
  const pool = [...strata.values()].reduce((sum, members) => sum + members.length, 0);
  const floors = [...strata].map(([stratum, members]) => Math.min(3, cap(stratum, members.length)));
  const left = Math.max(0, size - floors.reduce((sum, n) => sum + n, 0));
  return [...strata].flatMap(([stratum, members], index) => {
    const share = Math.floor((left * members.length) / Math.max(1, pool));
    const take = Math.min(cap(stratum, members.length), (floors[index] ?? 0) + share);
    return members
      .sort((a, b) => a.order.localeCompare(b.order))
      .slice(0, take)
      .map((member) => member.file);
  });
}

/** A sampled file: md5 of the download must be Drive's, sha256 must be the lake document's. */
export function judgeHash(
  file: DriveFile,
  document: LakeDocument,
  digest: { md5: string; sha256: string } | null,
): Judged {
  if (digest === null) {
    return judged(file.id, "BLOCKED", "Drive answers 404 now");
  }
  if (digest.md5 !== file.md5) {
    return judged(file.id, "BLOCKED", "the download is not Drive's md5: changed during the read");
  }
  return digest.sha256 === document.sha256
    ? judged(file.id, "MATCH")
    : judged(file.id, "CONTENT_MISMATCH", "the lake's bytes are not Drive's", ["sha256"]);
}

/**
 * A defect found while a precondition failed is not a finding: the read it rests on was not
 * whole, or the state moved under it. It becomes BLOCKED with the reason it would have had.
 */
export function withPreconditions(records: readonly Judged[], unmet: readonly string[]): Judged[] {
  if (unmet.length === 0) {
    return [...records];
  }
  return records.map((record) =>
    DEFECTS.has(record.verdict)
      ? {
          ...record,
          verdict: "BLOCKED",
          reason: `${record.verdict} (${record.reason}) not decidable: ${unmet.join("; ")}`,
        }
      : record,
  );
}

export type Outcome = "PASS" | "FAIL" | "INCONCLUSIVE" | "NOT_RUN";

/** FAIL outranks everything; anything undecided makes the run INCONCLUSIVE, never PASS. */
export function outcomeOf(records: readonly Judged[]): Outcome {
  if (records.length === 0) {
    return "NOT_RUN";
  }
  if (records.some((record) => DEFECTS.has(record.verdict))) {
    return "FAIL";
  }
  return records.some(
    (record) => record.verdict === "BLOCKED" || record.verdict === "NOT_YET_SYNCED",
  )
    ? "INCONCLUSIVE"
    : "PASS";
}
