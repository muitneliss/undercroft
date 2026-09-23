/**
 * A source names an ACCOUNT, and its kind is read off the front of it.
 *
 * A tenant may connect several Gmail mailboxes, or several Drive accounts, at once. The first
 * account of a kind keeps the bare source -- `gmail` -- so every tenant, row and lake key that
 * existed before this file is untouched. Each further account is a source of its own,
 * `<kind>.<account key>` (`gmail.3fa9c1d2e0ab`), where the key is derived from the provider's
 * opaque account id and so is the same every time that account is connected. ADR 0043.
 *
 * WHY A SOURCE AND NOT AN ACCOUNT COLUMN. Everything that has to be per-account is already
 * per-source: the sealed credential and the row lock its refresh takes, the one-running guard,
 * the last run the card shows, the cadence, the rows in `raw.records`, the lake keys. A column
 * would have re-keyed all of them, the partitioned `raw.records` and the only durable layer
 * included; a source that names its account gets each of them by construction.
 *
 * The price is that "is this Gmail?" can no longer be `source === "gmail"`. It is
 * `sourceKind(source) === "gmail"`, and this is the one place that says how to read it. Its own
 * entry point (`@undercroft/contracts/sources`) because the browser needs it too, and the root
 * barrel reaches `node:fs` -- see `runs.ts`.
 */

/** The kinds a tenant may connect more than one account of. */
export const MULTI_ACCOUNT_KINDS: ReadonlySet<string> = new Set(["gmail", "drive"]);

/** How many hex characters of the account digest a source carries. See `accountKeyOf`. */
export const ACCOUNT_KEY_LENGTH = 12;

/**
 * A kind is a connector id -- the same grammar `ConnectorSpec.id` enforces -- so it can never
 * carry a `/` or `..` into the `${source}.yaml` path a spec run reads.
 */
const INSTANCE = /^(?<kind>[a-z][a-z0-9_-]*)(?:\.(?<account>[0-9a-f]{12}))?$/u;

export interface SourceInstance {
  /** What the source IS: `gmail`, `drive`, `xero`, `hubspot`. */
  readonly kind: string;
  /** Which account of that kind, or `null` for the kind's first account. */
  readonly account: string | null;
}

/**
 * Read a source as a kind and an account, or `null` when it is neither.
 *
 * A suffix is refused on a kind that cannot hold a second account: `xero.3fa9c1d2e0ab` is not
 * a second Xero organisation, it is a string somebody made up, and reading it as `xero` would
 * run a connector against a connection that does not exist.
 */
export function parseSourceInstance(source: string): SourceInstance | null {
  const match = INSTANCE.exec(source);
  const kind = match?.groups?.kind;
  if (kind === undefined) {
    return null;
  }
  const account = match?.groups?.account ?? null;
  if (account !== null && !MULTI_ACCOUNT_KINDS.has(kind)) {
    return null;
  }
  return { kind, account };
}

/**
 * The kind a source belongs to.
 *
 * A string that is not a source instance answers as itself, so a lookup keyed by kind simply
 * misses it -- the same answer an unknown source always got.
 */
export function sourceKind(source: string): string {
  return parseSourceInstance(source)?.kind ?? source;
}

/**
 * The source a further account of `kind` lands under, from its account digest.
 *
 * The digest is computed by the caller (`hashToken` in `@undercroft/crypto`, which the browser
 * cannot import), so this stays free of `node:crypto`. Deterministic: the same account always
 * maps to the same source, which is what makes "add an account we already hold" a reconnect
 * rather than a duplicate, and why no slot is ever allocated or raced for.
 */
export function accountSourceOf(kind: string, accountDigest: string): string {
  return `${kind}.${accountDigest.slice(0, ACCOUNT_KEY_LENGTH)}`;
}
