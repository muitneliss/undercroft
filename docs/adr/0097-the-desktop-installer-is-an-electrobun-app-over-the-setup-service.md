# 97. The desktop installer is an Electrobun app over the setup service

- Status: Accepted
- Date: 2026-09-30
- Related: [ADR 0095](0095-undercroft-installs-through-a-setup-wizard-that-drives-docker.md)
  (the setup service and the terminal wizard this app sits beside), [ADR 0094](0094-a-local-install-signs-its-owner-in-on-loopback.md)
  (why the app opens exactly `http://localhost:<port>`), [ADR 0046](0046-the-cli-installs-once-from-the-latest-release.md)
  (the release as the one channel), [ADR 0009](0009-ui-state-in-zustand-no-usestate.md) (state
  in one store).

## Context

ADR 0095 put every install decision in `packages/setup` and gave it a terminal wizard, and
named a graphical front end built with Electrobun as the next step: most of the people a
one-click install is for do not open a terminal.

Electrobun changed shape between that ADR and this one. Version 2 (2.0.2 on 2026-09-29) no
longer ships its SDK through npm. The `electrobun` package is a small bootstrap that downloads
a build tool, Hutch, which projects the SDK into the project's `.hutch/devkit` and builds the
app; and its default main-process runtime is Cottontail, a runtime of its own on
JavaScriptCore, with Bun one option among several.

## Decision

**`apps/desktop` is an Electrobun 2 app, pinned exactly: `electrobun` 2.0.2 in `package.json`,
and Hutch 0.27.1 with Cottontail 0.7.1 in the `hutch.config.ts` pragma.** It is a window that
runs the same wizard as the terminal one, and a tray icon that runs the install afterwards.

- **The main process is Bun, not Cottontail.** It imports `@undercroft/setup` as it is --
  `node:child_process`, `node:crypto`, the compose file embedded with
  `import ... with { type: "text" }` -- the code the terminal wizard compiles and the suite
  tests, on the runtime they run on. Bun is also the package manager Hutch is told to use, so
  the workspace keeps one lockfile.
- **One setup service, a third caller.** The app adds no install decision. What it adds is
  what a window has and a terminal lacks, in two services: `desktop.ts` (where the install is,
  one compose operation at a time, progress as values) and `dockerSetup.ts` (only winget runs
  unattended, because `brew` and `sudo` would ask a terminal for a password; a Windows restart
  resumes the wizard at the Docker step). The defaults both front ends must agree on -- the
  install folder, the port, the bind address, the redirect URIs to register -- moved into
  `@undercroft/setup`, so the two cannot find different installs on one machine.
- **The view is React with one Zustand store**, the rule `apps/ui` already follows
  (`state.md`, and the `no-usestate` gate now covers `apps/desktop`). The step machine is
  written against `@undercroft/setup/answers`, a subpath that imports nothing, so the webview
  validates answers with `validateAnswers` itself without bundling the process runner.
- **The seam to Electrobun is three modules.** The composition root, the view's RPC bridge and
  the view's entry import the SDK; everything else is written against `rpc.ts` (the RPC
  contract, types only) and `handlers/shell.ts` (the desktop's operations, as a port). The
  offline gate typechecks, lints and tests all of it except those three, which it cannot see
  without Hutch; `task ci:desktop-check` typechecks them against the real SDK, builds the app,
  and launches it to walk itself to the Docker step.
- **Updates come from the GitHub release.** `release.baseUrl` is
  `https://github.com/muitneliss/undercroft/releases/latest/download`, and each release
  attaches the files Electrobun writes, under the names it gives them, since the updater
  builds its URLs from those names. Patches are off: that URL reaches only the newest release,
  so a patch could bridge one version and no more.
- **Release artifacts are unsigned.** macOS (Apple Silicon), Windows x64 and Linux x64 are each
  built on their own runner in the public release workflow, from the public source at the
  release's tag, and published with `undercroft-desktop-SHA256SUMS`. That is what a person
  verifies a download against. The terminal installer's binaries were already unsigned
  (ADR 0095); both now say so in the same runbook section.

## Options rejected

- **Signed distribution: an Apple Developer ID with notarization, and Windows Authenticode.**
  The right end state, declined for now for want of accounts: the project holds no Apple
  Developer Program membership and no code-signing certificate. Azure Artifact Signing, the
  cheapest Windows route, is not offered to individuals or organisations in Vietnam, and an OV
  certificate through a cloud signing service is a recurring cost for an open-source project
  with no revenue. Signing hooks wired to secrets nobody can supply would be dormant code that
  no gate exercises. A maintainer who obtains accounts adds signing in a new ADR; Hutch already
  reads `ELECTROBUN_DEVELOPER_ID` and the notarization variables, so the macOS half is
  configuration.
- **Electrobun 1.18, whose SDK is still an npm package.** It would let the offline gate
  typecheck the three SDK modules. It is the superseded line, and pinning it on the day this
  app is written starts it on a migration.
- **Cottontail as the main process.** Smaller, and Electrobun's default. But the setup
  service's tests run on Bun, and a runtime that reimplements Node's APIs, by its own
  documentation, can differ in the uncommon ones -- spawning a process and reading its pipes
  line by line is the whole of what this app does. Changing the runtime is a config line once
  Cottontail has been shown to run `@undercroft/setup`.
- **Tauri.** A Rust shell in a TypeScript-only repository (ADR 0095 rejected it for the same
  reason); the install logic would be reached over a sidecar rather than imported.
- **Electron.** A bundled Chromium in every download, where this app's macOS disk image is
  21 MB with the system webview, for a seven-step form.
- **Importing `apps/ui`'s stylesheet.** It is the control plane's whole book -- Tailwind layers,
  xyflow, the acetate solver. The wizard copies its tokens and uses its font files instead.
- **A Content-Security-Policy on the wizard's page.** Under `default-src 'self' views:` the
  preload bridge of Electrobun 2.0.2 never answered the view's first request. The page loads
  only the app's own bundled files; the policy can return once Electrobun documents one that
  works.

## Consequences

- **Gatekeeper and SmartScreen warn.** macOS says it cannot verify the developer of an app
  downloaded in a browser, and Windows SmartScreen says it does not recognise the Setup
  program. `docs/runbook/install.md` says how to verify the checksum and how to open each, and
  how to build the app from source with `task build:desktop` instead. SmartScreen keeps an
  unsigned file's reputation by the file itself, so every release starts without one; a
  signing certificate's reputation carries across releases, which is one more reason signing is
  the end state.
- **No Intel Mac build.** Electrobun publishes no macOS x64 core. An Intel Mac installs with the
  terminal wizard, which still compiles for `darwin-x64`.
- **A release builds on three more runners**, macOS and Windows among them, and a pull request
  that touches the app runs `ci:desktop-check` on all three. The first build on a runner
  downloads the pinned toolchain.
- **The gate cannot see three files.** A type error in `main.ts`, `view/bridge.ts` or
  `view/main.tsx` fails `ci:desktop-check`, not `ci:verify`. Keeping those three thin is what
  keeps that gap small.
- **Updates are whole archives,** about 20 MB on macOS, until a stable URL beyond
  `releases/latest` exists to serve patches from.
- **One more version field for release-please**: `apps/desktop/package.json`, which the app's
  `electrobun.config.ts` reads as the app's version and `main.ts` as the release it installs.
