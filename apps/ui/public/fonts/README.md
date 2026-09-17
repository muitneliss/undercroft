# Self-hosted faces

Three families, subset to latin / latin-ext / vietnamese by `unicode-range`, so a
reader downloads only the subsets their text needs. Registered in
`ui/src/index.css`; preloaded (latin only) in `ui/index.html`.

| File prefix | Family | Role | Upstream |
|---|---|---|---|
| `archivo-*` | Archivo (variable, `wdth` 62–125, `wght` 400–700) | Display, headings, UI labels, tab lettering | Omnibus-Type |
| `garamond-*` | EB Garamond (variable, `wght` 400–600, roman + italic) | Prose a person must read and act on — the access statement, refusals, explanations | Georg Duffner / Octavio Pardo |
| `mono-*` | Spline Sans Mono (variable, `wght` 400–700) | Machine voice only: identifiers, digests, dates, cron, counts, addresses | Eben Sorkin / Mirko Velimirović |

## Why these are here and not on a CDN

This origin holds the session cookie that opens every stored OAuth credential.
It has no business making a third-party request on every page load, and an
internal control plane cannot assume a font host is reachable either.

## Why these faces

Archivo stands in for Univers: a grotesque with a real width axis, so the
condensed headline voice and the upright display voice come from one file.
EB Garamond stands in for Sabon. Spline Sans Mono replaced Roboto Mono, which is
one of the handful of faces every generated interface converges on; nothing here
needed Roboto specifically.

**Spline Sans Mono ships latin only.** Everything set in it is ASCII by
construction, and a stray glyph falls through to the system mono behind it.

## Licence

All three are under the SIL Open Font License 1.1 — see `OFL.txt`, which ships
beside the files as the licence requires. The OFL permits self-hosting and
redistribution; it does not permit selling the fonts on their own, and any
derivative must not use a Reserved Font Name.

## Replacing one

Subset URLs come from the Google Fonts `css2` API. **Verify roman against italic
by rendering them**, not by trusting the order of the returned `@font-face`
blocks: the italic block is returned first for `ital,wght@0,…;1,…`, and taking
the order at face value ships every sentence of consent copy in italic.
