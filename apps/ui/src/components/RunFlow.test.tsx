/**
 * What `RunFlow` promises beyond `deriveRunFlow` itself (pinned in `runFlow.test.ts`): the
 * canvas is decorative, and a chain link is always real, focusable text with a real `href`,
 * never something only the drawn plate carries.
 *
 * No mocks: the real component, the real i18next instance, a real router for the link.
 */

import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { DEFAULT_LOCALE } from "@undercroft/core/locale";
import { MemoryRouter } from "react-router-dom";

import { RunFlow } from "@/components/RunFlow.tsx";
// The side effect is the point: `useTranslation` resolves against the module-level i18next
// singleton, and without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";
import { useUiStore } from "@/store.ts";
import { runDetail, runLink } from "@/test/fixtures.ts";

afterEach(() => {
  cleanup();
  useUiStore.setState({ locale: DEFAULT_LOCALE });
});

describe("a run with nothing chained either side", () => {
  it("draws its own shape and names no chain link", () => {
    const { container } = render(
      <MemoryRouter>
        <RunFlow tenantId="CASE-0042" run={runDetail()} events={[]} locale="en" />
      </MemoryRouter>,
    );

    expect(container.querySelectorAll(".run-flow__chain")).toHaveLength(0);
  });
});

describe("a run chained on both sides", () => {
  it("names each side as real, focusable text with a real link to it", () => {
    // `t()` follows the store's locale, projected into i18next -- not the `locale` prop
    // below, which only drives number and date formatting. Both read the same store in the
    // app; a test that wants English text has to switch the store too.
    useUiStore.setState({ locale: "en" });
    const detail = runDetail({
      parentRun: runLink({ id: "run-parent", kind: "ingest", source: "hubspot", status: "ok" }),
      childRun: runLink({ id: "run-child", kind: "transform", source: null, status: "running" }),
    });

    render(
      <MemoryRouter>
        <RunFlow tenantId="CASE-0042" run={detail} events={[]} locale="en" />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("link", { name: "Chained from the HubSpot ingest" }).getAttribute("href"),
    ).toBe("/tenants/CASE-0042/journal/run-parent");
    expect(
      screen.getByRole("link", { name: "Chained into a model build" }).getAttribute("href"),
    ).toBe("/tenants/CASE-0042/journal/run-child");
  });
});

describe("the drawn canvas", () => {
  it("is hidden from assistive tech: the chain links above carry the same facts in words", () => {
    const { container } = render(
      <MemoryRouter>
        <RunFlow
          tenantId="CASE-0042"
          run={runDetail({ parentRun: runLink() })}
          events={[]}
          locale="en"
        />
      </MemoryRouter>,
    );

    const canvas = container.querySelector(".run-flow__canvas");
    expect(canvas?.getAttribute("aria-hidden")).toBe("true");
  });
});
