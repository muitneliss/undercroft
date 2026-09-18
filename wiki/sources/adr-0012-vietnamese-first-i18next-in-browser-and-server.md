---
title: ADR 0012 Vietnamese First, i18next in Browser and Server
type: source
date: 2026-09-18
tags: []
source: docs/adr/0012-vietnamese-first-i18n-with-i18next.md
source_path: docs/adr/0012-vietnamese-first-i18n-with-i18next.md
source_hash: a7f58211f12480ad31bac638027aff874ba176e17a6d46a1e5457d2e0953544f
ingested: 2026-09-18
---

# ADR 0012 Vietnamese First, i18next in Browser and Server

> **Numbering note.** Two accepted ADRs share the number 0012. This is the i18n one; the
> other is [[ADR 0012 The Tab Strip Crosses the Head]].

## Decision

The control plane is bilingual. **Vietnamese is the default and English is the second
language**, and that ordering is a product decision recorded in code rather than a fallback:
`DEFAULT_LOCALE` in `@undercroft/core` is `"vi"`, and every path that cannot determine a
preference resolves to it.

Four pieces:

* **`packages/core/src/locale.ts`** holds the shared primitive — `Locale`, `LOCALES`,
  `DEFAULT_LOCALE`, `parseLocale`, `negotiateLocale`. Both sides of the wire import the same
  definition of which languages exist. `parseLocale` refuses an unreadable tag with `null`;
  `negotiateLocale` is the one place that turns absence into the default.
* **`apps/ui/src/i18n/`** holds the browser catalogues. `vi.ts` is the source of truth for
  which keys exist: `CustomTypeOptions` points at `typeof vi`, so a mistyped key is a
  typecheck error, and `const english: typeof vi = en` makes a key added to one catalogue
  and not the other fail `bun run typecheck`.
* **`apps/control-plane/src/i18n/`** holds a much smaller catalogue on a private
  `createInstance()`: two emails and four refusals.
* **The locale travels as `Accept-Language`**, negotiated once per request onto
  `Context.locale`.

**The Zustand store owns the language.** `@/i18n` subscribes and pushes the value into
i18next and onto `<html lang>`. Only the locale is persisted to `localStorage`.

Pure presentation libraries take a `t` as their first argument instead of returning prose.

## Why

* **The operators read Vietnamese.** English was never a neutral default here; it was the
  language the first version happened to be written in. Putting `vi` in `@undercroft/core`
  rather than a UI config means the server writes an invitation email in Vietnamese even
  when no browser is involved.
* **The server has to translate, because an email has no client.** This settled the scope:
  nobody's browser is open when an invitation is sent, so only the request that asked for it
  knows the language.
* **i18next rather than a hand-rolled lookup.** It buys plural rules, `Intl`-backed number
  formatting inside a message, and call-site key checking — the three things a hand-rolled
  module always reimplements badly.
* **The store owns the language, not i18next.** Letting the switcher call `changeLanguage`
  directly would put the user's choice inside a library the store cannot see — exactly the
  second home for state that [[ADR 0009 UI State in Zustand, useState Banned]] exists to
  prevent, arriving through a dependency instead.
* **Both catalogues ship in the bundle**, \~23 kB gzipped. A switcher that had to fetch
  before it could switch would stall exactly the reader who cannot read the page they are on.
* **`bun run build:ui` joined the gate.** A value import of `@undercroft/core` broke the
  Vite build (the root barrel reaches `node:crypto`) while `typecheck` stayed green.
* **An amount does not change shape with the language.** `formatCount` and `formatBytes`
  follow the reader; `formatMoney` deliberately does not, because separators that followed
  the interface language would make `1.234` mean one thousand to one reader and
  one-and-a-bit to the next — see
  [[ADR 0006 Money as a String and Microsecond Stamps]].
* **The language changes the words, never the clock.** `@/lib/when` keeps
  `Asia/Singapore` in every locale; Vietnam is an hour behind, and a locale-following
  formatter would render an expiry an hour off from the cron printed beside it.

## Rejected

* **A typed in-repo catalogue with no dependency.** Plural selection and locale-aware number
  formatting are the two things such a module always ends up reimplementing.
* **Negotiating `navigator.language` on first load.** Makes the product's default
  unpredictable — two colleagues on the same laptop model see different first screens.
* **Sharing one catalogue between the UI and the control plane.** Would put several hundred
  UI keys in the server bundle so six could be reused.
* **Error codes over the wire, mapped to copy in the UI.** A code table is a second thing to
  keep in step — for four messages.
* **Translating the role names** (`viewer`, `member`, `admin`) or the source names. A
  translated product name is how an operator fails to find the button they were told to press.
* **A language dropdown.** Rejected for the reader who most needs it: someone who opened the
  app in a language they cannot read and cannot find a menu labelled "Language".
