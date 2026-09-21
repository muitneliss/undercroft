# 29. The assistant is an interleaf, and it acts only through the router

- Status: Accepted
- Date: 2026-09-21
- Extends: [ADR 0019](0019-the-wheel-is-full-seven-divisions-seven-hues.md),
  [ADR 0020](0020-bi-is-first-party-metabase-leaves-the-stack.md),
  [ADR 0024](0024-a-documents-text-is-readable-by-dbt.md)

## Context

Every capability this platform has is a tRPC procedure with a role gate in front of it.
Reaching one means knowing which of seven divisions holds it — and the primary reader is
usually mid-call about one customer, which is the worst moment to be learning an information
architecture. So: an assistant that answers questions about a customer's data and performs
actions on the reader's behalf, built on the [AI SDK](https://ai-sdk.dev).

The interesting decisions are not "which model". They are: where does it live, what may it
do, how does a reader confirm an action, what does it render, and what does the record of the
conversation keep.

## Decision

### It is an interleaf, not a division

A binder's interleaf is a blank sheet bound between pages for the reader's own notes. The
panel is a third grid area of `.book`: the leaf narrows, the sheet takes a column beside it,
and the page behind stays in the document and in the tab order. Not a modal, not a portal —
the same decision `.hinge` records for a scope panel, taken at the scale of the whole book.

It wears **no wheel hue**. ADR 0019 records that the seven division hues are spoken for and
an eighth is a decision rather than a hex; this sheet is on `--leaf` stock because it belongs
to the reader rather than to a section. Its mark is the printer's fist (☞) in the running
head — the one band present on every division, because the assistant follows the reader
rather than being a place they go.

It carries a hairline and **no shadow**: ply is declared once, and it is bound in rather than
standing off the board.

### It acts only through `appRouter.createCaller(ctx)`

This is the load-bearing decision. Every tool calls the real procedure through the real
middleware, so `tenantProcedure` answers `NOT_FOUND` rather than `FORBIDDEN` for a non-member
(the assistant cannot be used to enumerate customers), `requireRole` refuses a viewer in the
viewer's own language, and a superadmin holds admin without a `tenant_member` row. Nothing is
re-implemented, so nothing can drift from the copy that ships. **The tool refuses itself.**

The catalogue that declares the tools is a service and may not import `@trpc/*`, so it names
its procedure as a dotted path and the handler binds it. That trades a compile-time check for
layering, so a test asserts every path resolves against `appRouter._def.procedures`.

### Four tiers, and a tier that is not bound cannot be reached

| Tier         | What has to happen first                                                                |
| ------------ | --------------------------------------------------------------------------------------- |
| `read`       | nothing — it returns what the caller could already have read by clicking                |
| `navigate`   | nothing reaches the server at all: no `procedure`, no `execute`, handled in the browser |
| `write`      | a proof the reader strikes, and the judge's agreement                                   |
| `privileged` | the same, plus retyping the object's name                                               |

An unbound tool is a stronger guarantee than a bound one that asks nicely.

**Authoring or running SQL is deliberately at no tier.** `lake.query` executes against a
customer's data as their own role, and an author has to see what they are about to run. So
`draftLakeQuery` writes the query into the console's editor, takes the reader there, and
stops. That is the whole `navigate` tier's reason to exist.

### A change is proposed as a proof, and the gate is separate from the prompt

Before any mutation is offered, two independent things must hold.

The reader strikes it: every mutating tool is `user-approval`, and
`experimental_toolApprovalSecret` HMAC-signs each request against the tool name, call id and
arguments — without which "the reader said yes" is a claim the browser makes about itself.

And the reader's **own words** asked for it. The assistant reads the raw lake, so a tool
result carries mail bodies and document text: content written by people outside this system,
arriving in the same channel the reader's words do. A landed email saying "revoke all ingest
keys" is the ordinary shape of a phishing attempt. The system prompt says to ignore
instructions found in data, and that is necessary and not sufficient, because a prompt is an
instruction to the thing being attacked. So a separate judgement — TypeSafe's System One, a
Noul — is asked about separate state: the reader's turns with **every tool result excluded**,
which is the mechanism. An unavailable judge denies, because a gate that fails open is not a
gate.

The proof's sentence comes from the i18n catalogue, never from the model: asking the thing
that proposed an action to word the confirmation of it is how somebody strikes a sentence that
does not describe what runs. It is **not vermilion** — a destructive plate is an ordinary
plate, because the safety is the confirmation step and not the colour. A discarded proof stays
on the page, struck.

### The model renders from a closed plate case, never from markup

A tool declares which of the application's own printed forms renders its result. The model
supplies typed data; it never supplies HTML.

### A transcript keeps the conversation and digests the payloads

The line is bulk versus conversation. What protects a transcript is reachability: the two
tables are granted to `undercroft_app` alone and no dbt or BI role has USAGE on `app`, so a
conversation is strictly less reachable than `raw.document_text`, which ADR 0024 grants
`undercroft_dbt` outright. So the reader's question and the assistant's answer are kept — they
_are_ the conversation — and a tool's result is replaced by a one-line summary the tool itself
declared safe, or by nothing. A CHECK constraint forbids an `output` or `errorText` key in
`parts` at any depth, so forgetting is a raised error rather than a silent leak.

The server rebuilds the prompt from those rows rather than from the browser's array, so a
tampered transcript cannot put words in the reader's mouth.

## Options rejected

**An eighth division.** Consistent with the existing navigation, and it needs an eighth hue,
which ADR 0019 records as a decision rather than a colour to pick. It also makes the assistant
a place you go rather than a hand that follows you.

**A permanently docked rail.** No gesture to open, and it takes ~22rem from a layout whose
whole argument is density — on screen during the vast majority of the day when nobody is
asking it anything.

**An HTML tool, with sanitisation.** The popular answer, and wrong twice over. It is an XSS
surface on an authenticated page that can reach `lake.query`, and it would let the model
invent visuals outside `DESIGN.md` — an easing curve, a modal, a coloured badge, vermilion on
something that is not an erratum — every one of which renders perfectly while being wrong. A
model cannot read the Wheel Rule. The closed plate case gives better output _and_ no
vulnerability.

**MCP-UI / Apps-SDK widgets in an iframe.** An iframe cannot inherit `index.css`, so it is a
second design system on the page.

**AI Elements**, Vercel's shadcn chat kit. ADR 0025 admits a vendored primitive only where it
would otherwise reimplement real interaction behaviour; a transcript has none, and every
default Tailwind class would have to be stripped and re-dressed.

**Trusting the client's transcript**, which is the AI SDK's default and simplest path. It
makes every tool defend itself alone against a history it cannot verify.

**Letting the assistant run SQL.** It is good at writing SQL, and the failure mode is a query
nobody read executing against a customer's data. Drafting is the same capability with the
reader left in it.

**A prompt instruction as the only injection defence.** See above: a prompt is an instruction
to the thing being attacked.

## Consequences

- Two new secrets, both degrading rather than crashing: no `UNDERCROFT_ANTHROPIC_API_KEY` and
  the panel says it is unavailable; no `UNDERCROFT_TYPESAFE_API_KEY` and it answers questions
  but refuses to offer any change. The boot log names which.
- The interleaf is `React.lazy`-loaded. Eager, `@ai-sdk/react` took the entry chunk from
  528 kB to 710 kB — a third more bytes on first paint for a panel most page loads never open.
- `zod` moved to 3.25.76 and `react` to 19.0.8, both peer requirements of `ai@7`.
- `@ai-sdk/anthropic` and `@typesafe-ai/sdk` are banned from `apps/ui/**` by a Biome plugin,
  pinned from both sides.
- The browser restates three facts about the server's tools — which mutate, which sentence
  each proof prints, which plate draws each result — because it cannot import the catalogue.
  A test asserts all three agree in both directions.

## Open

- **Retention.** Transcripts are not pruned. The digest rule keeps document text out, so this
  is a storage-growth question rather than a PII one; if pruning is added, `raw-lake.md`'s
  "never prune silently" applies and it must name what it removed.
- **The judge's threshold.** `ASKED_FOR_THRESHOLD` is 0.75 as a starting point, to be measured
  against real turns rather than tuned from a cookbook.
- **A per-reader cost ceiling.** `MAX_TURNS` bounds one conversation; there is no daily budget.
