// biome-ignore-all lint/correctness/noUnresolvedImports: `react` and `pg` resolve through the workspace package that depends on them; Biome's module resolver does not walk a Bun workspace layout. tsc and the build both resolve them.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@undercroft/control-plane/router";
import type { Locale } from "@undercroft/core/locale";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.tsx";
import { useUiStore } from "./store.ts";
import { trpc } from "./trpc.ts";
// Side-effect import: builds the i18next singleton and starts following the store's locale.
// It must be imported before anything renders, or the first paint is unlocalised.
import "./i18n/index.ts";
// Side-effect import: Vite extracts this into a hashed CSS asset the control plane serves.
import "./index.css";

// Module-level singletons, deliberately not `useState(() => ...)` as the tRPC docs show.
// That pattern exists to give each SSR request its own client; this is a browser-only SPA,
// so one client per tab is correct -- and `.claude/rules/state.md` bans `useState` outright.
const queryClient = new QueryClient({
  defaultOptions: {
    // A control plane is read repeatedly while someone works through setup; a short stale
    // window keeps a connection card from claiming "connected" after it was undone elsewhere.
    queries: { staleTime: 5000, retry: 1 },
  },
});

// Same-origin: the browser sends the session cookie automatically, so no custom fetch is
// needed. The control plane serves /trpc on the same origin the SPA is served from.
//
// `accept-language` is read per request rather than captured once, so a language chosen
// mid-session applies to the next call: the server composes an invitation email and a
// refusal message in it, and those must be in the language the operator is looking at.
const link = httpBatchLink({
  url: "/trpc",
  headers: () => ({ "accept-language": useUiStore.getState().locale }),
});
const trpcClient = trpc.createClient({ links: [link] });

/**
 * Tell the server when the reader changes language, so the emails it sends while no page
 * is open -- a failed run at three in the morning -- arrive in it.
 *
 * The store stays the owner of the choice; this is a projection of it, exactly like the
 * one `i18n/index.ts` makes into i18next and onto `<html lang>`. It lives here rather than
 * in `i18n/index.ts` because that module must stay network-free for the tests that render
 * with it. Only while signed in: an anonymous reader has nobody to record it against, and
 * signing in records the request's language itself. A failed call is left alone -- the
 * store is still right, and the next change or the next sign-in records it again.
 */
const vanilla = createTRPCClient<AppRouter>({ links: [link] });
let recordedLocale: Locale = useUiStore.getState().locale;
useUiStore.subscribe((state) => {
  if (state.locale === recordedLocale) {
    return;
  }
  recordedLocale = state.locale;
  const signedIn = queryClient
    .getQueryCache()
    .findAll({ queryKey: [["session", "me"]] })
    .some((query) => query.state.status === "success");
  if (signedIn) {
    vanilla.session.setLocale.mutate({ locale: state.locale }).catch(() => undefined);
  }
});

const root = document.querySelector("#root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          {/*
           * `App` renders <Routes>, which throws without a Router above it. Until sign-in
           * existed this was unreachable -- `session.me` always failed, so `App` always
           * returned the title page, which uses no router hooks. The first successful login
           * would have crashed the app on its first render.
           *
           * BrowserRouter, not Hash or Memory: the control plane already serves index.html
           * for any unmatched path, so a deep link like /tenants/42 and a reload both land
           * on the SPA and the URL stays the thing you can paste to a colleague.
           */}
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </trpc.Provider>
    </StrictMode>,
  );
}
