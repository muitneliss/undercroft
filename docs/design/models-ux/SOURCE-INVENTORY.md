# Source inventory — review Git files

Prepared 2026-10-11. SHA-256 and byte lengths describe staged Git blob content, not checkout-specific CRLF conversion. Regenerate from the index after final edits and staging, before the review commit. Compare against Git blobs at the submitted commit. The inventory excludes itself to avoid a circular hash; the PR supplies the immutable review commit link.

Upstream integration base: deb49f74db6162ff697f4a8db9a5006e0ab7bac8. This is the base SHA, not the prototype review commit. Shared upstream sources are available in the same Git tree; the second table lists principal references, not every transitive dependency.

## Contribution and design files (49)

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| [.taskfiles/artifacts/Taskfile.yml](../../../.taskfiles/artifacts/Taskfile.yml) | 3402 | 168332e6ebae98894854d534ceb8728e4c2a2b35852e074ef5389ff638581c0d |
| [.taskfiles/ci/Taskfile.yml](../../../.taskfiles/ci/Taskfile.yml) | 5923 | f4288ba0c15a27640f1fbedbdbcd57cffb3ff0125c1ee589f7a055e86bde4faa |
| [.taskfiles/dev/Taskfile.yml](../../../.taskfiles/dev/Taskfile.yml) | 14110 | 4b193b24c3cb2f2f2d98eca99bb9f3eae3ef59b095a0c396d45f228af31905d5 |
| [apps/ui/package.json](../../../apps/ui/package.json) | 2156 | 3169a42af5b040a4e4280265b2069e332a2dbacb7cf51d5aef52124acce260e7 |
| [apps/ui/prototype/index.html](../../../apps/ui/prototype/index.html) | 286 | 63dc89593484bfed4a4c7cc2e17760c104aeb18c1c8f41b4eb89bcc41062d8d8 |
| [apps/ui/src/features/models-workspace/catalog.test.ts](../../../apps/ui/src/features/models-workspace/catalog.test.ts) | 4835 | c20a29206942fae883e1b95939fea7d7398cb34f9f8869c7515477c96c563a46 |
| [apps/ui/src/features/models-workspace/catalog.ts](../../../apps/ui/src/features/models-workspace/catalog.ts) | 4794 | 484072dc9775052f9e8c172c1013c2b60308d65714d528c39355b0643fccb0a9 |
| [apps/ui/src/features/models-workspace/details.css](../../../apps/ui/src/features/models-workspace/details.css) | 6355 | 16a7719f5611a57c30b2d7d2e93c5d2cbcfb56a053c76ef4619350c9961fcd36 |
| [apps/ui/src/features/models-workspace/Expand.tsx](../../../apps/ui/src/features/models-workspace/Expand.tsx) | 2092 | 1777ee1a39c395e555c81d6535e8fb68b275046e2bbacf44686e7a255f3ba6bf |
| [apps/ui/src/features/models-workspace/hooks.ts](../../../apps/ui/src/features/models-workspace/hooks.ts) | 2092 | ba39cf5c4950a95cfe6a698a9933274fd90726fe8c4558c01fd125ded37f5ae1 |
| [apps/ui/src/features/models-workspace/layout.ts](../../../apps/ui/src/features/models-workspace/layout.ts) | 2790 | 89bf0b084501bda444d002bf77aca93805819975ab08a77cf10e6c35cd8b2114 |
| [apps/ui/src/features/models-workspace/ModelChooser.tsx](../../../apps/ui/src/features/models-workspace/ModelChooser.tsx) | 6834 | f01d41adcef540f90ccb119de443e79397163718fb0fe860a8e9710076308eb5 |
| [apps/ui/src/features/models-workspace/ModelGraph.tsx](../../../apps/ui/src/features/models-workspace/ModelGraph.tsx) | 5892 | 7b47d2a8d5e478b21a1c1fbb87fb43062a0f4f04a742d94196b490f287f7f677 |
| [apps/ui/src/features/models-workspace/ModelLineage.tsx](../../../apps/ui/src/features/models-workspace/ModelLineage.tsx) | 12834 | baa2aab9e8a39896749ec6be4e35f33ac3174835d861f1aba7cb9e44ec7ecaa7 |
| [apps/ui/src/features/models-workspace/ModelList.tsx](../../../apps/ui/src/features/models-workspace/ModelList.tsx) | 11668 | a3d24367370ca5830d6090284698c32789638db79e2bd31931c82be6d0f53d40 |
| [apps/ui/src/features/models-workspace/ModelProfile.tsx](../../../apps/ui/src/features/models-workspace/ModelProfile.tsx) | 5218 | 6bf2b2bee03f32a28456716698e5b72ac383d762e16fac5acebcb5d5f7c200dc |
| [apps/ui/src/features/models-workspace/ModelsWorkspace.tsx](../../../apps/ui/src/features/models-workspace/ModelsWorkspace.tsx) | 2517 | fc827364bf87092fabca786661196a215a75caa56de178507c2e2e364d397d03 |
| [apps/ui/src/features/models-workspace/ProfileConfiguration.tsx](../../../apps/ui/src/features/models-workspace/ProfileConfiguration.tsx) | 2396 | 47562ee52e322f6258e90e56678a25cfa8ff12d5da3ee5203e16b6e95f7a81dc |
| [apps/ui/src/features/models-workspace/ProfileDetails.tsx](../../../apps/ui/src/features/models-workspace/ProfileDetails.tsx) | 4815 | fd03177b7b8d63c2954389c5cbd3f2129072d3b5f5e4993eb8de7e7747e75911 |
| [apps/ui/src/features/models-workspace/ProfileEvidence.tsx](../../../apps/ui/src/features/models-workspace/ProfileEvidence.tsx) | 3079 | e0258b508d896ba56cb0d6f051c60b92a888cceb936b08c33153cb340e75c37c |
| [apps/ui/src/features/models-workspace/ProfileOperations.tsx](../../../apps/ui/src/features/models-workspace/ProfileOperations.tsx) | 5360 | 35edc0146a666eb6b66d0f2d3167cfb4a145992a075c33acc1519123ec761f35 |
| [apps/ui/src/features/models-workspace/profileSource.ts](../../../apps/ui/src/features/models-workspace/profileSource.ts) | 1156 | 11d2066ec6cda902f6fd7a2622133b217f36ee36cc8cb38be430f778c40cac82 |
| [apps/ui/src/features/models-workspace/scope.ts](../../../apps/ui/src/features/models-workspace/scope.ts) | 1015 | 8df87be9fe8356adc4f1793f404ede56a09fd3c10fc90cc9ea2b87271e775430 |
| [apps/ui/src/features/models-workspace/shared.tsx](../../../apps/ui/src/features/models-workspace/shared.tsx) | 2530 | 3e08d50e798386c14d2d3f10d214a67c480fc7b22339bc1609dea5bc51d242ac |
| [apps/ui/src/features/models-workspace/types.ts](../../../apps/ui/src/features/models-workspace/types.ts) | 1790 | ed646159704272acbd5cd02dfbbd716658a85c9ead720c79c3f822bb467405f8 |
| [apps/ui/src/features/models-workspace/workspace.css](../../../apps/ui/src/features/models-workspace/workspace.css) | 4755 | d4e34c11eb85099ec40f03278b29e2916a284b82f6af0d78e23092f40c3fca6f |
| [apps/ui/src/features/models-workspace/workspace.test.tsx](../../../apps/ui/src/features/models-workspace/workspace.test.tsx) | 6717 | 0ce006101be2198ff70e86a4da2ed1c29b36891f7ce0380936c068324bf6e978 |
| [apps/ui/src/i18n/en.ts](../../../apps/ui/src/i18n/en.ts) | 103605 | df8300737d0cffd89f9beddd54a8c5fd17f21e46edf98452e6221fd1bcacef71 |
| [apps/ui/src/i18n/vi.ts](../../../apps/ui/src/i18n/vi.ts) | 142614 | 50dfabf5bec64a87f2ba20bc1744672a536db6992ab4e07ad85373d5976dc983 |
| [apps/ui/src/prototype/details.ts](../../../apps/ui/src/prototype/details.ts) | 2622 | 96c7a48dc27975710c015f97077b89e47a7a3c3bfc657224416f7feaa257b920 |
| [apps/ui/src/prototype/engineering.ts](../../../apps/ui/src/prototype/engineering.ts) | 3422 | 66269d1cf935f7cf6451d8402cf798386e86ed9f006534911fa9e499eddeb8a3 |
| [apps/ui/src/prototype/fixtures.ts](../../../apps/ui/src/prototype/fixtures.ts) | 6825 | 397d65b5c3181e8573775e3cf21851a7c34917ab290fb25b4258b5a72fd5138e |
| [apps/ui/src/prototype/main.tsx](../../../apps/ui/src/prototype/main.tsx) | 1957 | b93c0596af6ba16351f5ba8fe999c1fd1369709ed6bf1f54fbcdec3710c6d401 |
| [apps/ui/src/prototype/Prototype.tsx](../../../apps/ui/src/prototype/Prototype.tsx) | 2307 | ca5c4f4de1692680fa69a2b95e8f128402820c054d902b1963169c2dcd4efb79 |
| [apps/ui/src/store.ts](../../../apps/ui/src/store.ts) | 42794 | 785a5fef47ba35f8d97d1f0c66861a5e86d5502cdfcc902ff09dbc61c31f59d7 |
| [apps/ui/vite.prototype.config.ts](../../../apps/ui/vite.prototype.config.ts) | 1223 | 2c5051419045a6f735eb522b8fd25f83fd67285e187c8154de64361408a51d4b |
| [biome.jsonc](../../../biome.jsonc) | 68161 | f89979b0895787b87d89867a92a66637b3245ff999afc2b691848dba2c5518ff |
| [docs/design/models-ux/AUDIT-models-live-2026-10-10.md](../../../docs/design/models-ux/AUDIT-models-live-2026-10-10.md) | 6526 | eaa646d6b358aa86bf4d2ca72f8c768d840e3aef3a2193f660b894f351ef5200 |
| [docs/design/models-ux/AUDIT-models-performance-2026-10-11.md](../../../docs/design/models-ux/AUDIT-models-performance-2026-10-11.md) | 12745 | 21849071dc07347e126b81abbfece58985feb57bd25a204b307d70ee10fdef10 |
| [docs/design/models-ux/AUDIT-models-plan-spec-final-2026-10-11.md](../../../docs/design/models-ux/AUDIT-models-plan-spec-final-2026-10-11.md) | 7785 | fdc75c27ccbf29af79751b25ca190f2151d3cca65d262fe3ddb431964f5ecfa0 |
| [docs/design/models-ux/FEASIBILITY-models-repo.md](../../../docs/design/models-ux/FEASIBILITY-models-repo.md) | 9893 | c54f6cc5c9a31b412bce835ba84ec25327fc85c5598af48a83f3d53dd4637602 |
| [docs/design/models-ux/IMPLEMENTATION-STATUS-models-ux.md](../../../docs/design/models-ux/IMPLEMENTATION-STATUS-models-ux.md) | 22144 | 128935a2c0f4928a5aa9b37f14dc2ddc7f89983112928316403eca130e1ab1e2 |
| [docs/design/models-ux/PLAN-models-ux.md](../../../docs/design/models-ux/PLAN-models-ux.md) | 12879 | f7513bc50fb06ea1b4deb745c07b7c5d633c325192908b1604c2c768bd39999f |
| [docs/design/models-ux/PROMPT-implement-models-ux.md](../../../docs/design/models-ux/PROMPT-implement-models-ux.md) | 8250 | 0424a710af1d9943bf896c85ef5d1daca639701a5cad4011027487cf413cc33f |
| [docs/design/models-ux/PROTOTYPE-HANDOFF.md](../../../docs/design/models-ux/PROTOTYPE-HANDOFF.md) | 12738 | d3488253a9fc52ca3f9a7fee66931f76ee577b9147f03b5c67e0412ba59712ba |
| [docs/design/models-ux/README.md](../../../docs/design/models-ux/README.md) | 8233 | 2d7aefa146d519e01055e2aeafe48a9df36f9b9a63917f35ed12b1c8d632ddc1 |
| [docs/design/models-ux/RESEARCH-lineage-scale-2026-10-11.md](../../../docs/design/models-ux/RESEARCH-lineage-scale-2026-10-11.md) | 12165 | e06a45c56d3ceaf8cfc32201e56ef7ba422df02363a8bf5368c2382962597817 |
| [docs/design/models-ux/SPEC-models-ux.md](../../../docs/design/models-ux/SPEC-models-ux.md) | 132860 | f111ec73246a1b20d56a0cba92a5a78b73cb73da575ddca54c580fed8b04ca50 |
| [package.json](../../../package.json) | 4114 | d9b570877dd8e98258964a34fbc5a687989074c9ea82a2b6d44c42e7934754dc |

## Existing shared sources and reproducibility references

| File | SHA-256 |
| --- | --- |
| [bun.lock](../../../bun.lock) | 7aa1cf08cfb66feae8545e7e10d1d8db5d77d33f2a4318c6de8dee915baabc1b |
| [.bun-version](../../../.bun-version) | b99b4c7cdf236f59bc9f65d963deaecae3b16a7dad87939cacb9057f7664daee |
| [Taskfile.yml](../../../Taskfile.yml) | 74fb6e1916d4294c76e9d69822340d8eba414dab08a28ef8be36a206f79517a5 |
| [CLAUDE.md](../../../CLAUDE.md) | 0da8c11f7267be591dc04d1110cf6da020641d9434a0b9ff6a8c744f5ae731c8 |
| [CONTRIBUTING.md](../../../CONTRIBUTING.md) | a49a871662706e1fc241440f315c82c0e9e32e4a1985ba4a88a1a448b7c83bf0 |
| [apps/ui/AGENTS.md](../../../apps/ui/AGENTS.md) | 6e7222ffb718b8eaf2b7fa7307c80f0c0950101a57029f2f518f5e887b944d8d |
| [apps/ui/DESIGN.md](../../../apps/ui/DESIGN.md) | eb7192f550d22333f6106f53df4f6deb49e2905797ddb777173cced728ae90fa |
| [apps/ui/src/components/Book.tsx](../../../apps/ui/src/components/Book.tsx) | fe61377430a2ba068a39ac52a160163d94ba846c962e89e92382225c44816b41 |
| [apps/ui/src/components/TabRail.tsx](../../../apps/ui/src/components/TabRail.tsx) | 5234be1c73ec0d3170357c319ced284cfb0b84e3c322da07b44254fa45dc785e |
| [apps/ui/src/components/LineageCanvas.tsx](../../../apps/ui/src/components/LineageCanvas.tsx) | e52a49fa043811d1751de085330fffb21526ca2e15102e21e63c934a4f8ca4b4 |
| [apps/ui/src/index.css](../../../apps/ui/src/index.css) | d19df9b9da9a583ea52b83b2f896adc7172b07155bda2482d49d9ec0ab539475 |
| [apps/ui/src/routes/Models.tsx](../../../apps/ui/src/routes/Models.tsx) | 3cf28451ce878b69a17087d45960e44860aa15417eacf785fb70340a92330430 |
| [apps/ui/src/routeTable.tsx](../../../apps/ui/src/routeTable.tsx) | 06bdb1c9d26965286e4025b2db203d76ff5d32e964965a609ede536932a6614c |
| [docs/design/operator-and-reader-paths.md](../../../docs/design/operator-and-reader-paths.md) | b8f76fe53fdc2346d4cef7db225880e8d876dc5a9b4c9db8e6d80c0d7253974d |
| [docs/adr/0112-a-model-carries-no-business-context.md](../../../docs/adr/0112-a-model-carries-no-business-context.md) | dad3f837952edb4a38ca3fc2b06f2b9d42ad2bb778fcbbedf8b0055a1cae52df |
| [docs/adr/0117-the-village-is-an-overview-and-replaces-no-drawing.md](../../../docs/adr/0117-the-village-is-an-overview-and-replaces-no-drawing.md) | 3fc0903993a6b491e4bf9336420a0b50b141629b4163cd3020d4dc18ee8b0e41 |

Complete delivery also includes this inventory. Source files are ordinary readable Git files, not archives or generated bundles. Installed packages and build outputs are reproduced from the lockfile and Task commands. Local investigation notes outside the repository are not runtime dependencies. Any new contribution file must be added here; no authored runtime source may be excluded merely because it was untracked during preparation.
