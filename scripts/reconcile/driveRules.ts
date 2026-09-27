/**
 * Which Drive files a connection takes, and what the lake must hold for each -- restated from
 * the published pages, NOT imported from the connector.
 *
 * A check that imports the rule it checks only agrees with itself: a wrong alias in the
 * connector's matcher would be wrong on both sides and every comparison would still match. So
 * the rule is written again from `docs/reference/file-formats.md`:
 *
 * - the MIME type is asked first, lowercased and without parameters, and matches a chosen type
 *   or one of its documented spellings (`image/jpg` for JPEG, `text/x-markdown`, `text/xml`);
 * - only `application/octet-stream` falls to the name, and then only to an extension chosen as
 *   such (`.oa`): one to eight letters or digits after the last dot, at least one a letter;
 * - an empty choice takes every type.
 *
 * What lands: a Google Doc, Sheet or Slides file as its export; an `.oa` sent as octet-stream as
 * JSON; anything else as the type Drive declared. A file declared over 25 MiB keeps its record
 * and lands no bytes, with a refusal naming the ceiling.
 */

const OCTET_STREAM = "application/octet-stream";
const EXTENSION = /^\.(?=[a-z0-9]*[a-z])[a-z0-9]{1,8}$/u;
const DIGITS = /^\d+$/u;

/** The declared size above which no bytes land: 25 MiB. */
export const CEILING_BYTES = 25 * 1024 * 1024;

/** Every other spelling a provider sends for a chosen type, as the reference page lists them. */
const SPELLINGS: Readonly<Record<string, readonly string[]>> = {
  "image/jpeg": ["image/jpg"],
  "text/markdown": ["text/x-markdown"],
  "application/xml": ["text/xml"],
};

/** Google-native types and the type each is exported as. */
const EXPORTS: Readonly<Record<string, string>> = {
  "application/vnd.google-apps.document":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.google-apps.spreadsheet":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.google-apps.presentation": "text/plain",
};

/** Extensions filed under another type when their MIME type says nothing. */
const LANDS_AS: Readonly<Record<string, string>> = { oa: "application/json" };

function bare(mimeType: string): string {
  return (mimeType.split(";")[0] ?? "").trim().toLowerCase();
}

/** The extension a name carries, without its dot; null when the name has none. */
export function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  const candidate = dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
  return EXTENSION.test(`.${candidate}`) ? candidate : null;
}

/** Whether a connection with these `fileTypes` takes a file of this type and extension. */
export function takes(
  fileTypes: readonly string[],
  mimeType: string,
  extension: string | null,
): boolean {
  if (fileTypes.length === 0) {
    return true;
  }
  const type = bare(mimeType);
  const chosen = fileTypes
    .filter((choice) => !EXTENSION.test(choice))
    .flatMap((choice) => [bare(choice), ...(SPELLINGS[bare(choice)] ?? [])]);
  if (chosen.includes(type)) {
    return true;
  }
  return type === OCTET_STREAM && extension !== null && fileTypes.includes(`.${extension}`);
}

/** The type a Google-native file is exported as; null for a file that downloads as itself. */
export function exportOf(mimeType: string): string | null {
  return EXPORTS[bare(mimeType)] ?? null;
}

/** The type the lake's document for this file must carry. */
export function landedTypeOf(mimeType: string, extension: string | null): string {
  const exported = exportOf(mimeType);
  if (exported !== null) {
    return exported;
  }
  if (bare(mimeType) !== OCTET_STREAM || extension === null) {
    return mimeType;
  }
  return LANDS_AS[extension] ?? mimeType;
}

/** Declared over the ceiling. Drive's size is decimal text; an unreadable one is not over. */
export function overCeiling(size: string | null): boolean {
  return size !== null && DIGITS.test(size) && BigInt(size) > BigInt(CEILING_BYTES);
}
