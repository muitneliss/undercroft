/**
 * Which tag of the Postgres image (ADR 0155) each compose file names, pinned against the two
 * ways it can quietly be wrong.
 *
 * The development file builds the recipe when it cannot pull the private package, under the tag
 * it names. A recipe bump that left that tag behind would build the new recipe under the old
 * name -- an image that lies about what it is, on every laptop and in `task ci:itest`, while the
 * PR that bumped it believed it was testing the new one. So the development file names exactly
 * the tag `deploy/Dockerfile.postgres`'s ARGs make, `<PG_MAJOR>-pgts<PG_TEXTSEARCH_VERSION>`,
 * which is how `task build:postgres-image` derives it.
 *
 * The server file is deliberately NOT held to the recipe: it names a tag only once that tag is
 * published, so in the PR that bumps the recipe it rightly lags. What it may never do is follow
 * the release pointer, as every other image of ours does: compose ships from `main` and a
 * rollback runs it against an older release's images, so a release-built Postgres tag would be
 * one a rollback cannot find. The install file is held to the server's image by
 * `packages/setup/src/composeDrift.test.ts`.
 */

import { expect, test as it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..");

interface ComposeFile {
  readonly services: Readonly<Record<string, { readonly image?: string }>>;
}

async function postgresImage(file: string): Promise<string | undefined> {
  const text = await readFile(join(REPO, "deploy", "compose", file), "utf8");
  return (Bun.YAML.parse(text) as ComposeFile).services.postgres?.image;
}

async function dockerfileArg(name: string): Promise<string | undefined> {
  const dockerfile = await readFile(join(REPO, "deploy", "Dockerfile.postgres"), "utf8");
  return new RegExp(`^ARG ${name}=(?<value>\\S+)$`, "mu").exec(dockerfile)?.groups?.value;
}

it("the development compose names the tag the Postgres recipe makes", async () => {
  const major = await dockerfileArg("PG_MAJOR");
  const textsearch = await dockerfileArg("PG_TEXTSEARCH_VERSION");
  expect(major).toBeDefined();
  expect(textsearch).toBeDefined();

  expect(await postgresImage("docker-compose.yml")).toBe(
    `ghcr.io/muitneliss/undercroft-postgres:${major}-pgts${textsearch}`,
  );
});

it("the server compose pins the Postgres image by its recipe, never by the release", async () => {
  expect(await postgresImage("docker-compose.server.yml")).toMatch(
    /^ghcr\.io\/muitneliss\/undercroft-postgres:\d+-pgts\d+\.\d+\.\d+$/u,
  );
});
