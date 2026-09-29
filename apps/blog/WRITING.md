# Writing a post for the Undercroft blog

The blog exists so that people searching for a problem Undercroft solves find it: "Xero
integration", "Gmail to database", "Google Drive OCR", "ETL vs ELT". Every rule below serves
either being found or being trusted once found.

## One post, one search intent

- Each post answers **one query a person types**. Write the primary keyword down before
  writing anything else, then put it in the slug, the `title`, the H1 (the title is the H1),
  the `description`, the first paragraph, one H2 and the hero image's `heroAlt`. Use it
  naturally; never repeat it to pad.
- An integration's landing post sets `integration:` (`xero`, `gmail`, `google-drive`,
  `hubspot`). At most one post per language may claim a source, and the build fails on a
  second one: two pages competing for "Xero integration" both rank worse.
- `title` is 20–70 characters and `description` 80–170. Past those, search results cut them
  off, so the schema rejects them.
- Structure by the questions a reader asks: an H2 per question, short paragraphs, a table or a
  list where the answer is a comparison. End with an `## FAQ` of three or four questions phrased
  the way people search, each answered in two or three sentences.
- Link to at least two other posts by their path (`/en/etl-vs-elt/`, `/etl-va-elt-la-gi/`),
  in the same language, with descriptive anchor text, never "click here".

## Every post exists in Vietnamese and English

- `src/content/posts/vi/<slug>.md` and `src/content/posts/en/<slug>.md`, paired by the same
  `translationKey`. The build fails on a post without its pair.
- Each language gets its **own slug**, the words its readers search: `tich-hop-xero-postgres`
  and `xero-integration-postgres`.
- The Vietnamese post is written for Vietnamese readers, not translated sentence by sentence.
- **Technical terms stay in English in the Vietnamese post.** A reader who knows "data lake"
  does not recognise "hồ dữ liệu", and a search engine does not match it either. Keep, for
  example: data integration, ETL, ELT, data pipeline, data lake, raw data, data warehouse,
  connector, REST API, API, OAuth, sync, incremental sync, watermark, schema, dbt, model, SQL,
  Postgres, S3, MinIO, BI, dashboard, report, self-hosted, open-source, multi-tenant, OCR,
  MCP, AI agent, CLI, and every product name (Xero, Gmail, Google Drive, HubSpot, Fivetran,
  Airbyte). Write the Vietnamese around them: "tích hợp Xero", "đồng bộ dữ liệu", "raw data
  lake bất biến".

## Concepts, not code

The reader is deciding whether this approach, and this product, fits their problem. They are
a finance lead, an operations manager, or an engineer weighing options. They are not yet
operating Undercroft. Implementation detail loses the first two readers and tells the third
nothing they can use before they have chosen. The runbooks in `docs/runbook/` hold the how-to,
so the post explains the idea and links there.

- **No code.** No code blocks, no SQL, no YAML, no shell commands, no JSON.
- **No internals.** No file paths, function, table, column or config-key names, environment
  variables, API endpoints, OAuth scope strings, header names, or internal limits and
  defaults ("1,100 ms", "800 requests", "25 MiB"). Write what they mean for the reader
  instead: "it reads only what changed since the last sync", not the header it sends.
- **No inline code formatting** (backticks) at all. A product or concept name is plain text.
- Explain **the concept** (what ELT is, why raw data should be kept), **the problem it solves**
  for the business, **how Undercroft approaches it** in plain words, **when it fits and when it
  does not**, and **what to do next** (a link to the product, the repository or a runbook).
- One level of mechanism is enough. "Each sync reads only what changed, and a periodic full
  read catches edits the source does not report" is the right depth. How the watermark is
  stored is not.

## Only what is true

- Every claim about Undercroft must be true of this repository: `README.md`,
  `docs/architecture.md`, `docs/adr/`, `docs/runbook/`, `specs/connectors/`. Read the source
  before describing a feature, and never promise one that does not exist. The product's own
  rule applies here: never guess. Read deeply, then write at the level of the concept.
- Compare competitors fairly and only on facts you can state generally (hosted vs
  self-hosted, licence, where raw data lives). No invented benchmarks or prices.
- No real customer, person or company data (`.claude/rules/pii.md`). Tenants are `CASE-0042`;
  example companies are `Acme`.

## Images: sketches that explain a flow

- A 16:9 `hero` plus one or two diagrams in the body, in
  `src/assets/posts/<translationKey>/`, shared by both languages.
- Style: a hand-drawn ink and pencil sketch on warm off-white paper (`#efe9d9`), boxes,
  cylinders and arrows showing how data flows, like a whiteboard drawn by an engineer. No
  gradients, no 3D, no stock-photo people.
- Labels are short and in English. They are the technical terms, which the Vietnamese post
  keeps in English anyway, so one image serves both.
- A diagram shows a concept, the same as the text: boxes named for what they are ("Raw
  lake", "Models", "Report"). It never shows code, a config file, or an internal table or
  file name.
- Reference an image by its relative path from the post:
  `![alt text](../../../assets/posts/<translationKey>/<file>.png)`. The build converts it to
  WebP at every width. Alt text describes what the diagram shows, in the post's language.

## Frontmatter

```yaml
title: "Xero integration: sync Xero data into Postgres"
description: "One or two sentences with the primary keyword, 80-170 characters."
translationKey: xero-integration
pubDate: 2026-09-29
tags: [Xero, Integration, ELT]
keywords: [xero integration, xero api, xero to postgres]
hero: ../../../assets/posts/xero-integration/hero.png
heroAlt: "Sketch of Xero data flowing through the raw lake into Postgres"
integration: xero
```

`task build:blog` checks all of this, the schema and the pairs, before it builds.
