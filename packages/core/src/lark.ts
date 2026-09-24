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
 *   - Every string a notice carries is rendered as `plain_text`, never `lark_md`. Notices
 *     quote what people outside this repo wrote -- an issue title, a PR body, the error a
 *     vendor's API answered a sync with -- and Lark reads
 *     `<at id=all></at>` inside markdown as a mention, so an issue titled that way would page
 *     the whole group.
 *   - Lark refuses a message with HTTP 200 and a non-zero `code` (a bad signature, a missing
 *     keyword). Reading the status alone would report a notice as sent that nobody received.
 */

import { createHmac } from "node:crypto";

/** Lark's header colours. */
export type LarkTone = "green" | "red" | "blue" | "orange" | "grey";

/** What a card says, before it is Lark's shape. Every string in it is rendered as plain text. */
export interface LarkNotice {
  readonly title: string;
  readonly tone: LarkTone;
  readonly facts: readonly (readonly [label: string, value: string])[];
  /** Free text under the facts; empty for none. */
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

function plain(content: string): PlainText {
  return { tag: "plain_text", content };
}

export function larkMessage(notice: LarkNotice): LarkMessage {
  const elements: unknown[] = [
    {
      tag: "div",
      fields: notice.facts.map(([label, value]) => ({
        is_short: true,
        text: plain(`${label}: ${value}`),
      })),
    },
  ];
  if (notice.body !== "") {
    elements.push({ tag: "hr" }, { tag: "div", text: plain(notice.body) });
  }
  if (notice.links.length > 0) {
    elements.push({
      tag: "action",
      actions: notice.links.map(([label, url]) => ({
        tag: "button",
        text: plain(label),
        url,
        type: "default",
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
