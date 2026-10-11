import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpLink } from "@trpc/client";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Prototype } from "./Prototype.tsx";
import "@/i18n/index.ts";
import "@/index.css";
import "@/features/models-workspace/workspace.css";
import "@/features/models-workspace/details.css";
import { trpc } from "@/trpc.ts";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
});
const client = trpc.createClient({
  links: [
    httpLink({
      url: "/trpc",
      fetch: (input) => {
        const procedure = new URL(String(input), location.href).pathname.split("/").at(-1);
        if (procedure === "tenants.get") {
          return Promise.resolve(
            Response.json({
              result: {
                data: {
                  id: "CASE-0042",
                  displayName: "CASE-0042",
                  role: "admin",
                  deactivatedAt: null,
                },
              },
            }),
          );
        }
        return Promise.resolve(
          Response.json(
            {
              error: {
                message: "Unavailable in the read-only prototype",
                code: -32_603,
                data: { code: "FORBIDDEN", httpStatus: 403 },
              },
            },
            { status: 403 },
          ),
        );
      },
    }),
  ],
});

const element = document.querySelector("#root");
if (!element) {
  throw new Error("Missing root element");
}
createRoot(element).render(
  <StrictMode>
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Prototype />
        </BrowserRouter>
      </QueryClientProvider>
    </trpc.Provider>
  </StrictMode>,
);
