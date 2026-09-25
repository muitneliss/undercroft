/**
 * The widgets `/mcp` offers beside a tool's answer, as MCP Apps resources (ADR 0061).
 *
 * A host that speaks the MCP Apps extension reads a tool's `_meta.ui.resourceUri`, fetches that
 * `ui://` resource, and draws the HTML in a sandboxed frame; the widget then receives the tool's
 * result and may call tools itself, through the host, over this same door and this same
 * credential. A host that does not speak it ignores all of this and shows the text and the
 * structured content every result carries anyway -- a widget is a way of drawing an answer,
 * never the only place the answer is.
 *
 * What this module owns is the door's half: which `ui://` address each widget has, what a
 * widget-drawn tool says about itself, and what a widget-drawn result carries so the widget
 * knows what it was handed. What the widgets draw is `apps/mcp-widgets`; which procedure each
 * one draws is `MCP_WIDGETS` in `surface.ts`; building them into HTML is `widgets.ts`, once, at
 * boot.
 *
 * The documents are self-contained -- script and style inlined, nothing fetched -- so the
 * resource declares no CSP domains at all: the host's default, which allows nothing outside the
 * frame, is exactly what a widget needs. Every read it makes goes back through `/mcp`.
 */

import { RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";
import type { ReadResourceResult, Resource } from "@modelcontextprotocol/server";
import {
  MCP_WIDGETS,
  type ProcedurePath,
  type WidgetCall,
  type WidgetId,
  WIDGET_CALL_META,
} from "./surface.ts";

/** Each widget's page, as built at boot. An empty map is a door with no widgets. */
export type Widgets = ReadonlyMap<WidgetId, string>;

export const NO_WIDGETS: Widgets = new Map();

const URIS: Readonly<Record<WidgetId, string>> = {
  grid: "ui://undercroft/grid.html",
  run: "ui://undercroft/run.html",
};

/** What each widget is called in a host's resource list. Not shown to a person. */
const NAMES: Readonly<Record<WidgetId, string>> = {
  grid: "Undercroft result grid",
  run: "Undercroft run status",
};

const WIDGETS_BY_PATH: ReadonlyMap<string, WidgetId> = new Map(Object.entries(MCP_WIDGETS));

/** The widget that draws `path`'s answer, if one does and it was built. */
function widgetFor(path: ProcedurePath, widgets: Widgets): WidgetId | null {
  const id = WIDGETS_BY_PATH.get(path);
  return id !== undefined && widgets.has(id) ? id : null;
}

/**
 * A tool's `_meta`, pointing a host at the widget that draws it -- in both spellings the
 * extension defines, the nested `ui.resourceUri` and the older flat key, as its own
 * `registerAppTool` does -- or `undefined` for a tool no widget draws.
 */
export function toolMeta(
  path: ProcedurePath,
  widgets: Widgets,
): Record<string, unknown> | undefined {
  const id = widgetFor(path, widgets);
  return id === null
    ? undefined
    : { ui: { resourceUri: URIS[id] }, [RESOURCE_URI_META_KEY]: URIS[id] };
}

/**
 * A result's `_meta` for a widget-drawn tool: which procedure answered and for which tenant.
 *
 * The widget needs both and cannot be sure of either otherwise. The host's context names the
 * tool only optionally, and the run widget asks `runs.get` about a run it knows by id alone --
 * `runs.trigger` answers `{ runId }` -- so it needs the tenant the call was made in. Both are
 * what the caller sent, echoed; nothing a widget reads here is something it was not told.
 */
export function resultMeta(
  path: ProcedurePath,
  args: Record<string, unknown> | undefined,
  widgets: Widgets,
): Record<string, unknown> | undefined {
  if (widgetFor(path, widgets) === null) {
    return undefined;
  }
  const tenantId = args?.tenantId;
  const call: WidgetCall = { path, tenantId: typeof tenantId === "string" ? tenantId : null };
  return { [WIDGET_CALL_META]: call };
}

export function listResources(widgets: Widgets): Resource[] {
  return [...widgets.keys()].map((id) => ({
    uri: URIS[id],
    name: NAMES[id],
    mimeType: RESOURCE_MIME_TYPE,
  }));
}

/** A widget's page, or `null` for a URI that names none. */
export function readResource(uri: string, widgets: Widgets): ReadResourceResult | null {
  for (const [id, html] of widgets) {
    if (URIS[id] === uri) {
      return { contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    }
  }
  return null;
}
