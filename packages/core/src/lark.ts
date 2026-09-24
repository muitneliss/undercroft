/**
 * Lark's custom-bot webhook: what a card looks like on the wire, and posting one.
 *
 * Two callers decide what a card says -- `scripts/notify.ts` for what happened in the
 * repository, the control plane's alert tick for a sync that failed or recovered -- and this
 * module is the only place that knows Lark's shape, so a change of card schema or signing
 * scheme is one file.
 *
 * The webhook URL IS the credential -- anyone holding it can post into the group -- so each
 * caller reads it from its own environment (a GitHub secret in CI, the compose environment for
 * the control plane) and it is never printed. The secret is Lark's optional signature check;
 * with it set, a leaked URL alone is no longer enough to post.
 *
 * Two things here look like over-caution and are not:
 *
 *   - No string a notice carries reaches Lark as markup. Notices quote what people outside
 *     this repo wrote -- an issue title, a PR body, the error a vendor answered a sync with -- and
 *     Lark reads `<at id=all></at>` inside markdown as a mention, so text written that way
 *     would page the whole group. The title
 *     is `plain_text`; a fact is `larkLiteral` inside the emphasis this module adds; the body
 *     is `larkMarkdown`, which renders GitHub's markdown but escapes every tag.
 *   - Lark refuses a message with HTTP 200 and a non-zero `code` (a bad signature, a missing
 *     keyword). Reading the status alone would report a notice as sent that nobody received.
 */

import { createHmac } from "node:crypto";

import { larkLiteral, larkMarkdown } from "./larkMarkdown.ts";

/** Lark's header colours. */
export type LarkTone = "green" | "red" | "blue" | "orange" | "grey";

/** How a run of a fact's value stands out; a card has no other way to style text. */
export type Emphasis = "bold" | "green" | "red" | "grey";

/** A run of a fact's value. Its text is always shown exactly as written. */
export type Span = string | { readonly text: string; readonly emphasis: Emphasis };

export function bold(text: string): Span {
  return { text, emphasis: "bold" };
}

export function green(text: string): Span {
  return { text, emphasis: "green" };
}

export function red(text: string): Span {
  return { text, emphasis: "red" };
}

export function grey(text: string): Span {
  return { text, emphasis: "grey" };
}

/** What a card says, before it is Lark's shape. */
export interface LarkNotice {
  readonly title: string;
  readonly tone: LarkTone;
  readonly facts: readonly (readonly [label: string, value: Span | readonly Span[]])[];
  /** GitHub-flavoured markdown, possibly written outside this repo; empty for none. */
  readonly body: string;
  readonly links: readonly (readonly [label: string, url: string])[];
}

interface PlainText {
  readonly tag: "plain_text";
  readonly content: string;
}

export interface LarkMessage {
  readonly msg_type: "interactive";
  readonly card: {
    readonly config: { readonly wide_screen_mode: true };
    readonly header: { readonly template: LarkTone; readonly title: PlainText };
    readonly elements: readonly unknown[];
  };
}

export interface LarkConfig {
  readonly url: string;
  /** Empty when the bot has no signature check. */
  readonly secret: string;
}

export type LarkFetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * How much of a body a card carries, cut at a line so no link is split. Lark refuses a
 * request over 20 KB, and the rest of the body is one click away.
 */
const BODY_CHARS = 1200;

function plain(content: string): PlainText {
  return { tag: "plain_text", content };
}

const EMPHASIS: Readonly<Record<Emphasis, (markup: string) => string>> = {
  bold: (markup) => `**${markup}**`,
  green: (markup) => `<font color='green'>${markup}</font>`,
  red: (markup) => `<font color='red'>${markup}</font>`,
  grey: (markup) => `<font color='grey'>${markup}</font>`,
};

function inline(value: Span | readonly Span[]): string {
  const spans = typeof value === "string" || "text" in value ? [value] : value;
  return spans
    .map((span) =>
      typeof span === "string"
        ? larkLiteral(span)
        : EMPHASIS[span.emphasis](larkLiteral(span.text)),
    )
    .join("");
}

function bounded(markdown: string): string {
  if (markdown.length <= BODY_CHARS) {
    return markdown;
  }
  const lineEnd = markdown.lastIndexOf("\n", BODY_CHARS);
  return `${markdown.slice(0, lineEnd > 0 ? lineEnd : BODY_CHARS).trimEnd()}\n…`;
}

export function larkMessage(notice: LarkNotice): LarkMessage {
  const elements: unknown[] = [
    {
      tag: "div",
      fields: notice.facts.map(([label, value]) => ({
        is_short: true,
        text: { tag: "lark_md", content: `**${larkLiteral(label)}**\n${inline(value)}` },
      })),
    },
  ];
  const body = bounded(larkMarkdown(notice.body));
  if (body !== "") {
    elements.push({ tag: "hr" }, { tag: "markdown", content: body });
  }
  if (notice.links.length > 0) {
    elements.push({
      tag: "action",
      actions: notice.links.map(([label, url], index) => ({
        tag: "button",
        text: plain(label),
        url,
        type: index === 0 ? "primary" : "default",
      })),
    });
  }
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: { template: notice.tone, title: plain(notice.title) },
      elements,
    },
  };
}

/** Lark's documented scheme: HMAC-SHA256 keyed by `timestamp\nsecret` over an empty message. */
function signature(secret: string, timestamp: string): string {
  return createHmac("sha256", `${timestamp}\n${secret}`).update("").digest("base64");
}

interface LarkReply {
  readonly code?: number;
  /** The older spelling of `code`, which some hooks still answer with. */
  readonly StatusCode?: number;
}

function replyCode(text: string): number | undefined {
  try {
    const reply: LarkReply = JSON.parse(text);
    return reply.code ?? reply.StatusCode;
  } catch {
    // Not JSON: no code, so the caller refuses the send rather than assuming it landed.
    return undefined;
  }
}

/** Never retried: a retried post that Lark had in fact accepted is a duplicate in the group. */
export async function postLark(
  cfg: LarkConfig,
  message: LarkMessage,
  deps: { readonly fetch: LarkFetch; readonly now: () => number },
): Promise<void> {
  const timestamp = String(Math.floor(deps.now() / 1000));
  const signed = cfg.secret === "" ? {} : { timestamp, sign: signature(cfg.secret, timestamp) };
  const response = await deps.fetch(cfg.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...signed, ...message }),
  });
  const text = await response.text();
  if (!response.ok || replyCode(text) !== 0) {
    throw new Error(`Lark refused the notice: HTTP ${response.status} ${text.slice(0, 300)}`);
  }
}
