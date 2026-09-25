/**
 * Each widget, as the control plane builds it at boot, is ONE document that needs nothing else.
 *
 * A host draws a widget in a frame whose CSP lets it fetch nothing, so a page that referred to
 * a script, a stylesheet or a font by address would render as a blank frame in every host --
 * while every test of the widget's logic passed. This builds the real pages with the real
 * `buildWidgets` and reads them as a browser would.
 */

import { describe, expect, test as it } from "bun:test";
import { buildWidgets } from "@undercroft/control-plane/widgets";

describe("the widget pages", () => {
  it("are one self-contained document each, fetching nothing", async () => {
    const widgets = await buildWidgets();
    const pages = [...widgets].map(([id, html]) => {
      const page = new DOMParser().parseFromString(html, "text/html");
      const scripts = [...page.querySelectorAll("script")];
      return {
        id,
        external: [...page.querySelectorAll("[src], [href]")].map((node) => node.outerHTML),
        inlineScripts: scripts.filter((script) => script.textContent.length > 0).length,
        scripts: scripts.length,
      };
    });

    expect(pages).toEqual([
      { id: "grid", external: [], inlineScripts: 1, scripts: 1 },
      { id: "run", external: [], inlineScripts: 1, scripts: 1 },
    ]);
  });
});
