/**
 * What saving a scope draft changes, set beside what is saved: the scope picker's review step.
 *
 * One function answers the whole review, so the step prints a comparison and a list of what
 * leaves without knowing how any kind stores its choice. It reads the saved scope in the shape
 * `connections.list` hands the card (`configOf` on the server) and the draft in the store's,
 * and words both through `scopeSummary`, the card's own sentence, so the "Saved" column says
 * exactly what the card says today and "Will apply" exactly what it will say after Save.
 *
 * ## Nothing saved is not the widest reading
 *
 * A connection nobody has scoped carries an empty config, and `scopeSummary` reads an empty
 * Gmail label list as the whole mailbox -- right for a saved empty list, a recorded decision,
 * and wrong for no list at all. So an empty config is "nothing saved" and prints as MISSING,
 * never as the reading an empty choice would make. Rule 2: no evidence is not a verdict.
 *
 * ## What leaves is only what can be named
 *
 * The names in the saved choice that the draft drops, and nothing inferred. Three of the lists
 * read "nothing ticked" as OPEN -- Gmail's labels, Xero's entities, the file types -- so a
 * draft that clears one of them drops nothing, and a saved open list names nothing that could
 * leave: narrowing a whole mailbox to two labels is said by the two columns, not by a list of
 * labels nobody chose. HubSpot's properties and Drive's picks have no open end, so every
 * saved name the draft lacks is leaving.
 *
 * File types are compared on their own row, because `scopeSummary` does not name them and a
 * change to them alone would otherwise print two identical columns over a real change.
 *
 * ## And back
 *
 * `storedDraft` is the other direction: the saved scope read back into a draft, which is what
 * the picker opens holding and what Discard puts back.
 */

import type { TFunction } from "i18next";

import type { Connection, Source } from "@/api/types.ts";
import { scopeSummary } from "@/lib/connectionState.ts";
import { describeFileType } from "@/lib/fileTypes.ts";
import { describeHubspotObject } from "@/lib/hubspotProperties.ts";
import { describeXeroEntity } from "@/lib/xeroEntities.ts";
import type { ScopeDraft } from "@/store.ts";

type Config = Connection["config"];
type Choice = Omit<ScopeDraft, "source">;

/** One row of the comparison. `null` is a scope nothing names, printed as MISSING. */
export interface ScopeRow {
  readonly row: "reads" | "fileTypes";
  readonly saved: string | null;
  readonly willApply: string | null;
}

export interface ScopeChange {
  readonly rows: readonly ScopeRow[];
  /** Names in the saved choice the draft drops, in the saved order. */
  readonly leaving: readonly string[];
  /** Drive: the saved pick read sub-folders and the draft does not. */
  readonly subfoldersDropped: boolean;
}

/** The kinds whose choice carries file types. */
const TYPED: ReadonlySet<Source> = new Set<Source>(["gmail", "drive"]);

/** The draft in the shape the card reads a saved scope in, so one summary serves both. */
function draftConfig(kind: Source, chosen: Choice): Config {
  switch (kind) {
    case "gmail":
      return { labels: chosen.labels, fileTypes: chosen.fileTypes };
    case "drive":
      return { files: chosen.files, recurse: chosen.recurse, fileTypes: chosen.fileTypes };
    case "xero":
      return { entities: chosen.entities };
    case "hubspot":
      return { properties: chosen.properties };
    default: {
      const exhaustive: never = kind;
      throw new Error(`unhandled source ${String(exhaustive)}`);
    }
  }
}

function fileTypesSummary(t: TFunction, fileTypes: readonly string[] | undefined): string | null {
  if (fileTypes === undefined) {
    return null;
  }
  return fileTypes.length === 0
    ? t("scope.anyFileType")
    : fileTypes.map((choice) => describeFileType(t, choice)).join(", ");
}

/** What `saved` holds and `draft` does not, for a list whose empty end reads everything. */
function droppedFromOpen(saved: readonly string[], draft: readonly string[]): string[] {
  return draft.length === 0 ? [] : saved.filter((entry) => !draft.includes(entry));
}

function hubspotLeaving(t: TFunction, saved: Config, chosen: Choice): string[] {
  return Object.entries(saved.properties ?? {}).flatMap(([object, names]) => {
    const kept = chosen.properties[object] ?? [];
    return names
      .filter((name) => !kept.includes(name))
      .map((name) => `${describeHubspotObject(t, object)} · ${name}`);
  });
}

function leavingFor(t: TFunction, kind: Source, saved: Config, chosen: Choice): string[] {
  const fileTypes = TYPED.has(kind)
    ? droppedFromOpen(saved.fileTypes ?? [], chosen.fileTypes).map((c) => describeFileType(t, c))
    : [];
  switch (kind) {
    case "gmail":
      return [...droppedFromOpen(saved.labels ?? [], chosen.labels), ...fileTypes];
    case "drive": {
      const kept = new Set(chosen.files.map((file) => file.id));
      const picks = (saved.files ?? []).filter((file) => !kept.has(file.id));
      return [...picks.map((file) => file.name), ...fileTypes];
    }
    case "xero":
      return droppedFromOpen(saved.entities ?? [], chosen.entities).map((entity) =>
        describeXeroEntity(t, entity),
      );
    case "hubspot":
      return hubspotLeaving(t, saved, chosen);
    default: {
      const exhaustive: never = kind;
      throw new Error(`unhandled source ${String(exhaustive)}`);
    }
  }
}

/** The review of `chosen` against what `saved` holds, in the words of `t`'s language. */
export function scopeChange(
  t: TFunction,
  kind: Source,
  saved: Config,
  chosen: Choice,
): ScopeChange {
  const nothingSaved = Object.keys(saved).length === 0;
  const draft = draftConfig(kind, chosen);
  const reads: ScopeRow = {
    row: "reads",
    saved: nothingSaved ? null : scopeSummary(t, kind, saved),
    willApply: scopeSummary(t, kind, draft),
  };
  const rows = TYPED.has(kind)
    ? [
        reads,
        {
          row: "fileTypes" as const,
          saved: fileTypesSummary(t, saved.fileTypes),
          willApply: fileTypesSummary(t, draft.fileTypes),
        },
      ]
    : [reads];

  return {
    rows,
    leaving: nothingSaved ? [] : leavingFor(t, kind, saved, chosen),
    subfoldersDropped: kind === "drive" && saved.recurse === true && !chosen.recurse,
  };
}

/**
 * The draft a connection's stored scope reads back as.
 *
 * An admin changing a selection should see what they chose last time, not an empty form that
 * silently means "everything" -- and Discard puts exactly this back.
 */
export function storedDraft(source: string, current: Connection): ScopeDraft {
  return {
    source,
    labels: current.config.labels ?? [],
    // Each pick read back as what it IS. This used to rebuild every pick as a folder from a
    // list of bare ids, so an admin who re-saved without re-picking turned their chosen
    // documents into folder picks -- which list nothing, and refuse.
    files: current.config.files ?? [],
    // The organisation already chosen, by the id a run sends and the name the card shows.
    organisation:
      current.externalAccountId === ""
        ? null
        : { id: current.externalAccountId, name: current.externalAccountLabel },
    entities: current.config.entities ?? [],
    // A connection never scoped at all has no `fileTypes` to read back; PDF-only is what
    // every source has always meant until an admin visits this screen and says otherwise.
    fileTypes: current.config.fileTypes ?? ["application/pdf"],
    // A selection saved before sub-folders could be asked for read one level, and keeps
    // reading one level until somebody here says otherwise. ADR 0031.
    recurse: current.config.recurse ?? false,
    // A HubSpot connection nobody has scoped reads the spec's properties alone, which is
    // exactly what an empty choice here means.
    properties: current.config.properties ?? {},
  };
}
