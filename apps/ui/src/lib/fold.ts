/**
 * The browser's copy of `raw.fold`, and the highlighting it exists for.
 *
 * WHY THERE ARE TWO. The database folded the text to MATCH it and hands back an excerpt of the
 * ORIGINAL -- diacritics intact, because a Vietnamese operator should not be shown their own
 * language with the tones stripped off. Marking where the match is therefore has to happen
 * against the same fold, on this side. Sending marked-up HTML instead would put markup on the
 * wire that every reader would have to trust or escape, for a decision the browser can make
 * from what it already has.
 *
 * WHAT MUST NOT DRIFT is the pair (same mapping, same length). `fold.test.ts` pins both here
 * and `packages/db/src/rawSearch.test.ts` pins them in SQL; if the two ever disagree, the
 * highlight lands on the wrong characters while everything still renders.
 *
 * `String.normalize("NFC")` and this table are the whole of it -- deliberately not
 * `normalize("NFD").replace(/\p{M}/gu, "")`, which is shorter and wrong twice over: it changes
 * the string's length, and it leaves `đ` alone, that being a letter in its own right rather
 * than a d with a mark on it.
 */

/**
 * Precomposed Vietnamese and the Latin-1 accents, in the order their replacements follow.
 *
 * Kept as one string per base letter so a reader can check a row against the alphabet instead
 * of counting a hundred characters. Ligatures (æ, œ, ß) are deliberately absent: expanding one
 * changes the string's length, which is the property this module may not lose.
 */
const FOLD_PAIRS: readonly (readonly [string, string])[] = [
  ["àáảãạăằắẳẵặâầấẩẫậ", "a"],
  ["èéẻẽẹêềếểễệ", "e"],
  ["ìíỉĩị", "i"],
  ["òóỏõọôồốổỗộơờớởỡợ", "o"],
  ["ùúủũụưừứửữự", "u"],
  ["ỳýỷỹỵ", "y"],
  ["đ", "d"],
  ["ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ", "a"],
  ["ÈÉẺẼẸÊỀẾỂỄỆ", "e"],
  ["ÌÍỈĨỊ", "i"],
  ["ÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ", "o"],
  ["ÙÚỦŨỤƯỪỨỬỮỰ", "u"],
  ["ỲÝỶỸỴ", "y"],
  ["Đ", "d"],
  // The Latin-1 accents, character for character as `raw.fold`'s own `äëïöüÿñçåîû` list. Kept
  // in step deliberately: a letter this side folds and the database does not is a term that
  // matched nothing and is highlighted anyway, or the reverse.
  ["äå", "a"],
  ["ë", "e"],
  ["ïî", "i"],
  ["ö", "o"],
  ["üû", "u"],
  ["ÿ", "y"],
  ["ñ", "n"],
  ["ç", "c"],
  ["ÄÅ", "a"],
  ["Ë", "e"],
  ["ÏÎ", "i"],
  ["Ö", "o"],
  ["ÜÛ", "u"],
  ["Ÿ", "y"],
  ["Ñ", "n"],
  ["Ç", "c"],
];

const FOLD_MAP = new Map<string, string>(
  FOLD_PAIRS.flatMap(([from, to]) => [...from].map((character) => [character, to] as const)),
);

/**
 * One character in, one character out: lowercase ASCII where there is a mapping, `lower()`
 * where there is not.
 *
 * `toLowerCase` is applied per character AFTER the table, so a locale's opinion about a
 * non-ASCII letter never gets a say -- the same order, and the same reason, as the SQL.
 */
export function fold(text: string): string {
  let folded = "";
  for (const character of text.normalize("NFC")) {
    folded += FOLD_MAP.get(character) ?? character.toLowerCase();
  }
  return folded;
}

/** Everything between terms: anything that is not a letter or a digit, in any script. */
const NOT_A_TERM = /[^\p{L}\p{N}]+/u;

/** A run of the excerpt, and whether a query term occurs there. */
export interface Segment {
  readonly text: string;
  readonly match: boolean;
}

/**
 * The reader's question as the words to look for.
 *
 * Quotation marks and a leading `-` are `websearch_to_tsquery`'s operators, not part of any
 * term. They are dropped rather than searched for: somebody who typed `"hop dong" -phu` meant
 * a phrase and an exclusion, and hunting for a word beginning with a quotation mark would mark
 * nothing at all. An excluded term is dropped too -- by definition it is not in this text.
 */
function termsOf(query: string): string[] {
  return fold(query)
    .split(NOT_A_TERM)
    .filter((term) => term !== "");
}

const NEGATED = /(?:^|\s)-\S+/gu;

/**
 * The excerpt split into runs, with the ones a query term occurs in marked.
 *
 * Offsets are found in the FOLDED text and applied to the NFC original, which is sound exactly
 * because `fold` is length-preserving. Nothing is added, dropped or reordered: the segments
 * always rejoin to the text that was passed in, and `fold.test.ts` pins that rather than only
 * pinning which words came back marked.
 *
 * NOT A SECOND MATCHER. A hit can be real while no term occurs literally -- Postgres's English
 * stemmer matched `contract` to `contracts` -- and in that case this marks nothing, because a
 * span chosen to have something to highlight would tell the reader the match was somewhere it
 * was not.
 */
export function highlightSegments(text: string, query: string): Segment[] {
  const source = text.normalize("NFC");
  const terms = termsOf(query.replace(NEGATED, " "));
  if (terms.length === 0) {
    return [{ text: source, match: false }];
  }
  const folded = fold(source);
  const marked = new Array<boolean>(source.length).fill(false);
  for (const term of terms) {
    let at = folded.indexOf(term);
    while (at !== -1) {
      for (let i = at; i < at + term.length; i += 1) {
        marked[i] = true;
      }
      at = folded.indexOf(term, at + term.length);
    }
  }
  return runsOf(source, marked);
}

/** Adjacent characters with the same verdict, as one segment each. */
function runsOf(source: string, marked: readonly boolean[]): Segment[] {
  const segments: Segment[] = [];
  let start = 0;
  for (let i = 1; i <= source.length; i += 1) {
    if (i === source.length || marked[i] !== marked[start]) {
      segments.push({ text: source.slice(start, i), match: marked[start] === true });
      start = i;
    }
  }
  return segments;
}
