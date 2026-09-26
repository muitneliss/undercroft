/**
 * The repository's skills, served over `/mcp` by the MCP Skills extension. ADR 0066.
 *
 * `io.modelcontextprotocol/skills` (SEP-2640) lets a host discover a server's Agent Skills and
 * read them: `skills/list` and `skills/get` answer each skill's `SKILL.md` URI, its frontmatter
 * unchanged and a manifest of every file with its SHA-256 and size, and every file is read
 * through `resources/read` at `skill://<name>/<path>`. The skills are `skills/` at the
 * repository root -- the same files `npx skills add` installs -- read once at boot by
 * `skills.ts`; nothing here writes or reshapes them.
 *
 * Three things this holds to:
 *
 * - **A file is served only if a manifest lists it.** A read looks the URI up among the
 *   manifests' entries, which hold the bytes read at boot; it never joins a URI onto a path, so
 *   `skill://undercroft/../x` names nothing and cannot reach the disk. An unknown skill or
 *   file is `-32602`, as the extension specifies.
 * - **The extension is declared only when there is a skill to serve**, the rule the widgets
 *   follow: a host is never told of a capability that answers nothing.
 * - **Any grant may read a skill.** A skill is content, not an operation: it changes nothing
 *   and holds nothing a person's own data could leak through. The bearer is still required,
 *   as for every `/mcp` request, so this is the door's reach and no wider.
 */

import { ProtocolError, ProtocolErrorCode, type Server } from "@modelcontextprotocol/server";
import type { Locale } from "@undercroft/core";
import { z } from "zod";
import { messages } from "../i18n/index.ts";

/** The extension's identifier, as a server declares it among its capabilities. */
export const SKILLS_EXTENSION = "io.modelcontextprotocol/skills";

/** Exactly the two shapes a resource's contents may take, so it spreads into one. */
export type SkillContent = { readonly text: string } | { readonly blob: string };

export interface SkillFile {
  readonly uri: string;
  readonly mimeType: string;
  readonly digest: `sha256:${string}`;
  readonly size: number;
  readonly content: SkillContent;
}

export interface Skill {
  readonly name: string;
  /** Its `SKILL.md`, which is how a host names the skill. */
  readonly uri: string;
  /** Every field the frontmatter holds, unchanged. */
  readonly frontmatter: Readonly<Record<string, unknown>>;
  /** `SKILL.md` first, then every other file by path. */
  readonly files: readonly SkillFile[];
}

export const NO_SKILLS: readonly Skill[] = [];

/**
 * How long a host may keep an answer before asking again. The skills change only with a
 * release, and a release restarts this process; five minutes bounds how long a host keeps the
 * last release's text after one.
 */
const TTL_MS = 5 * 60 * 1000;

/**
 * The same for every caller: the skills are the public repository's, and no answer depends on
 * who asked. So a host may share what it cached across the people it serves.
 */
const CACHE = { resultType: "complete", ttlMs: TTL_MS, cacheScope: "public" } as const;

const ListParams = z.object({ cursor: z.string().optional() }).passthrough();
const GetParams = z.object({ uri: z.string() }).passthrough();

/** A skill as `skills/list` and `skills/get` describe it: its frontmatter and its manifest. */
interface SkillEntry {
  readonly uri: string;
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly resources: readonly { uri: string; digest: string; size: number }[];
}

function entryOf(skill: Skill): SkillEntry {
  return {
    uri: skill.uri,
    frontmatter: skill.frontmatter,
    resources: skill.files.map(({ uri, digest, size }) => ({ uri, digest, size })),
  };
}

/** The capabilities to declare: the extension, and the resources it reads through. */
export function skillCapabilities(skills: readonly Skill[]): {
  readonly extensions?: Record<string, Record<string, never>>;
} {
  return skills.length === 0 ? {} : { extensions: { [SKILLS_EXTENSION]: {} } };
}

/** Answer `skills/list` and `skills/get` on this server. Registers nothing without skills. */
export function registerSkills(server: Server, skills: readonly Skill[], locale: Locale): void {
  if (skills.length === 0) {
    return;
  }
  const byUri = new Map(skills.map((skill) => [skill.uri, skill]));
  // One page: two skills of a few kilobytes each are far below any size worth a cursor, and
  // every entry is atomic by the extension's rule, so a page could never split one anyway.
  server.setRequestHandler("skills/list", { params: ListParams }, () => ({
    ...CACHE,
    skills: skills.map(entryOf),
  }));
  server.setRequestHandler("skills/get", { params: GetParams }, (params) => {
    const skill = byUri.get(params.uri);
    if (skill === undefined) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        messages(locale)("mcp.unknownResource", { uri: params.uri }),
      );
    }
    return { ...CACHE, skill: entryOf(skill) };
  });
}

/**
 * The file at `uri` as `resources/read` answers it, or `null` when the URI is not one of a
 * skill's files -- the caller decides whether that is a widget's URI or nobody's.
 */
export function readSkillFile(
  uri: string,
  skills: readonly Skill[],
): { contents: [{ uri: string; mimeType: string } & SkillContent] } | null {
  for (const skill of skills) {
    const file = skill.files.find((candidate) => candidate.uri === uri);
    if (file !== undefined) {
      return { contents: [{ uri: file.uri, mimeType: file.mimeType, ...file.content }] };
    }
  }
  return null;
}
