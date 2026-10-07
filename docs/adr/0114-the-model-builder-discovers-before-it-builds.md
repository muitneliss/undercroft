# 114. The model builder finds out what is needed before it builds anything

- Status: Accepted
- Date: 2026-10-07
- Relates to: [ADR 0067](0067-the-published-skills-are-one-family-over-both-doors.md), whose
  `undercroft-model-builder` this widens without renaming; [ADR 0086](0086-a-tenant-writes-its-own-macros.md),
  whose macro reuse it folds into a wider reuse search; and
  [ADR 0112](0112-a-model-carries-no-business-context.md), whose reasoning it keeps: a model's
  meaning lives in the brief and its tests, not in a record on the platform. None is superseded.

## Context

ADR 0067 gave the published skills a workflow that interviews a person to a written brief and
then drafts, checks, saves and builds a model. It began at the brief. A person who said "build
me a model" got a model; nothing in the workflow asked whether the tenant already had one that
answered the request, or whether a question over it would do.

People asking for a model rarely know yet which layer they need: a look at the data, a report
over a model that exists, one column added to a model, a macro, or a new model. The production
tenant shows what a model-first workflow builds, one request at a time: about 185 models behind
about 20 saved questions and 3 dashboards; the same business filter written into several
questions rather than owned by one model column; a hand-kept list of models copied into two
questions; a cluster of models around one concept with overlapping grains; and a formula made a
macro only after eight models had copied it. Each request was answered. The project as a whole
lost an obvious owner for its concepts.

Every read needed to avoid this already exists on the router and is offered over MCP: the lake
(`lake.summary`, `lake.records`, `lake.query`), the models and their lineage, the macros, and
the saved questions and dashboards. The workflow did not use the last two at all.

## Decision

**`undercroft-model-builder` keeps its name and becomes discovery-first.** A new model is one
outcome of it, not its premise:

- **Reconnaissance first.** It reads the models, macros, the model reference, the lake summary,
  the saved questions and the dashboards before it designs anything, and gives the person a
  short inventory rather than the raw lists.
- **The outcome before the implementation, one question at a time.** It asks what the person
  wants to understand or decide and who uses the result, offering choices the inventory shows.
  A fact about the data is read, never asked or guessed; a meaning is asked.
- **A route.** Explore, Reporting, Modeling, or a combination of only the stages needed. Explore
  and Reporting are complete outcomes.
- **Reuse before creation.** An owner is looked for in order: an existing question or
  dashboard, model, macro, raw entity, a change to one of them, and only then a new component.
  A new component needs one sentence saying why the existing ones cannot serve. The proposal is
  shown as a reuse map, each piece `REUSE`, `MODIFY` or `NEW`, and with two or three approaches
  when there is a real choice.
- **A plan, approved before any write.** Nothing is saved, overwritten, built, configured or
  deleted until the person approves the plan shown. The approval opens the gate; it does not
  replace the yes each save already needed, and a model's build still has its own.
- **The plan written down, in the person's workspace.** One file, after the approval and before
  the first write, where their project keeps plans, where they say, or under `docs/undercroft/`.
  Where no file can be written, the plan is given in full and said to be unsaved. Evidence goes
  in as shapes and counts, never as copied rows.
- **Validation of meaning, and a duplication check.** Before it hands over, it checks what one
  row means, joins, keys, missing values, currencies and reconciliation with the raw lake, and
  that no concept ended up with two owners.

The detail lives in one new reference, `references/discovery.md`. `SKILL.md` is the map and
keeps every guardrail it had: `models.check` before showing, a save on the person's yes,
`create: true` and no silent overwrite, a separate yes for the build, no delete, and a stop at
every refusal. `references/interview.md` becomes the Modeling route's brief and no longer
re-asks the purpose discovery established.

`apps/control-plane/src/publishedSkills.test.ts` pins the one part a machine can see: the skill
names every read discovery depends on. The behaviour around those reads -- one question at a
time, the gate, the quality of a recommendation -- is prose, and is reviewed as prose.

## Options rejected

- **Rename the skill**, to something like `undercroft-data-builder`. It is installed by name
  (`npx skills add ... --skill undercroft-model-builder`) and named by the entry skill; ADR 0067's
  own rename already cost every installer a manual step. The description was widened instead, so
  it triggers on a report or an open question as well as on a model.
- **A second skill for discovery** beside the model builder. Two published skills would compete
  for the same request, and an agent that picked the builder would skip discovery entirely --
  the failure this decision exists to remove.
- **New procedures**, such as a plan stored on the platform. Every read the workflow needs
  exists. A plan kept by the platform would be the per-model prose ADR 0112 removed because
  nobody maintained it; a file in the person's own workspace is theirs to keep or discard.
- **Testing the prose**, for example that the skill says "one question at a time". It would
  pin wording, break on every edit that keeps the meaning, and pass on an edit that loses it.

## Consequences

- A request for a model can end with a question, a dashboard tile, one changed column or an
  exploratory answer, and the runbook says that is by design.
- The workflow reads more before it asks, which costs a few calls at the start of every request
  and saves a duplicate model at the end of some.
- A person with read access only can be taken to the end of discovery and leave with a plan
  someone else can carry out.
- The builder now saves questions and dashboards as well as models and macros, each on its own
  yes. Saving a question or dashboard with an `id` replaces it whole, so the skill reads it first
  and shows what changes.
