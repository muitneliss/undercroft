/**
 * Registers happy-dom globally so React can render in `bun test`, and stamps the release
 * the way a Vite build would. Preloaded via bunfig.toml, so every UI test gets a document
 * and a build stamp without importing this itself.
 */

// biome-ignore-all lint/correctness/noNodejsModules: This is server code running on Bun. `node:` builtins are the platform here, not a portability hazard -- the rule exists for code that must also run in a browser.
// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys, HTTP header names, and Better Auth's option keys and table names. strictCase cannot be satisfied by code that talks to another system.
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

/**
 * `bun test` does not run `vite.config.ts`, so `__UNDERCROFT_RELEASE__` would be undefined
 * and `@/lib/release` would throw the moment anything imported it. It is read from the
 * same root package.json the Vite build reads rather than pinned to an invented version,
 * so a test asserting the shape of the tag asserts it about the real one.
 */
const root = fileURLToPath(new URL("../../../../package.json", import.meta.url));
const { version } = JSON.parse(readFileSync(root, "utf8")) as { version: string };

(globalThis as { __UNDERCROFT_RELEASE__?: string }).__UNDERCROFT_RELEASE__ = `v${version}`;
