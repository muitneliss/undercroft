# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: the VietCham staff operator.** Internal staff who run many member
companies at once. They are in this interface daily or near-daily: creating a
customer, watching a connection lapse, re-granting it, checking that what landed
is what was expected. They hold several customers in their head at the same time
and are usually in the middle of something else — a call with the customer whose
Xero grant just expired. Density, scanning across tenants, and getting to the one
broken thing outrank hand-holding.

**Secondary: the customer's own admin.** The finance or operations person at a
member company who signs in to connect their own HubSpot, Xero, Gmail and Google
Drive. They visit rarely, often exactly once, and they are being asked to hand
read access to their accounting system and company mailbox to someone else's
software. For them the interface has to earn consent, not just collect it.

Both use the same screens. A user with exactly one visible tenant is routed
straight into it; a list of one is not a decision.

## Product Purpose

A control plane over an ingestion worker that already exists. It is where an
account gets connected, scoped, re-granted when it lapses, and where a staff
operator can see what the platform holds for a customer.

The wider platform moves HubSpot, Xero, Gmail and Google Drive into an immutable
raw lake on S3/MinIO, projects curated tables into Postgres, and serves them to
Metabase. This surface configures that; it does not perform it.

Success is that onboarding a customer is done by the person who has that customer
on the phone, rather than by an engineer editing environment variables and
redeploying.

## Positioning

The distinction ADR 0004 exists to defend: **this configures the worker, it does
not become one.** It runs no connector, holds no scheduler, owns no datastore of
its own, and ships no plugin system. The test is a factual one — with this
service stopped, Kestra still fires, the worker still syncs, Metabase still
serves. Ingestion continues; nobody can change settings.

That is what separates it from the ingestion platform ADR 0003 rejected, and it
is a claim the interface should not undermine by presenting itself as the place
where data pipelines run.

## Operating Context

- **Connections lapse as a matter of course, not as an exception.** Xero's
  refresh token dies after 60 days unused. A customer can revoke a Google grant
  from their own account page without telling anyone. While the OAuth app is in
  Google's Testing status, refresh tokens expire after 7 days, which presents as
  apparently random revocation. Re-granting access is routine work, not an
  incident, and the interface is used for it repeatedly.
- **The consent moment is a redirect away from this app** to Google's, Xero's or
  HubSpot's own screen. Whatever is going to be explained has to be explained
  before that redirect; there is no coming back to read it.
- **There is no run history.** ADR 0007 removed the run ledger. The worker holds
  live status in memory and loses it on restart. A sync that has been started can
  be reported as started, and nothing more — which makes the confirmation of that
  action load-bearing rather than decorative.
- **Timezone is Asia/Singapore.** Schedules are cron in that zone.
- Scheduling is Kestra's. This surface records a schedule; it does not run one.

## Capabilities and Constraints

**What the API actually serves today** (`vcdo/api/routers/`): Google sign-in and
server-side sessions; list, read and create tenants; list connections, save a
connection's config, disconnect; the OAuth authorize and callback redirects;
browse the raw lake, read an object's manifests, download bytes (admin only, and
written to the audit log); list tenant members, create an invitation whose token
is returned exactly once, remove a member.

**Known gaps, not to be papered over:**

- `POST /api/tenants/{id}/runs` is called by `ui/src/api/client.ts` and **is not
  implemented by any router.** The in-memory test server implements it, so the
  "Run sync now" action is green under test and fails against the real service.
- Nothing serves `curated.customer_commercial_overview`, so the money and
  three-valued-verdict rendering in `ui/src/lib/` has no endpoint behind it.
  `CustomerTotals` in `ui/src/api/types.ts` describes a response that does not
  exist yet.

**Hard rules, enforced by `.claude/rules/` and by pinned tests:**

- A monetary amount is a string from Postgres `NUMERIC(18,4)` to the DOM and is
  never parsed into a JavaScript number. `Decimal` becomes `float` inside
  FastAPI's own encoders, so the type never appears in a response model at all.
- `null` is a recorded absence and renders as an em dash. Never `0`, never blank.
- Comparison is three-valued: `ok` / `mismatch` / `unverified`. `unverified`
  means there was nothing to compare against; it is not a soft pass and not a
  soft failure, and it may not be collapsed into either.
- A tenant a user cannot see returns 404, never 403, so the endpoint cannot be
  used to enumerate the customer list. The interface must therefore say "you do
  not have access", never "that does not exist".
- What a source will read, that nothing will be written, and that it can be
  undone are stated on the connection card **before** the redirect.
  `ConnectionCard.test.tsx` pins that copy.
- Status is never carried by colour alone (WCAG 2.1 AA 1.4.1).
- No mocks in tests. The suite runs against a working in-memory implementation
  that enforces the same authorisation rules, including refusing.
- Client names are PII. Tracked files, fixtures and screenshots use CASE-IDs.

**Terminology.** A *tenant* is one member company; staff-facing copy calls it a
*customer*. A *source* is one of HubSpot, Xero, Gmail, Google Drive. *Raw* is the
immutable lake; *curated* is the rebuildable Postgres projection. A *connection*
is one tenant's grant on one source, and carries its own status, scope config and
schedule.

**Connection states**: `disconnected`, `connected`, `needs_scope`,
`needs_reconnect`, plus an `expired` presentation derived from the credential's
expiry. `needs_scope` and `needs_reconnect` both look like "not working" and ask
for completely different things, so they stay distinct.

**Roles**: viewer reads, member runs syncs, admin administers. Staff are
identified by domain; everyone else needs an invitation.

**Stack**: Vite + React 19 + TypeScript, TanStack Query, React Router 7, plain
CSS with custom properties, Vitest + Testing Library + MSW. Built into the `api`
container's image and served by FastAPI at every non-`/api` path. Bun is the
frontend toolchain and is part of `make verify`.

## Brand Commitments

- The product is "VietCham data platform"; the sidebar wordmark is "VietCham
  data". No logo asset exists in the repository.
- Copy is British/Singapore English — "organisation", "authorisation". Amounts
  format with `en-SG` grouping.
- `noindex, nofollow`. An internal control plane holding customer data has no
  business in a search index.
- Voice: plain, specific, and willing to say what the software will not do. The
  existing copy refuses a Drive sync without a folder and says why, in the
  customer's words rather than the system's. That register is a commitment.

## Evidence on Hand

- A working, tested incumbent UI: four routes, a token file at
  `ui/src/index.css`, and components with reasoned docstrings.
- Real fixture data under `fixtures/`, keyed by CASE-ID. Safe to design against.
- Seven ADRs recording decisions and rejected options, and a legacy reference
  system at `vcc-ostwin-architecture-review` for domain rules.
- **No logo, no photography, no illustration, no brand typeface, no colour
  specification** exists. Nothing here must be presented as an existing brand
  asset.
- **No real customer names may appear anywhere.** Demonstration data is authored
  and uses CASE-IDs.

## Product Principles

1. **Never guess; show nothing and say why.** An empty cell is visibly missing; a
   wrong value is invisibly false. "No evidence" is never "pass".
2. **A lapsed grant is normal traffic, and the recovery path is the product.**
   The state that actually happens in production gets the clearest route through
   the interface, not the smallest badge.
3. **Consent is stated before it is collected**, on the card, in the customer's
   words, ahead of the redirect that cannot be undone from here.
4. **This configures the worker; it never claims to be the worker.** The
   interface must not imply it is running, holding or scheduling the data.
5. **Raw is the only durable layer.** Anything in Postgres is a projection and
   may be dropped and rebuilt; the interface should not present curated figures
   as the system of record.

## Accessibility & Inclusion

WCAG 2.1 AA. Status carries a glyph and a word as well as a tone, so it survives
greyscale and colour-blindness. A visible focus ring on every interactive
element. `prefers-reduced-motion` is honoured. Skeletons rather than spinners
inside content, so layout does not jump. Assertions in tests are on roles and
text, which keeps the semantic layer honest.
