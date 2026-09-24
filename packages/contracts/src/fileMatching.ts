/**
 * How a file is matched against the file types a scope chose, and what it is filed under.
 *
 * THE MIME TYPE IS ASKED FIRST, AND THE NAME ONLY WHEN THE MIME TYPE SAYS NOTHING. A file's
 * name is written by a person; a file named `Services Agreement for Mr. Smith` has no
 * extension at all, and cutting at its last dot calls it a `smith`. In the Drive the issue
 * measured, 77 of the 99 such names its reporter checked were Google Docs and Sheets with a
 * perfectly good MIME type -- so a name is consulted only when the type is generic, and even then only a short
 * run of letters and digits after the last dot counts as an extension (`extensionOf`). An
 * extension never vetoes a MIME type and never widens one: a PDF chosen as a PDF lands
 * exactly the files Drive calls PDFs, as it always has.
 */

import { FILE_FORMATS } from "./fileFormats.ts";

/**
 * The MIME types that say nothing about what a file is, so its name has to.
 *
 * Only the one the issue measured: 1,020 `.oa` files arrived as `application/octet-stream`.
 * A second entry here widens every extension choice to a type nobody has seen a file under.
 */
export const GENERIC_MIME_TYPES: readonly string[] = ["application/octet-stream"];

/** `type/subtype`, the shape every MIME type has. Not a validator against IANA's registry. */
const MIME_TYPE_SHAPE = /^[^/\s]+\/[^/\s]+$/u;

/**
 * An extension as a scope stores it: a dot, then one to eight letters or digits, at least one
 * of them a letter. The same shape {@link extensionOf} accepts, so a custom choice can match.
 */
const EXTENSION_CHOICE = /^\.(?=[a-z0-9]*[a-z])[a-z0-9]{1,8}$/u;

/** What the free-text field may add: a MIME type, or an extension such as `.oa`. */
export function isPlausibleFileChoice(value: string): boolean {
  return MIME_TYPE_SHAPE.test(value) || EXTENSION_CHOICE.test(value);
}

/** Trimmed and lowercased, so a typed-in entry matches what Google's APIs actually send. */
export function normalizeFileChoice(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The extension a file's name carries, or `null` when it carries none.
 *
 * Whatever follows the LAST dot counts only when it is one to eight letters or digits with at
 * least one letter among them. Every other shape is a name that happens to hold a dot, and
 * each was measured misread as an extension: `for Mr. Smith` (a space), `Rev.1` (a number),
 * `Pte. Ltd.` (nothing after the dot), `01.01/2024 QT-FXpdf` (a slash and a space).
 */
export function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) {
    return null;
  }
  const candidate = name.slice(dot + 1).toLowerCase();
  return EXTENSION_CHOICE.test(`.${candidate}`) ? candidate : null;
}

/** A provider's MIME type, parameters dropped and lowercased: `Text/HTML; charset=x` is `text/html`. */
function bareType(mimeType: string): string {
  return (mimeType.split(";")[0] ?? "").trim().toLowerCase();
}

function isGeneric(mimeType: string): boolean {
  return GENERIC_MIME_TYPES.includes(bareType(mimeType));
}

/** A file as a provider describes it: the type it declared and the name a person gave it. */
export interface DescribedFile {
  readonly mimeType: string;
  readonly name: string;
}

/**
 * Whether a file is one a Gmail or Drive scope agreed to.
 *
 * The one place "empty means every type" is decided, and the one place the MIME-first rule
 * is: a specific MIME type is matched as itself or as an alias of a chosen format, and a
 * generic one falls to the name -- and then only to an extension chosen as such.
 */
export function allowsFile(fileTypes: readonly string[], file: DescribedFile): boolean {
  if (fileTypes.length === 0) {
    return true;
  }
  const type = bareType(file.mimeType);
  // A MIME type chosen as itself matches first -- `application/octet-stream` included, which
  // the Drive browse offers like any other type present (ADR 0047). Only then does a generic
  // type fall to the name.
  if (chosenMimeTypes(fileTypes).includes(type)) {
    return true;
  }
  const extension = isGeneric(type) ? extensionOf(file.name) : null;
  return extension !== null && fileTypes.includes(`.${extension}`);
}

/**
 * Every MIME type the chosen formats cover: a curated choice brings its aliases, a custom one
 * is itself, and an extension choice brings the generic types its files arrive under -- which
 * is what a Drive listing has to ask for to see them at all.
 */
export function mimeTypesOf(fileTypes: readonly string[]): string[] {
  const types = new Set(chosenMimeTypes(fileTypes));
  if (fileTypes.some((choice) => EXTENSION_CHOICE.test(choice))) {
    for (const generic of GENERIC_MIME_TYPES) {
      types.add(generic);
    }
  }
  return [...types];
}

/** The MIME types chosen as MIME types: a curated choice with its aliases, a custom one as itself. */
function chosenMimeTypes(fileTypes: readonly string[]): string[] {
  return fileTypes.flatMap((choice) => {
    if (EXTENSION_CHOICE.test(choice)) {
      return [];
    }
    const format = FILE_FORMATS.find((f) => f.choice === choice);
    return format === undefined ? [bareType(choice)] : format.mimeTypes.map(bareType);
  });
}

/**
 * The type a landed file is catalogued under.
 *
 * What the provider declared, unless it declared nothing useful and the name is an extension
 * the catalogue knows: a `.oa` sent as `application/octet-stream` is catalogued as JSON, so
 * the reader for JSON is the one that opens it. The declared type is not lost -- the record
 * keeps it -- but the document is filed under what it is.
 */
export function landedType(file: DescribedFile): string {
  if (!isGeneric(file.mimeType)) {
    return file.mimeType;
  }
  const extension = extensionOf(file.name);
  const format =
    extension === null ? undefined : FILE_FORMATS.find((f) => f.extensions.includes(extension));
  return format?.landsAs ?? file.mimeType;
}

/** The type a Google-native file is exported as, or `null` for a file that downloads as itself. */
export function exportTypeOf(mimeType: string): string | null {
  const type = bareType(mimeType);
  return FILE_FORMATS.find((f) => f.mimeTypes.includes(type))?.exportAs ?? null;
}
