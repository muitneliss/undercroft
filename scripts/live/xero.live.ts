/**
 * Xero → lake, one test per record, against a real Xero organisation's exports and a real
 * tenant.
 *
 *   UNDERCROFT_LIVE=1 bun test ./scripts/live/xero.live.ts
 *
 * The Xero side is the files Xero's web app exports -- the invoice export (Sales invoices,
 * Bills) and the contacts export -- because those are what an owner can take without an app of
 * their own. Every exported document becomes one test that passes only if the lake holds it
 * with the same header and the same lines; every exported contact, one that passes only if the
 * lake holds it with the same details. Every live lake document or contact the export does not
 * list becomes one test that fails. The `.live.ts` name keeps this file out of `bun run test`
 * and CI; see `README.md` beside it.
 *
 * This file is the composition root: it reads the local configuration, the exports and the
 * lake (through the Undercroft CLI in agent mode), and only then declares the tests.
 */

import { describe, expect, test as it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import process from "node:process";
import { objectAt, textAt } from "./json.ts";
import { type Cli, lakeRows, lastRunStart } from "./lakeCli.ts";
import { compareContact, compareDocument, matchDocuments, type Verdict } from "./xeroCompare.ts";
import {
  contactsExport,
  type ExportedContact,
  type ExportedDocument,
  invoiceExport,
  KINDS,
  type LedgerSide,
} from "./xeroExport.ts";
import { type LakeContact, type LakeDocument, lakeContact, lakeDocument } from "./xeroLake.ts";

const REPO = join(import.meta.dirname, "..", "..");
const XERO = "xero";
const ENTITIES = ["invoices", "credit_notes", "overpayments", "prepayments"] as const;
/** The export lists neither: they can only be checked from the lake's side. */
const NOT_EXPORTED = new Set(["DELETED", "VOIDED"]);

interface Config {
  readonly tenant: string;
  readonly cli: readonly string[];
  /** A folder holding the `.csv` files exported from Xero; every one in it is read. */
  readonly exports: string;
  /**
   * When the oldest of those files was exported, ISO-8601. A record Xero changed after that
   * cannot agree with the export, and is reported skipped rather than failed.
   */
  readonly exportedAt: string;
}

function repoPath(path: string): string {
  return isAbsolute(path) ? path : join(REPO, path);
}

function loadConfig(): Config {
  const path = repoPath(process.env.UNDERCROFT_LIVE_CONFIG ?? "fixtures/live/xero.json");
  if (!existsSync(path)) {
    throw new Error(`no live configuration at ${path}; see scripts/live/README.md`);
  }
  const raw = objectAt(JSON.parse(readFileSync(path, "utf8")), path);
  const cli = Array.isArray(raw.cli) ? raw.cli.map((part) => textAt(part, `${path} cli`)) : [];
  const exportedAt = textAt(raw.exportedAt, `${path} exportedAt`);
  if (Number.isNaN(Date.parse(exportedAt))) {
    throw new Error(`${path} exportedAt: expected an ISO-8601 instant`);
  }
  return {
    tenant: textAt(raw.tenant, `${path} tenant`),
    cli: cli.length === 0 ? ["undercroft"] : cli,
    exports: textAt(raw.exports, `${path} exports`),
    exportedAt,
  };
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

interface Exports {
  readonly documents: readonly ExportedDocument[];
  /** Documents two export files both hold, with different lines: one of them is wrong. */
  readonly conflicts: readonly ExportedDocument[];
  readonly contacts: readonly ExportedContact[];
}

/**
 * Every export in the folder, each told apart by its header. Exports taken over overlapping
 * date ranges hold the documents at the overlap twice; each is kept once, and a document two
 * files disagree about is kept aside as a conflict.
 */
function readExports(folder: string): Exports {
  const documents = new Map<string, ExportedDocument>();
  const conflicts: ExportedDocument[] = [];
  const contacts = new Map<string, ExportedContact>();
  const files = readdirSync(folder)
    .filter((name) => name.toLowerCase().endsWith(".csv"))
    .sort();
  for (const name of files) {
    const text = readFileSync(join(folder, name), "utf8");
    const header = text.slice(0, text.indexOf("\n"));
    if (header.includes("*ContactName")) {
      for (const contact of contactsExport(text, name)) {
        contacts.set(contact.name, contacts.get(contact.name) ?? contact);
      }
      continue;
    }
    for (const document of invoiceExport(text, name)) {
      const key = [document.kind, document.number, document.contact, document.date]
        .concat(document.total)
        .join("\u0000");
      const seen = documents.get(key);
      if (seen === undefined) {
        documents.set(key, document);
      } else if (seen.lines.length !== document.lines.length) {
        conflicts.push(document);
      }
    }
  }
  return { documents: [...documents.values()], conflicts, contacts: [...contacts.values()] };
}

function says(verdict: Verdict): string {
  return verdict.kind === "different" ? `different: ${verdict.fields.join(", ")}` : verdict.kind;
}

function changedAfter(updatedAt: string | null, exportedAt: string): boolean {
  return updatedAt !== null && Date.parse(updatedAt) >= Date.parse(exportedAt);
}

function declareDocuments(
  exports: Exports,
  lake: readonly LakeDocument[],
  exportedAt: string,
): void {
  const sides = new Set<LedgerSide>(
    exports.documents.flatMap((document) => KINDS[document.kind]?.side ?? []),
  );
  const listed = lake.filter((document) => {
    const side = KINDS[document.kind]?.side;
    return side !== undefined && sides.has(side);
  });
  const live = listed.filter((document) => !NOT_EXPORTED.has(document.status));
  const { matched, onlyExport, onlyLake } = matchDocuments(exports.documents, live);

  describe("Xero export → lake", () => {
    for (const { source, lake: copies } of matched) {
      const verdict = compareDocument(source, copies);
      const ids = copies.map((copy) => copy.id).join(" + ");
      if (
        verdict.kind !== "same" &&
        copies.some((copy) => changedAfter(copy.updatedAt, exportedAt))
      ) {
        // biome-ignore lint/suspicious/noSkippedTests: reported as skipped on purpose -- the export predates the change.
        it.skip(`${source.kind} ${ids}: changed in Xero after the export`, () => {
          // The export cannot show a change made after it was taken.
        });
        continue;
      }
      it(`${source.kind} ${ids}: in the lake with the same header and lines`, () => {
        expect(says(verdict)).toBe("same");
      });
    }
    for (const source of onlyExport) {
      it(`${source.kind} at ${source.file} row ${source.row}: in the lake`, () => {
        expect("missing").toBe("same");
      });
    }
    for (const source of exports.conflicts) {
      it(`${source.kind} at ${source.file} row ${source.row}: the exports agree about it`, () => {
        expect("two exports hold it with different lines").toBe("one document");
      });
    }
  });

  describe("lake → Xero export", () => {
    for (const document of onlyLake) {
      if (changedAfter(document.updatedAt, exportedAt)) {
        // biome-ignore lint/suspicious/noSkippedTests: reported as skipped on purpose -- the export predates it.
        it.skip(`${document.kind} ${document.id}: changed in Xero after the export`, () => {
          // The export cannot list what Xero wrote after it was taken.
        });
        continue;
      }
      it(`${document.kind} ${document.id}: listed in the export`, () => {
        expect("only in the lake").toBe("in both");
      });
    }
    for (const document of listed.filter((d) => NOT_EXPORTED.has(d.status))) {
      // biome-ignore lint/suspicious/noSkippedTests: reported as skipped on purpose -- the export omits this status.
      it.skip(`${document.kind} ${document.id}: ${document.status}, which the export never lists`, () => {
        // Nothing to compare against: Xero's export leaves voided and deleted documents out.
      });
    }
  });
}

function declareContacts(
  exported: readonly ExportedContact[],
  lake: readonly LakeContact[],
  exportedAt: string,
): void {
  const byName = new Map(lake.map((contact) => [contact.name, contact]));
  const names = new Set(exported.map((contact) => contact.name));
  describe("Xero contacts export → lake", () => {
    for (const source of exported) {
      const copy = byName.get(source.name);
      if (copy === undefined) {
        it(`contact at ${source.file} row ${source.row}: in the lake`, () => {
          expect("missing").toBe("same");
        });
        continue;
      }
      const verdict = compareContact(source, copy);
      if (verdict.kind !== "same" && changedAfter(copy.updatedAt, exportedAt)) {
        // biome-ignore lint/suspicious/noSkippedTests: reported as skipped on purpose -- the export predates the change.
        it.skip(`contact ${copy.id}: changed in Xero after the export`, () => {
          // The export cannot show a change made after it was taken.
        });
        continue;
      }
      it(`contact ${copy.id}: in the lake with the same details`, () => {
        expect(says(verdict)).toBe("same");
      });
    }
  });
  describe("lake contacts → Xero contacts export", () => {
    for (const contact of lake.filter((c) => !names.has(c.name))) {
      it(`contact ${contact.id} (${contact.status}): listed in the export`, () => {
        expect(
          changedAfter(contact.updatedAt, exportedAt) ? "changed after" : "only in the lake",
        ).toBe("in both");
      });
    }
  });
}

if (process.env.UNDERCROFT_LIVE === "1") {
  const config = loadConfig();
  const exports = readExports(repoPath(config.exports));
  const cli = undercroftCli(config.cli);
  const runBefore = await lastRunStart(cli, config.tenant, XERO);
  const [contactRows, ...documentRows] = await Promise.all(
    ["contacts", ...ENTITIES].map((entity) => lakeRows(cli, config.tenant, entity, XERO)),
  );
  // A run that began while the lake was being read leaves a snapshot that is half one run and
  // half the next; refuse it rather than report what it shows.
  if ((await lastRunStart(cli, config.tenant, XERO)) !== runBefore) {
    throw new Error("a Xero run began while this check was reading; run it again");
  }
  const lake = ENTITIES.flatMap((entity, at) =>
    (documentRows[at] ?? []).flatMap((row) => lakeDocument(row.payload, entity) ?? []),
  );
  if (exports.documents.length > 0) {
    declareDocuments(exports, lake, config.exportedAt);
  }
  if (exports.contacts.length > 0) {
    declareContacts(
      exports.contacts,
      (contactRows ?? []).map((row) => lakeContact(row.payload)),
      config.exportedAt,
    );
  }
  if (exports.documents.length === 0 && exports.contacts.length === 0) {
    throw new Error(`no Xero export in ${config.exports}; see scripts/live/README.md`);
  }
} else {
  // biome-ignore lint/suspicious/noSkippedTests: off unless asked for; the skip is the visible reason.
  it.skip("Xero → lake: set UNDERCROFT_LIVE=1 and fixtures/live/xero.json", () => {
    // Off unless asked for: it reads a real organisation's exports and a real tenant.
  });
}
