# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is an **operator at a services firm that holds many customer case books**:
someone who keeps several member companies' data flowing at once, is usually mid-call about
one of them, and switches between cases many times a day. They read Vietnamese first; some
colleagues and auditors read English. _(Confirmed in interview, 2026-09-19.)_

The second reader is a **customer's own administrator**: the person at a member company who
connects their accounts (Gmail, Google Drive, HubSpot, Xero), chooses what may be read,
writes the SQL that shapes their data, and looks at the reports built on it. They arrive by
invitation only. _(Confirmed in interview.)_

Roles within a customer are `viewer`, `member` and `admin`; platform superadmins are named in
the environment, never in the database.

## Product Purpose

Undercroft connects a customer's accounts, lands everything they permit into an immutable raw
lake, projects it into one generic Postgres table, lets the customer author the transforms
that give the data a shape, and presents the result as questions, charts and dashboards —
with evidence at every step that a run happened, what it landed, what it refused and why.

Success is a customer who can answer "did my invoices come in, and what do they add up to?"
without asking anyone, and an operator who can answer "is this customer's data flowing?"
in one glance while on the phone.

## Positioning

Three rules a neighbouring product cannot truthfully copy:

1. **Raw is the only durable layer.** Everything in Postgres is a projection and may be
   dropped and rebuilt. Raw cannot be recomputed, so it is create-only and content-addressed.
2. **Never guess; return nothing and say why.** An empty cell is visibly missing; a wrong
   value is invisibly false. Money is a string end to end; an unreadable amount is `null`,
   never `0`; a refused row is recorded with its reason.
3. **One writer, many callers.** Every byte enters through one create-only path, whatever
   called it.

And one product decision: **it ships no business schema.** Records land in one generic
table; every table above it is a dbt model the customer wrote, executed as that customer's
own database role, in that customer's own schema.

## Operating Context

- Each customer is a **case**, identified by a CASE-id (`CASE-0042`), never by a real name in
  any tracked file.
- Sources today: Gmail (headers and PDF attachments in chosen labels), Google Drive (files
  chosen in Google's own Picker), HubSpot CRM (private-app token), Xero Accounting (OAuth,
  one organisation). Ingest runs on a per-source cadence chosen by the customer's admin
  (hourly, every six hours, daily, paused) or on demand.
- After each successful ingest, the customer's dbt models are built as that customer's role.
  Failing tests land in a per-customer `dq` schema.
- Times are always shown in Asia/Singapore, in the reader's language. Amounts are never
  localised.
- Operators and customers use the same browser application; there is no second BI tool.
- Anything else can land data through per-customer ingest keys on the lake's REST API.

## Capabilities and Constraints

- **Divisions of a customer's book**: Sources (grants, cadence, run now, ingest keys),
  Journal (every run, its counts, refusals and test results), Raw lake (what landed),
  Models (dbt models authored in the browser), Reports (questions, charts, dashboards),
  People (roster and invitations). Customers is the one division outside any book.
- **Isolation is physical**: a customer's SQL runs as a Postgres role that can read only
  that customer's rows and write only that customer's schemas.
- **Money is a string** at every boundary; charts may plot a numeric column as a
  coordinate, but every figure a reader can read comes from the original digits.
- **Client state has one owner** (the Zustand store) and server state another (the query
  cache); `useState` is banned.
- **Vietnamese first, English second**; no user-facing string is written in place.
- **The offline gate** (`bun run verify`) must pass with no Docker, no network and no
  credentials.
- Undecided: whether an eighth division will ever exist. The seven-hue wheel is full once
  Journal, Models and Reports are bound; an eighth needs a decision, not a hex.

## Brand Commitments

- The name is **Undercroft**: the vaulted chamber beneath a building, the part that holds
  everything up and outlives what stands on it.
- The mark is one ink: an inked block with the arch cut through it, drawn in `currentColor`.
- The interface is a **book**: a leaf lying open on a section board, divisions cut as tabs
  across the head, each division carrying one hue of a seven-hue wheel; vermilion is held out
  of the wheel for corrections only.
- Motion is stepped, never eased; the number of frames is the size of the thing that moved.
- Vendor names (HubSpot, Xero, Gmail, Google Drive) and role values are never translated.

## Evidence on Hand

- Connector specs: `specs/connectors/hubspot.yaml`, `specs/connectors/xero.yaml`.
- Architecture decisions: `docs/adr/`. Runbooks: `docs/runbook/`.
- Synthetic fixtures only (`Acme`, `example.test`, CASE-ids). **No real customer data,
  names, screenshots or testimonials exist in this repository, and none may be invented.**

## Product Principles

1. **Evidence before assurance.** A screen never claims something happened ("syncing on
   schedule") without the run, the count and the time beside it.
2. **The schedule is the product.** The screen a new customer lands on is the one an
   established customer uses; nothing is hidden behind an empty state.
3. **Refusal is a first-class outcome.** A row that was refused, a test that failed, a
   grant that lapsed each get their own words and their own next action.
4. **One application for everyone.** Operators and customers share one interface, one
   language switch, one set of divisions; permissions decide what is live, not what is
   visible.
5. **Consent is stated before the redirect.** What will be read and what will never be
   written are printed on the card, not on a help page.

## Accessibility & Inclusion

- State is carried by geometry and words before hue: four distinct status marks (solid,
  half, struck, open) survive greyscale and colour-blindness.
- Every board hue has its lettering solved for contrast at runtime; text on any hinged leaf
  clears 4.5:1.
- `prefers-reduced-motion` collapses travel to a single frame but keeps the ink pass, so a
  new row is still announced visually.
