/**
 * The contents page: what `undercroft` shows a person who is signed in.
 *
 * A running head -- the mark, the name, the edition; the server and profile; the address and
 * whether this profile may write -- then every topic with its sentence, a dot leader, and the
 * number of commands under it, the way a printed manual lists its chapters. Set in
 * `typeset.ts`, whose docstring holds the rules every page keeps.
 *
 * Write permission is told by form: "read-only" plain, "WRITES ON" in bold capitals. Never
 * red, because a profile a person allowed to write is not an error.
 */

import type { Translate } from "../i18n/index.ts";
import { type TopicKey, topicKey } from "../manifest.ts";
import {
  bold,
  dim,
  flushRight,
  innerOf,
  isWide,
  type Line,
  leader,
  lineWidth,
  type PageStyle,
  plain,
  setPage,
  widthOf,
  wrap,
} from "./typeset.ts";

/** The mark at running-head size: the block, with the arch cut out of its foot. */
const MARK_SMALL = '#"#';

/** The width of a topic's name, a sub-topic's indent included. */
const TOPIC_COLUMN = 14;

type Part = "contents" | "appendix";

/**
 * Where each topic sits, in the order the README walks the pipeline -- sources, runs, the raw
 * lake, the models built on it, their quality, the reports read from them -- then the
 * administration, and last, in the appendix, the CLI's own machinery. Keyed by `TopicKey`, so
 * a namespace the router grows is a `tsc` error here until someone places it.
 */
const PLACE = {
  connections: "contents",
  runs: "contents",
  lake: "contents",
  models: "contents",
  dq: "contents",
  bi: "contents",
  biQuestions: "contents",
  biDashboards: "contents",
  tenants: "contents",
  people: "contents",
  keys: "contents",
  auth: "appendix",
  session: "appendix",
  config: "appendix",
} as const satisfies Record<TopicKey, Part>;

export interface ContentsFacts {
  readonly version: string;
  readonly origin: string;
  readonly profile: string | null;
  readonly email: string;
  readonly allowWrites: boolean;
  /** Every command, spoken (`bi questions list`), which is what the counts are taken from. */
  readonly commands: readonly string[];
  /** A topic's sentence, by its oclif id (`bi:questions`), or `null` when it has none. */
  readonly sentence: (topic: string) => string | null;
}

interface Entry {
  /** The topic's oclif id, `bi:questions`, which is what `topicKey` and the sentences read. */
  readonly topic: string;
  readonly count: number;
  readonly part: Part;
}

/** Each topic, with the number of commands directly under it, in `PLACE` order. */
function entries(commands: readonly string[]): Entry[] {
  const counts = new Map<string, number>();
  for (const command of commands) {
    const words = command.split(" ");
    for (let end = 1; end < words.length; end += 1) {
      const topic = words.slice(0, end).join(":");
      counts.set(topic, (counts.get(topic) ?? 0) + (end === words.length - 1 ? 1 : 0));
    }
  }
  const byKey = new Map([...counts].map(([topic, count]) => [topicKey(topic), { topic, count }]));
  return Object.entries(PLACE).flatMap(([key, place]) => {
    const found = byKey.get(key);
    return found === undefined ? [] : [{ ...found, part: place }];
  });
}

function runningHead(t: Translate, facts: ContentsFacts, inner: number): Line[] {
  const left: Line = [
    bold(`${MARK_SMALL} ${t("page.name").toUpperCase()}`),
    plain(" "),
    dim(facts.version),
  ];
  const where: Line =
    facts.profile === null
      ? [dim(facts.origin)]
      : [dim(facts.origin), plain("  "), dim(facts.profile)];
  const who: Line = [
    plain(facts.email),
    plain("  "),
    facts.allowWrites ? bold(t("page.writesOn")) : plain(t("page.readOnly")),
  ];
  if (lineWidth(left) + 2 + lineWidth(where) <= inner && lineWidth(who) <= inner) {
    return [[...left, ...flushRight(where, lineWidth(left), inner)], flushRight(who, 0, inner)];
  }
  return [left, where, who];
}

function contentsRow(entry: Entry, sentence: string | null, inner: number): Line[] {
  const words = entry.topic.split(":");
  const sub = words.length > 1;
  const label = `${sub ? "  " : ""}${words.at(-1) ?? entry.topic}`;
  const name = sub ? plain(label) : bold(label);
  const count: Line = [plain(String(entry.count).padStart(2))];
  if (!isWide(inner) || sentence === null) {
    return [leader([name], count, inner)];
  }
  // The sentence hangs under itself when it wraps, and the leader goes on its last line.
  const first: Line = [name, plain(" ".repeat(Math.max(1, TOPIC_COLUMN - widthOf(label))))];
  const hang: Line = [plain(" ".repeat(TOPIC_COLUMN))];
  const lines = wrap(sentence, inner - TOPIC_COLUMN - 6);
  return lines.map((text, index) => {
    const line: Line = [...(index === 0 ? first : hang), plain(text)];
    return index === lines.length - 1 ? leader(line, count, inner) : line;
  });
}

/**
 * One part of the book. Only the first carries the count column's head; the appendix is read
 * under it.
 */
function part(t: Translate, facts: ContentsFacts, which: Part, inner: number): Line[] {
  const title = t(which === "contents" ? "page.contents" : "page.appendix");
  const head: Line =
    which === "contents"
      ? [bold(title), ...flushRight([dim(t("page.commands"))], widthOf(title), inner)]
      : [bold(title)];
  return [
    [],
    head,
    [],
    ...entries(facts.commands)
      .filter((entry) => entry.part === which)
      .flatMap((entry) => contentsRow(entry, facts.sentence(entry.topic), inner)),
  ];
}

function footer(t: Translate, inner: number): Line[] {
  const topic = t("page.topicHelp");
  const command = t("page.commandHelp");
  return isWide(inner) && widthOf(topic) + widthOf(command) + 3 <= inner
    ? [[bold(topic), plain("   "), bold(command)]]
    : [[bold(topic)], [bold(command)]];
}

/** The contents page: the running head, then every topic with the commands under it. */
export function contentsPage(t: Translate, facts: ContentsFacts, style: PageStyle): string[] {
  const inner = innerOf(style);
  return setPage(
    [
      [],
      ...runningHead(t, facts, inner),
      [dim("-".repeat(inner))],
      ...part(t, facts, "contents", inner),
      ...part(t, facts, "appendix", inner),
      [],
      ...footer(t, inner),
      [],
    ],
    style.color,
  );
}
