# Auditing business contexts

Every model carries one business context: its purpose, what one row is, its key, what each
column means and the rules it applies. The platform works out its state each time the model
is read, and never stores it:

- `incomplete` -- a part is missing; `missing` names which: `purpose`, `grain`, `key`,
  `columns`, `rules`;
- `needs_review` -- the model's definition, or that of a model it reads directly, changed
  since the context was approved; `changes` names each one;
- `current` -- neither.

An audit finds the contexts that are not `current`, says why, drafts what would make them
right, and lets a person approve each one. It changes no SQL, no test and no table.

## 1. List and group

Call `models.list`. Each model has `context.state`, `context.missing` and `context.changes`.
Group the models by state and show the person the counts, `needs_review` first: those have a
context a reader may already trust that may no longer be true.

Ask which models to review. Do not work through all of them unasked.

## 2. Read each one

Call `models.get` for each model the person chose. Its `context` carries:

- `body`: the approved text, or `null` when none was ever approved. It is kept under a
  `needs_review`: the old description is still the best one there is.
- `changes`: one `{model, kind}` per change. The model may be this one or one it reads.
  `kind` is `sql`, `tests`, `columns` (what a build found changed), `dependency` (it started
  or stopped reading that model) or `missing` (a model it read is gone).
- `absentColumns`: columns the context names that the last build did not have. `null` means
  the model was never built, so nothing could be compared.
- `upstreamUndeclared`: part of what the model reads cannot be read from its declarations,
  so a change through that part would not show up in `changes`.
- `basis`: what an approval of the definition as it stands must send back.

## 3. Report

For each model, tell the person, in their language:

- each change, as a sentence: "the SQL of `stg_deals`, which this model reads, changed";
- each missing part;
- each absent column, and that it is evidence from the last build, not a judgement;
- when `upstreamUndeclared` is true, that some changes cannot be seen.

Read what changed before you draft: `models.get` on the model named in a change, and
`models.lineage` for what reads what. Say what you found, and what you could not tell.

## 4. Draft

Write a new context and show it marked **DRAFT**, beside the approved one when there is one.

- Keep what is still true, word for word. Change only what the definition's change made
  wrong, and say which sentence you changed and why.
- A meaning you cannot read from the person's own words, the SQL or the brief is a question
  for the person. Ask it. Never fill a definition from a column's name.
- A key is the columns the person says identify a row, or no key with the reason. It is not
  a test result; only the model's `unique` test checks it.
- Rules are sentences the person confirms, or `none` when they say the model applies none.

## 5. Approve, only on a yes

Call `models.setContext` with the name, the `basis` from step 2 and the context, only after
the person says yes to that exact text. Saving is the approval.

- `CONFLICT`: the definition changed again since you read it. Go back to step 2 for that
  model and show the person what is new. Never resend an old `basis`.
- `PERMISSION_DENIED` or `WRITES_DISABLED`: approving needs the `admin` role and a write
  grant. Give the person the draft to approve themselves, in the web UI or through their own
  session, and stop.

A context is documentation. Never report a model as verified, tested or passed because its
context is `current`.
