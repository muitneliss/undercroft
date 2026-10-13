/**
 * What `models.check` says about a model's SQL, in English: `en.ts`'s `modelCheck` namespace,
 * split out beside its Vietnamese source (`modelCheck.vi.ts`), which decides the keys.
 */

export const modelCheck = {
  finding: {
    "not-one-macro":
      "A macro is exactly one {% macro name(...) %} ... {% endmacro %} block. Nothing may stand outside it but comments, and there is no second block.",
    "name-mismatch":
      "The definition is named {{subject}}, not the name it is being saved under. Give both the same name.",
    "reserved-name":
      "{{subject}} is reserved: a macro of that name would silently replace one dbt or the platform relies on. Choose another name.",
    "forbidden-block":
      "A macro may not hold a {{subject}} block. It would change how the whole project builds, not add something a model calls.",
    "unbound-name":
      "{{subject}} is not a parameter of this macro, nor anything dbt defines. dbt would render it as an empty string without an error.",
    empty: "The model has no SQL yet.",
    semicolon:
      "Remove the semicolon. dbt wraps a model in CREATE TABLE ... AS, so a semicolon ends that statement early and the build fails.",
    "not-select":
      "A model is one query starting with select, with or values. dbt makes the table from its result.",
    "write-statement":
      "A model must not write: remove {{subject}}. It only reads; dbt creates the table from the select.",
    "select-into":
      "Remove select ... into. dbt creates the model's table itself; into would create a second one outside dbt.",
    "raw-direct":
      "Read raw.{{subject}} through dbt's source() function, naming the undercroft source, rather than directly -- so dbt knows what the model depends on.",
    "analytics-direct":
      "Read {{subject}} through dbt's ref() rather than by its schema, so dbt builds that model before this one.",
    "unknown-source": "There is no source {{subject}}. models.reference lists the sources.",
    "unknown-ref": "This customer has no model named {{subject}}.",
    "self-ref": "A model cannot read itself.",
    "report-parameter":
      "{{subject}} is a report question's parameter. A model has none: dbt would render it as an empty string and the filter would vanish without an error. Replace it with a fixed value, or drop that filter.",
    "no-tombstone-filter":
      "The model reads records but never mentions deleted_at. Without deleted_at is null, a record deleted at its source shows as live.",
    "zero-default":
      "coalesce(…, 0) turns a missing value into a real-looking zero. Leave it NULL unless 0 is truly what it means.",
    "top-level-limit":
      "A limit on the whole query saves only part of the data as the model. Keep it only if that is intended.",
    "unknown-macro":
      "{{subject}} is neither a macro of this project -- the platform's or the customer's own -- nor a dbt function. models.reference lists the macros.",
    "dynamic-reference":
      "The name passed to {{subject}} is not written out as plain text, so whether it exists cannot be checked.",
    "test-column-unmentioned":
      "There is a test for column {{subject}}, but the SQL never mentions that column.",
  },
  unverified: {
    compiles: "Whether the SQL compiles and runs: only a build knows.",
    "payload-keys": "Whether the keys read from the payload exist in the data.",
    "column-types":
      "What type each column comes out as, and whether each cast holds for every row.",
    "tests-pass": "Whether the tests pass: only a build runs them.",
    "function-effects":
      "What the called functions do: the grants on the customer's dbt login decide that.",
  },
};
