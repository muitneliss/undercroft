/**
 * A tenant's dbt project on disk: rendered the one way, written to a directory that exists for
 * one dbt process, and read back from what dbt wrote under `target/`.
 *
 * Apart from `transform.ts` because two verbs stand on it -- a build (`runTransform`) and a model
 * preview (`modelPreview.ts`, ADR 0132) -- and the promise both need is that they see the SAME
 * project for the same rows. A preview that rendered on its own would compile something a build
 * of the same text does not, which is the drift the preview exists to remove.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { DatabaseAddress } from "@undercroft/db";
import type { Seed } from "@undercroft/db/repos";
import { type ProjectMacro, type ProjectModel, renderProject } from "@undercroft/db/services";

import { projectSeeds } from "./seedLoad.ts";
import type { TenantSessions } from "./tenantSession.ts";

/** What a tenant's project is made of, as `renderProject` takes it. */
export interface ProjectParts {
  readonly models: readonly ProjectModel[];
  readonly macros: readonly ProjectMacro[];
  readonly seeds: readonly Seed[];
}

/**
 * Every file of the tenant's project, rendered the one way a build renders it: its seeds loaded
 * as `seedLoad.ts` decides against what stands in staging, its profile the tenant's dbt login.
 */
export async function tenantProjectFiles(
  deps: { readonly database: DatabaseAddress; readonly sessions: TenantSessions },
  input: { tenantId: string; roles: { slug: string; stagingSchema: string } } & ProjectParts,
): Promise<Record<string, string>> {
  const loads = await projectSeeds(deps.sessions, {
    tenantId: input.tenantId,
    schema: input.roles.stagingSchema,
    seeds: input.seeds,
  });
  return renderProject({
    slug: input.roles.slug,
    database: deps.database,
    models: input.models.map((m) => ({
      name: m.name,
      sql: m.sql,
      tests: m.tests,
      description: m.description,
    })),
    macros: input.macros.map((m) => ({ name: m.name, sql: m.sql })),
    seeds: loads,
  });
}

async function writeProject(dir: string, files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    const full = join(dir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, text, "utf8");
  }
}

/**
 * `files` written to a fresh directory that exists for `fn` alone, and is removed however `fn`
 * ends. A directory made for one run cannot drift from the rows it was written from.
 */
export async function inProjectDir<T>(
  workDir: string | undefined,
  files: Record<string, string>,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(workDir ?? tmpdir(), "undercroft-dbt-"));
  try {
    await writeProject(dir, files);
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** One of the JSON files dbt writes under `target/`, or `null` when it wrote none readable. */
export async function readTarget(dir: string, file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(dir, "target", file), "utf8"));
  } catch {
    return null;
  }
}
