/**
 * The two promises the slip makes about a failed request, both of them silent when broken.
 *
 * Drop the trace line, or build the report link without the id, and the slip still renders a
 * perfectly good sentence -- the reader just has nothing to quote back, and the report that
 * reaches the tracker says "it broke" with no way to find the request. Forget the
 * `internal_error` case and the reader is shown a raw code in the language of neither
 * catalogue.
 *
 * No mocks: the real component, the real i18next instance and the real catalogues. The error
 * is shaped as the control plane's `errorFormatter` shapes it; the trace id is a made-up
 * 32-hex value, not one from any real request.
 */

import { afterEach, expect, test as it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";

import { Errata } from "@/components/Errata.tsx";
// The side effect is the point: `useTranslation` resolves against the module-level i18next
// singleton, and without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";

// Said here rather than left to Testing Library's own registration; see Colophon.test.tsx.
afterEach(cleanup);

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";

it("signs a failed request with its trace id and a report link that carries it", () => {
  render(
    <Errata
      heading="Không lưu được"
      error={{ message: "Tên đã được dùng.", data: { traceId: TRACE_ID } }}
    />,
  );

  expect(screen.getByText(TRACE_ID).tagName).toBe("CODE");
  const report = screen.getByRole("link", { name: "Báo lỗi" });
  const url = new URL(report.getAttribute("href") ?? "");
  expect(url.searchParams.get("trace-id")).toBe(TRACE_ID);
  expect(url.searchParams.get("template")).toBe("bug_report.yml");
  expect(url.searchParams.get("version")).toMatch(/^v\d+\.\d+\.\d+$/u);
});

it("words an internal failure in the reader's language instead of printing the code", () => {
  render(<Errata heading="Không lưu được" error={{ message: "internal_error", data: null }} />);

  expect(screen.queryByText("internal_error")).toBeNull();
  expect(screen.getByText(/Máy chủ gặp lỗi ngoài dự kiến/u)).toBeDefined();
  // No trace id, no signature: a label with nothing to copy would be a promise not kept.
  expect(screen.queryByRole("link")).toBeNull();
});
