/**
 * The skills this repository publishes (`skills/`) name only what the platform has.
 *
 * A skill is prose an agent follows, and prose does not fail a compiler. A skill that says
 * `models.save` after the router renamed it would send every agent that installed it to a
 * procedure that is not there, with nothing to say so until somebody's first attempt. So
 * the real tree is read here through `readSkills` -- the same function `/mcp` serves it with,
 * so the gate and the server cannot disagree about what a valid skill is -- and every
 * operation a skill names, in any of the three spellings an agent meets, is checked against
 * the router:
 *
 * - the procedure path, `models.check`, which is how a skill names an operation;
 * - the CLI command, `undercroft models check` (the path, kebab-cased, one word per segment);
 * - the MCP tool, `models_check` (the path with `.` as `_`).
 *
 * Only a token whose first segment is one of the router's own topics is read as a reference,
 * so `raw.records` or `deleted_at` in a model's SQL is not one. Each reference must also be
 * offered over MCP -- a skill may be served there, and a procedure only the browser session
 * may call is not an operation it can use.
 */

import { describe, expect, test as it } from "bun:test";
import { join } from "node:path";

import { checkModel } from "@undercroft/db/services";

import { PROCEDURE_PATHS } from "./handlers/procedures.ts";
import { MCP_EXCLUDED, SESSION_ONLY } from "./handlers/surface.ts";
import { readSkills, type Skill } from "./skills.ts";

const SKILLS_ROOT = join(import.meta.dir, "..", "..", "..", "skills");
const ENTRY = "undercroft";

/** The CLI's spelling of a path segment -- `apps/cli/src/manifest.ts`, whose suite pins it. */
function kebab(segment: string): string {
  return segment
    .replaceAll(/(?<lower>[a-z0-9])(?<upper>[A-Z])/gu, "$<lower>-$<upper>")
    .toLowerCase();
}

const OFFERED: ReadonlySet<string> = new Set(
  [...PROCEDURE_PATHS].filter(
    (path) => !(Object.hasOwn(MCP_EXCLUDED, path) || SESSION_ONLY.some((only) => only === path)),
  ),
);
const TOPICS: ReadonlySet<string> = new Set([...PROCEDURE_PATHS].map((p) => p.split(".")[0] ?? ""));
const BY_COMMAND: ReadonlyMap<string, string> = new Map(
  [...PROCEDURE_PATHS].map((path) => [path.split(".").map(kebab).join(" "), path]),
);
const BY_TOOL: ReadonlyMap<string, string> = new Map(
  [...PROCEDURE_PATHS].map((path) => [path.replaceAll(".", "_"), path]),
);

/**
 * The CLI's own commands whose first word is also a router topic (`config.google`). They are
 * local -- `apps/cli/src/commands.ts` -- so no procedure answers them, and they are not unknown.
 */
const CLI_LOCAL: ReadonlySet<string> = new Set(["config show", "config set-profile", "config use"]);

const INLINE_CODE = /`(?<code>[^`\n]+)`/gu;
const FENCE = /^```[^\n]*\n(?<body>[\s\S]*?)^```/gmu;
const DOTTED = /^(?<path>[a-z][A-Za-z]*(?:\.[a-z][A-Za-z]*)+)$/u;
/** A file name is not a path: `config.json` is the CLI's profile file, not `config.json()`. */
const FILE_NAME = /\.(?:json|ya?ml|md|ts|sql|toml|txt|tgz)$/u;
const SNAKE = /^(?<topic>[a-z]+)_[A-Za-z_]+$/u;
const COMMAND = /(?:^|[\s(])undercroft\s+(?<words>[a-z][a-z-]*(?:\s+[a-z][a-z-]*)*)/gu;
const SQL_FENCE = /^```sql\n(?<sql>[\s\S]*?)^```/gmu;
const REF_NAME = /ref\(\s*'(?<model>[a-z][a-z0-9_]*)'\s*\)/gu;
const LINK = /\]\((?<target>[^)\s]+)\)/gu;
const REFERENCE_FILE = /^(?<file>references\/[\w./-]+\.\w+)$/u;
const EXTERNAL = /^(?:[a-z]+:|#)/u;

/** Every piece of code in a Markdown text: inline spans, and each line of a fenced block. */
function codeIn(text: string): string[] {
  const inline = [...text.matchAll(INLINE_CODE)].map((match) => match.groups?.code ?? "");
  const fenced = [...text.matchAll(FENCE)].flatMap((match) =>
    (match.groups?.body ?? "").split("\n"),
  );
  return [...inline, ...fenced];
}

/** The procedure a CLI command line names, `null` if it names none, `undefined` if not ours. */
function commandPath(words: readonly string[]): string | null | undefined {
  if (!TOPICS.has(words[0] ?? "") || CLI_LOCAL.has(words.slice(0, 2).join(" "))) {
    return undefined;
  }
  for (let end = words.length; end >= 2; end -= 1) {
    const path = BY_COMMAND.get(words.slice(0, end).join(" "));
    if (path !== undefined) {
      return path;
    }
  }
  return null;
}

/** A code span that is a procedure path or an MCP tool name, as `[written, meant]`. */
function spanReference(code: string): [string, string | null] | null {
  const dotted = DOTTED.exec(code)?.groups?.path;
  if (dotted !== undefined && TOPICS.has(dotted.split(".")[0] ?? "") && !FILE_NAME.test(dotted)) {
    return [dotted, PROCEDURE_PATHS.has(dotted) ? dotted : null];
  }
  const snake = SNAKE.exec(code)?.groups?.topic;
  return snake !== undefined && TOPICS.has(snake) ? [code, BY_TOOL.get(code) ?? null] : null;
}

/** Each `undercroft <topic> ...` command in a line of code, as `[written, meant]`. */
function commandReferences(code: string): [string, string | null][] {
  return [...code.matchAll(COMMAND)].flatMap((match): [string, string | null][] => {
    const words = (match.groups?.words ?? "").split(/\s+/u);
    const path = commandPath(words);
    return path === undefined ? [] : [[`undercroft ${words.join(" ")}`, path]];
  });
}

/** Every operation a text names, as `[as written, the path it means or null]`. */
function referencesIn(text: string): [string, string | null][] {
  return codeIn(text).flatMap((code) => {
    const span = spanReference(code);
    return [...(span === null ? [] : [span]), ...commandReferences(code)];
  });
}

/** Each file of a skill as `[path within the skill, its text]`. */
function textsOf(skill: Skill): [string, string][] {
  return skill.files.flatMap((file) =>
    "text" in file.content
      ? [[file.uri.slice(`skill://${skill.name}/`.length), file.content.text]]
      : [],
  );
}

/** Where a link in `from` points, as a path within the skill, or `null` if it leaves it. */
function resolveWithin(from: string, target: string): string | null {
  const parts = from.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "..") {
      if (parts.pop() === undefined) {
        return null;
      }
    } else if (part !== ".") {
      parts.push(part);
    }
  }
  return parts.join("/");
}

/** Every ```sql block a skill holds, as `[path within the skill, the SQL]`. */
function sqlExamplesOf(skill: Skill): [string, string][] {
  return textsOf(skill).flatMap(([path, text]) =>
    [...text.matchAll(SQL_FENCE)].map((match): [string, string] => [path, match.groups?.sql ?? ""]),
  );
}

/** What `models.check` finds in an example, every model it `ref()`s taken as existing. */
function exampleFindings(sql: string): string[] {
  const models = [...sql.matchAll(REF_NAME)].map((ref) => ref.groups?.model ?? "");
  const { findings } = checkModel({
    name: "an_example",
    sql,
    tests: { columns: {} },
    existingModels: models,
  });
  return findings.map((found) => `${found.code} ${found.subject ?? ""}`.trim());
}

const skills = readSkills(SKILLS_ROOT);

describe("the reference reader", () => {
  it("fires on a path, a command and a tool the router does not have", () => {
    const text =
      "Call `models.nope`, then `models_nope`.\n\n```sh\nundercroft models nope --x\n```\n";
    expect(referencesIn(text)).toEqual([
      ["models.nope", null],
      ["models_nope", null],
      ["undercroft models nope", null],
    ]);
  });

  it("reads each spelling of a real procedure as that procedure", () => {
    const text = "`models.check`, `lake_querySchema` and `undercroft lake query-schema --agent`.";
    expect(referencesIn(text)).toEqual([
      ["models.check", "models.check"],
      ["lake_querySchema", "lake.querySchema"],
      ["undercroft lake query-schema", "lake.querySchema"],
    ]);
  });

  it("stays quiet on SQL, columns, files and the CLI's own local commands", () => {
    const text =
      "`raw.records`, `deleted_at`, `source_record_id`, `schema.yml`, `undercroft describe`, `undercroft auth login --email x`, `undercroft config show --agent`, `config.json`.";
    expect(referencesIn(text)).toEqual([]);
  });
});

describe("the published skills", () => {
  it("are the entry skill and its workflows, each under its own name", () => {
    const names = skills.map((skill) => skill.name);
    expect(names).toContain(ENTRY);
    expect(names).not.toContain("undercroft-cli");
    expect(new Set(names).size).toBe(names.length);
  });

  it("the entry skill names every workflow skill, so an agent can find it", () => {
    const entry = skills.find((skill) => skill.name === ENTRY);
    const text =
      entry === undefined
        ? ""
        : textsOf(entry)
            .map(([, t]) => t)
            .join("\n");
    for (const skill of skills.filter((s) => s.name !== ENTRY)) {
      expect(text).toContain(`\`${skill.name}\``);
    }
  });

  it("name only procedures the router has, and offers over MCP", () => {
    const unknown = skills.flatMap((skill) =>
      textsOf(skill).flatMap(([path, text]) =>
        referencesIn(text)
          .filter(([, meant]) => meant === null || !OFFERED.has(meant))
          .map(([written]) => `${skill.name}/${path}: ${written}`),
      ),
    );
    expect(unknown).toEqual([]);
  });

  it("name at least one procedure each: a workflow that names none is not one", () => {
    for (const skill of skills) {
      const named = textsOf(skill).flatMap(([, text]) => referencesIn(text));
      expect(named.length).toBeGreaterThan(0);
    }
  });

  it("link only to files the skill itself holds", () => {
    const broken = skills.flatMap((skill) => {
      const held = new Set(textsOf(skill).map(([path]) => path));
      return textsOf(skill).flatMap(([path, text]) => {
        const links = [...text.matchAll(LINK)]
          .map((match) => match.groups?.target ?? "")
          .filter((target) => !EXTERNAL.test(target))
          .map((target) => resolveWithin(path, target.split("#")[0] ?? ""));
        const mentioned = codeIn(text).flatMap((code) => {
          const file = REFERENCE_FILE.exec(code)?.groups?.file;
          return file === undefined ? [] : [file];
        });
        return [...links, ...mentioned]
          .filter((target) => target === null || !held.has(target))
          .map((target) => `${skill.name}/${path} -> ${target ?? "(outside the skill)"}`);
      });
    });
    expect(broken).toEqual([]);
  });

  it("teach only SQL that models.check accepts without a single finding", () => {
    // An example is what an agent copies. One that trips the checker teaches the agent to
    // write a model the checker refuses -- or, worse, to stop believing the checker.
    const noisy = skills.flatMap((skill) =>
      sqlExamplesOf(skill).flatMap(([path, sql]) =>
        exampleFindings(sql).map((code) => `${skill.name}/${path}: ${code}`),
      ),
    );
    expect(noisy).toEqual([]);
  });
});
