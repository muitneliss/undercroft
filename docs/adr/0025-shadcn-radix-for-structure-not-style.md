# 25. shadcn/Radix for structure, never for style

- Status: Accepted
- Date: 2026-09-20

## Decision

Where a hand-written `apps/ui` component would otherwise have to reimplement real interaction
behavior — focus trapping, roving tabindex, listbox semantics, `aria-*` state wiring — it may
adopt a shadcn-scaffolded, Radix-backed primitive instead of hand-rolling that behavior. The
primitive's source is fetched with the shadcn CLI (`bunx shadcn@4.21.0 add <name>`, run from
`apps/ui/`, pinned rather than `@latest`) into `apps/ui/src/components/ui/`, then hand-edited:
every default Tailwind visual class shadcn generates is stripped and replaced with this
project's own tokens and classes (hairline borders, `steps()` motion via the `--hinge`/`--tip`/
`--turn`/`--pass` tokens, no shadow beyond the one existing exception, never a color-only status
signal). Only the Radix behavior — `data-state`, focus management, ARIA roles — is kept.

Tailwind v4 is installed as shadcn's required peer dependency, imported for its `theme` and
`utilities` layers only (`apps/ui/src/index.css`); its Preflight/base reset is deliberately never
imported, so it cannot change any not-yet-migrated component's rendering. `apps/ui/components.json`
and the `@theme inline` token mapping are hand-authored rather than produced by `shadcn init`,
because `init`'s Tailwind-detection only recognizes the blanket `@import "tailwindcss"` form and
would otherwise try to overwrite the hand-authored `:root` token block in `index.css`.

This is deliberately **not** a general license to reach for a shadcn component. Most of
`apps/ui/src/components/` gets no behavioral value from shadcn/Radix at all: several components
(`TabRail`, `LanguageSwitcher`, `StatusMark`/`Mark`/`Errata`, `RunDetail`, the native `<details>`
disclosures in `ResultTable`/`LakeConsole`) already deliberately implement the accessible answer
and reject the shadcn-shaped one for a documented reason (see "Why" below); others already use a
native HTML element (`<table>`, `<select>`) that is already fully accessible, and the matching
shadcn component (`Table`, `Select`) is a purely visual wrapper with no Radix behavior underneath
it, so adopting it would be pure indirection for no gain. Each component in `apps/ui/src/components/`
is audited individually rather than converted by default; the audit and its per-component verdicts
are tracked outside this ADR (see the migration's own tracking notes, not duplicated here since a
verdict list is not a decision record).

`apps/ui/src/components/ui/**` is exempt from the repo-wide `no-usestate` ast-grep rule
(`.ast-grep/rules/no-usestate.yml`, `.claude/rules/state.md`, ADR 0009): some shadcn-scaffolded
wrapper source calls `useState` internally for its own open/pressed/focus bookkeeping. This is
vendored code, not application state — it never touches the Zustand store, and it is not owned or
maintained here so much as re-fetched — and it does not weaken ADR 0009's actual claim, which is
about where _this application's_ state lives. `scripts/state.test.ts` pins the exemption from both
sides: it fires for `useState` anywhere else under `apps/ui/**`, and stays quiet only under
`components/ui/**`.

## Why

- **Reimplementing Radix's accessibility behavior by hand is real, avoidable risk.** Focus
  trapping in an overlay, roving tabindex in a composite widget, and correct ARIA state wiring
  are each their own small research project to get right, and Radix has already done it. Where a
  component genuinely needs that behavior, building it from `<div>` and `onClick` is the more
  expensive and more fragile choice, not the more careful one.
- **This design system already rejected shadcn's defaults, on the record, for specific reasons —
  not by omission.** `apps/ui/src/index.css`'s own header docstring names the generic
  dashboard answer ("left sidebar, page header, source cards three-up, one status pill each") and
  explains why it is wrong for a "record of standing authorities": containers are hairline rules
  because "exactly one thing in the system casts a real shadow"; radii are a "cut sheet of board,
  not a rounded card"; motion is `steps(n, end)` because "there is no easing curve anywhere in
  this sheet" (ADR 0014); status is shape-first because color alone fails WCAG 2.1 AA 1.4.1
  (`StatusMark.tsx`). Shipping shadcn's stock look would silently reverse all four, spread across
  however many components adopted it, with no single diff a reviewer could catch it in. Stripping
  the visual layer and keeping only the behavioral one is what lets this repo use shadcn/Radix at
  all without that reversal.
- **A purely visual shadcn component earns nothing here.** `Table`, `Card`, `Badge`, `Skeleton`
  and `Separator` are Tailwind-styled markup with no Radix primitive behind them — no keyboard
  handling, no ARIA role beyond what the underlying element already has natively. Adopting one of
  these over the existing hand-written equivalent is a rename with a bigger diff, not a capability
  gain, and the existing equivalents are in several cases _more_ accessible than the shadcn
  default (`StatusMark`'s shape-coded status vs. `Badge`'s color-only pill).
- **Excluding Preflight is what keeps this an opt-in, per-component migration.** Tailwind's base
  reset changes default margins, button chrome and table borders globally the moment it is
  imported — before any component has actually adopted anything. Importing only `theme` and
  `utilities` means adding the dependency is inert until a component's `className`s actually
  reference it.

## Rejected

- **Adopting shadcn's visual output as a redesign** (shadows, rounded corners, eased motion, color
  badges, replacing the current look). Considered and explicitly declined: it would reverse ADR
  0014's motion law and the WCAG-motivated status design in `StatusMark`/`Mark`/`Errata` across
  every component touched, and neither is a decision this ADR is making.
- **Bypassing the shadcn CLI and depending on `@radix-ui/react-*` directly**, skipping Tailwind
  and `components.json` entirely. Rejected because the ask was specifically to adopt shadcn (its
  CLI workflow, its registry, its ability to pull a new primitive on demand later), not to hand-roll
  Radix wiring from scratch under a different name; the CLI is still the fastest correct way to get
  a given primitive's Radix composition right on the first try, even though its visual output is
  discarded immediately after.
- **A blanket exemption of all `apps/ui/components/**` from `no-usestate`**, instead of the narrower
  `components/ui/**`. Rejected because it would silently cover future hand-written components too,
  defeating the rule for exactly the code ADR 0009 was written to constrain.
