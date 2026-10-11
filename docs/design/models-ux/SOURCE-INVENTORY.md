# Source inventory — local review snapshot

Prepared 2026-10-11. These hashes describe working-tree file bytes, including uncommitted changes. This is not a published revision. Regenerate after any change (including line-ending normalization), before the final review commit; verify hashes against the checked-out submission. The inventory excludes itself to avoid a circular hash.

Local base HEAD: bc5e774ee8ab8dd1e5852d0eca38a4b49b9c2d9e. Do not present this base SHA as the prototype review commit. Shared upstream sources are available in the same Git tree; the second table lists principal references, not every transitive dependency.

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
| [apps/ui/src/i18n/en.ts](../../../apps/ui/src/i18n/en.ts) | 99995 | d7c7344b965ad08b7c8cca01cbc8cc9a6745b48e4033835ca8d2862d155bb354 |
| [apps/ui/src/i18n/vi.ts](../../../apps/ui/src/i18n/vi.ts) | 137170 | 1243cc0f8e05e6491d7109e3baeac9630e4f91b8028f20f3df33ef3305773792 |
| [apps/ui/src/prototype/details.ts](../../../apps/ui/src/prototype/details.ts) | 2622 | 96c7a48dc27975710c015f97077b89e47a7a3c3bfc657224416f7feaa257b920 |
| [apps/ui/src/prototype/engineering.ts](../../../apps/ui/src/prototype/engineering.ts) | 3422 | 66269d1cf935f7cf6451d8402cf798386e86ed9f006534911fa9e499eddeb8a3 |
| [apps/ui/src/prototype/fixtures.ts](../../../apps/ui/src/prototype/fixtures.ts) | 6825 | 397d65b5c3181e8573775e3cf21851a7c34917ab290fb25b4258b5a72fd5138e |
| [apps/ui/src/prototype/main.tsx](../../../apps/ui/src/prototype/main.tsx) | 1957 | b93c0596af6ba16351f5ba8fe999c1fd1369709ed6bf1f54fbcdec3710c6d401 |
| [apps/ui/src/prototype/Prototype.tsx](../../../apps/ui/src/prototype/Prototype.tsx) | 2307 | ca5c4f4de1692680fa69a2b95e8f128402820c054d902b1963169c2dcd4efb79 |
| [apps/ui/src/store.ts](../../../apps/ui/src/store.ts) | 42794 | 785a5fef47ba35f8d97d1f0c66861a5e86d5502cdfcc902ff09dbc61c31f59d7 |
| [apps/ui/vite.prototype.config.ts](../../../apps/ui/vite.prototype.config.ts) | 1223 | 2c5051419045a6f735eb522b8fd25f83fd67285e187c8154de64361408a51d4b |
| [biome.jsonc](../../../biome.jsonc) | 69371 | 7c36c578e823e59e54bc52f4e72332a6e1069e8d62ae953975e54c5baf382143 |
| [docs/design/models-ux/AUDIT-models-live-2026-10-10.md](../../../docs/design/models-ux/AUDIT-models-live-2026-10-10.md) | 6528 | 0cf48e6990c39d0e2d365904ac63b1b31c7ff7c4dba27a0b0f180161626e7650 |
| [docs/design/models-ux/AUDIT-models-performance-2026-10-11.md](../../../docs/design/models-ux/AUDIT-models-performance-2026-10-11.md) | 12748 | a0084f2241a9e56b50b3c4697c2846eaae1c7f25105b5515727c245835f3f0fc |
| [docs/design/models-ux/AUDIT-models-plan-spec-final-2026-10-11.md](../../../docs/design/models-ux/AUDIT-models-plan-spec-final-2026-10-11.md) | 7785 | fdc75c27ccbf29af79751b25ca190f2151d3cca65d262fe3ddb431964f5ecfa0 |
| [docs/design/models-ux/FEASIBILITY-models-repo.md](../../../docs/design/models-ux/FEASIBILITY-models-repo.md) | 9894 | 022880cca7422f96ea5804b1a791329675afa7b014ce56c8c6120ca28761435e |
| [docs/design/models-ux/IMPLEMENTATION-STATUS-models-ux.md](../../../docs/design/models-ux/IMPLEMENTATION-STATUS-models-ux.md) | 22098 | 793376869b4035793f41946965a58f1647faa59a5d9029437caff3f7275bdbb7 |
| [docs/design/models-ux/PLAN-models-ux.md](../../../docs/design/models-ux/PLAN-models-ux.md) | 12879 | f7513bc50fb06ea1b4deb745c07b7c5d633c325192908b1604c2c768bd39999f |
| [docs/design/models-ux/PROMPT-implement-models-ux.md](../../../docs/design/models-ux/PROMPT-implement-models-ux.md) | 8250 | 0424a710af1d9943bf896c85ef5d1daca639701a5cad4011027487cf413cc33f |
| [docs/design/models-ux/PROTOTYPE-HANDOFF.md](../../../docs/design/models-ux/PROTOTYPE-HANDOFF.md) | 12092 | 7f476bef985796e1cdfcda92945b188795c1346405085c47dde7ea9e8c06ae60 |
| [docs/design/models-ux/README.md](../../../docs/design/models-ux/README.md) | 8448 | cfae2ad7e426063340754f2a2db4a5cfd5053a69257cc76f848553b83820014a |
| [docs/design/models-ux/RESEARCH-lineage-scale-2026-10-11.md](../../../docs/design/models-ux/RESEARCH-lineage-scale-2026-10-11.md) | 12165 | e06a45c56d3ceaf8cfc32201e56ef7ba422df02363a8bf5368c2382962597817 |
| [docs/design/models-ux/SPEC-models-ux.md](../../../docs/design/models-ux/SPEC-models-ux.md) | 133690 | d9bb29d34c78d6d1be9d1c44c3dedd713edcbcbc0e71154f6511183dfe5cda5c |
| [package.json](../../../package.json) | 4114 | 4c604227932968e474620435d86be5d8108fea0acc3decd6776fb809e18f4a88 |

## Existing shared sources and reproducibility references

| File | SHA-256 |
| --- | --- |
| [bun.lock](../../../bun.lock) | fea033bb7373510111a14d6e85e543da0655a56f2f9854bee025e86d78f0f362 |
| [.bun-version](../../../.bun-version) | d63588ea4b78e83a37d1219d7c9f625e5080a5b269d1784819cba93a86c14ee1 |
| [Taskfile.yml](../../../Taskfile.yml) | 1ae139dd1209f7666ab27b6df7615b521fde26f41748cab9847f53c80048053f |
| [CLAUDE.md](../../../CLAUDE.md) | 23e33dd44ac014bad37ac81007429906fa5868bcfdb1ffca1ad05dfdddb3b62a |
| [CONTRIBUTING.md](../../../CONTRIBUTING.md) | 04943a2b3174cd8315e0fef041aa2d1d0a2094de882470568adc598ad222a669 |
| [apps/ui/AGENTS.md](../../../apps/ui/AGENTS.md) | 6e7222ffb718b8eaf2b7fa7307c80f0c0950101a57029f2f518f5e887b944d8d |
| [apps/ui/DESIGN.md](../../../apps/ui/DESIGN.md) | 5488070ff97dbd3c95d641496d1d29cc77464071b6dba903748a50aa28d2599f |
| [apps/ui/src/components/Book.tsx](../../../apps/ui/src/components/Book.tsx) | ea4fc8f074c5b6e79719f87aefbfc6eb1835eb13c378fe949ff971875908c3d8 |
| [apps/ui/src/components/TabRail.tsx](../../../apps/ui/src/components/TabRail.tsx) | 3732fd542e50e70511b2ce38afc0697daf29222451bdd6c6cd2927f15c0acefe |
| [apps/ui/src/components/LineageCanvas.tsx](../../../apps/ui/src/components/LineageCanvas.tsx) | dbf959efe163a4731689149fb1b70f97945d3ac0d75e41d71d633d74aea2b798 |
| [apps/ui/src/index.css](../../../apps/ui/src/index.css) | d3c519fdb7fb20e1ffae68b7954beab54dbeb2b75e6db2a9d167a824bde52d3c |
| [apps/ui/src/routes/Models.tsx](../../../apps/ui/src/routes/Models.tsx) | aebd5271963730550b2eb3b1f16f4f63619d583eb18e934f63a566b4abc860da |
| [apps/ui/src/routeTable.tsx](../../../apps/ui/src/routeTable.tsx) | 4781e33b710841f6e455afcf8e2e9b2804bdaefdc3e03298c9dd26dea0519bff |
| [docs/design/operator-and-reader-paths.md](../../../docs/design/operator-and-reader-paths.md) | 6bf622512e0fea33c5473c44db30082e69782002ce78beb9f3b19f1c9892439c |
| [docs/adr/0112-a-model-carries-no-business-context.md](../../../docs/adr/0112-a-model-carries-no-business-context.md) | 6731606fb8853ecc69e137863cb929a8670bad418fd26a99d35ccda4239c5ab8 |
| [docs/adr/0117-the-village-is-an-overview-and-replaces-no-drawing.md](../../../docs/adr/0117-the-village-is-an-overview-and-replaces-no-drawing.md) | e4f055e8bff2028ff1f9c1e6bd3ede8a1ca422d5c074d3efb274df05dd164547 |

Complete delivery also includes this inventory. Source files are ordinary readable Git files, not archives or generated bundles. Installed packages and build outputs are reproduced from the lockfile and Task commands. Local investigation notes outside the repository are not runtime dependencies. Any new contribution file must be added here; no authored runtime source may be excluded merely because it was untracked during preparation.
