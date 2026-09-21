/**
 * Searching the raw lake: one question, two kinds of answer.
 *
 * A record hit and a document hit are NOT the same shape and are deliberately not flattened
 * into one. A record is identified by `(source, entity, sourceRecordId)` and a document by
 * `(source, documentId)`; collapsing them behind a nullable `entity` would make every caller
 * re-derive which kind it was holding, and the browser link one of them opens does not exist
 * for the other. A discriminated union on `kind` makes the compiler ask instead.
 *
 * `excerpt` is a window onto the match cut from the ORIGINAL text -- diacritics intact, not the
 * folded form the index matched against. It is deliberately NOT highlighted here: markup on the
 * wire would have to be trusted or escaped by every reader, and the same fold that found it can
 * re-find it in the browser. See `raw.search_excerpt` in 190_raw_search.sql and ADR 0026.
 */

import { z } from "zod";

/** The most hits one search answers with. A place to look, not an export. */
export const MAX_SEARCH_HITS = 50;
/** What a search gets when it does not say. */
export const DEFAULT_SEARCH_HITS = 20;
/**
 * The longest question a reader may ask.
 *
 * Generous for a search box and far short of anything that would make the tsquery expensive to
 * build; `websearch_to_tsquery` never raises on malformed input, so this bounds work rather than
 * guarding against a syntax the parser would refuse.
 */
export const MAX_SEARCH_QUERY_CHARS = 256;

/** Which halves of the lake to look in. Both, unless the reader narrows it. */
export const SearchKind = z.enum(["record", "document"]);
export type SearchKind = z.infer<typeof SearchKind>;

export const RawSearchRequest = z.object({
  tenantId: z.string().min(1),
  /**
   * What the reader typed, verbatim.
   *
   * Passed to Postgres as a BOUND PARAMETER and folded there, never spliced into SQL and never
   * pre-tokenised here: `websearch_to_tsquery` is what gives `"a phrase"` and `-negation` their
   * meaning, and a second parser in TypeScript would be a second, quietly different answer to
   * what the reader asked.
   */
  q: z.string().trim().min(1).max(MAX_SEARCH_QUERY_CHARS),
  /** Empty is not allowed: a search of nothing is a request nobody meant to make. */
  kinds: z.array(SearchKind).nonempty().default(["record", "document"]),
  limit: z.number().int().min(1).max(MAX_SEARCH_HITS).default(DEFAULT_SEARCH_HITS),
  /** Hits to skip. Paging is the caller's; the order is stable, so a page boundary is exact. */
  offset: z.number().int().min(0).default(0),
});
export type RawSearchRequest = z.infer<typeof RawSearchRequest>;

/** What both kinds of hit carry: where it came from, how well it matched, and a window on it. */
const hitBase = {
  source: z.string().min(1),
  /** `ts_rank_cd`, for ordering only. Never shown: a relevance number means nothing to a reader. */
  rank: z.number(),
  excerpt: z.string(),
  observedAt: z.string().datetime(),
  /**
   * The source has since deleted it, and this is the tombstone.
   *
   * Carried rather than filtered out. The text is still in the lake and still worth finding --
   * "which contract said this" is asked about terminated contracts more often than live ones --
   * but a hit that did not say it had been deleted upstream would read as a current fact.
   */
  deletedAt: z.string().datetime().nullable(),
} as const;

export const RawSearchHit = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("record"),
    ...hitBase,
    entity: z.string().min(1),
    sourceRecordId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("document"),
    ...hitBase,
    documentId: z.string().min(1),
    /**
     * How the text was read: `pdf_text`, `pdf_ocr`, `docx`. Worth showing beside a hit, because
     * an OCR'd scan is a likelier place for a near-miss than an extracted text layer, and a
     * reader judging a result deserves to know which they are looking at.
     */
    method: z.string().nullable(),
    /** The extractor hit its ceiling: this document is cut, and so is what could be searched. */
    truncated: z.boolean(),
  }),
]);
export type RawSearchHit = z.infer<typeof RawSearchHit>;

export const RawSearchResponse = z.object({
  hits: z.array(RawSearchHit),
  /**
   * There was at least one more hit than the page holds.
   *
   * Reported rather than left to be inferred from a full page, which is ambiguous exactly when
   * it matters: "twenty hits" and "twenty of many" are different answers to "is what I want in
   * here", and only one of them means keep looking.
   */
  truncated: z.boolean(),
});
export type RawSearchResponse = z.infer<typeof RawSearchResponse>;
