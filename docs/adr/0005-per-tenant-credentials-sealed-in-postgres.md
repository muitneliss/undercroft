# ADR 0005 — Per-tenant credentials, sealed in Postgres

- **Status:** Accepted
- **Date:** 2026-09-17
- **Deciders:** Cuong Tran (owner), implementing agent
- **Relates to:** [ADR 0004](0004-control-plane-ui.md)

## Context

Credentials were `VCDO_<SOURCE>_CREDENTIALS`: one environment variable per
source, for the whole platform. Two properties make that unusable for more than
one customer, and neither is fixable by being careful:

1. **One value per source.** There is nowhere to put a second customer's token.
2. **Immutable at runtime.** OAuth tokens rotate — Xero's every thirty minutes,
   and its *refresh* token on every use. A process cannot rewrite its own
   environment for the next process, so a rotated token would be lost on exit.

So credentials need a writable, per-tenant home.

## Decision

Store them in Postgres, sealed with AES-256-GCM, in a schema the BI role cannot
reach.

```
ops.connection          status, external account, chosen scope — no secret material
app.connection_secret   ciphertext, nonce, key_version, expires_at
```

### Why not the raw lake

The lake is the obvious place for per-tenant data — it is already keyed by
tenant. But `.claude/rules/raw-lake.md` forbids overwriting an object in place,
and rotation *is* overwriting in place. Storing a mutable credential there would
mean either breaking the rule that makes the lake an archive rather than a cache,
or writing a new immutable version on every refresh and reading the newest, which
is a mutable store wearing a costume.

Everything in Postgres is a projection and may be rebuilt. A credential is not a
projection — but it is mutable state, and that is the property that decides where
it lives.

### Why not a secrets manager

Vault or Infisical would isolate this better and give proper audit and lease
semantics. They would also be another service to run, secure, monitor and back
up, on a host with 11 GiB free and **no swap** (ADR 0001 §3), for one table's
worth of rows. Recorded here as a considered trade rather than left as an implied
preference: if the tenant count or the regulatory position changes materially,
this is the decision to revisit first.

### Why a separate `app` schema, not a table in `ops`

This is the sharpest detail in the change. Migration 002 ends with:

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA ops GRANT SELECT ON TABLES TO metabase_ro;
```

**Every table created in `ops` from then on is automatically readable by the
Metabase role.** Putting sealed tokens beside the connection they belong to — the
obvious, tidy choice — would have granted every dashboard user read access to
every customer's OAuth credentials, silently, the moment the migration ran.
Nobody would have had to grant anything.

Migration 002's own closing comment anticipates exactly this: "a later migration
that grants broadly would otherwise silently open this up." The durable answer is
the one `dq` already demonstrates — a whole schema the BI role has no `USAGE` on.
`tests/integration/test_control_plane_grants.py` pins it, including a test that
fails if anyone adds a default-privilege grant to `app`.

### Key handling

- One key, or several, from `VCDO_SECRET_KEY`, base64, 32 bytes each.
- **Rotation is additive.** `VCDO_SECRET_KEY=1:<old>,2:<new>`: new writes seal
  under the highest version, existing rows stay readable under theirs. No
  re-encrypt-the-table migration, which is the one everybody defers and then does
  badly.
- **Resolved lazily, never through `Config`.** `vcdo.core.config.load()` is
  called by tests with an empty environment and produces a frozen dataclass that
  is logged and `repr`d freely. A client secret belongs in neither.
- A short key is **refused, not stretched**. Padding or hashing a short key into
  shape yields something that encrypts and decrypts perfectly while having far
  less entropy than it claims.
- A tampered ciphertext **raises**. It never opens as `""`, which would present
  downstream as a connection that exists and does not work — the slowest failure
  there is to diagnose.

## The backup trap, stated plainly

`app` is in `BACKUP_SCHEMAS`, so `app.connection_secret` is inside every
`pg_dump`. `VCDO_SECRET_KEY` is **not**.

That is deliberate, and it cuts both ways:

- A dump restored **without** the key yields rows nobody can read. Every customer
  reconnects every source by hand.
- A dump stored **beside** the key is a dump that decrypts itself. The encryption
  buys nothing.

So the key is backed up separately, by a different mechanism, to a different
place. This is the sentence to check during a restore rehearsal, and the reason
`vcdo/cli/backup.py`'s docstring names it too.

## Consequences

- Onboarding a source becomes a click, not a deploy.
- `ops.connection` stays visible to BI, so connection health can appear on a
  dashboard without exposing anything that opens an account.
- A refresh takes `SELECT ... FOR UPDATE` on the secret row. Xero invalidates the
  old refresh token the moment it is exchanged, so two concurrent refreshes do
  not race to a winner — they destroy the connection and the customer must
  re-consent.
- `expires_at` is duplicated in the clear beside the ciphertext, so "which
  connections need attention" is a query rather than a decrypt-everything loop.
