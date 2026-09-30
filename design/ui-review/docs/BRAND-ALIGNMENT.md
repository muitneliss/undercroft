# Brand alignment — r5

2026-09-29. Local prototype only; no production or GitHub changes.

## Scope

The requested change was only the original logo and fonts, following the Undercroft homepage. This pass replaces the approximate arch with the exact upstream mark: the rounded square and transparent arch use the original even-odd path, without redrawing or rasterizing it.

The shared header displays **Undercroft**, using Archivo 700, width axis 100 and letter spacing -0.025em. Desktop uses the homepage's 36px mark, 1.75rem wordmark and 0.75rem gap. Mobile scales the same lockup to fit the already-approved header. All seven sections and their inner screens inherit this shared header.

The homepage and signed-in upstream header use different wordmark treatments. This prototype intentionally uses the **homepage treatment**, not the signed-in shell's uppercase, expanded tracking. In production, reuse the existing `Mark` component and obtain maintainer approval before changing the authenticated shell's wordmark treatment.

## Font provenance

No substitute fonts were introduced. All 11 existing WOFF2 files matched the reference repository files by SHA-256:

- Archivo: UI, controls and headings; Latin, Latin Extended and Vietnamese subsets.
- EB Garamond: explanatory prose; regular and italic, with Latin, Latin Extended and Vietnamese subsets.
- Spline Sans Mono: identifiers, code and machine-readable values; Latin and Latin Extended subsets.

Existing font declarations, binaries, type roles and content sizing are preserved. Only the brand wordmark's typography changes. Font and upstream license files remain in the package.

## Source references

Repository: `muitneliss/undercroft`, rechecked at `116a41e` (release 1.53.0): the 212-character `mark.svg` path and all 11 WOFF2 files still match by exact text and SHA-256.

- `apps/ui/src/components/Mark.tsx` and `apps/ui/public/mark.svg`: mark geometry.
- `apps/ui/src/routes/Landing.tsx`: 36px mark and title-case brand label.
- `apps/ui/src/styles/home.css`: `.landing__brand` typography and spacing.
- `apps/ui/src/index.css`: font families and spacing token.
- `apps/ui/public/fonts/`: unchanged font binaries.

No changes to charts, lineage, page layout, navigation, filters, role logic, VI/EN controls, form behavior, animation or production contracts.

## Verification

- `node --check assets/app.js` passed.
- The inline SVG path exactly matches the 212-character upstream `mark.svg` path.
- SHA-256 comparison passed for all 11 WOFF2 files.
- Browser check at a 1280px-wide desktop viewport: Archivo 700 at 28px, width axis 100, tracking -0.7px and a square 36px mark; all three font families reported loaded.
- The header retained its previous measured height (64.67px); no document-wide horizontal overflow. The brand link still navigates to Sources, and VI/EN controls remain present.
- Visual evidence: `screenshots/17-original-brand-desktop.jpg`. Earlier screenshots used the superseded brand treatment and were removed during final-folder cleanup; their recorded test observations remain in the QA documents.

This is a focused brand verification, not a new full-device, accessibility or production integration audit. Interaction verification is in `QA.md`.
