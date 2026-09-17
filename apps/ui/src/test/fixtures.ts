/**
 * Test fixtures for the pure presentation logic.
 *
 * A `Connection` has many fields the connection-state logic never reads; this builder
 * fills them with inert defaults so a test can state only the fields under test. It is not
 * a network fake -- the design's MSW store did not survive the move to `bun test`, and the
 * kept tests exercise pure functions rather than components, so they need no server.
 */

import type { Connection, Source } from "@/api/types";

export function connection(source: Source, over: Partial<Connection> = {}): Connection {
  return {
    source,
    status: "disconnected",
    external_account_id: "",
    external_account_label: "",
    scopes: [],
    config: {},
    schedule_cron: "",
    last_run_id: "",
    expires_at: null,
    ...over,
  };
}
