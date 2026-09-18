/**
 * Superadmins: the addresses that hold authority over the whole platform, named in the
 * environment rather than in the database.
 *
 * Undercroft's authority model is otherwise entirely tenant-scoped -- `app.tenant_member`
 * says who may see a customer and with what rank, and `handlers/trpc.ts` resolves every
 * request against it. That model has no answer to the question a fresh deployment asks
 * first: *who may do anything at all, before there is anybody to grant it?* Before this,
 * the answer was `bun run invite` on a shell, which needs shell access to the production
 * host to add the first person and again to recover from losing them. ADR 0013 records
 * why that became a rule rather than a runbook step.
 *
 * ## The environment is the authority, not a seed
 *
 * `UNDERCROFT_SUPERADMINS` is read at boot and consulted on every request. Nothing is
 * written to say "this person is a superadmin": there is no row, no column and no flag, so
 * there is nothing for the environment to drift away from. Removing an address from
 * Dokploy's environment and redeploying withdraws that authority at once, and a database
 * dump of `app.tenant_member` never quietly disagrees with who can actually act.
 *
 * The cost of that choice, stated plainly: an address deleted from the variable by accident
 * loses platform authority the moment the process restarts, with no audit row recording the
 * change. That is the same exposure as any other production environment variable here --
 * `UNDERCROFT_SESSION_SECRET` ends every session the moment it changes -- and the
 * alternative, a `superadmin` column, buys an audit trail at the price of two sources of
 * truth for the most privileged thing in the system.
 *
 * A superadmin still *authenticates* like everyone else. This list grants authority, never
 * identity: the address must still prove it controls a Google account or a mailbox. What it
 * skips is the invitation, which is the one thing a fresh deployment cannot produce.
 *
 * ## Refusing a malformed entry rather than dropping it
 *
 * `parseSuperadmins` reports what it would not accept instead of silently keeping the rest.
 * A superadmin list is a security boundary read by a human into a web form, and
 * `UNDERCROFT_SUPERADMINS=ada@example.test;bob@example.test` -- a semicolon where a comma
 * belongs -- would otherwise resolve to one absurd address and no admins, looking exactly
 * like a correct configuration. `main.ts` logs `rejected` at boot. Rule 2: an entry nobody
 * can read is reported, never guessed at.
 */

// biome-ignore-all lint/nursery/useValidTestTitle: A false positive. The rule reads `/\s/.test(value)` -- RegExp#test on a regex literal -- as a test-framework `test()` call with a non-string title. There is no test in this file.
// biome-ignore-all lint/style/useExportsLast: Reordering so every export sits at the bottom would put `parseSuperadmins` below the private helper it calls. The order here is deliberate: the type this module is about, then what operates on it.

/** The accepted addresses, already normalised. Compared by exact match, never by pattern. */
export type Superadmins = ReadonlySet<string>;

export interface SuperadminList {
  readonly addresses: Superadmins;
  /**
   * Entries that were not addresses, verbatim as written. Reported at boot so a typo in the
   * panel is visible in the log rather than only in the absence of an administrator.
   */
  readonly rejected: readonly string[];
}

/** An install that names none. Every caller takes a list, so "none" has to be a value. */
export const NO_SUPERADMINS: Superadmins = new Set<string>();

/**
 * Read the comma-separated list.
 *
 * Addresses are lowercased and trimmed, the same normalisation `services/invite.ts` applies
 * to a just-authenticated address -- the two are compared to each other, so they have to be
 * normalised the same way or `Ada@Example.test` in the panel never matches the `ada@example.test`
 * Google returns.
 *
 * The acceptance test is deliberately weak: one `@`, something either side, no whitespace.
 * Validating an address properly is a famously bad idea, and this list is checked against
 * addresses that have *already* authenticated -- an entry that is not a real address simply
 * never matches anybody. What the check is for is catching the wrong separator.
 */
export function parseSuperadmins(raw: string | undefined): SuperadminList {
  const addresses = new Set<string>();
  const rejected: string[] = [];

  for (const entry of (raw ?? "").split(",")) {
    const trimmed = entry.trim();
    // Empty entries are not a typo worth reporting: a trailing comma, or a variable set to
    // the empty string, both mean "none" and both are ordinary.
    if (trimmed !== "") {
      const normalised = trimmed.toLowerCase();
      if (isAddressLike(normalised)) {
        addresses.add(normalised);
      } else {
        rejected.push(trimmed);
      }
    }
  }

  return { addresses, rejected };
}

/** Hoisted: a literal inside the function is recompiled on every entry to it. */
const WHITESPACE = /\s/u;

function isAddressLike(value: string): boolean {
  if (WHITESPACE.test(value)) {
    return false;
  }
  const at = value.indexOf("@");
  return at > 0 && at === value.lastIndexOf("@") && at < value.length - 1;
}

/**
 * Does this address hold platform authority?
 *
 * Takes the list rather than reaching for one, so the answer depends only on its arguments:
 * this is consulted inside the security boundary, and a function that read the environment
 * itself could not be driven from a test with a list the test chose.
 */
export function isSuperadmin(superadmins: Superadmins, email: string): boolean {
  const normalised = email.trim().toLowerCase();
  // An empty address is not a superadmin, and would be were the set ever to contain "".
  // `parseSuperadmins` cannot produce that, but this function is also called with whatever
  // an identity provider returned, which is not a guarantee of the same kind.
  if (normalised === "") {
    return false;
  }
  return superadmins.has(normalised);
}
