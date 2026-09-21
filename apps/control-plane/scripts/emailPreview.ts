/**
 * Render every email this platform sends, in both languages, to files you can open.
 *
 * An email is the one surface with no screen to check it on: nobody sees an invitation
 * before it is posted, and a run-failure notice is read once, by somebody already annoyed.
 * `bun run verify` proves the words resolve and the markup escapes; it cannot tell you the
 * schedule's rules are too heavy or the plate has fallen below the fold.
 *
 * So this renders the REAL composers -- `signInCodeMessage`, `invitationMessage` and the
 * three in `alerts.ts` -- rather than fixtures shaped like them. A preview built from its
 * own copy of the leaf is a preview of a message nobody sends, and it goes stale the first
 * time one is edited and the other is not.
 *
 * Output goes to `data/`, which is gitignored: these files carry invented values and are
 * regenerated in a second, so there is nothing to keep.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import type { EmailMessage, Locale } from "@undercroft/core";
import { signInCodeMessage } from "../src/handlers/auth.ts";
import {
  failedRunMessage,
  grantExpiringMessage,
  keyExpiringMessage,
} from "../src/services/alerts.ts";
import { invitationMessage } from "../src/services/people.ts";

const OUT_DIR = path.join(process.cwd(), "data", "email-preview");

/** Invented throughout, per `.claude/rules/pii.md`. A CASE-id is what a tenant is called. */
const TENANT = "CASE-0042";
const TO = "ada@example.test";
const PUBLIC_URL = "https://app.example.test";

function samples(locale: Locale): { name: string; message: EmailMessage }[] {
  const to = { email: TO, locale };
  return [
    { name: "sign-in-code", message: signInCodeMessage(TO, "418302", locale) },
    { name: "invitation", message: invitationMessage(TO, TENANT, PUBLIC_URL, locale) },
    {
      name: "run-failed",
      message: failedRunMessage(to, {
        tenantId: TENANT,
        source: "hubspot",
        verb: "sync",
        runId: "01J8Z4Q2X7",
        endedAt: "2026-09-21T14:32:00Z",
        error: 'connection refused: could not translate host name "api.hubapi.com"',
        publicUrl: PUBLIC_URL,
      }),
    },
    {
      name: "run-failed-no-reason",
      message: failedRunMessage(to, {
        tenantId: TENANT,
        source: "transform",
        verb: "build",
        runId: "01J8Z4Q2X8",
        // The absence case, which is the one worth looking at: a slip with nothing on it
        // would read as a slip somebody forgot to write.
        error: null,
        endedAt: "2026-09-21T02:05:00Z",
        publicUrl: PUBLIC_URL,
      }),
    },
    {
      name: "grant-expiring",
      message: grantExpiringMessage(to, {
        tenantId: TENANT,
        source: "xero",
        grantExpiresAt: "2026-09-28T09:00:00Z",
        publicUrl: PUBLIC_URL,
      }),
    },
    {
      name: "key-expiring",
      message: keyExpiringMessage(to, {
        tenantId: TENANT,
        label: "nightly-load",
        expiresAt: "2026-09-28T09:00:00Z",
        publicUrl: PUBLIC_URL,
      }),
    },
  ];
}

/** The index: every leaf side by side, at the width a phone actually gives them. */
function indexPage(names: readonly string[]): string {
  const cards = names
    .map(
      (name) =>
        `<figure><figcaption>${name}</figcaption><iframe src="./${name}.html" title="${name}"></iframe></figure>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Undercroft email preview</title><style>
    body{margin:0;background:#16150f;color:#efe9d9;font:13px/1.5 ui-monospace,Menlo,monospace;padding:24px}
    h1{font:700 13px/1 ui-sans-serif;letter-spacing:.15em;text-transform:uppercase;margin:0 0 24px}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:24px}
    figure{margin:0}
    figcaption{padding:0 0 8px;letter-spacing:.08em;text-transform:uppercase;color:#b9b19a}
    iframe{width:100%;height:760px;border:0;background:#efe9d9}
  </style></head><body><h1>Undercroft &mdash; posted leaves</h1><div class="grid">${cards}</div></body></html>`;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const written: string[] = [];

  for (const locale of ["vi", "en"] as const) {
    for (const { name, message } of samples(locale)) {
      const stem = `${name}.${locale}`;
      await writeFile(path.join(OUT_DIR, `${stem}.html`), message.html ?? "", "utf8");
      // The text branch beside it, because it is the message and not a fallback -- and
      // because reading them side by side is the cheapest way to notice one has drifted.
      await writeFile(
        path.join(OUT_DIR, `${stem}.txt`),
        `Subject: ${message.subject}\n\n${message.text}`,
        "utf8",
      );
      written.push(stem);
    }
  }

  await writeFile(path.join(OUT_DIR, "index.html"), indexPage(written), "utf8");
  process.stdout.write(`${written.length} leaves written to ${OUT_DIR}\nOpen index.html\n`);
}

await main();
