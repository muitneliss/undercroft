/**
 * Test fixtures for the pure presentation logic.
 *
 * A `Connection` has many fields the connection-state logic never reads; this builder fills
 * them with inert defaults so a test can state only the fields under test. It is not a
 * network fake -- the kept tests exercise pure functions, not components, so they need no
 * server.
 */

import type { Connection, Source } from "@/api/types";

export function connection(source: Source, over: Partial<Connection> = {}): Connection {
  return {
    source,
    status: "disconnected",
    externalAccountId: "",
    externalAccountLabel: "",
    scopes: [],
    config: {},
    scheduleCron: "",
    lastRunId: "",
    expiresAt: null,
    ...over,
  };
}
