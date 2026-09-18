/**
 * The control-plane HTTP surface: tRPC at /trpc, plus the plain routes whose callers are
 * not TypeScript clients (health, and OAuth redirects a provider drives), plus the built
 * SPA served at the same origin.
 *
 * Same-origin is not incidental: the SPA's tRPC client calls `/trpc` with no configured
 * base URL, so the browser attaches the session cookie automatically. Serving the app from
 * anywhere else would mean CORS and a cross-site cookie, which is the arrangement ADR 0004
 * set out to avoid.
 *
 * The control plane is one of the two long-running services and is deliberately
 * stoppable: it holds no pipeline and runs no connector, so stopping it leaves ingestion
 * (Kestra -> worker -> lake -> raw) untouched. ADR 0004.
 */

// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: These are the functions that hold one decision each -- the connector page loop, the deploy poller, the grant migration -- and the way to shorten them is to split one sequential procedure across several names, which makes the order it happens in harder to follow rather than easier.
// biome-ignore-all lint/correctness/noNodejsModules: This is server code running on Bun. `node:` builtins are the platform here, not a portability hazard -- the rule exists for code that must also run in a browser.
// biome-ignore-all lint/correctness/noUndeclaredVariables: Globals the runtime supplies that Biome's resolver does not model -- Bun's own `Bun`, and DOM globals in .tsx files. tsc resolves all of them, and tsc is the check that binds here.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/nursery/useNamedCaptureGroup: These regexes match one thing and read it out of group 1 on the next line. A name helps a pattern with several groups; every one of these has one.
// biome-ignore-all lint/performance/noBarrelFile: `index.ts` is each package's public entry point, which is the seam `.claude/rules/layering.md` is built on and what `.claude/rules/tests.md` means by testing through the public API. The re-export cost the rule is about applies to a bundle; these are workspace packages consumed by name.
// biome-ignore-all lint/performance/useTopLevelRegex: Worth doing, and deliberately not done here: hoisting these literals touches many files and belongs in its own commit where the diff is reviewable, rather than buried in a lint migration. Recorded rather than silently dropped.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useDestructuring: Style preference with no correctness content, and it fires where the current form names the source of the value (`params.tenantId`), which is the thing worth seeing at the call site.
// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. That ordering carries meaning; the rule's preferred one does not.

import { extname, join, normalize, sep } from "node:path";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { type EmailSender, type Locale, negotiateLocale } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import { Hono } from "hono";
import { appUserForEmail } from "../services/invite.ts";
import { invitationMessage } from "../services/people.ts";
import { isSuperadmin, NO_SUPERADMINS, type Superadmins } from "../services/superadmin.ts";
import type { Auth } from "./auth.ts";
import { appRouter } from "./router.ts";
import type { Context, SessionUser } from "./trpc.ts";

/**
 * Content types for the handful of extensions a Vite build emits. Explicit rather than
 * inferred from a BunFile, so the response body is a plain byte array that behaves the same
 * under Bun and under the test harness's DOM globals -- an unknown extension is served as
 * an opaque download rather than guessed.
 */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json",
};

export interface ServerDeps {
  readonly exec: SqlExecutor;
  /**
   * Sign-in. When unset — a test of static serving, or a process deliberately started with
   * no way in — `/api/auth/*` does not exist and every request is unauthenticated.
   */
  readonly auth?: Auth;
  /**
   * Tells an invited person they have access. Optional: with no mail configured an
   * invitation is still created and still valid, and the admin is told it was not sent.
   */
  readonly email?: EmailSender;
  /** The origin to put in an invitation email. Without it, no invitation mail is sent. */
  readonly publicUrl?: string;
  /**
   * The addresses from `UNDERCROFT_SUPERADMINS`, which hold `admin` in every tenant.
   *
   * Absent means none, and an install that names none behaves exactly as it did before
   * ADR 0013. Passed in rather than read here: this is a layer, and `layer-injected-deps`
   * keeps configuration substitutable by the composition root that owns it.
   */
  readonly superadmins?: Superadmins;
  /**
   * Absolute path to the built SPA (`apps/ui/dist`). When set, the app serves those files
   * and falls back to `index.html` for client-side routes. When unset — a test, or a
   * process with no UI baked in — only `/api` and `/trpc` exist, and everything else 404s.
   */
  readonly uiDist?: string;
}

export function createServer(deps: ServerDeps): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true }));

  // Registered BEFORE the SPA catch-all below, and with `all` rather than `get`. Both
  // matter: the catch-all answers any GET with index.html, so an auth route registered
  // after it would turn Google's redirect to /api/auth/callback/google into a 200 serving
  // the app shell -- a sign-in that silently never completes.
  if (deps.auth !== undefined) {
    const auth = deps.auth;
    app.all("/api/auth/*", (c) => auth.handler(c.req.raw));
  }

  app.all("/trpc/*", async (c) => {
    const headers = c.req.raw.headers;
    const { user, sessionId, superadmin } = await resolveCaller(deps, headers);
    const auth = deps.auth;
    // Resolved once, from the request, and carried on the context. Every refusal this
    // request produces and every email it causes to be sent is worded in it -- including the
    // invitation, which goes to somebody whose own language nobody here knows. See `../i18n`.
    const locale = negotiateLocale(headers.get("accept-language"));

    return await fetchRequestHandler({
      endpoint: "/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext: (): Context => ({
        exec: deps.exec,
        user,
        sessionId,
        superadmin,
        locale,
        endSession: async () => {
          if (auth !== undefined) {
            await auth.api.signOut({ headers });
          }
        },
        notifyInvitation: (to, tenantId): Promise<boolean> =>
          sendInvitation(deps, to, tenantId, locale),
      }),
    });
  });

  // Registered LAST, so /api and /trpc above always win over the catch-all. A request for a
  // real built asset gets that file; anything else gets index.html, because the router lives
  // in the browser and a deep link like /tenants/42 is the SPA's to resolve, not a 404.
  if (deps.uiDist !== undefined) {
    const dist = deps.uiDist;
    const indexHtml = join(dist, "index.html");

    app.get("/*", async (c) => {
      const asset = await resolveAsset(dist, c.req.path);
      const path = asset ?? indexHtml;
      const file = Bun.file(path);
      if (!(await file.exists())) {
        return c.notFound();
      }
      // A hashed asset filename is immutable; index.html must never be, or a deploy ships a
      // shell that keeps pointing at the previous build's bundles.
      const immutable = asset !== null && asset !== indexHtml;
      return new Response(new Uint8Array(await file.arrayBuffer()), {
        headers: {
          "content-type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
          "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
        },
      });
    });
  }

  return app;
}

/**
 * Tell an invited person they have access, and say whether it went.
 *
 * The wording is `people.invitationMessage`, shared with `bun run invite` so the two ways of
 * inviting cannot drift into saying different things. What is left here is the transport:
 * which sender, and what a failure means.
 *
 * A failed send is reported as `false`, never raised. The invitation is already written and
 * already valid; turning a mail outage into a failed invitation would throw away work the
 * admin would have to repeat.
 */
async function sendInvitation(
  deps: ServerDeps,
  to: string,
  tenantId: string,
  locale: Locale,
): Promise<boolean> {
  const { email, publicUrl } = deps;
  if (email === undefined || publicUrl === undefined) {
    return false;
  }

  try {
    await email.send(invitationMessage(to, tenantId, publicUrl, locale));
    return true;
  } catch {
    return false;
  }
}

/**
 * Who is calling, in the two steps that sign-in is made of.
 *
 * Better Auth verifies the signed cookie and reads its session row — the database read that
 * makes a revoked session stop working at once. That yields an *authenticated address*.
 * `appUserForEmail` then turns the address into the `app_user` uuid that memberships are
 * keyed by, which is the only id a procedure may act on.
 *
 * An authenticated address with no `app_user` resolves to `null`, not to a session. That is
 * the case where someone's account was removed while they still hold a valid cookie: they
 * are who they say they are, and they are nobody here.
 *
 * Platform authority is decided here too, and only here. It is read off the environment
 * list against the address in the session on **every request**, which is what makes removal
 * from `UNDERCROFT_SUPERADMINS` take effect at the next request rather than whenever a
 * session happens to expire. `superadmin` is false whenever `user` is null -- including for
 * a superadmin whose `app_user` row is missing -- because a caller the platform cannot
 * identify must not carry authority over it.
 */
async function resolveCaller(
  deps: ServerDeps,
  headers: Headers,
): Promise<{ user: SessionUser | null; sessionId: string; superadmin: boolean }> {
  if (deps.auth === undefined) {
    return { user: null, sessionId: "", superadmin: false };
  }

  const resolved = await deps.auth.api.getSession({ headers });
  if (resolved === null) {
    return { user: null, sessionId: "", superadmin: false };
  }

  const appUser = await appUserForEmail(deps.exec, resolved.user.email);
  if (appUser === null) {
    return { user: null, sessionId: "", superadmin: false };
  }

  return {
    superadmin: isSuperadmin(deps.superadmins ?? NO_SUPERADMINS, appUser.email),
    user: { userId: appUser.appUserId, email: appUser.email },
    sessionId: resolved.session.id,
  };
}

/**
 * Map a URL path to a file inside `dist`, or null to fall back to index.html. Returns null
 * for `/` and for anything that escapes `dist` — a request for `/../secrets` normalizes and
 * is refused rather than reaching outside the build.
 */
async function resolveAsset(dist: string, urlPath: string): Promise<string | null> {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.(\/|\\|$))+/u, "");
  if (rel === "/" || rel === "." || rel === sep) {
    return null;
  }
  const candidate = join(dist, rel);
  if (candidate !== dist && !candidate.startsWith(dist + sep)) {
    return null;
  }
  return (await Bun.file(candidate).exists()) ? candidate : null;
}

export type { AppRouter } from "./router.ts";
export { appRouter } from "./router.ts";
