# Previewing the village locally

Use this to look at a character, a pose, a building or the look without the backend, the
database or a sign-in. It is a standalone page served by the UI's own dev server. It builds the
real `Film` with the real `Town` from test fixtures, so what it shows is what the Journal's
village shows.

The two files are scratch and are never committed. List them in the worktree's
`.git/info/exclude`, not in `.gitignore`, and delete them when you are done.

## 1. Drop in the two files

```bash
printf "apps/ui/village-dev.html\napps/ui/src/village-dev.ts\n" \
  >> "$(git rev-parse --git-common-dir)/info/exclude"
```

`apps/ui/village-dev.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>village dev</title>
  </head>
  <body style="margin:0;background:#f7f3e7">
    <div id="frame" style="width:1280px;height:720px;position:relative">
      <canvas id="canvas" style="width:100%;height:100%;display:block"></canvas>
    </div>
    <div id="words"></div>
    <script type="module" src="/src/village-dev.ts"></script>
  </body>
</html>
```

`apps/ui/src/village-dev.ts` is a busy morning (one of every doing a reader can see). Edit the
runs to stage whatever you are working on:

```ts
// Local preview of the village, never committed (listed in .git/info/exclude).
// Open /village-dev.html[?mode=idle] on `task dev:ui`.
import "@/index.css";
import { Vector3 } from "three";

import { Film } from "@/lib/village/film.ts";
import { deriveVillage } from "@/lib/village/script.ts";
import { Town } from "@/lib/village/town.ts";
import { run, runDetail } from "@/test/fixtures.ts";

const params = new URLSearchParams(location.search);
const idle = params.get("mode") === "idle";
const elements = {
  frame: document.getElementById("frame") as HTMLElement,
  canvas: document.getElementById("canvas") as HTMLCanvasElement,
  words: document.getElementById("words") as HTMLElement,
};
const onPick = (kind: string, id: string): void => console.log("pick", kind, id);
const now = new Date();
const ago = (s: number): string => new Date(now.getTime() - s * 1000).toISOString();
const open = { endedAt: null, counts: null, status: "running" } as const;

// A busy morning: one of every doing a reader can see. Edit to taste.
const runs = idle
  ? []
  : [
      run({ id: "r1", kind: "ingest", source: "hubspot", startedAt: ago(30), ...open }),
      run({ id: "r2", kind: "ingest", source: "xero", status: "failed", startedAt: ago(300) }),
      run({
        id: "r3",
        kind: "transform",
        source: null,
        trigger: "build",
        startedAt: ago(20),
        ...open,
      }),
      run({ id: "r4", kind: "extract", source: "drive", startedAt: ago(10), ...open }),
      run({ id: "r8", kind: "semantic", source: "drive", startedAt: ago(8), ...open }),
      run({
        id: "r5",
        kind: "ingest",
        source: "gmail",
        trigger: "schedule",
        startedAt: ago(3),
        ...open,
      }),
      run({
        id: "r6",
        kind: "lake-api",
        source: "erp",
        trigger: "lake-api",
        startedAt: ago(10),
        ...open,
      }),
      run({
        id: "r7",
        kind: "ingest",
        source: "drive",
        status: "ok",
        counts: { landed: 54321, created: 1, changed: 1, unchanged: 1, refused: 3 },
      }),
    ];
const scene = deriveVillage({
  now,
  runs,
  events: new Map([
    [
      "r5",
      [
        {
          at: ago(2),
          level: "info",
          event: "run_waiting",
          entity: null,
          detail: {},
          live: false,
        },
      ],
    ],
  ]),
  lastBuild: runDetail({
    id: "b0",
    kind: "transform",
    testsFailed: 1,
    steps: [
      {
        uniqueId: "m1",
        kind: "model",
        name: "a",
        status: "success",
        failures: null,
        relation: null,
        message: null,
        executionMs: 1,
      },
      {
        uniqueId: "t1",
        kind: "test",
        name: "t",
        status: "fail",
        failures: 2,
        relation: null,
        message: null,
        executionMs: 1,
      },
    ],
  }),
  connections: [
    { source: "hubspot", status: "connected" },
    { source: "xero", status: "connected" },
    { source: "gmail", status: "connected" },
    { source: "drive", status: "needs_reconnect" },
  ],
});
const film = await Film.start(elements, (kit) => new Town(kit), onPick, {
  camera: new Vector3(5, 15, 17),
  fitHeight: 1.6,
});
film?.show(scene);
// The screenshot loop waits on this.
(window as unknown as { ready: boolean }).ready = true;
```

If a fixture's fields have moved, follow `apps/ui/src/test/fixtures.ts` and the `VillageInput`
type in `script.ts`.

## 2. Serve it and look

Run `task dev:ui` in the background. It needs no backend for this page. Then open
`http://localhost:5173/village-dev.html` (add `?mode=idle` for a quiet village).

To screenshot it from the agent with `agent-browser`, wait for `window.ready` and for the
frame's `data-village` to be `ready`, then capture:

```bash
agent-browser set viewport 1280 760
agent-browser open "http://localhost:5173/village-dev.html"
for i in $(seq 1 30); do
  r=$(agent-browser eval "String(window.ready === true) + ' ' + document.getElementById('frame').dataset.village")
  case "$r" in *true*) break;; esac; sleep 1
done
sleep 2   # let a few stepped frames play
agent-browser screenshot /tmp/village-town.png
```

Then read the PNG and look at it. If `data-village` is `failed`:

- the browser has no WebGL, or a model failed to load;
- `agent-browser console` shows which.

To check motion frame by frame (a door that opens in three frames, a page that turns), a
screenshot is too slow to catch consecutive frames of the live clock. Put the clock in the
page's hands instead: at the top of `village-dev.ts`, before `Film.start`, replace
`requestAnimationFrame` with one that only queues its callback, and expose a stepper that calls
it with a time 100 ms later. Each call then draws exactly one frame:

```ts
let queued: FrameRequestCallback | null = null;
let clock = 1000;
globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => ((queued = cb), 1);
globalThis.cancelAnimationFrame = (): void => void (queued = null);
(window as unknown as { advance: (n: number) => void }).advance = (n) => {
  for (let i = 0; i < n; i += 1) {
    clock += 100;
    const cb = queued;
    queued = null;
    cb?.(clock);
  }
};
```

Then `agent-browser eval "window.advance(1); 1"` between screenshots. `agent-browser set media
light reduced-motion` shows the settled frame; `set media light` turns motion back on.

When the user wants to review the motion themselves, give them the URL and leave the server
running. Hot reload picks up edits under `lib/village/`.

## 3. Clean up

Stop the dev server. Delete both files, and remove their two lines from
`.git/info/exclude`. The worktree's clean-up at the end of the task does not remove them,
because they are ignored.
