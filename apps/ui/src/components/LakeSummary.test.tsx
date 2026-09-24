/**
 * What the printed lake promises: a customer with nothing landed is told when the first
 * run comes rather than shown empty tables, and a customer with rows gets ONE index --
 * a line per stream, its count in the reader's grouping, and the one note its kind earns.
 *
 * No mocks: the real component, the real i18next instance, the real catalogues.
 */

import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { LakeSummary as Summary } from "@/api/types.ts";
import { LakeSummary } from "@/components/LakeSummary.tsx";
// The side effect is the point: `useTranslation` resolves against the module-level i18next
// singleton, and without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";
import { useUiStore } from "@/store.ts";
import { connection } from "@/test/fixtures.ts";

const NO_SCHEDULE = /Chưa có nguồn nào sẵn sàng/u;

afterEach(() => {
  cleanup();
  // The store is the real module-level one, so a fold left open would open the next test's.
  useUiStore.setState({ openLakeRefusals: {} });
});

function leaf(summary: Summary): React.JSX.Element {
  return (
    <MemoryRouter>
      <LakeSummary
        tenantId="CASE-0042"
        summary={summary}
        connections={[connection("hubspot")]}
        locale="vi"
      />
    </MemoryRouter>
  );
}

describe("LakeSummary", () => {
  it("nothing landed: an unprinted leaf that says what stands in the way, and no table", () => {
    render(leaf({ records: [], documents: [] }));

    expect(screen.getByText("Chưa có gì về")).toBeDefined();
    expect(screen.getByText(NO_SCHEDULE)).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("rows landed: one line per stream, each with the one note its own kind earns", () => {
    render(
      leaf({
        records: [
          {
            source: "hubspot",
            entity: "deals",
            records: 1234,
            tombstoned: 12,
            latestObservedAt: new Date().toISOString(),
          },
        ],
        documents: [
          // FOUR ROWS OVER TWO BLOBS, and no two of these numbers are equal on purpose. The
          // note has four slots and three of them are counts; a fixture where the row count
          // and the distinct count agreed would print the same line whichever of the two the
          // component passed as `count`, which is exactly the mix-up worth catching.
          {
            source: "gmail",
            documents: 4,
            distinctBlobs: 2,
            bytes: 3500,
            readable: 1,
            refused: 0,
            waiting: 3,
            reasons: [],
            latestObservedAt: new Date().toISOString(),
          },
        ],
      }),
    );

    expect(screen.getByText("HubSpot")).toBeDefined();
    expect(screen.getByText("deals")).toBeDefined();
    expect(screen.getByText("1.234")).toBeDefined();

    // Tombstones and bytes are no longer columns of their own. The index gives each stream a
    // SINGLE note, phrased in that stream's own terms -- how many rows the source has since
    // deleted for a record stream, how much was held and how much of it could be read for a
    // document one. Two half-empty numeric columns became one column that always says
    // something, which is the whole reason the two tables became one.
    expect(screen.getByText("12 đã xoá ở nguồn")).toBeDefined();
    // The bytes are what the LAKE holds -- two blobs -- printed beside the four catalogue
    // rows that name them. The old line said only "3.5 kB · đọc được 0/2" and so reported a
    // byte total that the object store underneath disagrees with by the duplication ratio,
    // with nothing on the page to show a reader that it did.
    expect(
      screen.getByText("3.5 kB trong 2 tệp riêng biệt · đọc được 1/4 · 0 bị từ chối · 3 chưa đọc"),
    ).toBeDefined();

    expect(screen.queryByText("Chưa có gì về")).toBeNull();
  });

  /**
   * Issue #139: "đọc được 1/5" read as mass breakage when the rest were logos nobody can read
   * and a file the extract had not reached. The row now says which is which, and unfolds the
   * reasons -- each marked for whether anyone has to act -- without naming a document.
   */
  it("a source's unread documents are told apart, and its refusals unfold marked benign or not", () => {
    render(
      leaf({
        records: [],
        documents: [
          {
            source: "gmail",
            documents: 5,
            distinctBlobs: 5,
            bytes: 900,
            readable: 1,
            refused: 3,
            waiting: 1,
            reasons: [
              { reason: "image-too-small-to-read", count: 2 },
              { reason: "extractor-missing:pdftotext", count: 1 },
            ],
            latestObservedAt: new Date().toISOString(),
          },
        ],
      }),
    );

    expect(
      screen.getByText("900 B trong 5 tệp riêng biệt · đọc được 1/5 · 3 bị từ chối · 1 chưa đọc"),
    ).toBeDefined();
    // Folded, the row already says the refusals need somebody: one of them is a deployment
    // fault, and "benign" on the row would hide it behind the two signature images.
    expect(screen.queryByRole("table", { name: "Vì sao bị từ chối" })).toBeNull();
    expect(screen.getByText("Cần xử lý")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Xem lý do từ chối" }));

    const rollup = within(screen.getByRole("table", { name: "Vì sao bị từ chối" }));
    const [, benign, actionable] = rollup.getAllByRole("row");
    expect(within(benign as HTMLElement).getByText("image-too-small-to-read")).toBeDefined();
    expect(within(benign as HTMLElement).getByText("Không cần xử lý")).toBeDefined();
    expect(
      within(actionable as HTMLElement).getByText("extractor-missing:pdftotext"),
    ).toBeDefined();
    expect(within(actionable as HTMLElement).getByText("Cần xử lý")).toBeDefined();
    // Reasons and counts only: the rollup has no record to unfold, so no reason is a control.
    expect(rollup.queryAllByRole("button")).toEqual([]);
  });
});
