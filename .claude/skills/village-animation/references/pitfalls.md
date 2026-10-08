# Pitfalls the village has already hit

Each entry is a constant or a step that looks arbitrary, the failure that put it there, and
what to check before you change it. They are grouped by where they bite.

## Assets (`scripts/village/`)

- **Quantised UVs broke the repaint.** meshopt quantises texture coordinates, so a UV no longer
  names its atlas cell exactly. The script therefore bakes two byte attributes in place of the
  UV: `_CELL`, the atlas cell, and `_SHADE`, how far down that cell's gradient. The browser reads
  them as `_cell` and `_shade`. Do not go back to reading UVs.
- **Orphan accessors inflated `clips.glb`.** A dropped clip's samplers outlive it and keep their
  keys alive. `keepClips` (`gltf.ts`) disposes of the samplers first. `bundle` then disposes of
  every accessor that only the root still points at, because `prune` leaves a bare accessor
  alone. Check the byte sizes after any clip change.
- **Loading suffixed the bone names.** Five rigs in one file share bone names, so three's
  `GLTFLoader` makes them unique by suffix (`hips_2`), and the clips' rigs get the same
  treatment. A clip addresses a bone by name, so no track would bind. `kit.ts` strips
  `DUPLICATE_SUFFIX` from both the bones and the track names after loading. When a new clip does
  not move a character, look at its track names first.
- **Team cells come from the red variant.** Buildings are kept in their blue variant, and the red
  one is read only to find the cells that differ, which are the team colour. A building with no
  red variant has no team cells, so its roof stays Bone.
- **The script refuses to guess.** It stops without `KAYKIT_DIR`, and writes nothing if any named
  file is missing. Do not add fallbacks: a building silently left out of the village is a wrong
  picture nobody notices.

## Rendering (`look.ts`, `paint.ts`, `props.ts`, `ribbon.ts`)

- **Light intensities are physical.** three's lights use physical units, so an intensity copied
  from an older example is out by about π. The scene went first overexposed, then too dark.
  `KEY_STRENGTH` and `FILL_STRENGTH` in `look.ts` are tuned to Neutral tone mapping and the
  page's colours, so change them together with a baseline retake, never alone.
- **Roads were invisible, twice.**
  - The strip's triangles were wound clockwise, so the strip faced down and was culled. The
    ribbon must stay counter-clockwise seen from +Y.
  - Even facing up, a road flush with the tiles hid under the ink outline drawn round every tile.
    `ROAD_LEVEL = 0.07` lifts it clear and still looks flat (`props.ts`).
- **A road is one strip, not a box per segment.** Roads are one mitred strip per line
  (`ribbon`). `MITRE_LIMIT` stops a sharp corner from spiking.
- **A figure's outline closed over its face.** A building's outline thickness, applied at a
  figure's scale, fills the face in. Figures get `FIGURE_OUTLINE`, which is finer.
- **The render resolution is a floor, not a ceiling.** The pixel ratio is clamped to between 2
  and 3, and the image is downscaled. A ratio of 1 makes the ink and the faces mushy at the
  diorama's size. The composer multisamples, so the renderer's own antialias stays off.
- **Clouds are shadow-only.** A visible cloud between the camera and the board hides the
  village. Clouds use a material with `colorWrite: false`, have the outline turned off, and still
  cast shadows. Only two small clouds at the back are seen.

## Tests and the visual tier

- **Run tests from the repo root** with `task ci:test-one -- <path>`, never with `apps/ui` as the
  working directory.
- **WebGL visual cases are slow under CI.** Software rendering in the Playwright image takes
  seconds per frame:
  - `WEBGL_TIMEOUT` is 60 s per `it`, and `SETTLE_MS` is 45 s;
  - `apps/ui/vitest.config.ts` sets `fileParallelism: false`, so WebGL files do not starve one
    another.

  Do not lower these to speed the tier up.

- **Biome flags `Suspense` and `lazy` from `react`** as unresolved imports, a false positive
  with React 19. `biome.jsonc` lists the files that need the exemption. Add a new lazy-loading
  file there with its reason; never add a `biome-ignore-all`.
- **Component tests cannot see the picture.** Test what a reader can reach in the DOM -- the
  work list, the buildings list, `data-village` on the frame -- not three.js objects.
