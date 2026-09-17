import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
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
    queries: { staleTime: 5_000, retry: 1 },
  },
});

// Same-origin: the browser sends the session cookie automatically, so no custom fetch is
// needed. The control plane serves /trpc on the same origin the SPA is served from.
const trpcClient = trpc.createClient({
  links: [httpBatchLink({ url: "/trpc" })],
});

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </trpc.Provider>
    </StrictMode>,
  );
}
