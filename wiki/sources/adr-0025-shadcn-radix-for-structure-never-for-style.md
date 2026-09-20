---
title: ADR 0025 shadcn/Radix for Structure, Never for Style
type: source
date: 2026-09-20
tags: []
source: docs/adr/0025-shadcn-radix-for-structure-not-style.md
source_path: docs/adr/0025-shadcn-radix-for-structure-not-style.md
source_hash: dd2d630983aeb7ae00d95d5f732162e4b6dc5ea877da548480bbb24c831a8f36
ingested: 2026-09-20
---

# ADR 0025 shadcn/Radix for Structure, Never for Style

# ADR 0025 shadcn/Radix for Structure, Never for Style

A hand-written `apps/ui` component may adopt a shadcn-scaffolded, Radix-backed primitive
(fetched via the pinned `bunx shadcn@4.21.0 add <name>` CLI into `apps/ui/src/components/ui/`)
only for genuine interaction behavior it would otherwise have to reimplement -- focus
trapping, roving tabindex, ARIA state wiring -- never for shadcn's default visual output,
which is stripped and replaced with this project's own tokens and classes on every adoption.

Tailwind v4 is installed as shadcn's required peer, importing only its `theme` and
`utilities` layers (never Preflight, which would change every not-yet-migrated component's
rendering globally). `apps/ui/src/components/ui/**` is exempted from the repo-wide
`no-usestate` ast-grep rule (see ADR 0009, `.claude/rules/state.md`) because vendored shadcn
wrapper source may call `useState` internally for its own bookkeeping; `scripts/state.test.ts`
pins the exemption from both sides.

This is deliberately not a license to reach for shadcn everywhere: most of
`apps/ui/src/components/` already implements the accessible answer natively (`<table>`,
`<select>`, `<details>`) or documents a deliberate rejection of the shadcn-shaped default
(see `[[ADR 0014 Frames Are Size, Nothing Eases]]` on stepped motion, and `StatusMark`'s
WCAG 2.1 AA 1.4.1 shape-coded status), so each component is audited individually rather than
converted by default.
