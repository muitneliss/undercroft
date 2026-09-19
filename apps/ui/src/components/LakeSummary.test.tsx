/**
 * What the printed lake promises: a customer with nothing landed is told when the first
 * run comes rather than shown empty tables, and a customer with rows sees each stream's
 * count in the reader's grouping and each source's bytes in a unit a person reads.
 *
 * No mocks: the real component, the real i18next instance, the real catalogues.
 */

// biome-ignore-all lint/style/useFilenamingConvention: One file named for the thing it tests, matching every other module in its directory.
// biome-ignore-all lint/style/noMagicNumbers: What is left after the domain constants were named (see the WCAG block in acetate.ts) is structural: string slice offsets, the radix argument to parseInt, padStart widths, rounding factors. A name like SLICE_START_OF_GREEN_CHANNEL does not tell a reader anything the expression did not. The rule has no allow-list option, so it is per file or not at all.

import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { LakeSummary as Summary } from "@/api/types.ts";
import { LakeSummary } from "@/components/LakeSummary.tsx";
// The side effect is the point: `useTranslation` resolves against the module-level i18next
// singleton, and without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";

const NO_SCHEDULE = /Chưa có nguồn nào sẵn sàng/u;

afterEach(() => {
  cleanup();
});

function leaf(summary: Summary): React.JSX.Element {
  return (
    <MemoryRouter>
      <LakeSummary
        tenantId="CASE-0042"
        summary={summary}
        connections={[{ nextRunAt: null }]}
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

  it("rows landed: each stream's count grouped the way the reader groups, bytes in a unit", () => {
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
          {
            source: "gmail",
            documents: 2,
            bytes: 3500,
            latestObservedAt: new Date().toISOString(),
          },
        ],
      }),
    );

    expect(screen.getByText("HubSpot")).toBeDefined();
    expect(screen.getByText("1.234")).toBeDefined();
    expect(screen.getByText("12")).toBeDefined();
    expect(screen.getByText("3.5 kB")).toBeDefined();
    expect(screen.queryByText("Chưa có gì về")).toBeNull();
  });
});
