# Changelog

## [1.36.1](https://github.com/muitneliss/undercroft/compare/v1.36.0...v1.36.1) (2026-09-25)


### Bug Fixes

* **ci:** allow real server tests time to clean up ([#239](https://github.com/muitneliss/undercroft/issues/239)) ([7de9800](https://github.com/muitneliss/undercroft/commit/7de9800f7f741794a94fb0ecaacc2b8c2ec0a561))

## [1.36.0](https://github.com/muitneliss/undercroft/compare/v1.35.1...v1.36.0) (2026-09-25)


### Features

* **ui:** add public homepage and searchable customer index ([#237](https://github.com/muitneliss/undercroft/issues/237)) ([d38d358](https://github.com/muitneliss/undercroft/commit/d38d358e53b2bf25dfcf342bec5b9975f33cbebf))

## [1.35.1](https://github.com/muitneliss/undercroft/compare/v1.35.0...v1.35.1) (2026-09-25)


### Bug Fixes

* **mcp:** a refused bearer is logged with its reason, and an OAuth access token lives eight hours ([#235](https://github.com/muitneliss/undercroft/issues/235)) ([a01336a](https://github.com/muitneliss/undercroft/commit/a01336ac94799bbdd6b6d88cc1c5c2e17ed47fde))

## [1.35.0](https://github.com/muitneliss/undercroft/compare/v1.34.1...v1.35.0) (2026-09-25)


### Features

* a sync may run on a cron expression beside the four presets ([#229](https://github.com/muitneliss/undercroft/issues/229)) ([29f0a58](https://github.com/muitneliss/undercroft/commit/29f0a589ab929e712aa8268d2d2fd0a9e7fb17d6))
* an agent reaches Undercroft over MCP at /mcp with a person's own read or write token ([#231](https://github.com/muitneliss/undercroft/issues/231)) ([00720de](https://github.com/muitneliss/undercroft/commit/00720dea6d87fc58dcdff4dfbc55065b88de8779))
* **cli:** `undercroft` on its own is a home page -- the title page with sign-in on it, then the contents ([#232](https://github.com/muitneliss/undercroft/issues/232)) ([be340eb](https://github.com/muitneliss/undercroft/commit/be340eb04d97e62e111d1d0ae3ac8882ca8a5cf0))

## [1.34.1](https://github.com/muitneliss/undercroft/compare/v1.34.0...v1.34.1) (2026-09-25)


### Bug Fixes

* **worker:** a Drive run's gauge moves while it lists and skips, not only when it downloads ([#226](https://github.com/muitneliss/undercroft/issues/226)) ([0aaf1a0](https://github.com/muitneliss/undercroft/commit/0aaf1a0af61e85cad3cb6200f4f56d3be1c1342e))

## [1.34.0](https://github.com/muitneliss/undercroft/compare/v1.33.0...v1.34.0) (2026-09-25)


### Features

* every request is traced into the host's otel-lgtm stack, and a debug-trace skill follows one ([#224](https://github.com/muitneliss/undercroft/issues/224)) ([744d57e](https://github.com/muitneliss/undercroft/commit/744d57e465724d72058c228d3e167987d780be3d))

## [1.33.0](https://github.com/muitneliss/undercroft/compare/v1.32.1...v1.33.0) (2026-09-25)


### Features

* **ui:** an open tab is told when a new release is live and offered a reload ([#220](https://github.com/muitneliss/undercroft/issues/220)) ([7b1c505](https://github.com/muitneliss/undercroft/commit/7b1c505c86e6674aa34592a624f38116c4a63a65))


### Bug Fixes

* **extract:** a NUL byte in a document no longer fails the batch, and UTF-16 text with a BOM is read as UTF-16 ([#218](https://github.com/muitneliss/undercroft/issues/218)) ([#222](https://github.com/muitneliss/undercroft/issues/222)) ([80159e1](https://github.com/muitneliss/undercroft/commit/80159e1ed118ae2318de7536a5a0d98a212312d1))
* **worker:** a Drive ingest stops within one file on a deploy, and a run the drain gives up on is closed as cut off, not killed ([#219](https://github.com/muitneliss/undercroft/issues/219)) ([#223](https://github.com/muitneliss/undercroft/issues/223)) ([9427d13](https://github.com/muitneliss/undercroft/commit/9427d13d9e8303d5c5307b921c57f0c17cbfe8e6))

## [1.32.1](https://github.com/muitneliss/undercroft/compare/v1.32.0...v1.32.1) (2026-09-25)


### Bug Fixes

* **connections:** a refresh token the provider refuses marks the connection expired and asks for a reconnect ([#213](https://github.com/muitneliss/undercroft/issues/213)) ([#216](https://github.com/muitneliss/undercroft/issues/216)) ([7ccb97d](https://github.com/muitneliss/undercroft/commit/7ccb97da16a995f6d706b459219fc98d127dbdc0))

## [1.32.0](https://github.com/muitneliss/undercroft/compare/v1.31.0...v1.32.0) (2026-09-25)


### Features

* **connectors:** read a widened HubSpot object in two steps so no choice of properties is too long ([#215](https://github.com/muitneliss/undercroft/issues/215)) ([a4404e1](https://github.com/muitneliss/undercroft/commit/a4404e198c1edccd359179f28d13b8ad6b994998)), closes [#210](https://github.com/muitneliss/undercroft/issues/210)


### Bug Fixes

* **control-plane:** a consent that cannot start names the provider that was pressed ([#212](https://github.com/muitneliss/undercroft/issues/212)) ([11715f3](https://github.com/muitneliss/undercroft/commit/11715f3782dcfa7dcc9dcac7579f5fe3176ab129)), closes [#211](https://github.com/muitneliss/undercroft/issues/211)

## [1.31.0](https://github.com/muitneliss/undercroft/compare/v1.30.0...v1.31.0) (2026-09-25)


### Features

* **worker:** read legacy Word .doc files in process instead of refusing them ([#207](https://github.com/muitneliss/undercroft/issues/207)) ([0b21288](https://github.com/muitneliss/undercroft/commit/0b212885b9071d60d8b0048542b2488b2e0e842d))


### Bug Fixes

* **ui:** say what is happening on every action that calls the server ([#209](https://github.com/muitneliss/undercroft/issues/209)) ([efb4e88](https://github.com/muitneliss/undercroft/commit/efb4e884e8704d0c3a43bd32e58e484e6b397bda))

## [1.30.0](https://github.com/muitneliss/undercroft/compare/v1.29.0...v1.30.0) (2026-09-25)


### Features

* **control-plane:** a local-only Better Auth sign-in method, UNDERCROFT_DEV_SIGN_IN_AS ([#201](https://github.com/muitneliss/undercroft/issues/201)) ([8033c73](https://github.com/muitneliss/undercroft/commit/8033c735f65713e1e7fa808ea4a32b3c78b01070))


### Bug Fixes

* **worker:** a Drive ingest counts files as they download, so a long run is not a frozen screen ([#206](https://github.com/muitneliss/undercroft/issues/206)) ([4f42b8b](https://github.com/muitneliss/undercroft/commit/4f42b8b8c09a0b8a2b0fa05fe8f23ac3b4492040))

## [1.29.0](https://github.com/muitneliss/undercroft/compare/v1.28.2...v1.29.0) (2026-09-25)


### Features

* **connectors:** an admin can choose which HubSpot properties are read ([#202](https://github.com/muitneliss/undercroft/issues/202)) ([#203](https://github.com/muitneliss/undercroft/issues/203)) ([1eeed9f](https://github.com/muitneliss/undercroft/commit/1eeed9f85b2a815cf3233fe4a715b062a3417609))

## [1.28.2](https://github.com/muitneliss/undercroft/compare/v1.28.1...v1.28.2) (2026-09-24)


### Bug Fixes

* **ui:** a second Drive pick adds folders to the scope, and each can be removed ([#197](https://github.com/muitneliss/undercroft/issues/197)) ([#198](https://github.com/muitneliss/undercroft/issues/198)) ([afa626e](https://github.com/muitneliss/undercroft/commit/afa626e3bbd28df2dc3ce18eda6d17b7303a4809))
* **worker:** a deploy stops an ingest cleanly, and the run keeps what it landed ([#196](https://github.com/muitneliss/undercroft/issues/196)) ([#200](https://github.com/muitneliss/undercroft/issues/200)) ([df1aed7](https://github.com/muitneliss/undercroft/commit/df1aed77225e8958e22c2aed68b637bbc5ce4cd6))

## [1.28.1](https://github.com/muitneliss/undercroft/compare/v1.28.0...v1.28.1) (2026-09-24)


### Bug Fixes

* **worker:** a password-protected PDF is refused as locked, not as possibly corrupt ([#194](https://github.com/muitneliss/undercroft/issues/194)) ([cfc6fe4](https://github.com/muitneliss/undercroft/commit/cfc6fe44495502378a448a0ef02f726876c86cd9))

## [1.28.0](https://github.com/muitneliss/undercroft/compare/v1.27.3...v1.28.0) (2026-09-24)


### Features

* **ui:** every scope tick-list can be filled in one press, and says when it is full ([#191](https://github.com/muitneliss/undercroft/issues/191)) ([9142873](https://github.com/muitneliss/undercroft/commit/9142873b22652d95e19c817ccb20e401b1920ec5)), closes [#175](https://github.com/muitneliss/undercroft/issues/175)

## [1.27.3](https://github.com/muitneliss/undercroft/compare/v1.27.2...v1.27.3) (2026-09-24)


### Bug Fixes

* **control-plane:** a tRPC refusal no longer carries the server's stack ([#186](https://github.com/muitneliss/undercroft/issues/186)) ([347fef4](https://github.com/muitneliss/undercroft/commit/347fef403f683f1fd6568a1126fdc014f104ed72)), closes [#152](https://github.com/muitneliss/undercroft/issues/152)
* **hubspot:** say that a deal-to-company link has no source change time ([#187](https://github.com/muitneliss/undercroft/issues/187)) ([6c130a1](https://github.com/muitneliss/undercroft/commit/6c130a19438241673bbf77bbdc4936fec41c4037)), closes [#141](https://github.com/muitneliss/undercroft/issues/141)
* **lake:** split the readable gap into refused and not read yet, with the reasons ([#189](https://github.com/muitneliss/undercroft/issues/189)) ([c715c34](https://github.com/muitneliss/undercroft/commit/c715c34e66e2ed22c8257f3470e55ecc1bd598fb)), closes [#139](https://github.com/muitneliss/undercroft/issues/139)

## [1.27.2](https://github.com/muitneliss/undercroft/compare/v1.27.1...v1.27.2) (2026-09-24)


### Bug Fixes

* **deploy:** run the raw lake on pgsty/minio, since MinIO withdrew its images ([#184](https://github.com/muitneliss/undercroft/issues/184)) ([8a3affe](https://github.com/muitneliss/undercroft/commit/8a3affea70d31d8834e36163aaa14c439c299e36))

## [1.27.1](https://github.com/muitneliss/undercroft/compare/v1.27.0...v1.27.1) (2026-09-24)


### Bug Fixes

* **deploy:** Dokploy clones the compose file from main instead of holding a pasted copy ([#182](https://github.com/muitneliss/undercroft/issues/182)) ([36bd9f0](https://github.com/muitneliss/undercroft/commit/36bd9f0c6ce6bc4e75d73d9df9b3ed4253c8d340))

## [1.27.0](https://github.com/muitneliss/undercroft/compare/v1.26.0...v1.27.0) (2026-09-24)


### Features

* **drive:** recognise files by MIME type first, export Google-native files, verify OpenAttestation records ([#180](https://github.com/muitneliss/undercroft/issues/180)) ([715015e](https://github.com/muitneliss/undercroft/commit/715015e75b6101347f35438b450d4ca137b24053)), closes [#176](https://github.com/muitneliss/undercroft/issues/176)


### Bug Fixes

* **drive:** read Drive with drive.readonly and let browse-scope list Drive folders and types ([#179](https://github.com/muitneliss/undercroft/issues/179)) ([9e0a293](https://github.com/muitneliss/undercroft/commit/9e0a293bb21b2c47d1adeeca98d005a0c338f13c)), closes [#178](https://github.com/muitneliss/undercroft/issues/178) [#177](https://github.com/muitneliss/undercroft/issues/177)

## [1.26.0](https://github.com/muitneliss/undercroft/compare/v1.25.0...v1.26.0) (2026-09-24)


### Features

* **alerts:** post a sync's failure and its recovery to the operators' Lark group ([#173](https://github.com/muitneliss/undercroft/issues/173)) ([ea4b26c](https://github.com/muitneliss/undercroft/commit/ea4b26cb8880ba95f30d631e1717be9015573eed))

## [1.25.0](https://github.com/muitneliss/undercroft/compare/v1.24.0...v1.25.0) (2026-09-24)


### Features

* **notify:** render Lark cards as markdown, with emoji and coloured diffs ([#171](https://github.com/muitneliss/undercroft/issues/171)) ([9d748ed](https://github.com/muitneliss/undercroft/commit/9d748ed2559222e5db05c1fb7447726d55997448))

## [1.24.0](https://github.com/muitneliss/undercroft/compare/v1.23.0...v1.24.0) (2026-09-24)


### Features

* **people:** change a member's role and remove a member, never the last admin ([#169](https://github.com/muitneliss/undercroft/issues/169)) ([a268549](https://github.com/muitneliss/undercroft/commit/a268549989615d05051e8b1d84f7fdc2c0e5492c)), closes [#168](https://github.com/muitneliss/undercroft/issues/168)

## [1.23.0](https://github.com/muitneliss/undercroft/compare/v1.22.1...v1.23.0) (2026-09-24)


### Features

* **ci:** post deploys, failed releases, issues, PRs and red CI to Lark ([#166](https://github.com/muitneliss/undercroft/issues/166)) ([fd705ef](https://github.com/muitneliss/undercroft/commit/fd705efc9909c8a50cedcfc82f422e95b5caf703))

## [1.22.1](https://github.com/muitneliss/undercroft/compare/v1.22.0...v1.22.1) (2026-09-23)


### Bug Fixes

* model-build alert subject reads as one sentence; unit gate runs in 21s, not 174s ([#161](https://github.com/muitneliss/undercroft/issues/161)) ([a6b10b2](https://github.com/muitneliss/undercroft/commit/a6b10b28cbca101e891c100b5abc8606bd689189))

## [1.22.0](https://github.com/muitneliss/undercroft/compare/v1.21.0...v1.22.0) (2026-09-23)


### Features

* **cli:** install the CLI once, from the latest release ([#159](https://github.com/muitneliss/undercroft/issues/159)) ([33e8776](https://github.com/muitneliss/undercroft/commit/33e8776c9f0ae141f5e3b479a6062d4cf58e7bc5))

## [1.21.0](https://github.com/muitneliss/undercroft/compare/v1.20.1...v1.21.0) (2026-09-23)


### Features

* **email:** set the Undercroft mark in every email's running head ([#157](https://github.com/muitneliss/undercroft/issues/157)) ([bb2b72b](https://github.com/muitneliss/undercroft/commit/bb2b72b3b2b81b84b4f21800b133dbac64d186d7))

## [1.20.1](https://github.com/muitneliss/undercroft/compare/v1.20.0...v1.20.1) (2026-09-23)


### Bug Fixes

* **cli:** pin the release CLI with one version per line; sync the README and add badges ([#149](https://github.com/muitneliss/undercroft/issues/149)) ([8a1aa0f](https://github.com/muitneliss/undercroft/commit/8a1aa0f8c57658131236e0fd830413f76dde58ee))

## [1.20.0](https://github.com/muitneliss/undercroft/compare/v1.19.1...v1.20.0) (2026-09-23)


### Features

* **cli:** an undercroft CLI for people and LLM agents, 1:1 with the web UI ([#146](https://github.com/muitneliss/undercroft/issues/146)) ([7abcb1d](https://github.com/muitneliss/undercroft/commit/7abcb1d0270060f6b0a82d7974276ee8b6c1a0f3))

## [1.19.1](https://github.com/muitneliss/undercroft/compare/v1.19.0...v1.19.1) (2026-09-23)


### Bug Fixes

* **ui:** hovering a run's leaf no longer runs the ledger's instant into its sentence ([#136](https://github.com/muitneliss/undercroft/issues/136)) ([db8f232](https://github.com/muitneliss/undercroft/commit/db8f232943304c30936a5f7f675cee5000b3d651))

## [1.19.0](https://github.com/muitneliss/undercroft/compare/v1.18.0...v1.19.0) (2026-09-23)


### Features

* **connections:** several Gmail and Drive accounts per tenant ([#125](https://github.com/muitneliss/undercroft/issues/125)) ([#132](https://github.com/muitneliss/undercroft/issues/132)) ([c646bce](https://github.com/muitneliss/undercroft/commit/c646bcea635fe58327a608d19dddc0c6ac3268d6))

## [1.18.0](https://github.com/muitneliss/undercroft/compare/v1.17.0...v1.18.0) (2026-09-23)


### Features

* **ui:** a pane's whole edge is its handle, not a corner speck ([#128](https://github.com/muitneliss/undercroft/issues/128)) ([7d41e94](https://github.com/muitneliss/undercroft/commit/7d41e94b62c86c7ca5421aede214ab770b2f8bf9))

## [1.17.0](https://github.com/muitneliss/undercroft/compare/v1.16.0...v1.17.0) (2026-09-23)


### Features

* **extract:** measure whether the readers are right, not just that they ran ([#122](https://github.com/muitneliss/undercroft/issues/122)) ([24f2256](https://github.com/muitneliss/undercroft/commit/24f22566fc734f29b0014a6135d0f37418b232bd))
* **extract:** read a digest once, and answer every document holding it ([#119](https://github.com/muitneliss/undercroft/issues/119)) ([04ee814](https://github.com/muitneliss/undercroft/commit/04ee8148f26486b542c2186597c697dc518278b5))
* **journal:** a refusal count has a route to its constituents ([#121](https://github.com/muitneliss/undercroft/issues/121)) ([334a73c](https://github.com/muitneliss/undercroft/commit/334a73cda658d80dd0f1f1b320143a31b2b17345))
* **lake:** say what the lake stores, not what the catalogue counts ([#123](https://github.com/muitneliss/undercroft/issues/123)) ([76b5959](https://github.com/muitneliss/undercroft/commit/76b5959033ac821e5f81418a80167d61f967edb1))

## [1.16.0](https://github.com/muitneliss/undercroft/compare/v1.15.5...v1.16.0) (2026-09-22)


### Features

* **extract:** read the document types the lake already holds and cannot open ([#116](https://github.com/muitneliss/undercroft/issues/116)) ([da0d297](https://github.com/muitneliss/undercroft/commit/da0d297554941099641cf450a31fc943d61f4dcb))
* **ui:** the lake console runs a script, and a selection is what a press means ([#118](https://github.com/muitneliss/undercroft/issues/118)) ([9af497c](https://github.com/muitneliss/undercroft/commit/9af497cb309fb68ba65983c04098111e965b6749))


### Bug Fixes

* **journal:** a build counts no records, and "no models" needs the worker's word ([#117](https://github.com/muitneliss/undercroft/issues/117)) ([89321d7](https://github.com/muitneliss/undercroft/commit/89321d7cee09bd43974e5cf843ffe17e7fb92310))
* **ui:** a query's grid reads from the left, and its columns are draggable ([#114](https://github.com/muitneliss/undercroft/issues/114)) ([eae838f](https://github.com/muitneliss/undercroft/commit/eae838f68896acfaf3de4dd085eb62b8f3f2e069))

## [1.15.5](https://github.com/muitneliss/undercroft/compare/v1.15.4...v1.15.5) (2026-09-22)


### Bug Fixes

* **db:** restate the provisioning function on every migrate, not once ([#108](https://github.com/muitneliss/undercroft/issues/108)) ([0f779bd](https://github.com/muitneliss/undercroft/commit/0f779bd797d4d2ed2f9c6cf6bae34d3c5121fc0d))

## [1.15.4](https://github.com/muitneliss/undercroft/compare/v1.15.3...v1.15.4) (2026-09-22)


### Bug Fixes

* **deploy:** give the worker 3g, because 25 MiB attachments cost ~220 MiB ([#106](https://github.com/muitneliss/undercroft/issues/106)) ([ad57ee6](https://github.com/muitneliss/undercroft/commit/ad57ee6d49852d33173ce634c6d5f896fec52496))

## [1.15.3](https://github.com/muitneliss/undercroft/compare/v1.15.2...v1.15.3) (2026-09-22)


### Bug Fixes

* **ui:** a grid wider than its pane shows the bar that says so ([#104](https://github.com/muitneliss/undercroft/issues/104)) ([a48ae1d](https://github.com/muitneliss/undercroft/commit/a48ae1d9a5c95deb365d4e8c0e02a59111998af7))
* **worker:** run bun --smol, because the process cannot see its budget ([#103](https://github.com/muitneliss/undercroft/issues/103)) ([e6c9d67](https://github.com/muitneliss/undercroft/commit/e6c9d67416908a4056243fdda0ff0431b321b911))

## [1.15.2](https://github.com/muitneliss/undercroft/compare/v1.15.1...v1.15.2) (2026-09-22)


### Bug Fixes

* **journal:** the ledger's instant and its sentence are two words again ([#101](https://github.com/muitneliss/undercroft/issues/101)) ([c52b379](https://github.com/muitneliss/undercroft/commit/c52b379032abc0251ad7e2bce6109091639c15d9))

## [1.15.1](https://github.com/muitneliss/undercroft/compare/v1.15.0...v1.15.1) (2026-09-22)


### Bug Fixes

* **ingest:** a harvest records what it settled instead of asserting it ([#99](https://github.com/muitneliss/undercroft/issues/99)) ([1c83644](https://github.com/muitneliss/undercroft/commit/1c83644b82a887e823b231de77053a5de1d07ca7))

## [1.15.0](https://github.com/muitneliss/undercroft/compare/v1.14.2...v1.15.0) (2026-09-21)


### Features

* an ingest streams, lands as it goes, and does not re-read what it holds ([#95](https://github.com/muitneliss/undercroft/issues/95)) ([911e133](https://github.com/muitneliss/undercroft/commit/911e13310941c86b6068430d402826bc71b73413))
* **assistant:** an in-app assistant that answers and acts, as the reader ([#87](https://github.com/muitneliss/undercroft/issues/87)) ([98e5c97](https://github.com/muitneliss/undercroft/commit/98e5c972735ed55ed38a412415733d4f40704c68))
* **drive:** let an admin sync a picked folder to the bottom ([#93](https://github.com/muitneliss/undercroft/issues/93)) ([94dfde9](https://github.com/muitneliss/undercroft/commit/94dfde91a387e02565d98cbef54372ffab395fb6))
* **email:** the five emails are set as leaves of the book (ADR 0030) ([#91](https://github.com/muitneliss/undercroft/issues/91)) ([2b6d2f6](https://github.com/muitneliss/undercroft/commit/2b6d2f61bb9df56bda2ed809d9bdd5dd33f796a9))
* **journal:** a progress line is a gauge, not an entry ([#94](https://github.com/muitneliss/undercroft/issues/94)) ([8ac5917](https://github.com/muitneliss/undercroft/commit/8ac5917261bf3b97c6ecff331e63fdbb6615f169))


### Bug Fixes

* **deploy:** preflight compares the panel's compose with the file this repo publishes ([#92](https://github.com/muitneliss/undercroft/issues/92)) ([657ef7f](https://github.com/muitneliss/undercroft/commit/657ef7f97ec2b12c2b1837d24a169ecc12c23534))

## [1.14.2](https://github.com/muitneliss/undercroft/compare/v1.14.1...v1.14.2) (2026-09-21)


### Bug Fixes

* **google:** pace Gmail at the rate it enforces, and wait out a quota window ([#85](https://github.com/muitneliss/undercroft/issues/85)) ([40842ee](https://github.com/muitneliss/undercroft/commit/40842ee6306d23743ce4e70baa308178be2cede8))

## [1.14.1](https://github.com/muitneliss/undercroft/compare/v1.14.0...v1.14.1) (2026-09-21)


### Bug Fixes

* **flows:** write both flows in the Kestra 2.x spellings the server accepts ([#80](https://github.com/muitneliss/undercroft/issues/80)) ([2db8214](https://github.com/muitneliss/undercroft/commit/2db821480e4c261b369ca9e6a6184a3f5a9e65a7))

## [1.14.0](https://github.com/muitneliss/undercroft/compare/v1.13.1...v1.14.0) (2026-09-21)


### Features

* **ui:** give the lake's SQL console its own page, sized for the work ([#78](https://github.com/muitneliss/undercroft/issues/78)) ([fb76aae](https://github.com/muitneliss/undercroft/commit/fb76aaeace14f51fa7c972ca1be7fc5bc855320d))

## [1.13.1](https://github.com/muitneliss/undercroft/compare/v1.13.0...v1.13.1) (2026-09-21)


### Bug Fixes

* **deploy:** give Kestra a writable storage volume, so the schedule runs at all ([#76](https://github.com/muitneliss/undercroft/issues/76)) ([b83c48e](https://github.com/muitneliss/undercroft/commit/b83c48eeceb3a8b4baff705bf803d3d1ee9a7a2e))

## [1.13.0](https://github.com/muitneliss/undercroft/compare/v1.12.0...v1.13.0) (2026-09-21)


### Features

* **extract:** read spreadsheets, and give the extract verb a caller ([#73](https://github.com/muitneliss/undercroft/issues/73)) ([b740762](https://github.com/muitneliss/undercroft/commit/b74076292f7a6c5850d819725263302ff908949e))
* **lake:** open a line of the index as a query, answered ([#71](https://github.com/muitneliss/undercroft/issues/71)) ([14cfb51](https://github.com/muitneliss/undercroft/commit/14cfb51e2da4c67f7c392cccfd443ffa589373b1))


### Bug Fixes

* **ui:** a control sits on its field's line, and a linter says so ([#74](https://github.com/muitneliss/undercroft/issues/74)) ([d28fd40](https://github.com/muitneliss/undercroft/commit/d28fd40596c9ce209f9b8c5e6ddc2a7effd1b3b8))

## [1.12.0](https://github.com/muitneliss/undercroft/compare/v1.11.0...v1.12.0) (2026-09-21)


### Features

* **lake:** a SQL console on CodeMirror, extracted document text, and a role-login fix ([#68](https://github.com/muitneliss/undercroft/issues/68)) ([da07d9f](https://github.com/muitneliss/undercroft/commit/da07d9feff54448feaef30fd0a93e3b5af4e19bb))
* **ui:** adopt shadcn/Radix for structure, restyled to the existing design ([#67](https://github.com/muitneliss/undercroft/issues/67)) ([81fc9b7](https://github.com/muitneliss/undercroft/commit/81fc9b702a4eda40e0880cc176ee3c124557e664))

## [1.12.0](https://github.com/muitneliss/undercroft/compare/v1.11.0...v1.12.0) (2026-09-20)


### Features

* **ui:** adopt shadcn/Radix for structure, restyled to the existing design ([#67](https://github.com/muitneliss/undercroft/issues/67)) ([81fc9b7](https://github.com/muitneliss/undercroft/commit/81fc9b702a4eda40e0880cc176ee3c124557e664))

## [1.11.0](https://github.com/muitneliss/undercroft/compare/v1.10.1...v1.11.0) (2026-09-19)


### Features

* **journal:** redraw a run as plates with the work flowing between them ([#63](https://github.com/muitneliss/undercroft/issues/63)) ([b1939fe](https://github.com/muitneliss/undercroft/commit/b1939fe1796d03677e054c0a9de8a72cf4eb958b))

## [1.10.1](https://github.com/muitneliss/undercroft/compare/v1.10.0...v1.10.1) (2026-09-19)


### Bug Fixes

* **ui:** give a signed-in reader a page again — the route table is data ([#61](https://github.com/muitneliss/undercroft/issues/61)) ([e82ac14](https://github.com/muitneliss/undercroft/commit/e82ac14cd4515fe7c963d8510760d182833f61f3))

## [1.10.0](https://github.com/muitneliss/undercroft/compare/v1.9.0...v1.10.0) (2026-09-19)


### Features

* **google:** let admins choose which file types Gmail and Drive ingest ([#59](https://github.com/muitneliss/undercroft/issues/59)) ([adf0a5b](https://github.com/muitneliss/undercroft/commit/adf0a5b90b67d5215159d46430b1cb6883847c83))
* **journal:** draw a run's own shape with React Flow, beside what it said ([#60](https://github.com/muitneliss/undercroft/issues/60)) ([5409d1a](https://github.com/muitneliss/undercroft/commit/5409d1a6f03c493a387fd317c85d4caaa76bf1fa))
* **journal:** let a run say what it is doing while it is doing it ([#54](https://github.com/muitneliss/undercroft/issues/54)) ([a8be7f6](https://github.com/muitneliss/undercroft/commit/a8be7f63ab94eca6dd9f371d14db4b2255880ba4))

## [1.9.0](https://github.com/muitneliss/undercroft/compare/v1.8.0...v1.9.0) (2026-09-19)


### Features

* close the ring, from a connected source to a dashboard with evidence at every step ([#52](https://github.com/muitneliss/undercroft/issues/52)) ([5c2393c](https://github.com/muitneliss/undercroft/commit/5c2393c5d487d68287f93d46632f6bd0704947c1))

## [1.8.0](https://github.com/muitneliss/undercroft/compare/v1.7.0...v1.8.0) (2026-09-19)


### Features

* **tenants:** correct a display name, and name the id plainly ([#50](https://github.com/muitneliss/undercroft/issues/50)) ([d53dc11](https://github.com/muitneliss/undercroft/commit/d53dc11546d42bbc5e6970fa930d20981a2de6fe))


### Bug Fixes

* **connections:** stop showing the access token's expiry as the grant's ([#48](https://github.com/muitneliss/undercroft/issues/48)) ([500a8f3](https://github.com/muitneliss/undercroft/commit/500a8f35040d1b67119cff26e503327762758cea))

## [1.7.0](https://github.com/muitneliss/undercroft/compare/v1.6.1...v1.7.0) (2026-09-19)


### Features

* **ui:** set the Gmail scope picker's labels as a bounded index ([#46](https://github.com/muitneliss/undercroft/issues/46)) ([269cd32](https://github.com/muitneliss/undercroft/commit/269cd3205375cb31c0d4109ce4b76a710fa8b168))


### Bug Fixes

* **connections:** refuse a partial Google consent, and name the remedy ([#44](https://github.com/muitneliss/undercroft/issues/44)) ([a61469f](https://github.com/muitneliss/undercroft/commit/a61469f1ab310d5901d8eaed5ab6cd4af0f78e93))

## [1.6.1](https://github.com/muitneliss/undercroft/compare/v1.6.0...v1.6.1) (2026-09-18)


### Bug Fixes

* **control-plane:** let a superadmin finish a per-tenant consent ([#42](https://github.com/muitneliss/undercroft/issues/42)) ([2270a88](https://github.com/muitneliss/undercroft/commit/2270a88914c0594726c53e52f1ce057ee544b186))

## [1.6.0](https://github.com/muitneliss/undercroft/compare/v1.5.0...v1.6.0) (2026-09-18)


### Features

* Gmail and Google Drive ingestion, per tenant ([#40](https://github.com/muitneliss/undercroft/issues/40)) ([fd4007a](https://github.com/muitneliss/undercroft/commit/fd4007a081705789211d4128a598f74c2b756d79))

## [1.5.0](https://github.com/muitneliss/undercroft/compare/v1.4.0...v1.5.0) (2026-09-18)


### Features

* **auth:** bootstrap platform superadmins from UNDERCROFT_SUPERADMINS ([#34](https://github.com/muitneliss/undercroft/issues/34)) ([2749010](https://github.com/muitneliss/undercroft/commit/27490108598b8700c1e1b91ddfb1aecc2dcc8e89))
* **ui:** extend the stepped motion doctrine so the book actually turns ([#36](https://github.com/muitneliss/undercroft/issues/36)) ([e294324](https://github.com/muitneliss/undercroft/commit/e2943244b2e1448d6009418ebdcc6826e11e32a7))
* **ui:** print the release tag in the colophon at the foot of every page ([#31](https://github.com/muitneliss/undercroft/issues/31)) ([0a89b0b](https://github.com/muitneliss/undercroft/commit/0a89b0b6b1536c90916d7024d2eb083e3ed77841))

## [1.4.0](https://github.com/muitneliss/undercroft/compare/v1.3.0...v1.4.0) (2026-09-18)


### Features

* **control-plane:** record refused sign-ins, and invite the first admin without SQL ([f2cb01f](https://github.com/muitneliss/undercroft/commit/f2cb01f12bc205686b969eb7b01d6631dedfc019))
* **i18n:** translate the control plane, Vietnamese first and English second ([ab5513c](https://github.com/muitneliss/undercroft/commit/ab5513c9257f07b2435f6bf6887da3f602628b2e))
* **i18n:** translate the control plane, Vietnamese first and English second ([80323a6](https://github.com/muitneliss/undercroft/commit/80323a6cb28c24a158c4b60ea277cc09d7db3a12))
* record refused sign-ins, and invite the first admin without SQL ([3e05843](https://github.com/muitneliss/undercroft/commit/3e05843e81a03a2bf65c9438c62bba1bd63fc75b))
* **ui:** set the division tabs upright across the head ([d8c6992](https://github.com/muitneliss/undercroft/commit/d8c699264c44cec45be75c096928badcca27a53f))
* **ui:** set the division tabs upright across the head ([8d0dfa0](https://github.com/muitneliss/undercroft/commit/8d0dfa05e2d07bfc641893570a20e2916b1a74e0))


### Bug Fixes

* **deploy:** verify a one-shot migration by its exit code, not its liveness ([550840d](https://github.com/muitneliss/undercroft/commit/550840d65fca00c40be1092a699c79b1e78d644d))
* **deploy:** verify a one-shot migration by its exit code, not its liveness ([698f8fd](https://github.com/muitneliss/undercroft/commit/698f8fdd59843b59f3a9e9eaf2b21e128acb5b22))

## [1.3.0](https://github.com/muitneliss/undercroft/compare/v1.2.0...v1.3.0) (2026-09-18)


### Features

* **lint:** enforce handler -&gt; service -&gt; repo with ast-grep ([c0b3abb](https://github.com/muitneliss/undercroft/commit/c0b3abbf082ecf0284a318f0b5bffb6efd0d74d8))
* **lint:** one direction — handler → service → repo, enforced by ast-grep ([417be68](https://github.com/muitneliss/undercroft/commit/417be686b1ab277806db17ca8169409613491867))


### Bug Fixes

* **deploy:** apply the schema on deploy via a db-migrate service ([ea105ec](https://github.com/muitneliss/undercroft/commit/ea105eca8bf2ee57ff690672dff6dcf7c060f6ab))
* **deploy:** apply the schema on deploy, so services never start without their tables ([0312b0c](https://github.com/muitneliss/undercroft/commit/0312b0cfca4c7585ae7754736f0c83333e9dbdba))

## [1.2.0](https://github.com/muitneliss/undercroft/compare/v1.1.0...v1.2.0) (2026-09-18)


### Features

* close the loop — invitations in the product, and the whole ring under test ([50d4607](https://github.com/muitneliss/undercroft/commit/50d4607bf792985e532b16f384173949cea3fd57))
* **control-plane:** invite-only sign-in with Google and an emailed code ([982e28f](https://github.com/muitneliss/undercroft/commit/982e28f3940b21e009a134d64194eb7ed3087453))
* **core:** add an EmailSender seam for one-time sign-in codes ([d00395f](https://github.com/muitneliss/undercroft/commit/d00395f1c35212162b8ce05350bd87b777aae5e2))
* **db:** add Better Auth's tables, their grants, and a way to apply migrations ([1427352](https://github.com/muitneliss/undercroft/commit/14273520f6682230ff1a94fc45f67beb88f314db))
* invite-only sign-in with Better Auth (Google + emailed code) ([b32330c](https://github.com/muitneliss/undercroft/commit/b32330c9987255cfb6790edbc148dd4d2515016e))
* **ui:** give Undercroft a device, and cut the icons from it ([ce204b7](https://github.com/muitneliss/undercroft/commit/ce204b7f99a76c741c180a2b745a97486dfeb424))
* **ui:** give Undercroft a device, and cut the icons from it ([07665e7](https://github.com/muitneliss/undercroft/commit/07665e77175fd509f92694f1b539cfbc6bdac2aa))
* **ui:** make sign-in live, with Google and a one-time code ([5a602dd](https://github.com/muitneliss/undercroft/commit/5a602ddcb623b2198b06e7a2a9a56570885ece4e))


### Bug Fixes

* **docs:** point the README device at raw URLs so it actually renders ([e91a5f3](https://github.com/muitneliss/undercroft/commit/e91a5f3dd81d11719a4eae63fc3c992b2fde2b43))
* **ui:** mount BrowserRouter so signed-in routes can resolve ([74fee20](https://github.com/muitneliss/undercroft/commit/74fee209eabd628dd6ae734e307528e4a207f7a6))

## [1.1.0](https://github.com/muitneliss/undercroft/compare/v1.0.0...v1.1.0) (2026-09-17)


### Features

* **ui:** adopt the impeccable design on the tRPC + Zustand architecture ([cbb59dc](https://github.com/muitneliss/undercroft/commit/cbb59dcd09c13624b0ad48ed084e34916c76f855))
* **ui:** adopt the impeccable design on the tRPC + Zustand architecture ([73cf759](https://github.com/muitneliss/undercroft/commit/73cf759ce5131a13b214e49f46966f57bd10da1f))


### Bug Fixes

* stop prettier failing on release-please's CHANGELOG ([685e980](https://github.com/muitneliss/undercroft/commit/685e980f87eda1eb74dd5b6068894350092bf75c))
* stop prettier from failing on release-please's CHANGELOG ([68268a6](https://github.com/muitneliss/undercroft/commit/68268a624962dd9094c540bcb0d0b8293a0408f0))

## [1.0.0](https://github.com/muitneliss/undercroft/compare/v0.2.0...v1.0.0) (2026-09-17)


### ⚠ BREAKING CHANGES

* complete rewrite. The Python platform built for one customer is replaced by a generic, MIT-licensed, 100% TypeScript platform.

### Features

* build and serve the control-plane SPA at the same origin ([3d12fe0](https://github.com/muitneliss/undercroft/commit/3d12fe04bd44162b445094b03feae4da28a5ef2f))
* build and serve the control-plane SPA at the same origin ([72a2ec8](https://github.com/muitneliss/undercroft/commit/72a2ec8a99b8f2a629bb8ae96c84093a1404d16c))
* deploy on release to Dokploy through the API ([4606b41](https://github.com/muitneliss/undercroft/commit/4606b41178bff7376579972caf9e2dcfadf3f62a))
* deploy on release to Dokploy through the API ([f973775](https://github.com/muitneliss/undercroft/commit/f9737759da7a382fd3e72134493218306ac44b92))
* rebuild as Undercroft, a generic open-source data platform ([0e20aca](https://github.com/muitneliss/undercroft/commit/0e20aca902aaee5d02534b8a420d0659855120b2))
* style the control-plane shell ([7d54806](https://github.com/muitneliss/undercroft/commit/7d54806a7f7398cd9c1a1e52e48a3cf623b79295))
* style the control-plane shell ([f8a5604](https://github.com/muitneliss/undercroft/commit/f8a560401c04e5dfc1de7e123e893853ca7c47a8))
* **ui:** tRPC React Query client, Zustand store, and a useState ban ([8eeb591](https://github.com/muitneliss/undercroft/commit/8eeb5917467dd7a7088a267f3ab896ca0b3a1410))
* **ui:** tRPC React Query client, Zustand store, and a useState ban ([4dd81bc](https://github.com/muitneliss/undercroft/commit/4dd81bccfc9813f114bf228a3b3f64094c27d366))


### Bug Fixes

* survive --wait on the init container and resolve the image tag in verify ([300a92a](https://github.com/muitneliss/undercroft/commit/300a92a04fb67d0df3ec1a4b1890db330f3dadf2))
* survive --wait on the init container and resolve the image tag in verify ([7210bbd](https://github.com/muitneliss/undercroft/commit/7210bbd091d886b855858d631ca3d8bc8037de31))
