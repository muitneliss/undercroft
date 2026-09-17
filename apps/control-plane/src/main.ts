/**
 * The control plane's process entrypoint. Wires the real Postgres pool into the server and
 * listens on :3000.
 */

import { asExecutor, createPool } from "@undercroft/db";
import { createServer } from "./server.ts";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
}

const pool = createPool(required("UNDERCROFT_POSTGRES_DSN"));
// The image bakes the built SPA in and points here; a bare `bun run` with the variable
// unset serves the API alone. Spread so the optional stays absent rather than `undefined`,
// which exactOptionalPropertyTypes forbids.
const uiDist = process.env.UNDERCROFT_UI_DIST;
const app = createServer({
  exec: asExecutor(pool),
  ...(uiDist !== undefined && uiDist !== "" ? { uiDist } : {}),
});

// parseInt, not Number(): a port, not an amount.
const port = parseInt(process.env.UNDERCROFT_API_PORT ?? "3000", 10);
console.log(`undercroft control-plane listening on :${port}`);

export default { port, fetch: app.fetch };
