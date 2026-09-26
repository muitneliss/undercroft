---
title: 'Design: The CLI''s home page and sign-in, drawn in text'
type: source
date: 2026-09-26
tags: []
source: docs/design/cli-home-and-sign-in.md
source_path: docs/design/cli-home-and-sign-in.md
source_hash: 9d0c4ef3e2a7655da0413905d7da24224a13ea530ee5d14fc254425691987fae
ingested: 2026-09-26
---

# Design: The CLI's home page and sign-in, drawn in text

# Design: The CLI's home page and sign-in, drawn in text

What `undercroft` shows a person at a terminal when run on its own, and how signing in at a terminal reads; built, with every frame captured from the built CLI. It carries the web UI's reference-manual world into type: the **title page** while signed out, with the sign-in form written on it (the home page and the login are one screen), and the **contents page** once signed in, every topic with a dot leader to the number of commands under it.

Five rules hold on every page, stated in `apps/cli/src/services/typeset.ts`: every stroke is 7-bit ASCII (the mark is rasterized from `Mark.tsx`'s path onto a 20 x 10 grid); one ink, the terminal's foreground; red is held for errata alone, a cancel is dim; rank comes from form, so `NO_COLOR` loses nothing; motion is stepped per [[ADR 0014 Frames Are Size, Nothing Eases]], one moment of it, the mark cut in three frames on the title page (not under `--quiet`, on CI, or on a narrow page).

Agent mode draws none of it: a bare piped `undercroft` still prints oclif's help (pinned in `cli.test.ts`), and `home` is a hidden command `main.ts` routes a bare run to in human mode only, so the `undercroft` skill, which always passes `--agent`, sees no change ([[ADR 0044: An agent reaches Undercroft as a caller]]). `--no-input` draws the page and never prompts.

Sign-in at a terminal is one run: email, a six-cell code prompt (paste fills it; only six digits submit; masked once submitted), and a rejected code offers a new code, another address, or quitting. The code-sent line keeps the server's "if ... has access" neutrality and no longer says "run again with --code" in the interactive path. The contents page is drawn only after `session.me` answers, since a session file is not evidence of a session. Topic order is typed against `TopicKey`; counts come from the command table at run time, and a topic whose commands are all in sub-topics (`account`) is a heading with no count.

In human mode every failure on stderr is an erratum: a red `ĐÍNH CHÍNH` / `ERRATUM` label, the error code first (still greppable), the message, details, and the trace id wrapped at the page width. Width is at most 77 columns with a 3-column margin (Clack's text column); under 60 columns the pages stack into one column. Known deviation: Clack's own email and choice prompts mark a Ctrl-C with Clack's red cancel symbol.

Code: `services/typeset.ts`, `titlePage.ts`, `contentsPage.ts`, `erratum.ts`; `handlers/home.ts`, `terminalSignIn.ts`, `prompts.ts`; words under `page` and `login` in `apps/cli/src/i18n/{vi,en}.ts`. See also [[Runbook: The undercroft CLI]].
