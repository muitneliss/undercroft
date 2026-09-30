/**
 * What the desktop app remembers between launches, in one small JSON file of its own.
 *
 * Three things, none of them a secret: which folder it installed to (a person may pick one other
 * than the default, and the next launch must find it), the language they chose, and whether the
 * wizard is waiting to resume after Windows restarted to finish installing Docker. Every secret
 * stays in the install's `.env`, which `@undercroft/setup` owns; nothing here duplicates it.
 *
 * A file that is missing, unreadable or not what this module wrote reads as "nothing
 * remembered", which sends a person to the wizard's first step -- never to a guessed folder.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { LOCALES, type Locale } from "@undercroft/core/locale";
import type { Mode } from "@undercroft/setup";

export interface Remembered {
  readonly dir?: string;
  readonly locale?: Locale;
  /** Set while the wizard waits for a restart to finish installing Docker. */
  readonly resume?: { readonly mode: Mode };
}

export interface Prefs {
  read: () => Promise<Remembered>;
  /** Merge `patch` into what is remembered. A key set to `undefined` is forgotten. */
  update: (
    patch: { readonly [K in keyof Remembered]?: Remembered[K] | undefined },
  ) => Promise<void>;
}

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

function isLocale(value: unknown): value is Locale {
  return LOCALES.some((locale) => locale === value);
}

/** Only what this module writes; anything else in the file is ignored rather than trusted. */
function parse(text: string): Remembered {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {};
  }
  const dir = field(json, "dir");
  const locale = field(json, "locale");
  const mode = field(field(json, "resume"), "mode");
  return {
    ...(typeof dir === "string" && dir !== "" ? { dir } : {}),
    ...(isLocale(locale) ? { locale } : {}),
    ...(mode === "desktop" || mode === "server" ? { resume: { mode } } : {}),
  };
}

async function readAt(path: string): Promise<Remembered> {
  try {
    return parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }
}

/** The app's prefs, kept at `path`. */
export function filePrefs(path: string): Prefs {
  return {
    read: (): Promise<Remembered> => readAt(path),
    update: async (patch): Promise<void> => {
      const merged = { ...(await readAt(path)), ...patch };
      await mkdir(dirname(path), { recursive: true });
      const staging = `${path}.tmp`;
      await writeFile(staging, `${JSON.stringify(merged, null, 2)}\n`);
      await rename(staging, path);
    },
  };
}
