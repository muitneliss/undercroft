/**
 * When a provider's GRANT lapses, as distinct from when its access token rotates.
 *
 * The distinction is the whole reason this exists. `expires_at` on a credential is the
 * access token's hourly rotation, which the worker handles unattended; the card once showed
 * it as the grant's end and every fresh Google connection announced "expires today". The
 * grant's end is a different fact with a different remedy -- a person has to consent again
 * -- and only one provider we speak to lets us date it in advance:
 *
 *   - Xero's refresh token dies sixty days after it was last used. Every seal and every
 *     refresh issues a new one, so the date moves forward with each successful run and
 *     stands still the moment runs stop.
 *   - Google announces no end (a project still in Testing loses the token after seven days,
 *     which is a console setting the token response does not carry).
 *   - A HubSpot private-app token never expires.
 *
 * So the rule answers a date for Xero and `null` for everything else, per rule 2: a value
 * we do not have is left empty rather than filled with the nearest number to hand.
 */

const DAY_MS = 86_400_000;
const XERO_REFRESH_TOKEN_DAYS = 60;

/** The instant the grant for `source` lapses if nothing renews it, or `null` when unknowable. */
export function grantExpiryFor(source: string, now: Date = new Date()): string | null {
  if (source === "xero") {
    return new Date(now.getTime() + XERO_REFRESH_TOKEN_DAYS * DAY_MS).toISOString();
  }
  return null;
}
