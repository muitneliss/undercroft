/**
 * When a provider's GRANT lapses, as distinct from when its access token rotates.
 *
 * The distinction is the whole reason this exists. `expires_at` on a credential is the
 * access token's hourly rotation, which the worker handles unattended; the card once showed
 * it as the grant's end and every fresh Google connection announced "expires today". The
 * grant's end is a different fact with a different remedy -- a person has to consent again
 * -- and it is known in two ways:
 *
 *   - **The provider states it.** Google answers `refresh_token_expires_in` beside a refresh
 *     token that will die: a project whose consent screen is still in Testing gets one that
 *     lasts seven days, and a person who granted time-based access gets the time they chose.
 *     Stated once, at consent; Google does not rotate the token, so a refresh changes nothing
 *     about its end. This was the failure that had customers reconnecting Drive and Gmail
 *     every week with no warning, because nothing here read the field.
 *   - **We know the provider's rule.** Xero's refresh token dies sixty days after it was last
 *     used. Every seal and every refresh issues a new one, so the date moves forward with each
 *     successful run and stands still the moment runs stop.
 *
 * A stated end outranks the rule: it is the provider's own word about this token. Anything
 * else -- a published Google project, a HubSpot private-app token -- has no known end and gets
 * `null`, per rule 2: a value we do not have is left empty rather than filled with the nearest
 * number to hand.
 */

const DAY_MS = 86_400_000;
const XERO_REFRESH_TOKEN_DAYS = 60;

/** The rule's date for `source`, or `null` when the provider has no rule we know. */
function ruleFor(source: string, now: Date): string | null {
  if (source === "xero") {
    return new Date(now.getTime() + XERO_REFRESH_TOKEN_DAYS * DAY_MS).toISOString();
  }
  return null;
}

/**
 * The instant a newly sealed grant for `source` lapses if nothing renews it, or `null` when
 * unknowable. `stated` is the end the provider gave with the refresh token, if it gave one.
 */
export function grantExpiryFor(
  source: string,
  opts: { readonly now?: Date; readonly stated?: string | null } = {},
): string | null {
  return opts.stated ?? ruleFor(source, opts.now ?? new Date());
}

/**
 * The grant's end after a refresh: the rule's new date, or -- for a provider with no rule that
 * handed back the very refresh token it was given -- `"unchanged"`, the end its consent
 * recorded. Without that answer Google's hourly refresh would write `null` over the seven-day
 * end its consent stated, and disarm the warning within the hour.
 */
export function grantExpiryAfterRefresh(
  source: string,
  opts: { readonly now?: Date; readonly rotated: boolean },
): string | null | "unchanged" {
  const ruled = ruleFor(source, opts.now ?? new Date());
  if (ruled !== null) {
    return ruled;
  }
  return opts.rotated ? null : "unchanged";
}
