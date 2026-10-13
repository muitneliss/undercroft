/**
 * `GET /cli/undercroft-cli.tgz`: the CLI of this server's own build, for `npm install -g`.
 * ADR 0135.
 *
 * The person who needs the CLI has a sign-in to THIS server, not to the repository the releases
 * are attached to, and the CLI they need is the one built from the same commit: its commands are
 * the router's procedures at build time (`apps/cli/scripts/build.ts`). The image packs it with
 * the release script and carries it; `cliTarball.ts` reads it once at boot; this serves the bytes.
 *
 * Unauthenticated, like the SPA's own bundles. What is in it is a client of `/trpc`: each
 * procedure's path, input schema and sentences, which the SPA's bundle and `/trpc`'s answers
 * already show anyone who asks. It holds no secret and reaches nothing a request cannot.
 *
 * NEVER THE APP SHELL. Nothing under `/cli/` is a route of the browser's, so a miss here is a
 * 404 in the caller's language -- a server started from a checkout carries no tarball, and a
 * name an agent guessed is not one. Left to the SPA's catch-all, either would be a 200 of HTML
 * that npm fails on as `TAR_BAD_ARCHIVE`, which reads like a corrupt release rather than a
 * server with nothing to install.
 */

import { negotiateLocale } from "@undercroft/core";
import type { Hono } from "hono";
import { messages } from "../i18n/index.ts";

/** The one name the tarball is served under: a fixed URL, whichever release this server is. */
const CLI_TARBALL_ROUTE = "/cli/undercroft-cli.tgz";

export function registerCliRoute(app: Hono, tarball: Uint8Array | undefined): void {
  app.get(CLI_TARBALL_ROUTE, (c) => {
    if (tarball === undefined) {
      return absent(c.req.header("accept-language"));
    }
    return new Response(tarball, {
      headers: {
        "content-type": "application/gzip",
        "content-disposition": 'attachment; filename="undercroft-cli.tgz"',
        // One URL for every release, so a cache must ask again: after a deploy it holds the
        // last release's CLI, which no longer matches this server's procedures.
        "cache-control": "no-cache",
      },
    });
  });
  app.get("/cli/*", (c) => absent(c.req.header("accept-language")));
}

function absent(acceptLanguage: string | undefined): Response {
  const t = messages(negotiateLocale(acceptLanguage ?? null));
  return new Response(t("cli.absent"), {
    status: 404,
    headers: { "content-type": "text/plain;charset=utf-8", "cache-control": "no-store" },
  });
}
