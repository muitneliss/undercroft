/**
 * The minimal database seam the migration runner and repos speak.
 *
 * Narrow on purpose, so the same migrations and the same privilege assertions run against
 * both a real `pg` pool and an in-process PGlite database. PGlite is real Postgres
 * compiled to WASM -- it supports `CREATE ROLE` and `SET ROLE`, which is what moves the
 * privilege tests into the offline gate rather than the Docker tier.
 */

/** One column of a result, as the server described it: its name and its type's OID. */
export interface QueryField {
  readonly name: string;
  readonly dataTypeID: number;
}

export interface QueryResult<T> {
  readonly rows: T[];
  /**
   * The result's columns in order, when the driver reports them. Repos never need this --
   * they name their columns -- but a query an author wrote has columns nobody named in
   * advance, and this is how the runner learns them.
   */
  readonly fields?: readonly QueryField[];
}

export interface SqlExecutor {
  /** Run one statement with parameters. */
  query: <T = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ) => Promise<QueryResult<T>>;
  /** Run a batch of statements with no parameters -- a whole migration file. */
  exec: (sql: string) => Promise<void>;
}
