/**
 * The sources a tenant's dbt project declares, as data, read from `SOURCES_YML` itself.
 *
 * A model reaches the raw layer only through these, so a check of a model's `source()` calls
 * needs the list -- and a second, hand-written copy of it would be free to disagree with the
 * YAML dbt actually reads. So this reads that text, by the fixed indentation the platform
 * writes it with, and `modelCheck.test.ts` pins the reading.
 */

import { SOURCES_YML } from "./dbtProject.ts";

export interface SourceDeclaration {
  readonly name: string;
  readonly schema: string;
  readonly tables: readonly string[];
}

const SOURCE_LINE = /^ {2}- name: (?<name>\w+)$/u;
const SCHEMA_LINE = /^ {4}schema: (?<schema>\w+)$/u;
const TABLE_LINE = /^ {6}- name: (?<table>\w+)$/u;

/** The sources `SOURCES_YML` declares, read from its own text by its fixed indentation. */
function sourceDeclarations(): SourceDeclaration[] {
  const declared: { name: string; schema: string; tables: string[] }[] = [];
  for (const line of SOURCES_YML.split("\n")) {
    const source = SOURCE_LINE.exec(line)?.groups?.name;
    const current = declared.at(-1);
    if (source !== undefined) {
      declared.push({ name: source, schema: "", tables: [] });
    } else if (current !== undefined) {
      current.schema = SCHEMA_LINE.exec(line)?.groups?.schema ?? current.schema;
      const table = TABLE_LINE.exec(line)?.groups?.table;
      if (table !== undefined) {
        current.tables.push(table);
      }
    }
  }
  return declared;
}

export const SOURCES: readonly SourceDeclaration[] = sourceDeclarations();

/** Each declared source's tables, by source name. Exported so a test can pin the reading. */
export function declaredSources(): ReadonlyMap<string, readonly string[]> {
  return new Map(SOURCES.map((source) => [source.name, source.tables]));
}
