/**
 * What a granted source's row promises about its runs.
 *
 * The card used to say "Syncing on schedule" with nothing behind it. These pin the
 * replacement: a failed run is a slip the reader cannot miss, a run in progress disables the
 * one plate that would start another, and the cadence is a choice an admin makes on the row
 * and nobody else is offered.
 *
 * No mocks: the real component, the real i18next instance and the real catalogues. The
 * handlers are plain functions that record what they were given.
 */

// biome-ignore-all lint/style/useFilenamingConvention: One file named for the thing it tests, matching every other module in its directory.

import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { ConnectionCard } from "@/components/ConnectionCard.tsx";
// The side effect is the point: `useTranslation` resolves against the module-level i18next
// singleton, and without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";
import type { Cadence } from "@/lib/cadence.ts";
import { connection, lastRun } from "@/test/fixtures.ts";

afterEach(cleanup);

/** A handler that records nothing, for the props a test is not about. */
function noop(): void {
  // Nothing to record.
}

function card(
  over: Parameters<typeof connection>[1] = {},
  props: Partial<Parameters<typeof ConnectionCard>[0]> = {},
): React.JSX.Element {
  // A router, because the failed-run slip links into the journal. Memory, because no test
  // here navigates.
  return (
    <MemoryRouter>
      <ConnectionCard
        tenantId="CASE-0042"
        connection={connection("hubspot", { status: "connected", ...over })}
        onConnect={noop}
        onScope={noop}
        onDisconnect={noop}
        onRun={noop}
        onCadence={noop}
        {...props}
      />
    </MemoryRouter>
  );
}

describe("the last run", () => {
  it("a failed run tips in a slip carrying the run's own reason", () => {
    render(card({ lastRun: lastRun({ status: "failed", error: "HubSpot answered 401 after 0" }) }));

    expect(screen.getByText("Lần chạy gần nhất thất bại")).toBeDefined();
    expect(screen.getByText("HubSpot answered 401 after 0")).toBeDefined();
    // And a way into the ledger, at this run: the slip names the fault, the journal holds
    // what was refused and why.
    expect(screen.getByRole("link", { name: "Xem trong nhật ký" }).getAttribute("href")).toBe(
      "/tenants/CASE-0042/journal/run-1",
    );
  });

  it("a run that succeeded tips in no slip and says how much it saw", () => {
    // The quiet side. A slip on every row would be a slip on none.
    render(card({ lastRun: lastRun({ seen: 1234 }) }));

    expect(screen.queryByText("Lần chạy gần nhất thất bại")).toBeNull();
    expect(screen.getByText("Thành công")).toBeDefined();
    expect(screen.getByText("1.234 bản ghi")).toBeDefined();
  });

  it("a source that has never run says so rather than showing a dash", () => {
    render(card({ lastRun: null }));

    expect(screen.getByText("Chưa chạy")).toBeDefined();
  });
});

describe("Run now", () => {
  it("is offered to an admin and starts a run", () => {
    const started: string[] = [];
    render(card({}, { canRun: true, onRun: () => started.push("hubspot") }));

    fireEvent.click(screen.getByRole("button", { name: "Chạy ngay" }));

    expect(started).toEqual(["hubspot"]);
  });

  it("is disabled while a run is in progress, and says so", () => {
    render(card({ lastRun: lastRun({ status: "running", endedAt: null }) }, { canRun: true }));

    const plate = screen.getByRole("button", { name: "Đang chạy…" });
    expect(plate.hasAttribute("disabled")).toBe(true);
  });

  it("is not offered to a reader who may not start one", () => {
    render(card({}, { canRun: false }));

    expect(screen.queryByRole("button", { name: "Chạy ngay" })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("how a source is connected", () => {
  it("HubSpot offers a token to paste, in the row, where Gmail offers its consent screen", () => {
    // HubSpot has no consent to run; sending the browser to a screen that does not exist
    // was a button that failed. Gmail must still go to Google's.
    render(
      <MemoryRouter>
        <ConnectionCard
          tenantId="CASE-0042"
          connection={connection("hubspot")}
          onConnect={noop}
          onScope={noop}
          onDisconnect={noop}
          onRun={noop}
          onCadence={noop}
          tokenForm={<input aria-label="the token form" />}
        />
        <ConnectionCard
          tenantId="CASE-0042"
          connection={connection("gmail")}
          onConnect={noop}
          onScope={noop}
          onDisconnect={noop}
          onRun={noop}
          onCadence={noop}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Dán mã ứng dụng riêng")).toBeDefined();
    expect(screen.getByLabelText("the token form")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Kết nối HubSpot" })).toBeNull();
    expect(screen.getByRole("button", { name: "Kết nối Gmail" })).toBeDefined();
  });
});

describe("the cadence", () => {
  it("offers an admin the four presets with the stored one selected, and saves on change", () => {
    const chosen: Cadence[] = [];
    render(
      card(
        { cadence: "daily" },
        {
          canRun: true,
          onCadence: (c: Cadence): void => {
            chosen.push(c);
          },
        },
      ),
    );

    const select = screen.getByRole<HTMLSelectElement>("combobox", { name: "Tần suất đồng bộ" });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Mỗi giờ",
      "Mỗi 6 giờ",
      "Hằng ngày",
      "Tạm dừng",
    ]);
    expect(select.value).toBe("daily");

    fireEvent.change(select, { target: { value: "hourly" } });

    expect(chosen).toEqual(["hourly"]);
  });

  it("a viewer reads the cadence as a word", () => {
    render(card({ cadence: "every_6h" }, { canRun: false }));

    expect(screen.getByText("Mỗi 6 giờ")).toBeDefined();
  });
});
