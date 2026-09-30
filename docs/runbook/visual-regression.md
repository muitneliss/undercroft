# Visual regression tests

The screens of `apps/ui`, rendered in Chromium from fixtures and compared with pictures a person
reviewed. Why this tier runs on Vitest when everything else runs on `bun test`, and why in a
container, is [ADR 0099](../adr/0099-screens-are-compared-as-pictures-by-vitest-and-nothing-else-uses-it.md).

## What you need

Docker, and the network the first time: the first run pulls the Playwright image and installs the
workspace into a Docker volume. Nothing else -- not Node, not a browser on your machine.

## Running it

```sh
task ci:visual                 # compare every screen with its committed baseline
task ci:visual -- Tenants      # only the files whose path matches
task ci:visual-update          # retake the baselines, then review them (below)
```

Both run the tier inside the Playwright image as `linux/amd64`, the platform CI runs, so a
baseline taken on a Mac is the same bytes as one taken in CI. On an Apple-silicon Mac that
platform is emulated, which is slower and still correct. Do not run Vitest outside the container:
it would write baselines ending in `-darwin.png`, which CI never reads.

`task ci:visual` never writes a baseline. When a picture moved, or has no baseline yet, the test
fails and its capture (`*-actual-*.png` or `*-reference-*.png`) and diff (`*-diff-*.png`, red
where pixels differ) are written to `apps/ui/.vitest-attachments/`, which git ignores. In CI the
`visual` workflow uploads that directory as the `visual-diffs` artifact.

## Writing a visual test

A visual test is a `*.vrt.test.tsx` file under `apps/ui/src`. That name is what keeps it out of
`bun test` (`bunfig.toml`) and in Vitest (`apps/ui/vitest.config.ts`); any other name runs in the
wrong runner. `apps/ui/src/routes/Tenants.vrt.test.tsx` is the example.

```tsx
await open("/tenants", "en", { "tenants.list": CUSTOMERS }).matches("customers-en-1440", 1440);
```

- `open(url, locale, answers)` mounts the real app -- the shell, the router, react-query, the
  tRPC client, `index.css` and the bundled fonts -- at `url`, in `"en"` or `"vi"`. `answers` maps
  a procedure path to what it returns; `session.me` (signed in as `operator@example.test`, not a
  superadmin) and `config.signIn` are answered unless you override them. The reader's role is
  fixture data, as on the server: `tenants.list` per customer, `tenants.get` for the open book.
- A procedure the page asks for and `answers` does not name fails the test, naming it. To show a
  refusal on purpose, answer that procedure with a `Response` carrying tRPC's error envelope.
- `.matches(name, width)` waits until no query is in flight and nothing is `aria-busy`, waits for
  the fonts, makes the viewport as tall as the page, and compares the whole page. Use 1440 and
  390, the widths the design references are captured at.
- The page's clock is stopped at `VISUAL_NOW` (from `@/test/visual.tsx`); write fixture times
  relative to it. `vi` is banned: nothing here is mocked.
- Fixtures are synthetic, mirroring the design review's own data where there is one:
  `CASE-nnnn` ids, `example.test` addresses, no real names (`.claude/rules/pii.md`).

## Taking and reviewing a baseline

1. `task ci:visual-update -- <file>`. The new `__screenshots__/<file>/<name>-chromium-linux.png`
   appear next to the test.
2. Open each beside the design's picture of the same screen. They will not be identical: the
   design renders its own data and prototype chrome, and its matching notes list the differences
   the code keeps on purpose. Review for what the change was meant to do, and for nothing else
   moving.
3. Commit the PNGs with the change that made them. A baseline no person looked at is a guess.

A change that moves a screen on purpose updates its baselines in the same pull request. So does a
bump of the `playwright` pin in `apps/ui/package.json`, which moves the image and the Chromium in
it.

## Troubleshooting

| Symptom                                          | Cause and fix                                                                                                               |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `No existing reference screenshot found.`        | The screen has no committed baseline. Take it with `task ci:visual-update`, review it, commit it.                           |
| `procedures the fixtures do not answer: [ '…' ]` | The page asked for a procedure `answers` does not name. Add its fixture; the screenshot would otherwise show an error slip. |
| `the page clock did not stop at …`               | The `freezeClock` command failed: the tier is not running on the Playwright provider. Run it through the tasks.             |
| Every screen differs after a dependency bump     | The Playwright image or a font changed. Retake and review the baselines in that change.                                     |
| `Cannot connect to the Docker daemon`            | Start Docker.                                                                                                               |
