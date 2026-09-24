/**
 * What a saved email (`.eml`) or a saved web page (`.mhtml`) says, as text.
 *
 * BOTH ARE ONE FORMAT. An `.eml` is an Internet Message (RFC 5322) and an `.mhtml` is the same
 * container holding a page and its resources (RFC 2557), so one reader walks the MIME tree of
 * either: headers, then parts, each decoded from its transfer encoding and its charset.
 *
 * WHAT IS READ. The message's own Subject, From, To, Cc and Date, then every text part: a
 * `text/plain` as it is, a `text/html` through `html.ts`. A `multipart/alternative` offers one
 * content several ways and only one is read -- the plain text when there is one, because the
 * two would otherwise index every sentence twice. A forwarded message (`message/rfc822`) is
 * read the same way, nested. Images, fonts and stylesheets are resources, not text, and are
 * skipped; a picture of a document inside an email is not OCR'd here.
 *
 * WHY NOT A LIBRARY. `zip.ts` gives the reason for its container and it is this one's too: a
 * mail parser is a supply-chain surface in the process that holds `UNDERCROFT_SECRET_KEY`,
 * for a job that is splitting on a boundary and decoding two encodings. Everything a mail
 * parser adds beyond that is about SENDING mail.
 *
 * BYTES ARE KEPT AS BYTES until a part's charset is known. Headers are ASCII by the RFC, but a
 * body may be 8-bit in any charset, so the walk runs over a one-char-per-byte string and a
 * part is decoded only once its own `Content-Type` has said how.
 */

import { decodeCharset, htmlToText } from "./html.ts";

interface Entity {
  readonly headers: ReadonlyMap<string, string>;
  /** One char per byte. See the module docstring. */
  readonly body: string;
}

/** The headers a reader of the message sees, in the order a mail client shows them. */
const SHOWN_HEADERS = ["subject", "from", "to", "cc", "date"] as const;
const HEADER_LABEL: Readonly<Record<(typeof SHOWN_HEADERS)[number], string>> = {
  subject: "Subject",
  from: "From",
  to: "To",
  cc: "Cc",
  date: "Date",
};

/** Deeper than any real message nests; a crafted one could otherwise recurse without end. */
const MAX_DEPTH = 16;

const HEADER_END = /\r?\n\r?\n/u;
const FOLDED_LINE = /\r?\n[ \t]+/gu;
const LINE_BREAK = /\r?\n/u;
const QUOTED = /^"(?<inner>.*)"$/u;
const WHITESPACE = /\s+/gu;
const SOFT_BREAK = /[ \t]*[=]\r?\n/gu;
const QP_OCTET = /[=](?<hex>[0-9a-f]{2})/giu;
const BETWEEN_WORDS = /\?=\s+=\?/gu;
const ENCODED_WORD = /[=]\?(?<charset>[^?]+)\?(?<encoding>[bq])\?(?<text>[^?]*)\?=/giu;

/** A message's readable text: its headers, a blank line, then its text parts in order. */
export function mimeToText(bytes: Uint8Array): string {
  const root = parseEntity(binaryString(bytes));
  const head = SHOWN_HEADERS.flatMap((name) => {
    const value = root.headers.get(name);
    return value === undefined ? [] : [`${HEADER_LABEL[name]}: ${decodeEncodedWords(value)}`];
  });
  const body = textOf(root, 0);
  return [...head, ...(head.length > 0 && body !== "" ? [""] : []), body].join("\n").trim();
}

function textOf(entity: Entity, depth: number): string {
  if (depth > MAX_DEPTH) {
    return "";
  }
  const { type, params } = contentTypeOf(entity);
  if (type.startsWith("multipart/")) {
    const parts = splitMultipart(entity.body, params.get("boundary")).map(parseEntity);
    const chosen = type === "multipart/alternative" ? preferredAlternative(parts) : parts;
    return chosen
      .map((part) => textOf(part, depth + 1))
      .filter((text) => text !== "")
      .join("\n\n");
  }
  if (type === "message/rfc822") {
    return mimeToText(bytesOf(decodeTransfer(entity)));
  }
  if (type === "text/plain" || type === "") {
    return decodeCharset(bytesOf(decodeTransfer(entity)), params.get("charset")).trim();
  }
  if (type === "text/html") {
    return htmlToText(decodeCharset(bytesOf(decodeTransfer(entity)), params.get("charset")));
  }
  return "";
}

/** The plain-text alternative when there is one, otherwise all of them. */
function preferredAlternative(parts: readonly Entity[]): readonly Entity[] {
  const plain = parts.find((part) => contentTypeOf(part).type === "text/plain");
  return plain === undefined ? parts : [plain];
}

/** Headers, unfolded and keyed lowercase, and the body after the first blank line. */
function parseEntity(raw: string): Entity {
  const split = HEADER_END.exec(raw);
  const headerText = split === null ? raw : raw.slice(0, split.index);
  const body = split === null ? "" : raw.slice(split.index + split[0].length);
  const headers = new Map<string, string>();
  for (const line of headerText.replaceAll(FOLDED_LINE, " ").split(LINE_BREAK)) {
    const colon = line.indexOf(":");
    if (colon > 0) {
      const name = line.slice(0, colon).trim().toLowerCase();
      if (!headers.has(name)) {
        headers.set(name, line.slice(colon + 1).trim());
      }
    }
  }
  return { headers, body };
}

/** `text/html; charset="utf-8"` as its bare type and its parameters, names lowercased. */
function contentTypeOf(entity: Entity): { type: string; params: Map<string, string> } {
  const [bare = "", ...rest] = (entity.headers.get("content-type") ?? "").split(";");
  const params = new Map<string, string>();
  for (const param of rest) {
    const eq = param.indexOf("=");
    if (eq > 0) {
      const value = param
        .slice(eq + 1)
        .trim()
        .replace(QUOTED, "$<inner>");
      params.set(param.slice(0, eq).trim().toLowerCase(), value);
    }
  }
  return { type: bare.trim().toLowerCase(), params };
}

/** The parts between `--boundary` lines, up to the closing `--boundary--`. */
function splitMultipart(body: string, boundary: string | undefined): string[] {
  if (boundary === undefined || boundary === "") {
    return [];
  }
  const delimiter = `--${boundary}`;
  const parts: string[] = [];
  let current: string[] | null = null;
  for (const line of body.split(LINE_BREAK)) {
    if (line.trimEnd() === `${delimiter}--`) {
      break;
    }
    if (line.trimEnd() === delimiter) {
      if (current !== null) {
        parts.push(current.join("\n"));
      }
      current = [];
    } else if (current !== null) {
      current.push(line);
    }
  }
  if (current !== null) {
    parts.push(current.join("\n"));
  }
  return parts;
}

/** A part's body with its `Content-Transfer-Encoding` undone, still one char per byte. */
function decodeTransfer(entity: Entity): string {
  const encoding = (entity.headers.get("content-transfer-encoding") ?? "").trim().toLowerCase();
  if (encoding === "base64") {
    return binaryString(Buffer.from(entity.body.replaceAll(WHITESPACE, ""), "base64"));
  }
  if (encoding === "quoted-printable") {
    return decodeQuotedPrintable(entity.body);
  }
  return entity.body;
}

function decodeQuotedPrintable(text: string): string {
  return text
    .replaceAll(SOFT_BREAK, "")
    .replaceAll(QP_OCTET, (_whole, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)));
}

/** `=?utf-8?B?...?=` and `=?utf-8?Q?...?=` (RFC 2047), the way a non-ASCII subject is sent. */
function decodeEncodedWords(value: string): string {
  return value
    .replaceAll(BETWEEN_WORDS, "?==?")
    .replaceAll(ENCODED_WORD, (_whole, charset: string, encoding: string, text: string) => {
      const raw =
        encoding.toLowerCase() === "b"
          ? Buffer.from(text, "base64")
          : bytesOf(decodeQuotedPrintable(text.replaceAll("_", " ")));
      return decodeCharset(raw, charset);
    });
}

/** Bytes as a string of the same length, one char per byte, so offsets survive the walk. */
function binaryString(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

function bytesOf(binary: string): Uint8Array {
  return Buffer.from(binary, "latin1");
}
