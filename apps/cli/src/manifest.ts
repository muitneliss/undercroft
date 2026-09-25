/**
 * What the CLI knows about the platform, and the one rule that names it.
 *
 * The manifest is the router's own description of itself -- every procedure's dotted path,
 * whether it is a query or a mutation, the JSON Schema of its input, its effect and its
 * sentence in each language -- produced by the control plane's `procedureManifest()` at BUILD
 * time and bundled in by `scripts/build.ts` as `virtual:surface`. It is never written to git,
 * so it cannot drift from the router it describes: a new procedure is a new command the next
 * time the CLI is built, with nothing to hand-edit here.
 *
 * The CLI never imports the router itself. What reaches it at run time is data, and what it
 * does with the data is send it over HTTP to `/trpc` -- `.ast-grep/rules/cli-boundary.yml`.
 * What reaches it at COMPILE time is the router's types, re-exported below, which is how a
 * renamed or reshaped procedure the CLI calls by name fails the CLI's typecheck.
 */

import type { ProcedurePath } from "@undercroft/control-plane/surface";

export type {
  Effect,
  ErrorCodeTable,
  InputOf,
  JsonSchema,
  KindOf,
  OutputOf,
  ProcedurePath,
  ProcedureSpec,
  SurfaceErrorCode,
} from "@undercroft/control-plane/surface";

/** The proper prefixes of a dotted path: `bi.questions.save` gives `bi` and `bi.questions`. */
type Namespaces<Path extends string> = Path extends `${infer Head}.${infer Rest}`
  ? Head | `${Head}.${Namespaces<Rest>}`
  : never;

/** A dotted namespace as a catalogue key: `bi.questions` is `biQuestions`. `topicKey`, typed. */
type CamelKey<Path extends string> = Path extends `${infer Head}.${infer Rest}`
  ? `${Head}${Capitalize<CamelKey<Rest>>}`
  : Path;

/**
 * Every topic the CLI has, as its catalogue key: each router namespace, and the two the
 * local commands add (`auth`, and `config`, which the router has too).
 *
 * The catalogues' `topics` are typed against this, so a new router namespace with no sentence,
 * or a sentence for one that is gone, is a `tsc` error rather than a blank line in `--help`.
 */
export type TopicKey = CamelKey<Namespaces<ProcedurePath>> | "auth" | "config";

/**
 * `startOAuth` -> `start-oauth`, `expiresInDays` -> `expires-in-days`.
 *
 * A capital joins the word before it only after a lowercase letter or a digit, so an acronym
 * stays one word: `OAuth` is `oauth`, not `o-auth`. Commands and flags share this rule, so
 * a person who learned one can predict the other.
 */
export function kebab(name: string): string {
  return name.replaceAll(/(?<lower>[a-z0-9])(?<upper>[A-Z])/gu, "$<lower>-$<upper>").toLowerCase();
}

/** The oclif id for a dotted path: `bi.questions.save` -> `bi:questions:save`. */
export function commandId(path: string): string {
  return path.split(".").map(kebab).join(":");
}

/** Every topic the ids imply: each proper prefix, so `bi:questions:save` gives `bi` and `bi:questions`. */
export function topicsOf(ids: readonly string[]): string[] {
  const topics = new Set<string>();
  for (const id of ids) {
    const words = id.split(":");
    for (let end = 1; end < words.length; end += 1) {
      topics.add(words.slice(0, end).join(":"));
    }
  }
  return [...topics].sort();
}

/** Where a topic id breaks into words: between topics, and inside a kebab-cased one. */
const WORD_BREAK = /[:-]/u;

/**
 * A topic's key in the catalogues' `topics`: `bi:questions` -> `biQuestions`.
 *
 * Joined in camelCase because `:` is i18next's namespace separator and `.` its key separator,
 * so neither can appear in a key. This is `CamelKey` above, at run time, reading the oclif id
 * rather than the dotted path -- so a `-` that `kebab` put into a namespace is joined back as a
 * capital. The one name the two cannot agree on is a namespace with an acronym in it
 * (`startOAuth` is `start-oauth` is `startOauth`); none exists, and its help line would be
 * blank rather than wrong.
 */
export function topicKey(topic: string): string {
  return topic
    .split(WORD_BREAK)
    .map((word, index) => (index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join("");
}

/** How a person types a command id: `bi:questions:save` -> `bi questions save`. */
export function spoken(id: string): string {
  return id.replaceAll(":", " ");
}
