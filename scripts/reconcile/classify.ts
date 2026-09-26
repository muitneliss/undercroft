/**
 * One leg of a reconciliation: a reference set against a target set, record by record.
 *
 * ABSENCE HAS FOUR MEANINGS AND ONLY ONE OF THEM IS A DEFECT. A record the target lacks may
 * have been dropped by a rule the target's contract names (`EXCLUDED_BY_RULE`), may sit
 * outside the target's confirmed scope (`OUT_OF_SCOPE`), may be newer than the target's last
 * completed run (`NOT_YET_SYNCED`) -- or may genuinely be missing. They are tried in that
 * order, and `MISSING` is what is left when none of the declared reasons applies. The order
 * matters: a rule-excluded record is excluded whatever its age, and an out-of-scope record is
 * never "not yet synced", because no run was ever going to land it.
 *
 * PRESENCE IS CHECKED AGAINST SCOPE TOO. A target holding a record its declared scope says it
 * should not hold is reported (`EXTRA`, with the reason), because that is how a wrong model of
 * the target's scope shows itself -- the reconciliation's own assumption failing, loudly,
 * instead of being quietly confirmed by the records that happen to agree with it.
 *
 * NO ROW-COUNT EQUALITY. A key answered by several target rows is `DUPLICATE`; a target that
 * legitimately holds several rows per source record keys them so that each is one key, and
 * says so in its adapter.
 */

import type { FieldDiff, RecordResult, Verdict } from "./model.ts";

export interface Keyed<T> {
  readonly key: string;
  readonly record: T;
  /** Where this copy was read: a query, a run id, a file -- enough to fetch it again. */
  readonly evidence: string;
}

export interface ScopeAnswer {
  readonly inScope: boolean;
  readonly reason: string;
}

export interface LegSpec<S, T> {
  readonly reference: readonly Keyed<S>[];
  readonly target: readonly Keyed<T>[];
  /** Whether the target's confirmed scope covers this reference record. */
  readonly inScope: (record: S) => ScopeAnswer;
  /** A rule in the target's contract that deliberately drops this record, or null. */
  readonly excludedBy?: (key: string, record: S) => string | null;
  /** Whether the target's last completed run could have landed this record. */
  readonly synced: (record: S) => boolean;
  /**
   * The target holds this record in a layer it has not published yet (a harvest awaiting
   * review, say): absent from what was compared, but not lost. Returns why, or null.
   */
  readonly pendingReason?: (key: string, record: S) => string | null;
  /** The fields the contract says must survive, compared. Empty means they agree. */
  readonly compare: (reference: S, target: T) => readonly FieldDiff[];
  /**
   * Whether a target record with no reference counterpart belongs to the universe this leg
   * compares. A target that cannot say which client a record belongs to answers false for all,
   * and the leg does not report extras it has no way to attribute.
   */
  readonly targetBelongs: (record: T) => boolean;
}

export function reconcileLeg<S, T>(spec: LegSpec<S, T>): RecordResult[] {
  const byKey = new Map<string, Keyed<T>[]>();
  for (const entry of spec.target) {
    const list = byKey.get(entry.key) ?? [];
    list.push(entry);
    byKey.set(entry.key, list);
  }
  const results: RecordResult[] = [];
  const referenceKeys = new Set<string>();
  for (const entry of spec.reference) {
    referenceKeys.add(entry.key);
    results.push(judge(spec, entry, byKey.get(entry.key) ?? []));
  }
  for (const [key, entries] of byKey) {
    if (referenceKeys.has(key)) {
      continue;
    }
    const [first] = entries;
    if (first === undefined || !spec.targetBelongs(first.record)) {
      continue;
    }
    results.push({
      key,
      verdict: "EXTRA",
      reason: "held by the target, absent from the reference",
      diffs: [],
      evidence: { target: first.evidence },
    });
  }
  return results.sort((a, b) => a.key.localeCompare(b.key));
}

function judge<S, T>(
  spec: LegSpec<S, T>,
  entry: Keyed<S>,
  targets: readonly Keyed<T>[],
): RecordResult {
  const evidence: Record<string, string> = { reference: entry.evidence };
  if (targets.length > 1) {
    targets.forEach((copy, index) => {
      evidence[`target_${index + 1}`] = copy.evidence;
    });
    const reason = `${targets.length} target rows for one reference record`;
    return { key: entry.key, verdict: "DUPLICATE", reason, diffs: [], evidence };
  }
  const [target] = targets;
  if (target === undefined) {
    return judgeAbsent(spec, entry, evidence);
  }
  evidence.target = target.evidence;
  return judgePresent(spec, entry, target, evidence);
}

/** Absence: a declared rule, then scope, then lag -- and MISSING only when none applies. */
function judgeAbsent<S, T>(
  spec: LegSpec<S, T>,
  entry: Keyed<S>,
  evidence: Record<string, string>,
): RecordResult {
  function verdict(kind: Verdict, reason: string): RecordResult {
    return { key: entry.key, verdict: kind, reason, diffs: [], evidence };
  }
  const rule = spec.excludedBy?.(entry.key, entry.record) ?? null;
  if (rule !== null) {
    return verdict("EXCLUDED_BY_RULE", rule);
  }
  const scope = spec.inScope(entry.record);
  if (!scope.inScope) {
    return verdict("OUT_OF_SCOPE", scope.reason);
  }
  const pending = spec.pendingReason?.(entry.key, entry.record) ?? null;
  if (pending !== null) {
    return verdict("NOT_YET_SYNCED", pending);
  }
  if (!spec.synced(entry.record)) {
    return verdict("NOT_YET_SYNCED", "newer than the target's last completed run");
  }
  return verdict("MISSING", "in scope and synchronised, absent from the target");
}

/** Presence: held outside scope is EXTRA; a difference is lag if the source changed since. */
function judgePresent<S, T>(
  spec: LegSpec<S, T>,
  entry: Keyed<S>,
  target: Keyed<T>,
  evidence: Record<string, string>,
): RecordResult {
  const scope = spec.inScope(entry.record);
  if (!scope.inScope) {
    const reason = `held although outside the declared scope (${scope.reason})`;
    return { key: entry.key, verdict: "EXTRA", reason, diffs: [], evidence };
  }
  const diffs = spec.compare(entry.record, target.record);
  if (diffs.length === 0) {
    return { key: entry.key, verdict: "MATCH", reason: "", diffs, evidence };
  }
  const fields = diffs.map((diff) => diff.field).join(", ");
  // The source changed after the target's last completed run could have read it: the
  // difference is lag, not a defect, until a later run fails to pick it up.
  return spec.synced(entry.record)
    ? { key: entry.key, verdict: "CONTENT_MISMATCH", reason: fields, diffs, evidence }
    : {
        key: entry.key,
        verdict: "NOT_YET_SYNCED",
        reason: `differs in ${fields}, changed after the target's last completed run`,
        diffs,
        evidence,
      };
}

/** Compare named fields as strings, trimming whitespace; a missing side reads as empty. */
export function diffFields(
  fields: readonly string[],
  reference: Readonly<Record<string, string | null | undefined>>,
  target: Readonly<Record<string, string | null | undefined>>,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const field of fields) {
    const expected = (reference[field] ?? "").trim();
    const actual = (target[field] ?? "").trim();
    if (expected !== actual) {
      diffs.push({ field, expected, actual });
    }
  }
  return diffs;
}
