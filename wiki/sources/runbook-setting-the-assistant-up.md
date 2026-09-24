---
title: 'Runbook: Setting the assistant up'
type: source
date: 2026-09-24
tags: []
source: docs/runbook/assistant-setup.md
source_path: docs/runbook/assistant-setup.md
source_hash: fd40a1f6088e7cf7860a0f7c3110118d3f6e434e7ba527709f2da04ba92a8270
ingested: 2026-09-24
---

# Runbook: Setting the assistant up

How to turn the interleaf on; [[ADR 0029: The assistant is an interleaf, and it acts only through the router]] records the decisions behind it. Four variables, on the **control plane only** -- the worker needs none of them. `UNDERCROFT_ANTHROPIC_API_KEY` is needed for anything at all, and absent it the panel says the assistant is not set up. `UNDERCROFT_TYPESAFE_API_KEY` is needed to propose any change, and absent it the assistant answers questions and refuses to act. `UNDERCROFT_ASSISTANT_APPROVAL_SECRET` makes approvals tamper-proof, and absent it they are unsigned. `UNDERCROFT_ASSISTANT_MODEL` pins a model, defaulting to `claude-opus-5`.

**The degradation is deliberately in two steps**, and the second is the interesting one: with a model key and no TypeSafe key the assistant comes up able to answer and unable to offer a change, because the prompt-injection gate fails closed. An assistant that reads a customer's mail must not be talked into acting by it, so when the gate cannot answer, the answer is no.

Locally the variables go in `deploy/compose/.env` (untracked -- never commit a key, `.claude/rules/pii.md`), then `task dev:run`. On the server the same four go in the **Dokploy panel environment, by hand**, because CI never writes the panel's configuration: `saveEnvironment` replaces the whole blob, which holds every live credential, and `task cd:preflight` asserts only the panel's compose source and command, not its environment, so a missing variable shows up in the boot log and a human repairs it ([[Runbook Deployment]]).

The boot log says which state it came up in and is worth reading, because nothing on screen distinguishes "answers only" from "fully configured" until somebody asks for a change: `assistant_ready` prints `model=`, `writes=gated` or `writes=refused: no UNDERCROFT_TYPESAFE_API_KEY`, and `approvals=signed` or `unsigned`, while `assistant_unconfigured` names the missing key. Then, signed in as an admin on a customer: press the fist in the running head and the leaf narrows with the sheet hinging in beside it; ask something and the answer streams, a figure possibly set beneath it; ask for a change and a **proof** appears -- one sentence, the arguments, two plates -- which you discard, confirming in Journal that nothing ran, then ask again, strike it, and confirm the run appears. Finally sign in as a **viewer** and ask for the same run: it is refused, in the viewer's language, by the procedure itself.

What it will not do, worth knowing before somebody reports it as a bug: it does not run SQL (ask for a query and it writes one into the lake console's editor and takes you there, because `lake.query` executes against a customer's data as their own role and an author has to see what they are about to run); it does not author or build dbt models, for the same reason; it does not change a member's role or remove a member -- those procedures exist but are deliberately not given to it, so a membership is changed in the People division or with `undercroft people set-role` / `remove-member`; and it does not choose Gmail labels or Drive files, because that is consent, given by an admin on the scope page (Gmail labels) or in Google's Picker (Drive).

A failure table closes the page. The fist is absent when no customer is open, since the panel needs a book. "Trợ lý chưa được cấu hình" means no model key. Answering but never offering to act means no TypeSafe key or an unreachable gate -- check the boot log's `writes=`. Being told you have not asked for something you just asked for means the gate scored below `ASKED_FOR_THRESHOLD`, which ADR 0029 lists as open; say it again more plainly. A refusal naming a role is the procedure refusing rather than the assistant, which holds exactly your permissions. "Cuộc trò chuyện này đã quá dài" is `MAX_TURNS`. And a figure saying the result is not kept is correct on a reloaded conversation, because results are digested rather than stored.
