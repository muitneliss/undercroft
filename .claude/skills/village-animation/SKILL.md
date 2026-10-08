---
name: village-animation
description: How to change the animated village in Undercroft's UI (ADR 0116). It covers the three.js stop-motion diorama of KayKit characters that draws the Journal's runs and replaces every node-and-edge drawing (a run's stage map and the models' lineage). Use this skill whenever you touch `apps/ui/src/lib/village/**`, `Village.tsx`, `VillageGraph.tsx`, `RunFlow.tsx`, `LineageCanvas.tsx`, `scripts/village/**` or `apps/ui/src/assets/village/**`. Also use it when someone asks to add or change a character, a role, a clip, a pose, a building, a prop, a road, the colours, the lighting, the outlines, the camera or the motion of the village. Use it as well when a run, lineage or stage drawing looks wrong, or when a village visual-regression baseline fails, even if they only say "the animation", "the characters", "the 3D view", "three.js" or "KayKit".
# For working on this repository, not for its users: the skills CLI hides an internal
# skill from `npx skills add muitneliss/undercroft` (docs/runbook/agent-skills.md).
metadata:
  internal: true
---

# The village: characters at work, drawn in stop-motion

The village is a second way of reading one customer's Journal (`?view=village`). Every running
operation is a KayKit character doing a job, and every division is a building. The same engine
draws the interface's two graphs: a run's stages, and the models' lineage. React Flow is gone
and nothing replaces it.

The decision record is `docs/adr/0116-the-journal-can-be-read-as-a-village.md`. The design and
the cast table are in `docs/design/village.md`, and the design system's own section is "The
Journal's Village" in `apps/ui/DESIGN.md`. Read the design doc's table for the rule you are
about to change before you change it: every row there is a promise a reader relies on.

## The four promises a change must keep

Each is easy to break silently, because a wrong picture raises no error.

1. **Nothing moves without a run behind it.** This is rule 2, "never guess", applied to a
   picture.
   - A character's `doing` is derived in `script.ts` from a run's status, its events or its
     steps. A character with no run is `resting`, which claims nothing.
   - Weather and machinery (`ambience.ts`) may move on their own only because a cloud claims
     nothing about the data.
   - If you want a character to do something new, first find the run field that proves it.
     If no field proves it, the character does not do it.
2. **Only the design system's inks.** The packs' colours are never shown.
   - Every vertex is repainted along a tonal ramp from `apps/ui/.impeccable/design.json`.
     `palette.ts` copies the `RAMPS`, and `village.test.ts` holds them equal.
   - A division's canonical hue appears only on a building's roof and flag (the Wheel Rule).
   - Vermilion appears only on an errata slip (the Vermilion Rule).
   - Roads are Page, and outlines are Ink. Never write a hex value into a material; take it
     from `readTokens` or `RAMPS`.
3. **Stop-motion, ten frames a second.**
   - Everything that moves is sampled on the frame and held between frames. The asset script
     re-keys the clips at 10 fps with STEP interpolation. A walk is a fixed `STRIDE` per frame.
     The film steps once per 100 ms and never bursts to catch up.
   - Under `prefers-reduced-motion` nothing loops. Each `show(…, still = true)` puts every
     figure straight where its work is and holds that clip's first frame. Every new choreography
     needs a `still` leg.
4. **The canvas is a picture, and the words beside it carry the meaning.**
   - The canvas is `aria-hidden` and draws no letters. The work list and the place list name
     everything in DOM text, in Vietnamese first under `journal.village.*`.
   - Pointing at a figure or a building lights its row through `data-actor`, `data-place` or
     `data-node` and `data-lit`.
   - Without WebGL, the frame says so in a sentence (`data-village="failed"`).

The graphs add a fifth promise, held by `village.test.ts`: **the village reflects the graph
exactly.** The buildings are exactly the nodes, the roads exactly the edges, and the traffic
exactly the flowing edges. `graph.ts` adds nothing and drops nothing.

## Map of the code

The modules are in `apps/ui/src/lib/village/`, one owner each:

| Module                                               | Owns                                                                                                                                                                                                                                               |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `script.ts`                                          | `deriveVillage(input) → VillageScene`. It turns runs, events, the last build and connections into actors (`role`, `doing`, `slip`), roads and gauges. It is a pure **state**, not a story; the runtime walks figures to it.                        |
| `folk.ts`                                            | `Figure`: one rigged clone per actor. `choreography()` maps a `Doing` to legs (`walk to a NODES spot, hold a clip for N frames`). It also has `MODEL` (role → KayKit character), `homeOf`, `carryClip` (walk legs + hold arms) and `FIGURE_SCALE`. |
| `layout.ts`                                          | Where things stand: the board's tiles (13×9 hexes, the lake behind the vault), `PLACEMENTS` (set piece, turn, scale, division), `PLACES` and the prop anchors. Pure data. A hex is 2 world units across, and +Y is up.                             |
| `roads.ts`                                           | The named spots (`NODES`) figures walk between, the road graph, `route()` (shortest path), `roadLines()`, the source-road slots (`ROAD_SLOTS = 5`) and `barrierAt`.                                                                                |
| `town.ts`                                            | `Town implements World<VillageScene>`: the board, the figures, the props rebuilt per scene, the bell and the ambience.                                                                                                                             |
| `graph.ts`                                           | `runMapGraph(stages)` and `lineageGraph(…)` return a `VillageGraph` (nodes, edges, `flowing`, `broken`, `state`). The lineage keeps ELK's arrangement, scaled by `PIXEL`.                                                                          |
| `graphParts.ts`, `graphWorld.ts`, `carriers.ts`      | A building per node kind, merged ribbon roads per state, the ground under the graph, and a `Carrier` (a courier or a handcart) on every flowing edge. The world is rebuilt only when `shapeOf(graph)` changes.                                     |
| `film.ts`                                            | `Film.start(elements, build, onPick, {camera, fitHeight})`. It owns the renderer, the fixed orthographic camera that fits the whole world, the 10 fps clock, visibility pausing, reduced motion and disposal.                                      |
| `look.ts`, `inkPass.ts`                              | The photograph. A warm key light with soft PCF shadows, a hemisphere fill and a RoomEnvironment, then the composer: Ink outlines, GTAO, tilt-shift, then the print grain and vignette, with Neutral tone mapping. It is deterministic.             |
| `paint.ts`, `palette.ts`                             | The `Painter` (paper `MeshStandardMaterial` with world-fixed grain, water, `figureMaterial` with a finer outline, `flat`, `faded`) and `vertexColour(atlas, cell, shade, roof)`.                                                                   |
| `kit.ts`                                             | `loadKit(tokens)` loads and paints `set.glb`, `folk.glb` and `clips.glb` once per film. It provides `piece(name, division)`, `cast`, `slip()` and `road(line)`.                                                                                    |
| `props.ts`, `ribbon.ts`, `ambience.ts`, `pointer.ts` | The made things (the slip, the bell, crates, barriers, roads as mitred strips), the weather and mills, and pointer-to-words lighting.                                                                                                              |

The React side is thin and holds no frame state (no `useState`; `.claude/rules/state.md`):

- `components/Village.tsx` polls, calls `deriveVillage` and hands the scene to `film.show()`.
- `VillageGraph.tsx` does the same for a graph and is lazily loaded.
- `RunFlow.tsx` and `LineageCanvas.tsx` build the graph and render `VillageGraph`.

The film writes back only `data-` attributes. three.js stays in the lazy chunk; nothing else in
the app may import it.

## Recipes

### A character does something new, or a new run kind gets a character

1. **`script.ts`.** Find the evidence: a status, an event name or a step. Add the `Doing` (with a
   doc comment saying what the reader sees) and derive it. A failure is the same doing at home
   with `slip: true`, not a new pose.
2. **`folk.ts`.** Add its `choreography`: legs to `NODES` spots, using one of the clips in
   `clips.glb`, and pick its `still` leg. A new role needs `MODEL` and `homeOf`; the `never`
   check fails the typecheck until you add both.
3. **`roads.ts`.** Add a spot or a road edge if the walk needs one. `route()` only walks the
   road graph, so a spot nobody connects is unreachable.
4. **The words.** Add the work-list wording to `apps/ui/src/i18n/vi.ts` and `en.ts` under
   `journal.village`, and the `data-actor` key.
5. **`docs/design/village.md`.** Add a row to "What each run makes them do", and to the cast
   table for a new role.
6. **`village.test.ts`.** Add a test only if a reader could be misled. For example, "a courier
   whose ingest is waiting sits by the gate, not on the road". Do not add one for every doing.

### A new clip, character model or set piece

The models come only from the asset script; never hand-edit a `.glb`.

1. Put the KayKit packs, unzipped, under `~/kaykit`. They come from itch.io and are not in the
   repo; the pack versions are listed in `apps/ui/src/assets/village/README.md`.
2. Add the name to the script's lists: `SET` for pieces, `FOLK` for characters and `CLIPS` for
   animations. A clip comes from its rig file, such as `Rig_Medium_General` or
   `Rig_Medium_Tools`.
3. Run `task build:village-assets KAYKIT_DIR=~/kaykit`. It refuses to run if any named file is
   missing; that is deliberate.
4. Update the asset README's lists and the size budget in `docs/design/village.md` if the bytes
   moved noticeably.

### A new kind of node in a graph

`GraphNodeKind` is in `graph.ts`, and `buildingFor` in `graphParts.ts` picks the set piece and
the roof's division. Keep the reflection exact: one building per node and one road per edge.
Extend the `drawnGraph` or "a graph drawn as a village" tests when the mapping changes. If the
node is pressable, it must answer `under()` as `node|<id>` and have a `data-node` word.

### The look: light, colour, outlines, framing

- **Light and post-processing.** These are in `look.ts`. Light intensities are physical, and a
  value that looked right under the legacy model is out by π.
- **Colour.** Change it in `palette.ts` or `paint.ts`, never per model.
- **Camera.** Each view's bearing is its own `{ camera, fitHeight }`: `TOWN_VIEW` in
  `Village.tsx`, `VIEW` in `VillageGraph.tsx`. The film fits the whole world itself; do not add
  pan or zoom, because ADR 0116 fixed the camera.
- **After any look change.** Retake the village baselines (below), and look at them before
  committing.

## Verifying

Green tests are not evidence that the picture is right, so look at it.

- **Unit tests.** Run `task ci:test-one -- apps/ui/src/lib/village/village.test.ts` from the
  repository root. Run the component tests the same way: `RunFlow.test.tsx`, `Models.test.tsx`
  and `lineage.test.ts`. Run from the root, not from `apps/ui`: ELK fails there with "Worker is
  not a constructor".
- **The gate.** Run `task ci:verify`. It includes `build:ui`, which catches a three.js import
  that leaks out of the lazy chunk.
- **Visual regression.** Run `task ci:visual -- Journal` and `task ci:visual -- Models`. They
  need Docker. After an intended change, run `task ci:visual-update -- Journal`, then open the
  new PNGs and compare them with the design before committing. The tier forces reduced motion,
  so a baseline is the settled frame, and software WebGL paints it the same way every time.
  WebGL cases use `{ timeout: WEBGL_TIMEOUT }` on each `it`; Biome rejects options on
  `describe`.
- **Looking at it locally.** Use a standalone harness page on `task dev:ui`, with no backend and
  no sign-in, which fits reviewing a character. `references/preview-harness.md` has a
  copy-in page, a busy-morning scene and the screenshot loop.

## Before you change something odd-looking

Several constants exist because the obvious value failed: the road height, the winding, the
scale factors, the unquantised tile geometry and the bone-name suffix. Read
`references/pitfalls.md` before you "simplify" any of them.

## Finishing

- Update `docs/design/village.md` when a reader-visible rule changes.
- Write a new ADR, never an edit to 0116, if a decision it records is reversed.
- Re-ingest the wiki for the changed docs.
- Commit, push and open a PR, as the workspace rules require.
