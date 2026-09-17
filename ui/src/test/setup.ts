import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "./server";
import { resetStore } from "./store";

// `error` rather than `warn`: a component that calls an endpoint nobody modelled
// must fail here, loudly, rather than quietly receiving nothing and rendering an
// empty state that looks deliberate.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
  server.resetHandlers();
  resetStore();
  cleanup();
});

afterAll(() => server.close());
