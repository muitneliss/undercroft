/**
 * The tarball is read at boot, and a file that is not there must not stop the boot: the server
 * then serves everything but the CLI, and says why in its log. Both sides, because a loader
 * that always answered "none" would pass the first test alone.
 */

import { afterAll, beforeAll, expect, test as it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@undercroft/core";
import { loadCliTarball } from "./cliTarball.ts";

let dir: string;
const logged: Record<string, unknown>[] = [];
const log = createLogger({
  component: "control-plane",
  sink: (line) => logged.push(JSON.parse(line) as Record<string, unknown>),
});

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "undercroft-cli-tarball-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

it("answers the file's bytes", async () => {
  const path = join(dir, "undercroft-cli.tgz");
  await writeFile(path, new Uint8Array([0x1f, 0x8b, 0x08]));

  expect(loadCliTarball(log, path)).toEqual(new Uint8Array([0x1f, 0x8b, 0x08]));
});

it("answers none, and logs why, for a file the image does not carry", () => {
  expect(loadCliTarball(log, join(dir, "missing.tgz"))).toBeUndefined();
  expect(logged.map((line) => line.event)).toContain("cli_tarball_unloaded");
});
