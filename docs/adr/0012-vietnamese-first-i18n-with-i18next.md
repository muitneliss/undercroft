# 12. Vietnamese first: i18next in the browser and on the server

- Status: Accepted
- Date: 2026-09-18

## Decision

The control plane is bilingual. **Vietnamese is the default and English is the second
language**, and that ordering is a product decision recorded in code, not a fallback:
`DEFAULT_LOCALE` in `@undercroft/core` is `"vi"`, and every path that cannot determine a
preference resolves to it.

Four pieces:

- **`packages/core/src/locale.ts`** holds the shared primitive — `Locale`, `LOCALES`,
  `DEFAULT_LOCALE`, `parseLocale` and `negotiateLocale`. Both sides of the wire import the
  same definition of which languages exist. `parseLocale` refuses an unreadable tag with
  `null`; `negotiateLocale` is the one place that turns absence into the default, and it
  says so in its name.

- **`apps/ui/src/i18n/`** holds the browser catalogues (`vi.ts`, `en.ts`) and a module-level
  i18next instance wired to `react-i18next`. `vi.ts` is the source of truth for which keys
  exist: i18next's `CustomTypeOptions` points at `typeof vi`, so a mistyped key is a
  typecheck error, and `const english: typeof vi = en` makes a key added to one catalogue
  and not the other fail `bun run typecheck`.

- **`apps/control-plane/src/i18n/`** holds a much smaller catalogue of its own, on a private
  `createInstance()`: two emails and four refusals.

- **The locale travels as `Accept-Language`.** The tRPC link and the Better Auth client send
  the store's locale on every call; `handlers/server.ts` negotiates it once per request onto
  `Context.locale`, and Better Auth's hooks read it off the request they are handed.

**The Zustand store owns the language.** `useUiStore.locale` is the only thing a button
writes to; `@/i18n` subscribes and pushes the value into i18next and onto `<html lang>`.
Only the locale is persisted to `localStorage` — `selectedTenantId` stays in the URL.

Pure presentation libraries (`connectionState`, `when`, `verdict`) take a `t` as their first
argument instead of returning prose. `connectionState` splits in two: `connectionFacts`
decides which state a grant is in and knows no words, `presentConnection` names it.

## Why

- **The operators read Vietnamese.** English was never a neutral default here; it was the
  language the first version happened to be written in. Making `vi` the default in
  `@undercroft/core` rather than in a UI config means the server writes an invitation email
  in Vietnamese even when no browser is involved at all.

- **The server has to translate, because an email has no client.** This is the argument that
  settled the scope. Nobody's browser is open when an invitation is sent, so there is no UI
  to localise it; only the request that asked for it knows the language. Once a catalogue
  exists on the server for that, wording the same request's refusals there too is the smaller
  surface — the alternative is a parallel set of error codes for the UI to map, which is two
  things to keep in step instead of one.

- **i18next rather than a hand-rolled lookup.** It is two dependencies in a repo that
  minimises them, and it buys three things worth that: plural rules (`1 customer` /
  `4 customers` / `4 khách hàng`, without an English plural rule hard-coded in a component),
  `Intl`-backed number formatting inside a message, and a type system that checks keys at the
  call site. A hand-rolled module would have grown all three badly.

- **The store owns the language, not i18next.** i18next keeps a current language and
  react-i18next re-renders off it, which makes it look like a second home for state next to
  the store — exactly the thing ADR 0009 banned `useState` to prevent, arriving through a
  dependency instead. Letting the switcher call `changeLanguage` directly would have put the
  user's choice inside a library where the store cannot see it, nothing persists it, and the
  tRPC link that has to send it to the server would read a different value from the one the
  page renders. So the store is the owner and i18next is a projection, and the subscription in
  `@/i18n` is the one place that link is made.

- **Both catalogues ship in the bundle.** The SPA grows by roughly 23 kB gzipped, most of it
  i18next itself. Lazy-loading the language not in use was rejected for the size of the
  saving: the second catalogue is a few kB, and a switcher that had to fetch before it could
  switch would stall exactly the reader who cannot read the page they are on.

- **`bun run build:ui` joined the gate.** Adding a value import of `@undercroft/core` to the
  UI broke the Vite build — the root barrel reaches `node:crypto` through `ids.ts` — while
  `bun run typecheck` stayed green, because `tsc` does not care what a bundler can resolve.
  CI ran only `verify`, so that break would have merged and surfaced at the release image
  build. The browser now imports `@undercroft/core/locale`, and the gate builds the SPA.

- **A `t` argument rather than a global.** A pure library that reached for a module-level
  translator could not be tested in two languages in one run, and `setupProgress` would have
  needed a language in scope to count finished sources — a decision taken in the wrong place.

- **An amount does not change shape with the language.** `formatCount` and `formatBytes`
  follow the reader (`1.234` in Vietnamese); `formatMoney` deliberately does not. An amount
  is screenshotted into runbooks and read back over the phone, and separators that followed
  the interface language would make `1.234` mean one thousand to one reader and one-and-a-bit
  to the next, with nothing on screen to say which. That is the silent wrongness
  `.claude/rules/money.md` exists to prevent.

- **The language changes the words, never the clock.** `@/lib/when` keeps
  `timeZone: "Asia/Singapore"` in every locale. Vietnam is an hour behind Singapore, so a
  formatter that quietly followed the locale's own region would render an expiry an hour off
  from the cron printed beside it — which is how somebody concludes a grant has a day longer
  than it has. `when.test.ts` pins it against a non-Singapore locale.

## Rejected

- **A typed in-repo catalogue with no dependency.** The first proposal, and the one that fits
  the repo's "minimise dependencies" instinct best. Rejected because plural selection and
  locale-aware number formatting inside a sentence are the two things such a module always
  ends up reimplementing, and reimplementing them for Vietnamese and English is how an
  English plural rule ends up applied to Vietnamese.

- **Negotiating the browser's `navigator.language` on first load.** It would give an English
  speaker English without them asking. Rejected because it makes the product's default
  unpredictable — two colleagues on the same laptop model see different first screens — and
  because the switcher is on the title page, which costs one click and is discoverable.

- **Sharing one catalogue between the UI and the control plane.** It would have put the UI's
  several hundred keys in the server bundle so that six could be reused, and it would let a
  copy edit on a screen quietly change the wording of an email. Two catalogues, each owned
  where it is read.

- **Error codes over the wire, mapped to copy in the UI.** The honest alternative for
  refusals, and it is what a bigger API would do. Rejected because the email case forces a
  server catalogue to exist regardless, and because a code table is a second thing that has
  to be kept in step with the catalogue — for four messages.

- **Translating the role names.** `viewer`, `member` and `admin` are the values the API takes
  and the words the roster column prints. Only the explanation after the dash is translated,
  so the option and the row cannot disagree.

- **Translating the source names.** "HubSpot" is HubSpot in every language, and a translated
  product name is how an operator fails to find the button they were told to press.

- **A language dropdown.** Rejected for the reader who most needs the control: someone who
  opened the app in a language they cannot read, and therefore cannot find a menu labelled
  "Language". Both faces are always on the page, each carrying its own name in its own
  language.
