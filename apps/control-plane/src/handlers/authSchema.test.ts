/**
 * Better Auth's tables, as the library will use them, against the tables the migrations made.
 *
 * Every other suite runs Better Auth on its in-memory adapter, which accepts any field it is
 * handed -- so a mapping that names a column the database does not have, or a plugin upgrade
 * that adds a field nobody migrated, passes every one of them and fails the first sign-in,
 * consent or token refresh in production. This suite closes that gap from the library's side:
 * it takes the table list Better Auth itself derives from `authOptions` (`getAuthTables`, the
 * same list its own migrator reads) and holds each field to a column in the migrated schema,
 * as the control plane's own role sees it.
 */

import { beforeEach, describe, expect, test as it } from "bun:test";
import { InMemoryEmailSender } from "@undercroft/core";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { memoryAdapter } from "better-auth/adapters/memory";
import { getAuthTables } from "better-auth/db";
import { authOptions } from "./auth.ts";

/** How Better Auth's Postgres migrator types each kind of field, as `information_schema` says it. */
const COLUMN_TYPES: Readonly<Record<string, readonly string[]>> = {
  string: ["text"],
  boolean: ["boolean"],
  number: ["integer", "bigint"],
  date: ["timestamp with time zone"],
  json: ["jsonb"],
  // Its Kysely adapter writes an array as JSON text, which a `text[]` column would refuse.
  "string[]": ["jsonb"],
  "number[]": ["jsonb"],
};

interface Column {
  readonly table_name: string;
  readonly column_name: string;
  readonly data_type: string;
  readonly is_nullable: "YES" | "NO";
  readonly column_default: string | null;
}

let db: TestDatabase;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.become("undercroft_app");
});

/** Every table Better Auth writes, as the options the control plane builds it with name them. */
function tablesInUse(): ReturnType<typeof getAuthTables> {
  return getAuthTables(
    authOptions({
      database: memoryAdapter({}),
      exec: db,
      transactor: (fn) => fn(db),
      secret: "a-test-secret-that-is-long-enough-to-sign",
      // Loopback, so the MCP authorization server's plugins are in the list too.
      baseUrl: "http://localhost:3000",
      email: new InMemoryEmailSender(),
    }),
  );
}

/** What is wrong with one table: fields with no column or the wrong type, columns it skips. */
function problemsIn(
  table: ReturnType<typeof getAuthTables>[string],
  columns: readonly Column[],
): string[] {
  const written = new Map<string, string>([
    ["id", "string"],
    ...Object.entries(table.fields).map(([name, field]): [string, string] => [
      field.fieldName ?? name,
      String(field.type),
    ]),
  ]);
  const unfit = [...written].flatMap(([name, type]) => {
    const column = columns.find((candidate) => candidate.column_name === name);
    if (column === undefined) {
      return [`${table.modelName}.${name}: no such column`];
    }
    return (COLUMN_TYPES[type] ?? []).includes(column.data_type)
      ? []
      : [`${table.modelName}.${name}: ${column.data_type} cannot hold ${type}`];
  });
  const skipped = columns
    .filter((column) => column.is_nullable === "NO" && column.column_default === null)
    .filter((column) => !written.has(column.column_name))
    .map((column) => `${table.modelName}.${column.column_name}: required, never written`);
  return [...unfit, ...skipped];
}

describe("the tables Better Auth writes", () => {
  it("have a column of a type it can hold for every field, and no required column it skips", async () => {
    // As `undercroft_app`: `information_schema` shows a role only what it may touch, so a
    // column missing its grant is missing here too.
    const { rows } = await db.query<Column>(
      `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns WHERE table_schema = 'app'`,
    );
    const tables = Object.values(tablesInUse());
    const problems = tables.flatMap((table) =>
      problemsIn(
        table,
        rows.filter((column) => column.table_name === table.modelName),
      ),
    );

    // The table list is asserted too, so an options object that stopped naming the OAuth
    // plugins -- or no tables at all -- cannot pass by checking nothing.
    expect({ problems, tables: tables.map((table) => table.modelName).sort() }).toEqual({
      problems: [],
      tables: [
        "auth_account",
        "auth_jwks",
        "auth_session",
        "auth_user",
        "auth_verification",
        "oauth_access_token",
        "oauth_client",
        "oauth_client_assertion",
        "oauth_client_resource",
        "oauth_consent",
        "oauth_refresh_token",
        "oauth_resource",
      ],
    });
  });
});
