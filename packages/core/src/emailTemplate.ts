/**
 * A leaf of the book, posted.
 *
 * Undercroft's interface is "printed matter that happens to be read on a screen"
 * (`apps/ui/DESIGN.md`), and an email is the one piece of that printed matter that
 * genuinely leaves the building. So it is set as a leaf: warm page stock on a bone board,
 * a running head naming whose book is open, heads in narrow caps hanging over a hairline,
 * the sentences a person must act on in Garamond, every datum in mono, and one die-cut
 * plate carrying the single next action. A failure arrives as the errata slip it is.
 *
 * ## One document, two renderings
 *
 * `renderEmailLeaf` returns the `text` and the `html` from ONE description of the message.
 * That is the whole reason this module exists rather than a pair of catalogues. A multipart
 * email whose branches are authored separately drifts -- somebody fixes a sentence in the
 * HTML, nobody opens the text, and the readers who see the text half (every plain-text
 * client, every screen reader set to prefer it, every forwarded quote) are told something
 * the sender stopped believing months ago. Here a sentence cannot exist in one branch, and
 * `emailTemplate.test.ts` pins that from both sides.
 *
 * The text branch is not a fallback. It is the message; the HTML is the same message set.
 *
 * ## Nothing here calls home
 *
 * No image, no remote font, no `url(`, no tracking pixel -- asserted by a test. A web font
 * would tell Google that a sign-in code had been opened, by which IP, at what time, which is
 * a worse thing to ship than an email set in Georgia. The font stacks below therefore name
 * the real faces first (a reader who has Archivo gets Archivo) and then the closest thing
 * every mail client already has. Georgia is a deliberate choice for the Garamond voice: of
 * the faces that ship everywhere it is the one with a true italic and old-style warmth.
 *
 * ## Escaping lives here, not in i18next
 *
 * `apps/control-plane/src/i18n/index.ts` runs i18next with `escapeValue: false`, because its
 * output has to stay literal for the text branch and for HTTP refusals. So the markup branch
 * escapes at the point it writes markup -- which is also the only correct place for it. The
 * values are not all ours: an ingest key's label and a run's error message are written
 * outside this repo and land in an administrator's inbox.
 *
 * ## Why the colours are solved to hex
 *
 * The design system's rules are `rgba(22, 21, 15, 0.16)` over a known ground. Outlook's Word
 * engine does not composite alpha, so each is solved against the stock it sits on and
 * written as an opaque hex, the same way the system already solves its acetate leaf. The
 * arithmetic is recorded beside each constant so the next reader can check it rather than
 * trust it.
 */

import type { EmailMessage } from "./email.ts";
import type { Locale } from "./locale.ts";

/** A row of the schedule: a head in the margin, a datum beside it. */
export interface ScheduleRow {
  readonly label: string;
  /** `null` prints the em dash. A value we do not have is never a blank cell. */
  readonly value: string | null;
  /** `pending` is the umber of a thing about to lapse. Never vermilion; that is errata's. */
  readonly tone?: "ink" | "pending";
}

export type EmailBlock =
  /** A sentence the reader must understand to act. Garamond. */
  | { readonly kind: "prose"; readonly text: string }
  /** Facts as a ruled schedule, never a card. */
  | { readonly kind: "schedule"; readonly rows: readonly ScheduleRow[] }
  /** A one-time secret, set large enough to read down a phone line. */
  | { readonly kind: "token"; readonly value: string }
  /** The correction slip. The only object in the system allowed vermilion. */
  | { readonly kind: "errata"; readonly mark: string; readonly text: string }
  /** The one die-cut plate. A leaf has at most one next action. */
  | { readonly kind: "plate"; readonly label: string; readonly href: string }
  /** The quiet sentence that closes: what happens next, or what to ignore. */
  | { readonly kind: "note"; readonly text: string };

export interface EmailLeaf {
  readonly locale: Locale;
  readonly subject: string;
  /** The right of the running head: whose book is open. Absent where no customer owns it. */
  readonly runningHead?: string;
  readonly heading: string;
  readonly lead?: string;
  readonly blocks: readonly EmailBlock[];
  /** The colophon, in the reader's language. */
  readonly colophon: string;
}

export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** The wordmark, in the running head of every leaf. */
const WORDMARK = "UNDERCROFT";

const INK = "#16150f";
const INK_2 = "#56513f";
const INK_3 = "#6b6450";
const BONE = "#efe9d9";
const PAGE = "#f7f3e7";
const LEAF = "#fbf8f0";
const CHROME = "#eda600";
const ERRATA = "#cf2f16";
const ERRATA_INK = "#8c1c09";
const ERRATA_GROUND = "#fdf0eb";
const PENDING = "#6b4a00";

/** `rgba(22, 21, 15, 0.16)` over Page: 0.16·22 + 0.84·247 = 211, and so on per channel. */
const RULE_ON_PAGE = "#d3cfc4";
/** The same hairline over Bone, for the edge where the leaf meets the board. */
const RULE_ON_BONE = "#ccc7b9";
/** `rgba(22, 21, 15, 0.44)` over Page: the heavier rule that closes a block. */
const RULE_STRONG_ON_PAGE = "#949188";

const FACE_DISPLAY = "Archivo,'Helvetica Neue',Helvetica,Arial,sans-serif";
const FACE_PROSE = "'EB Garamond',Garamond,Georgia,'Times New Roman',serif";
const FACE_MONO = "'Spline Sans Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

/** Caps in a narrow grotesque: every head, every column head, every plate. */
const LABEL = `font-family:${FACE_DISPLAY};font-size:11px;font-weight:700;letter-spacing:0.15em;`;
const DATUM = `font-family:${FACE_MONO};font-size:13px;line-height:1.45;`;
const PROSE = `font-family:${FACE_PROSE};font-size:17px;line-height:1.53;`;

/**
 * Caps applied in the renderer, not by `text-transform`, and not asked of the catalogue.
 *
 * Both branches then print the same characters, which is what lets the parity test compare
 * them literally -- with the transform in CSS the HTML said SOURCE while the text said
 * Source, and a guard that has to compare case-insensitively stops noticing a real edit.
 * It also survives the mail clients that strip `text-transform`, where the wayfinding would
 * otherwise quietly become sentence case.
 *
 * `toUpperCase` rather than `toLocaleUpperCase`: the latter follows the HOST's locale, so a
 * server in a Turkish locale would write SOURCE as SOURCE but `i` as `İ`. Unicode's
 * locale-independent mapping is correct for both languages this platform writes.
 */
function caps(value: string): string {
  return value.toUpperCase();
}

/**
 * The exhaustiveness guard on a block switch.
 *
 * Its own spelling rather than `paging.ts`'s: that one lives in `connector-runtime`, which
 * imports this package, so reaching for it here would close a cycle. Three lines duplicated
 * is the cheaper of the two.
 */
function assertNever(value: never, what: string): never {
  throw new Error(`unhandled ${what}: ${JSON.stringify(value)}`);
}

/** A value the system does not have. The Absence Rule, in both branches. */
const MISSING = "—";

/** The plain-text branch's rule: a run of box-drawing that reads as one even set proportionally. */
const TEXT_RULE = "──────────────────────────────";

const AMPERSAND = /&/gu;
const LESS_THAN = /</gu;
const GREATER_THAN = />/gu;
const DOUBLE_QUOTE = /"/gu;

/**
 * Escape for both text content and an attribute value.
 *
 * Quotes are escaped even in text position: one function with one behaviour is a guard a
 * reader can check, and the alternative -- two escapers and a rule about which goes where --
 * is how the attribute one ends up on the text path.
 */
function esc(value: string): string {
  return value
    .replace(AMPERSAND, "&amp;")
    .replace(LESS_THAN, "&lt;")
    .replace(GREATER_THAN, "&gt;")
    .replace(DOUBLE_QUOTE, "&quot;");
}

/**
 * The spacing scale in px, from the system's rem steps (`s3` 0.75rem, `s4` 1rem, `s5`
 * 1.5rem, `s6` 2rem). Typed as numbers because a gap is a quantity, not an enum.
 */
const S3: number = 12;
const S4: number = 16;
const S5: number = 24;
const S6: number = 32;

/** A block's row in the leaf's single-column table, with the space that precedes it. */
function row(space: number, content: string): string {
  return `<tr><td style="padding-top:${space}px;">${content}</td></tr>`;
}

/** A hairline, drawn as a table cell because a 1px div is the one thing Outlook drops. */
function rule(color: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" style="height:1px;line-height:1px;font-size:1px;background:${color};">&nbsp;</td></tr></table>`;
}

function scheduleHtml(rows: readonly ScheduleRow[]): string {
  const cells = rows
    .map((entry) => {
      const absent = entry.value === null;
      const tone = absent ? INK_3 : entry.tone === "pending" ? PENDING : INK;
      return `<tr><td width="34%" valign="top" style="${LABEL}color:${INK_2};padding:9px 14px 9px 0;border-bottom:1px solid ${RULE_ON_PAGE};">${esc(caps(entry.label))}</td><td valign="top" style="${DATUM}color:${tone};padding:9px 0;border-bottom:1px solid ${RULE_ON_PAGE};">${esc(entry.value ?? MISSING)}</td></tr>`;
    })
    .join("");
  return `${rule(RULE_STRONG_ON_PAGE)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${cells}</table>`;
}

/**
 * The token box, set large.
 *
 * Bigger and more widely tracked than the interface's `.token`, on purpose: that one holds a
 * long opaque secret to be copied, this one holds six digits somebody reads down a phone to
 * a colleague. `text-indent` puts back the trailing space the last digit's tracking adds,
 * without which a centred figure sits left of centre by exactly that much.
 */
function tokenHtml(value: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${LEAF}" style="background:${LEAF};border:1px solid ${INK};border-radius:2px;padding:22px 16px;font-family:${FACE_MONO};font-size:30px;font-weight:700;letter-spacing:0.16em;text-indent:0.16em;color:${INK};">${esc(value)}</td></tr></table>`;
}

function errataHtml(mark: string, text: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${ERRATA_GROUND}" style="background:${ERRATA_GROUND};border-top:2px solid ${ERRATA};border-bottom:2px solid ${ERRATA};border-radius:1px;padding:16px 22px;"><div style="${LABEL}color:${ERRATA_INK};">${esc(caps(mark))}</div><div style="${PROSE}color:${INK};padding-top:8px;">${esc(text)}</div></td></tr></table>`;
}

/**
 * The plate: Chrome ground, Ink keyline, caps label, cut at 2px.
 *
 * Padded to a 44px target rather than the interface's 0.5rem, because the reader is on a
 * phone with one thumb and there is no hover to tell them they found it.
 */
function plateHtml(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${CHROME}" style="background:${CHROME};border:1px solid ${INK};border-radius:2px;"><a href="${esc(href)}" style="display:inline-block;${LABEL}letter-spacing:0.13em;color:${INK};text-decoration:none;padding:15px 20px;">${esc(caps(label))}</a></td></tr></table>`;
}

/**
 * How much air a block wants above it.
 *
 * Prose sits closer to what it follows because it is usually explaining it; everything else
 * is an object in its own right and gets the full step.
 */
function spaceAbove(block: EmailBlock): number {
  switch (block.kind) {
    case "prose":
      return S4;
    default:
      return S5;
  }
}

function blockHtml(block: EmailBlock): string {
  switch (block.kind) {
    case "prose":
      return `<div style="${PROSE}color:${INK};">${esc(block.text)}</div>`;
    case "schedule":
      return scheduleHtml(block.rows);
    case "token":
      return tokenHtml(block.value);
    case "errata":
      return errataHtml(block.mark, block.text);
    case "plate":
      return plateHtml(block.label, block.href);
    case "note":
      return `<div style="font-family:${FACE_PROSE};font-size:15px;line-height:1.5;color:${INK_2};">${esc(block.text)}</div>`;
    default:
      return assertNever(block, "email block");
  }
}

/** The running head: the wordmark, and on the right whose book is open. */
function runningHeadHtml(leaf: EmailLeaf): string {
  const right =
    leaf.runningHead === undefined
      ? ""
      : `<td align="right" style="${DATUM}color:${INK_2};">${esc(leaf.runningHead)}</td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="${LABEL}color:${INK};">${WORDMARK}</td>${right}</tr></table>`;
}

/**
 * The line a mail client shows beside the subject in the inbox list.
 *
 * Without it the client takes the first words it finds, which on a styled email is whatever
 * the running head happens to be -- so every Undercroft message would preview identically as
 * "UNDERCROFT CASE-0042".
 */
function preheaderHtml(leaf: EmailLeaf): string {
  return `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${BONE};">${esc(leaf.lead ?? leaf.heading)}</div>`;
}

function leafBodyHtml(leaf: EmailLeaf): string {
  const lead =
    leaf.lead === undefined
      ? ""
      : row(
          S3,
          `<div style="font-family:${FACE_PROSE};font-size:18px;line-height:1.45;color:${INK_2};">${esc(leaf.lead)}</div>`,
        );

  return [
    row(0, runningHeadHtml(leaf)),
    // Off the scale on purpose, both of them: the running head's rule sits tight under the
    // wordmark because it belongs to it, and the heading takes more air above than its lead
    // takes below, so the pair reads as one object rather than two.
    row(10, rule(RULE_STRONG_ON_PAGE)),
    row(
      26,
      `<h1 style="margin:0;font-family:${FACE_DISPLAY};font-size:29px;line-height:1.1;font-weight:700;letter-spacing:-0.005em;color:${INK};">${esc(leaf.heading)}</h1>`,
    ),
    lead,
    ...leaf.blocks.map((block) => row(spaceAbove(block), blockHtml(block))),
    row(S6, rule(RULE_ON_PAGE)),
    row(
      S3,
      `<div style="font-family:${FACE_PROSE};font-size:14px;line-height:1.5;color:${INK_3};">${esc(leaf.colophon)}</div>`,
    ),
  ].join("");
}

/**
 * There is no dark Undercroft.
 *
 * The system has one stock, warm bone, and a printed thing is not dark. Declaring
 * `light` rather than `light dark` is what stops iOS Mail inverting a paper ground into
 * mud; the explicit `bgcolor` attributes carry the rest where a client forces it anyway.
 */
function headHtml(leaf: EmailLeaf): string {
  return `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(leaf.subject)}</title><style>:root{color-scheme:light;}@media only screen and (max-width:520px){.leaf{padding:24px 20px 28px !important;}.display{font-size:25px !important;}}</style></head>`;
}

function htmlFor(leaf: EmailLeaf): string {
  // The leaf is FLUID with a cap, not 560px wide.
  //
  // A fixed `width="560"` renders identically on a desktop and clips on every phone: a
  // `max-width` beside it cannot shrink what the attribute has already fixed, so the reader
  // gets a message they have to scroll sideways through. Outlook's Word engine is the one
  // client that ignores `max-width`, and the conditional comment below is the standard
  // answer for it -- a 560px table that only Outlook parses, wrapped around a table that
  // every other client sizes for itself.
  const leafTable = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto;background:${PAGE};border:1px solid ${RULE_ON_BONE};border-radius:3px;"><tr><td class="leaf" style="padding:28px 32px 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${leafBodyHtml(leaf)}</table></td></tr></table>`;
  const msoOpen =
    '<!--[if mso]><table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->';
  const msoClose = "<!--[if mso]></td></tr></table><![endif]-->";

  const body = `<body style="margin:0;padding:0;background:${BONE};">${preheaderHtml(leaf)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BONE}" style="background:${BONE};"><tr><td align="center" style="padding:32px 16px 40px;">${msoOpen}${leafTable}${msoClose}</td></tr></table></body>`;

  return `<!doctype html><html lang="${leaf.locale}">${headHtml(leaf)}${body}</html>`;
}

/** A schedule in the text branch is `LABEL: value` per line: alignment needs a mono client. */
function blockText(block: EmailBlock): string {
  switch (block.kind) {
    case "prose":
    case "note":
      return block.text;
    case "schedule":
      return block.rows
        .map((entry) => `${caps(entry.label)}: ${entry.value ?? MISSING}`)
        .join("\n");
    case "token":
      return `    ${block.value}`;
    case "errata":
      return `${caps(block.mark)}\n${block.text}`;
    case "plate":
      return `${caps(block.label)}:\n${block.href}`;
    default:
      return assertNever(block, "email block");
  }
}

function textFor(leaf: EmailLeaf): string {
  const head = leaf.runningHead === undefined ? WORDMARK : `${WORDMARK} · ${leaf.runningHead}`;
  const parts = [head, TEXT_RULE, "", leaf.heading];
  if (leaf.lead !== undefined) {
    parts.push("", leaf.lead);
  }
  for (const block of leaf.blocks) {
    parts.push("", blockText(block));
  }
  parts.push("", TEXT_RULE, leaf.colophon);
  return `${parts.join("\n")}\n`;
}

/**
 * One description of a message, set two ways.
 *
 * Pure, and it takes no locale-dependent decision of its own: the words arrive already
 * written in the reader's language by the caller's catalogue, because the catalogue is the
 * only thing that knows how a sentence goes in Vietnamese.
 */
export function renderEmailLeaf(leaf: EmailLeaf): RenderedEmail {
  return { subject: leaf.subject, text: textFor(leaf), html: htmlFor(leaf) };
}

/**
 * A leaf, addressed -- the one place a rendering becomes a message to send.
 *
 * Every caller wants both branches every time, so handing them the pair and letting each
 * spread it into an `EmailMessage` would be five chances to pass one and forget the other.
 */
export function postEmailLeaf(to: string, leaf: EmailLeaf): EmailMessage {
  const rendered = renderEmailLeaf(leaf);
  return { to, subject: rendered.subject, text: rendered.text, html: rendered.html };
}
