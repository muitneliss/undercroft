/**
 * A relation AS a tenant: its columns and its first rows, what the catalogue holds, what reads
 * from it, and dropping it.
 *
 * Every statement here runs on an executor that is already the tenant's own login (see
 * `services/tenantSession.ts`), so what it can see -- and what it may drop, which is only what
 * it owns -- is what Postgres lets that login do and nothing this module decides. Identifiers are quoted, never interpolated bare: a model name
 * has passed the contract's rule before it is a row, but a relation dbt named for a test is
 * dbt's to spell.
 */

import type { SqlExecutor } from "@undercroft/db";

export interface Column {
  readonly name: string;
  /** Postgres's own name for the type: `numeric`, `integer`, `text`, `timestamp with time zone`. */
  readonly type: string;
}

/** `"name"`, with any quote in the name doubled. The only safe way to splice an identifier. */
export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** The relation's columns in table order, or none when the login cannot see such a relation. */
export async function columnsOf(
  exec: SqlExecutor,
  schema: string,
  relation: string,
): Promise<Column[]> {
  const { rows } = await exec.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, relation],
  );
  return rows.map((r) => ({ name: r.column_name, type: r.data_type }));
}

/**
 * The first `limit + 1` rows, as arrays in `columns` order. One more than asked, so the
 * caller can say the page was cut rather than guess from a full one.
 */
export async function firstRows(
  exec: SqlExecutor,
  target: { schema: string; relation: string; columns: readonly Column[]; limit: number },
): Promise<unknown[][]> {
  if (target.columns.length === 0) {
    return [];
  }
  const list = target.columns.map((c) => quoteIdent(c.name)).join(", ");
  const from = `${quoteIdent(target.schema)}.${quoteIdent(target.relation)}`;
  const { rows } = await exec.query<Record<string, unknown>>(
    `SELECT ${list} FROM ${from} LIMIT $1`,
    [target.limit + 1],
  );
  return rows.map((row) => target.columns.map((c) => row[c.name]));
}

/** The kinds of relation that hold rows, as `DROP` spells them. */
export type RelationKind = "table" | "view" | "materialized view";

export interface Relation {
  readonly schema: string;
  readonly name: string;
  readonly kind: RelationKind;
}

/**
 * `pg_class.relkind` for each kind that holds rows. A partitioned table is dropped as a
 * table. An index, a sequence or a composite type holds no row a reader could see, and is
 * never listed.
 */
const KIND_OF: Readonly<Record<string, RelationKind>> = {
  r: "table",
  p: "table",
  v: "view",
  m: "materialized view",
};

const DROP_OF: Readonly<Record<RelationKind, string>> = {
  table: "DROP TABLE",
  view: "DROP VIEW",
  "materialized view": "DROP MATERIALIZED VIEW",
};

function relationOf(row: { schema: string; name: string; relkind: string }): Relation | null {
  const kind = KIND_OF[row.relkind];
  return kind === undefined ? null : { schema: row.schema, name: row.name, kind };
}

/** Every relation that holds rows in these schemas, read from the catalogue. */
export async function relationsIn(
  exec: SqlExecutor,
  schemas: readonly string[],
): Promise<Relation[]> {
  const { rows } = await exec.query<{ schema: string; name: string; relkind: string }>(
    `SELECT n.nspname AS schema, c.relname AS name, c.relkind::text AS relkind
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ANY($1::text[])
     ORDER BY n.nspname, c.relname`,
    [schemas],
  );
  return rows.flatMap((row) => relationOf(row) ?? []);
}

/**
 * The views and materialized views whose definition reads `relation`: what a `DROP ...
 * RESTRICT` of it would refuse over. Found through the rewrite rule each view is stored as.
 */
export async function dependentsOf(exec: SqlExecutor, relation: Relation): Promise<Relation[]> {
  const { rows } = await exec.query<{ schema: string; name: string; relkind: string }>(
    `SELECT DISTINCT vn.nspname AS schema, v.relname AS name, v.relkind::text AS relkind
     FROM pg_class t
     JOIN pg_namespace tn ON tn.oid = t.relnamespace
     JOIN pg_depend d ON d.refclassid = 'pg_class'::regclass AND d.refobjid = t.oid
     JOIN pg_rewrite r ON d.classid = 'pg_rewrite'::regclass AND r.oid = d.objid
     JOIN pg_class v ON v.oid = r.ev_class
     JOIN pg_namespace vn ON vn.oid = v.relnamespace
     WHERE tn.nspname = $1 AND t.relname = $2 AND v.oid <> t.oid
     ORDER BY 1, 2`,
    [relation.schema, relation.name],
  );
  return rows.flatMap((row) => relationOf(row) ?? []);
}

/**
 * Drop one relation, RESTRICT: never through to anything that depends on it. Postgres
 * refuses the drop to anyone but the relation's owner, which is the login that built it.
 */
export async function dropRelation(exec: SqlExecutor, relation: Relation): Promise<void> {
  await exec.query(
    `${DROP_OF[relation.kind]} ${quoteIdent(relation.schema)}.${quoteIdent(relation.name)} RESTRICT`,
  );
}

/**
 * `fn` inside one transaction on this executor: committed when it returns, rolled back when
 * it throws. The executor must be a single connection, as a tenant session's is, or the
 * statements between BEGIN and COMMIT could each take a different one.
 */
export async function inTransaction<T>(exec: SqlExecutor, fn: () => Promise<T>): Promise<T> {
  await exec.query("BEGIN");
  try {
    const value = await fn();
    await exec.query("COMMIT");
    return value;
  } catch (error) {
    await exec.query("ROLLBACK");
    throw error;
  }
}
