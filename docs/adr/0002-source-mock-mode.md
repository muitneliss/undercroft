# ADR 0002 — Mock mode as a first-class source mode

- **Status:** Accepted
- **Date:** 2026-09-17
- **Deciders:** Cuong Tran (owner), implementing agent

## Context

We hold no credentials for any of the four sources. HubSpot, Xero, Gmail and
Drive all need access that has not been arranged yet — a HubSpot private app, a
Xero connection slot, and a Google Workspace OAuth decision that needs an
administrator.

Waiting would stall every part of the platform that does not actually depend on a
credential: the lake, the curated models, the crosswalk, the money contract, the
quality gates, the dashboards. That is nearly all of it.

The obvious alternative — build against fixtures in tests and add "real" code
later — produces two code paths, of which only one is ever exercised before
production.

## Decision

Every source resolves through a mode, read from the environment:

- `VCDO_SOURCE_MODE` sets the default (`mock` or `live`).
- `VCDO_<SOURCE>_MODE` overrides it per source.

`mock` serves recorded fixtures; `live` calls the real API. **The seam is
identical.** Switching a source to live is an environment change plus a
credential, never a code change.

Dokploy holds placeholder credential variables (`VCDO_HUBSPOT_CREDENTIALS` and
friends), empty until each source is ready. Config refuses to start a source in
`live` mode without one, and refuses at startup rather than at first API call —
by then a partial run has already written state and spent API budget.

Three properties follow, and each is pinned by a test in
`tests/unit/test_config.py`:

1. **Mock is the default.** The platform runs end to end with no credential at
   all, which is the only way the offline path stays genuinely working rather
   than notionally supported.
2. **Sources onboard one at a time.** Xero can be live while Gmail is still
   mocked, so a credential arriving for one source does not block on the others.
3. **A typo is an error, not a silent default.** An unknown source name or an
   unrecognised mode raises. Without that, `VCDO_HUBPSOT_MODE=live` leaves
   HubSpot quietly in mock mode, and the symptom is a production dashboard
   showing fixture data — entirely plausible-looking, and wrong.

## Consequences

- The mock path is production code, so it is maintained, reviewed and tested like
  production code. It is not allowed to drift into a stub.
- Fixtures must be recorded from real API shapes, not invented. An invented
  fixture proves the code works against our imagination.
- `Config.live_sources` is reported by `vcdo doctor` and belongs in the run
  ledger, so any output can be traced to whether its source was real.

## Deferred: retention and deletion

The owner decided (2026-09-17) **not** to design retention or deletion yet, so
the lake keeps every observation: `LakeStore` defaults to unbounded retention and
prunes nothing. Create-only plus content-idempotence already bounds growth by
real change rather than by polling frequency, so this is affordable.

This is a starting position with a deadline, not a policy. Under Singapore PDPA,
personal data must not be retained once it no longer serves a business or legal
purpose, and Gmail bodies, attachments and Drive documents are in scope. Disk is
not the constraint — 152 GB free at last measurement — the obligation is.

Revisit before Phase 3 stores production email or document bytes.
