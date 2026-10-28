/**
 * An agent's kept call (ADR 0151) as the account page prints its bodies.
 *
 * A body is JSON text the server wrote, and it is printed re-indented, never re-parsed: a round
 * trip through `JSON.parse` turns every number into a double, and a call log that showed
 * `12345678901234567000` where the agent sent `12345678901234567890` would be a wrong value in
 * the one place a superadmin reads to find out what was really sent (`LakeBrowser.tsx` refuses
 * the same round trip for a payload). So the indentation is added between tokens, character by
 * character, and nothing inside a string or a number is touched.
 */

const INDENT = "  ";

/** What a body is printed as: indented, or as it was stored when it cannot be. */
export interface PrintedBody {
  readonly text: string;
  /** `false` when the text is shown exactly as stored: cut at the cap, or not JSON. */
  readonly indented: boolean;
}

/**
 * A stored body ready to print. A body cut at the cap is shown as stored -- it ends mid-value,
 * and indenting it would dress a fragment up as a whole -- and so is one that is not balanced
 * JSON (the server's `[unserialisable]`).
 */
export function printedBody(text: string, truncated: boolean): PrintedBody {
  if (truncated) {
    return { text, indented: false };
  }
  const indented = indentJson(text);
  return indented === null ? { text, indented: false } : { text: indented, indented: true };
}

/**
 * `text` with a line per member and element, or `null` when it is not balanced JSON: a bracket
 * closed that was never opened, one left open, a string never ended, or a bare word JSON has none
 * of.
 */
export function indentJson(text: string): string | null {
  const trimmed = text.trim();
  if (!OPENS_A_TREE.test(trimmed)) {
    return null;
  }
  const state: Indenting = { out: [], open: [] };
  let index = 0;
  while (index < trimmed.length) {
    const next = step(trimmed, index, state);
    if (next === null) {
      return null;
    }
    index = next;
  }
  return state.open.length > 0 ? null : state.out.join("");
}

/** Only an object or an array is indented; a bare value is printed as it is. */
const OPENS_A_TREE = /^[[{]/u;

/** What JSON allows outside a string that is not punctuation: a number, or one of three words. */
const BARE_TOKEN = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/u;

/** What ends a bare token: punctuation, a quote, or whitespace. */
const ENDS_A_TOKEN = /[{}[\],:"\s]/u;

/** The indented text so far, and the closing bracket each open one is waiting for. */
interface Indenting {
  readonly out: string[];
  readonly open: string[];
}

function newline(state: Indenting): void {
  state.out.push(`\n${INDENT.repeat(state.open.length)}`);
}

/** Print the token at `index`; the index after it, or `null` when the text is not JSON there. */
function step(text: string, index: number, state: Indenting): number | null {
  const char = text.charAt(index);
  if (char === '"') {
    return copyString(text, index, state);
  }
  if (isOpening(char)) {
    return openBracket(text, index, state);
  }
  if (isClosing(char)) {
    return closeBracket(text, index, state);
  }
  if (char === ",") {
    state.out.push(",");
    newline(state);
    return index + 1;
  }
  if (char === ":") {
    state.out.push(": ");
    return index + 1;
  }
  return char.trim() === "" ? index + 1 : copyBare(text, index, state);
}

function openBracket(text: string, index: number, state: Indenting): number {
  const char = text.charAt(index);
  state.open.push(char === "{" ? "}" : "]");
  state.out.push(char);
  // An empty object or array stays on its line.
  if (!isClosing(text.charAt(index + 1))) {
    newline(state);
  }
  return index + 1;
}

/** Close the bracket at `index`, or `null` when it is not the one the innermost open awaits. */
function closeBracket(text: string, index: number, state: Indenting): number | null {
  const char = text.charAt(index);
  if (state.open.pop() !== char) {
    return null;
  }
  if (!isOpening(text.charAt(index - 1))) {
    newline(state);
  }
  state.out.push(char);
  return index + 1;
}

function isOpening(char: string): boolean {
  return char === "{" || char === "[";
}

function isClosing(char: string): boolean {
  return char === "}" || char === "]";
}

/** Copy the string starting at `start` as written, escapes and all; `null` if it never ends. */
function copyString(text: string, start: number, state: Indenting): number | null {
  let index = start + 1;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === "\\") {
      index += 2;
    } else if (char === '"') {
      state.out.push(text.slice(start, index + 1));
      return index + 1;
    } else {
      index += 1;
    }
  }
  return null;
}

/** Copy the number or literal starting at `start` as written, once it is known to be one. */
function copyBare(text: string, start: number, state: Indenting): number | null {
  let end = start;
  while (end < text.length && !ENDS_A_TOKEN.test(text.charAt(end))) {
    end += 1;
  }
  const token = text.slice(start, end);
  if (!BARE_TOKEN.test(token)) {
    return null;
  }
  state.out.push(token);
  return end;
}
