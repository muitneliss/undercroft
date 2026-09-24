# Setting the assistant up

The assistant is the interleaf: the sheet that hinges out beside the open leaf when a reader
presses the printer's fist (☞) in the running head. It answers questions about a customer's
data and proposes changes the reader confirms. ADR 0029 records the decisions; this is how to
turn it on.

## What it needs

Four variables on the **control plane** only. The worker needs none of them.

| Variable                               | Required for           | Absent means                               |
| -------------------------------------- | ---------------------- | ------------------------------------------ |
| `UNDERCROFT_ANTHROPIC_API_KEY`         | anything at all        | the panel says the assistant is not set up |
| `UNDERCROFT_TYPESAFE_API_KEY`          | proposing any change   | it answers questions and refuses to act    |
| `UNDERCROFT_ASSISTANT_APPROVAL_SECRET` | tamper-proof approvals | approvals are unsigned                     |
| `UNDERCROFT_ASSISTANT_MODEL`           | pinning a model        | `claude-opus-5`                            |

**The degradation is deliberately in two steps**, and the second one is the interesting one.
With a model key and no TypeSafe key the assistant comes up able to answer and unable to
offer a change — because the prompt-injection gate fails closed. An assistant that reads a
customer's mail must not be talked into acting by it, so when the gate cannot answer, the
answer is no. See `services/assistant/judge.ts`.

## Doing it

Locally, in `deploy/compose/.env` (untracked — never commit a key; `.claude/rules/pii.md`):

```sh
UNDERCROFT_ANTHROPIC_API_KEY=sk-ant-...
UNDERCROFT_TYPESAFE_API_KEY=apikey_...
UNDERCROFT_ASSISTANT_APPROVAL_SECRET=$(openssl rand -base64 32)
```

Then `task dev:run`.

On the server the same four go in the **Dokploy panel environment**, by hand. CI never writes
the panel's configuration (`.claude/rules/deployment.md`): `saveEnvironment` replaces the whole
blob, which holds every live credential. `task cd:preflight` asserts the panel's compose source and
command, not its environment; a missing variable shows up in the boot log, and a human repairs
it.

## Checking it came up

The boot log says which state it is in, and it is worth reading, because nothing on the screen
distinguishes "answers only" from "fully configured" until somebody asks for a change:

```
assistant_ready  model=claude-opus-5  writes=gated             approvals=signed
assistant_ready  model=claude-opus-5  writes=refused: no UNDERCROFT_TYPESAFE_API_KEY  approvals=unsigned
assistant_unconfigured  missing=UNDERCROFT_ANTHROPIC_API_KEY
```

Then, signed in as an admin on a customer:

1. Press the fist in the running head. The leaf narrows and the sheet hinges in beside it.
2. Ask something ("Các nguồn thế nào?"). The answer streams; a figure may be set beneath it.
3. Ask for a change ("Chạy đồng bộ Xero ngay"). A **proof** appears — one sentence, the
   arguments, two plates. Discard it and confirm in Journal that nothing ran. Ask again,
   strike it, and confirm the run appears.
4. Sign in as a **viewer** and ask for the same run. It is refused, in the viewer's language,
   by the procedure itself.

## What it will not do

Worth knowing before somebody asks for it as a bug:

- **It does not run SQL.** Ask for a query and it writes one into the lake console's editor
  and takes you there; you read it and press Run. `lake.query` executes against a customer's
  data as their own role, and an author has to see what they are about to run.
- **It does not author or build dbt models**, for the same reason.
- **It does not change a member's role or remove a member.** Those procedures exist but are
  deliberately not given to the assistant; use the People division, or
  `undercroft people set-role` / `remove-member`.
- **It does not choose Gmail labels or Drive files.** That is consent, given by an admin on
  the scope page (Gmail labels) or in Google's Picker (Drive).

## When it goes wrong

| Symptom                                                     | Cause                                                                                                                                    |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| The fist is absent                                          | No customer open — the panel needs a book. It is also absent on Customers.                                                               |
| "Trợ lý chưa được cấu hình"                                 | No `UNDERCROFT_ANTHROPIC_API_KEY`.                                                                                                       |
| It answers but never offers to act                          | No `UNDERCROFT_TYPESAFE_API_KEY`, or the gate is unreachable. Check the boot log's `writes=`.                                            |
| It says you have not asked for something you just asked for | The gate scored below its threshold. Say it again more plainly; `ASKED_FOR_THRESHOLD` is a starting point and ADR 0029 lists it as open. |
| A refusal naming a role                                     | The procedure refused, not the assistant. It has exactly your permissions.                                                               |
| "Cuộc trò chuyện này đã quá dài"                            | `MAX_TURNS` reached. Clear the conversation.                                                                                             |
| A figure says the result is not kept                        | Correct, on a reloaded conversation: results are digested rather than stored. Ask again to see it.                                       |
