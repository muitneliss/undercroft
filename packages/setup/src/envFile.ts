/**
 * The install's `.env`, read and rewritten in place.
 *
 * A person may edit this file: add an assistant key, a Lark webhook, a second superadmin. So a
 * re-run never regenerates it. `updateEnv` replaces the value of each key it is given on the
 * line where that key already stands, appends the ones that are new, and leaves every other
 * line -- comments included -- exactly as it was.
 *
 * Every value is written single-quoted. Compose reads a single-quoted `.env` value literally,
 * with no `$` interpolation, so an email sender like `Undercroft <no-reply@x.test>` or a secret
 * with a `$` in it arrives as typed. A value holding a single quote or a line break has no
 * literal spelling, and `validateAnswers` refuses one before it reaches this module.
 */

const ASSIGNMENT = /^\s*(?:export\s+)?(?<key>[A-Za-z_][A-Za-z0-9_]*)\s*=(?<value>.*)$/u;
const LINE_BREAK = /\r?\n/u;
const FINAL_LINE_BREAK = /\r?\n$/u;

function unquote(raw: string): string {
  const value = raw.trim();
  const first = value.at(0);
  if (value.length >= 2 && (first === "'" || first === '"') && value.at(-1) === first) {
    return value.slice(1, -1);
  }
  return value;
}

/** Every `KEY=value` in `text`. A later line wins, as it does for compose. */
export function parseEnv(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split(LINE_BREAK)) {
    const { key, value } = ASSIGNMENT.exec(line)?.groups ?? {};
    if (key !== undefined && value !== undefined) {
      values.set(key, unquote(value));
    }
  }
  return values;
}

function assignment(key: string, value: string): string {
  return `${key}='${value}'`;
}

/** `text` with each of `values` set: in place where the key stands, appended where it does not. */
export function updateEnv(text: string, values: ReadonlyMap<string, string>): string {
  const written = new Set<string>();
  const lines = text === "" ? [] : text.replace(FINAL_LINE_BREAK, "").split(LINE_BREAK);
  const updated = lines.map((line) => {
    const key = ASSIGNMENT.exec(line)?.groups?.key;
    const value = key === undefined ? undefined : values.get(key);
    if (key === undefined || value === undefined) {
      return line;
    }
    written.add(key);
    return assignment(key, value);
  });
  const appended = [...values]
    .filter(([key]) => !written.has(key))
    .map(([key, value]) => assignment(key, value));
  return `${[...updated, ...appended].join("\n")}\n`;
}
