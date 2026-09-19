/**
 * Registers happy-dom globally so React can render in `bun test`, and stamps the release
 * the way a Vite build would. Preloaded via bunfig.toml, so every UI test gets a document
 * and a build stamp without importing this itself.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import { GlobalRegistrator } from "@happy-dom/global-registrator";

/**
 * With a URL, because a browser always has one and `about:blank` reports its origin as the
 * string `"null"`. Better Auth reads `window.location.origin` when no base URL is configured
 * and refuses `"null"` outright -- and `@/auth` builds that client at module scope, so any
 * suite reaching `SignIn` (which is every suite that renders `App`) would fail on an import
 * rather than on anything it asserts. The host is invented, per `.claude/rules/pii.md`, and
 * nothing asserts it.
 */
GlobalRegistrator.register({ url: "https://undercroft.test/" });

/**
 * `bun test` does not run `vite.config.ts`, so `__UNDERCROFT_RELEASE__` would be undefined
 * and `@/lib/release` would throw the moment anything imported it. It is read from the
 * same root package.json the Vite build reads rather than pinned to an invented version,
 * so a test asserting the shape of the tag asserts it about the real one.
 */
const root = fileURLToPath(new URL("../../../../package.json", import.meta.url));
const { version } = JSON.parse(readFileSync(root, "utf8")) as { version: string };

(globalThis as { __UNDERCROFT_RELEASE__?: string }).__UNDERCROFT_RELEASE__ = `v${version}`;
