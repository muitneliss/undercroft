import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "@/App";
import "@/index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A control plane is read repeatedly while someone works through setup.
      // Refetching on focus keeps a connection card from claiming "connected"
      // after the operator disconnected it in another tab.
      refetchOnWindowFocus: true,
      staleTime: 5_000,
      retry: 1,
    },
  },
});

const container = document.getElementById("root");
if (!container) throw new Error("no #root element");

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
