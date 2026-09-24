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
- **Each tenant's rows are fenced by row-level security** (`docs/adr/0018`), and each tenant
  has its own dbt and BI logins, so one customer's models cannot read another's records.
- **dbt can read extracted document text** (`raw.document_text`, `docs/adr/0024`), which
  holds whatever names a human wrote in a document. The BI role cannot, and the control
  plane is denied the `text` column.
- **Sign-in is invite-only** (`docs/adr/0010`).
- **The CLI and the assistant act only as the signed-in person**, through the same role
  checks as the web UI (`docs/adr/0029`, `docs/adr/0044`). The CLI never holds a DSN or a
  service token, and its writes need a per-profile opt-in that only a person at a terminal
  can set. The assistant's injection gate denies every change when it is not configured.
- **The lake is create-only**; nothing overwrites source data in place.
- **Kestra holds no Docker socket**; it can invoke only the worker's fixed HTTP verb
  allowlist.

## Operator responsibilities

- Generate strong random values for every secret (see `deploy/compose/.env.example`; on a
  server they go in the Dokploy environment); never commit `.env`.
- Google `gmail.readonly` / `drive.readonly` are restricted scopes: in a self-hosted
  deployment you register your own Google app and complete Google's verification.
- Set a retention policy appropriate to your jurisdiction. The lake keeps everything by
  default, which is a starting position, not a permanent one.
