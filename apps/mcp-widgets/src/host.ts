/**
 * What both widgets share: joining the host, following its theme and language, and reading
 * what a result says about the call that produced it.
 *
 * A widget is a page an MCP Apps host draws in a sandboxed frame beside a tool's answer. It
 * talks to the host through `App` from `@modelcontextprotocol/ext-apps` -- the `app-with-deps`
 * build, because the frame's CSP allows nothing to be fetched and the page must carry every
 * byte it runs. The order below is the extension's rule, not taste: every handler is set
 * BEFORE `connect()`, because the host may send the tool's input and result the moment the
 * handshake completes, and a notification with no handler is dropped.
 *
 * The frame follows the host rather than the web UI's own look: the host's theme (light or
 * dark, and its CSS variables where it sends them), its language, and its safe-area insets.
 * The web UI's palette would read as a foreign object in someone else's chat.
 */

import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  type McpUiHostContext,
  type McpUiToolResultNotification,
} from "@modelcontextprotocol/ext-apps/app-with-deps";
import type { WIDGET_CALL_META } from "@undercroft/control-plane/surface";
import type { Locale } from "@undercroft/core/locale";
import { localeOf, type Words, wordsFor } from "./i18n.ts";

/** A tool's result, as the host hands it over. */
export type ToolResult = McpUiToolResultNotification["params"];

/** Which procedure answered and for which tenant. See `resultMeta` in the control plane. */
export interface Call {
  readonly path: string;
  readonly tenantId: string | null;
}

/** What a widget has to draw with. */
export interface Host {
  readonly app: App;
  /** The element the widget draws into; everything else on the page is this module's. */
  readonly root: HTMLElement;
  readonly locale: () => Locale;
  readonly t: () => Words;
  /** Which call produced `result`, or `null` when neither the result nor the host says. */
  readonly callOf: (result: ToolResult) => Call | null;
  /** Run `stop` when the host takes the frame down: a timer must not outlive its page. */
  readonly onTeardown: (stop: () => void) => void;
}

/** The key the door writes a call's identity under; typed against the door's own constant. */
const CALL_META: typeof WIDGET_CALL_META = "undercroft/call";

/**
 * The page's own style. Every colour is the host's variable where it sends one and the
 * system's `Canvas` / `CanvasText` where it does not, so the page follows light and dark with
 * no palette of its own.
 */
const STYLE = `
:root {
  color-scheme: light dark;
  --u-bg: var(--color-background-primary, Canvas);
  --u-fg: var(--color-text-primary, CanvasText);
  --u-muted: var(--color-text-secondary, GrayText);
  --u-rule: var(--color-border-secondary, color-mix(in srgb, CanvasText 18%, transparent));
  --u-danger: var(--color-text-danger, #b3261e);
  --u-success: var(--color-text-success, #1e7a3c);
  --u-font: var(--font-sans, system-ui, sans-serif);
  --u-mono: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  --u-radius: var(--border-radius-md, 6px);
}
html.dark { color-scheme: dark; }
html.light { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--u-bg); color: var(--u-fg); font: 13px/1.45 var(--u-font); }
.widget { padding: 8px; display: grid; gap: 8px; }
.note { margin: 0; color: var(--u-muted); }
.note--error { color: var(--u-danger); }
.grid { overflow: auto; max-height: 480px; border: 1px solid var(--u-rule); border-radius: var(--u-radius); }
table { border-collapse: collapse; width: max-content; min-width: 100%; }
th, td { text-align: left; vertical-align: top; padding: 4px 8px; border-bottom: 1px solid var(--u-rule); }
th { position: sticky; top: 0; background: var(--u-bg); font-weight: var(--font-weight-semibold, 600); white-space: nowrap; }
th .type { margin-left: 6px; color: var(--u-muted); font: 11px var(--u-mono); font-weight: normal; }
td { font-family: var(--u-mono); font-variant-numeric: tabular-nums; white-space: nowrap; max-width: 40ch; overflow: hidden; text-overflow: ellipsis; }
td details summary { cursor: pointer; overflow: hidden; text-overflow: ellipsis; }
td details pre { margin: 4px 0 0; white-space: pre-wrap; word-break: break-word; max-width: 70ch; }
.run-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.run-head h1 { margin: 0; font-size: 14px; font-family: var(--u-mono); }
.badge { padding: 1px 8px; border-radius: 999px; border: 1px solid currentColor; font-size: 12px; }
.badge--running { color: var(--u-muted); }
.badge--ok { color: var(--u-success); }
.badge--failed { color: var(--u-danger); }
.facts { margin: 0; padding: 0; list-style: none; display: grid; gap: 2px; }
.events { margin: 0; padding: 0; list-style: none; display: grid; gap: 2px; font-family: var(--u-mono); font-size: 12px; }
.events .level--warn { color: var(--u-muted); }
.events .level--error { color: var(--u-danger); }
`;

/** Build an element with a class and its children. The pages are small enough for this. */
export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string | null,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== null) {
    node.className = className;
  }
  node.append(...children);
  return node;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A refusal's own sentence, which the door wrote in the caller's language (`mcpAnswers.ts`). */
export function refusalMessage(result: ToolResult): string {
  const content: unknown = result.structuredContent;
  return isRecord(content) && typeof content.message === "string" ? content.message : "";
}

/** The call a result names in its `_meta`, which the door writes for every drawn tool. */
function callInMeta(result: ToolResult): Call | null {
  const call = result._meta?.[CALL_META];
  if (!isRecord(call) || typeof call.path !== "string") {
    return null;
  }
  return { path: call.path, tenantId: typeof call.tenantId === "string" ? call.tenantId : null };
}

/**
 * Follow the host's context: its theme on the root element (so `color-scheme` and the `dark`
 * class agree), its CSS variables, and its safe-area insets as the page's padding.
 */
function follow(context: McpUiHostContext | undefined): void {
  if (context?.theme !== undefined) {
    applyDocumentTheme(context.theme);
    document.documentElement.classList.toggle("dark", context.theme === "dark");
    document.documentElement.classList.toggle("light", context.theme === "light");
  }
  if (context?.styles?.variables !== undefined) {
    applyHostStyleVariables(context.styles.variables);
  }
  const insets = context?.safeAreaInsets;
  if (insets !== undefined) {
    const { style } = document.body;
    style.paddingTop = `${insets.top}px`;
    style.paddingRight = `${insets.right}px`;
    style.paddingBottom = `${insets.bottom}px`;
    style.paddingLeft = `${insets.left}px`;
  }
}

/** What the host has told the page so far. One object, so every reader sees the latest. */
interface Heard {
  context: McpUiHostContext | undefined;
  input: Record<string, unknown> | undefined;
  drawn: boolean;
  readonly stops: (() => void)[];
}

/**
 * Which call produced `result`: what the door wrote in its `_meta`, or else what the host says.
 * A host that relays a result without its `_meta` still names the tool it called and hands
 * over the input; a tool's name is its path with `_` for `.`.
 */
function callFrom(result: ToolResult, heard: Heard): Call | null {
  const named = callInMeta(result);
  const tool = heard.context?.toolInfo?.tool.name;
  if (named !== null || tool === undefined) {
    return named;
  }
  const tenantId = heard.input?.tenantId;
  return {
    path: tool.replaceAll("_", "."),
    tenantId: typeof tenantId === "string" ? tenantId : null,
  };
}

function hostFor(app: App, root: HTMLElement, heard: Heard): Host {
  return {
    app,
    root,
    locale: () => localeOf(heard.context?.locale),
    t: () => wordsFor(localeOf(heard.context?.locale)),
    callOf: (result) => callFrom(result, heard),
    onTeardown: (stop): void => {
      heard.stops.push(stop);
    },
  };
}

/**
 * Join the host and draw each result it sends with `draw`.
 *
 * Until the first result arrives the page says it is waiting, in the host's language once the
 * handshake has told it which that is.
 */
export async function mount(
  name: string,
  draw: (result: ToolResult, host: Host) => void,
): Promise<Host> {
  document.head.append(element("style", null, STYLE));
  const root = element("main", "widget");
  document.body.append(root);

  const app = new App({ name, version: "1" }, {}, { autoResize: true });
  const heard: Heard = { context: undefined, input: undefined, drawn: false, stops: [] };
  const host = hostFor(app, root, heard);

  function waiting(): void {
    if (!heard.drawn) {
      root.replaceChildren(element("p", "note", host.t()("loading")));
    }
  }

  app.ontoolinput = (params): void => {
    heard.input = params.arguments;
  };
  app.ontoolresult = (result): void => {
    heard.drawn = true;
    draw(result, host);
  };
  app.onteardown = (): Record<string, never> => {
    for (const stop of heard.stops) {
      stop();
    }
    return {};
  };
  app.onhostcontextchanged = (changed): void => {
    heard.context = { ...heard.context, ...changed };
    follow(heard.context);
    waiting();
  };

  waiting();
  await app.connect();
  heard.context = app.getHostContext();
  follow(heard.context);
  waiting();
  return host;
}
