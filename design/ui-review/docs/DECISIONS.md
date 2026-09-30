# Decisions to agree before production implementation

| Decision                  | Recommended starting point                                                                      | Trade-off / alternative                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Delivery size             | UI-first changes, then lineage contract separately                                              | One large redesign is harder to review and roll back                                           |
| Model version             | Do not display until revision identity is defined                                               | SQL hash, immutable revision number and SemVer mean different things                           |
| Recovery                  | Secondary annotation derived from ordered completed runs                                        | A primary recovered status overlaps success and makes summary totals ambiguous                 |
| Latest success            | Explicit nullable server field / approved history derivation                                    | Latest build may have failed; its time is not latest success                                   |
| Running model             | Authoritative active-run identity and lifecycle                                                 | Do not turn null lastBuild into running; null can mean never built                             |
| Graph authority           | The server reads each model's own declarations (`ref`, and `source` for the raw lake tables)    | Regex over SQL is not a reliable lineage parser; a filter or a table name is not a declaration |
| Edges beyond declarations | None: no source account → model, no model → report/question/dashboard                           | Each needs its own declared contract first; a guessed edge reads exactly like a declared one   |
| Unknown relationships     | Show unknown/unresolved explicitly                                                              | A missing graph edge must not look like proof that there is no dependency                      |
| Summary counts            | Derive list counts from the same dataset                                                        | Server-wide totals need an endpoint if the list later becomes paginated                        |
| Journal filtering         | One account, in the address, filtered server-side across the complete history                   | A current-page filter must be labelled as such; never call it global                           |
| Graph accessibility       | Keyboard links and text paths alongside diagram                                                 | Color or a dimmed canvas alone is insufficient                                                 |
| Scope review              | Review current choice versus saved choice, and state per kind what happens to held records      | Drive and Gmail are stated from ADR 0071; other kinds only once confirmed against the read     |
| Run scope                 | Store the scope observed when a run starts; older runs show an em dash                          | Reading today's scope later dates today's answer to the past (ADR 0039)                        |
| Run → records             | Admin-only link from a run's counts to the records it wrote; report records a later run rewrote | A raw record names only the run that last wrote it                                             |

These are design/contract choices, not blockers to reviewing the offline prototype. Nothing in this file authorizes publishing, migrations or production changes.
