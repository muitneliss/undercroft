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
   * Why an absent record that is in scope and old enough still cannot be called MISSING: a
   * condition the verdict needs (the scope the target's run read, say) has no evidence.
   * Returns why, or null when MISSING stands.
   */
  readonly undecided?: (key: string, record: S) => string | null;
  /**
   * How a target record with no reference counterpart is judged, when the leg can say more
   * than "extra": retained by the target's policy, undecidable, or a proven extra. Null drops
   * it from the leg. When absent, the record is EXTRA.
   */
  readonly judgeExtra?: (key: string, record: T) => { verdict: Verdict; reason: string } | null;
  /** The fields the contract says must survive, compared. Empty means they agree. */
  readonly compare: (reference: S, target: T) => readonly FieldDiff[];
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
    const [first] = entries;
    const extra =
      referenceKeys.has(key) || first === undefined ? null : judgeTargetOnly(spec, key, first);
    if (extra !== null) {
      results.push(extra);
    }
  }
  return results.sort((a, b) => a.key.localeCompare(b.key));
}

/** A target record with no reference counterpart: the leg's own judgement, else EXTRA. */
function judgeTargetOnly<S, T>(
  spec: LegSpec<S, T>,
  key: string,
  first: Keyed<T>,
): RecordResult | null {
  const evidence = { target: first.evidence };
  if (spec.judgeExtra !== undefined) {
    const judged = spec.judgeExtra(key, first.record);
    return judged === null ? null : { key, ...judged, diffs: [], evidence };
  }
  const reason = "held by the target, absent from the reference";
  return { key, verdict: "EXTRA", reason, diffs: [], evidence };
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
  if (!spec.synced(entry.record)) {
    return verdict("NOT_YET_SYNCED", "newer than the target's last completed run");
  }
  const undecided = spec.undecided?.(entry.key, entry.record) ?? null;
  if (undecided !== null) {
    return verdict("BLOCKED", undecided);
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
