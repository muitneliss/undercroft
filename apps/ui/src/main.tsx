// biome-ignore-all lint/correctness/noUnresolvedImports: `react` and `pg` resolve through the workspace package that depends on them; Biome's module resolver does not walk a Bun workspace layout. tsc and the build both resolve them.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.tsx";
import { trpc } from "./trpc.ts";
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
const trpcClient = trpc.createClient({
  links: [httpBatchLink({ url: "/trpc" })],
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
