/**
 * The MCP widgets, built into one self-contained HTML page each, once per process. ADR 0061.
 *
 * The widgets' source is `apps/mcp-widgets`, TypeScript typed against this package's router.
 * A host draws each one in a sandboxed frame whose CSP lets it fetch NOTHING -- no script from a
 * CDN, no stylesheet, not even another file from this server -- so a page must carry every
 * byte it runs. That is why this bundles each entry with `Bun.build` in memory and inlines the
 * result into the page, rather than serving files beside it.
 *
 * At boot, not at image build: Bun is already in the image, the build is a fraction of a second,
 * and there is then no second artefact to keep in step with the source it came from. A build
 * that fails is logged and answered with no widgets, so `/mcp` serves every tool exactly as it
 * did before widgets existed, text and structured content, which every host shows. A broken
 * widget must never be the reason a person cannot read their data.
 *
 * Here, beside `main.ts` and `testing.ts`, because it is the composition root's to call: the
 * handlers are handed the pages (`ServerDeps.widgets`) and never build anything.
 */

import { describeError, type Logger } from "@undercroft/core";
import { NO_WIDGETS, type Widgets } from "./handlers/mcpWidgets.ts";
import type { WidgetId } from "./handlers/surface.ts";

/** Each widget's entry, as `apps/mcp-widgets/package.json` exports it. */
const ENTRIES: Readonly<Record<WidgetId, string>> = {
  grid: "@undercroft/mcp-widgets/grid",
  run: "@undercroft/mcp-widgets/run",
};

/** What would end the inline script early, or open an HTML comment inside it. */
const SCRIPT_BREAKS = /<(?<rest>\/script|!--)/giu;

/**
 * Bundle one entry and put it in a page.
 *
 * `</script` and `<!--` inside the bundle are escaped as `<\/script` and `<\!--`, which mean
 * the same to JavaScript and nothing to the HTML parser -- the one way an inlined bundle can
 * break out of its own element.
 */
async function page(entry: string): Promise<string> {
  const built = await Bun.build({
    entrypoints: [Bun.resolveSync(entry, import.meta.dir)],
    target: "browser",
    format: "esm",
    minify: true,
  });
  const [bundle] = built.outputs;
  if (!built.success || bundle === undefined) {
    throw new AggregateError(built.logs, `${entry} did not build`);
  }
  const script = (await bundle.text()).replace(SCRIPT_BREAKS, "<\\$<rest>");
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "</head><body>",
    `<script type="module">${script}</script>`,
    "</body></html>",
  ].join("");
}

async function buildAll(log: Logger | undefined): Promise<Widgets> {
  try {
    const ids = Object.keys(ENTRIES).filter((id): id is WidgetId => Object.hasOwn(ENTRIES, id));
    const pages = await Promise.all(ids.map(async (id) => [id, await page(ENTRIES[id])] as const));
    log?.info("mcp_widgets_built", { widgets: ids.join(",") });
    return new Map(pages);
  } catch (error) {
    log?.error("mcp_widgets_unbuilt", describeError(error));
    return NO_WIDGETS;
  }
}

let built: Promise<Widgets> | null = null;

/** Every widget's page, built on the first call and shared by every later one. */
export function buildWidgets(log?: Logger): Promise<Widgets> {
  built ??= buildAll(log);
  return built;
}
