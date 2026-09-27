/**
 * `320_xero_reread.sql`: the one-off that sends every Xero stream back to a full read.
 *
 * A migration runs once, against a database that already has rows, and every test database is
 * fresh -- so the migrated fixture ran this against an empty table and proved nothing. It is
 * applied again here, over cursors seeded the way production holds them.
 */

import { afterEach, beforeEach, expect, test as it } from "bun:test";
import { loadMigrations } from "./migrate.ts";
import { createMigratedTestDatabase, type TestDatabase } from "./testing.ts";

const REREAD = loadMigrations().find((migration) => migration.name === "320_xero_reread.sql");

let db: TestDatabase;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.exec(`
    INSERT INTO raw.sync_cursor (source, tenant_id, entity, watermark, format) VALUES
      ('xero',        'CASE-0042', 'invoices', '/Date(1790395785607+0000)/', 'ms-json-date'),
      ('xero.acme01', 'CASE-0042', 'contacts', '/Date(1790394677450+0000)/', 'ms-json-date'),
      ('hubspot',     'CASE-0042', 'deals',    '1790394677450',              'epoch-millis'),
      ('xerox',       'CASE-0042', 'things',   '1790394677450',              'epoch-millis')`);
});

afterEach(async () => {
  await db.close();
});

async function sources(): Promise<string[]> {
  const { rows } = await db.query<{ source: string }>(
    "SELECT source FROM raw.sync_cursor ORDER BY source",
  );
  return rows.map((row) => row.source);
}

it("forgets every Xero watermark, a second Xero account's included", async () => {
  await db.exec(REREAD?.sql ?? "SELECT missing_migration()");

  expect(await sources()).not.toContain("xero");
  expect(await sources()).not.toContain("xero.acme01");
});

it("leaves every other source's watermark where it was", async () => {
  // The quiet side: a HubSpot mark forgotten costs a full read nobody asked for, and a source
  // whose name merely STARTS with `xero` is not Xero.
  await db.exec(REREAD?.sql ?? "SELECT missing_migration()");

  expect(await sources()).toEqual(["hubspot", "xerox"]);
});
