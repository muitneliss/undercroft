/**
 * Why `seeds.save` refuses a table, in English: `seedTable.vi.ts` answered key for key.
 */

import type { seedTable as vi } from "./seedTable.vi.ts";

export const seedTable: typeof vi = {
  problem: {
    "too-many-columns":
      "The reference table has more than {{max}} columns. Split it into a few smaller ones.",
    "too-many-rows":
      "The reference table has more than {{max}} rows. A reference table is a small one a person keeps; larger data belongs in the raw lake, landed as a document.",
    "too-large":
      "The reference table takes more than {{max}} bytes to store. Send fewer rows or columns, or land the data in the raw lake as a document.",
    "duplicate-column": "Two columns are named {{column}}. Each column needs a name of its own.",
    "unknown-type":
      "The column {{column}} has a type that cannot be used. The types are text, integer, bigint, numeric(18,4), boolean, date and timestamptz.",
    "row-width":
      "The row rows[{{row}}] does not have exactly {{columns}} cells, one per column. Send null for a cell with no value.",
    "reads-as-null":
      "rows[{{row}}], column {{column}}: a text cell that is empty, only whitespace, or reads null is loaded by dbt as NULL, not as that text. Send null for a cell with no value.",
    "carriage-return":
      "rows[{{row}}], column {{column}}: the cell holds a \\r, which dbt loads as \\n. Use \\n for a line break.",
    "unstorable-character":
      "rows[{{row}}], column {{column}}: the cell holds a NUL character or half of a UTF-16 pair, which cannot be stored as text.",
    "cell-too-long":
      "rows[{{row}}], column {{column}}: the cell is longer than {{max}} characters, the limit of the CSV reader dbt uses.",
    "not-integer":
      "rows[{{row}}], column {{column}}: not a plain integer -- digits only, an optional minus, no leading zero. If it is a code, give the column the type text.",
    "out-of-range":
      "rows[{{row}}], column {{column}}: the number is outside what the column's type holds. Choose a wider type for the column.",
    "not-decimal":
      "rows[{{row}}], column {{column}}: not a plain decimal such as -1234.5 -- a decimal point, no thousands separator, no leading zero.",
    "too-many-digits":
      "rows[{{row}}], column {{column}}: more than 14 digits before the point, which numeric(18,4) cannot hold.",
    "too-many-decimals":
      "rows[{{row}}], column {{column}}: more than 4 digits after the point, which numeric(18,4) would round away. Send at most 4 decimals.",
    "not-boolean": "rows[{{row}}], column {{column}}: must be true or false.",
    "not-date": "rows[{{row}}], column {{column}}: not a real day written as YYYY-MM-DD.",
    "not-timestamp":
      "rows[{{row}}], column {{column}}: not a moment written as YYYY-MM-DDTHH:MM:SS with a time zone, such as 2026-10-13T09:00:00+07:00.",
    "no-offset":
      "rows[{{row}}], column {{column}}: the moment has no time zone, so Postgres would read it in the session's, which is a guess. Add Z or an offset such as +07:00.",
  },
};
