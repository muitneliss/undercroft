# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub's "Report a vulnerability"
(Security → Advisories) rather than a public issue. We aim to acknowledge within a few days.

## What the platform protects, and how

- **Per-tenant OAuth credentials** are sealed with AES-256-GCM (`@undercroft/crypto`). The
  master key (`UNDERCROFT_SECRET_KEY`) is read from the environment at point of use and is
  never in the database — a `pg_dump` yields only sealed blobs. Keys rotate additively.
- **The database privilege model** (`docs/adr/0005`) is the boundary between user-authored
  dbt models and credentials: dbt's role has no access to the `app` schema, so a model
  cannot read a credential even by mistake. The BI role cannot read `raw`, `app` or `dq`.
- **The lake is create-only**; nothing overwrites source data in place.
- **Kestra holds no Docker socket**; it can invoke only the worker's fixed HTTP verb
  allowlist.

## Operator responsibilities

- Generate strong random values for every secret in `.env` (see `.env.example`); never
  commit `.env`.
- Google `gmail.readonly` / `drive.readonly` are restricted scopes: in a self-hosted
  deployment you register your own Google app and complete Google's verification.
- Set a retention policy appropriate to your jurisdiction. The lake keeps everything by
  default, which is a starting position, not a permanent one.
