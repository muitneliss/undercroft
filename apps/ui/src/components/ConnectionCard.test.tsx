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

import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { ConnectionCard } from "@/components/ConnectionCard.tsx";
// The side effect is the point: `useTranslation` resolves against the module-level i18next
// singleton, and without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";
import type { CadenceChoice } from "@/lib/cadence.ts";
import { useUiStore } from "@/store.ts";
import { connection, lastRun } from "@/test/fixtures.ts";

afterEach(() => {
  cleanup();
  // The store is the real module-level one, so a cron draft left behind would be the next
  // test's.
  useUiStore.setState({ cronDraft: null });
});

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
        onResync={noop}
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

  it("is offered on a grant short of a permission, beside what it skips and the reconnect", () => {
    // Every Xero connection made before ADR 0073 still reads twelve lists. Its card read
    // "lapsed" and offered no run, although the schedule kept reading them.
    render(
      <MemoryRouter>
        <ConnectionCard
          tenantId="CASE-0042"
          connection={connection("xero", {
            status: "connected",
            ungranted: [{ entity: "tax_rates", scope: "accounting.settings.read" }],
          })}
          onConnect={noop}
          onScope={noop}
          onDisconnect={noop}
          onRun={noop}
          onCadence={noop}
          onResync={noop}
          canRun={true}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Chạy ngay" })).toBeDefined();
    expect(screen.getByRole("button", { name: /Kết nối lại Xero/u })).toBeDefined();
    expect(
      screen.getByText("Chưa được cấp quyền accounting.settings.read, nên chưa đọc Thuế suất."),
    ).toBeDefined();
    expect(screen.queryByText("Cần kết nối lại")).toBeNull();
  });

  it("is not offered to a reader who may not start one", () => {
    render(card({}, { canRun: false }));

    expect(screen.queryByRole("button", { name: "Chạy ngay" })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("the write plates, by who is reading", () => {
  /** Every plate a card may offer that writes: connect, reconnect, paste, choose, change, remove. */
  const WRITES =
    /^(?:Kết nối|Kết nối lại|Dán mã ứng dụng riêng|Chọn dữ liệu cần đồng bộ|Đổi dữ liệu đồng bộ|Ngắt kết nối)/u;

  /** Each state that offers a write plate, as a member or viewer would see its card. */
  function everyState(canRun: boolean): React.JSX.Element {
    const states = [
      connection("gmail", { status: "connected", lastRun: lastRun() }),
      connection("drive"),
      connection("xero", { status: "needs_scope" }),
      connection("hubspot", { status: "needs_reconnect" }),
    ];
    return (
      <MemoryRouter>
        {states.map((c) => (
          <ConnectionCard
            key={c.source}
            tenantId="CASE-0042"
            connection={c}
            onConnect={noop}
            onScope={noop}
            onDisconnect={noop}
            onRun={noop}
            onCadence={noop}
            onResync={noop}
            canRun={canRun}
          />
        ))}
      </MemoryRouter>
    );
  }

  it("are absent, not disabled, for a reader the server refuses them to", () => {
    render(everyState(false));

    expect(screen.queryAllByRole("button", { name: WRITES })).toEqual([]);
    expect(screen.queryByText("Dán mã ứng dụng riêng")).toBeNull();
  });

  it("are drawn for an admin, as each card's state allows", () => {
    render(everyState(true));

    expect(screen.getByRole("button", { name: "Đổi dữ liệu đồng bộ" })).toBeDefined();
    expect(screen.getAllByText("Ngắt kết nối…").length).toBe(3);
    expect(screen.getByRole("button", { name: /Kết nối Google Drive/u })).toBeDefined();
    expect(screen.getByRole("button", { name: /Chọn dữ liệu cần đồng bộ/u })).toBeDefined();
  });

  it("leave every reader the door to the account's own runs", () => {
    render(everyState(false));

    // One account, not its kind: the journal opened here lists this source's runs alone.
    expect(screen.getByRole("link", { name: /Các lần chạy/u }).getAttribute("href")).toBe(
      "/tenants/CASE-0042/journal?source=gmail",
    );
  });
});

describe("Disconnect", () => {
  // It ends a grant a customer made, so it asks first and names what it ends -- as Remove on
  // the roster does. Both sides: the first press must not act, and the second must.
  function adminCard(ended: string[]): void {
    render(
      card(
        { externalAccountLabel: "ops@acme.test" },
        {
          canRun: true,
          onDisconnect: (): void => {
            ended.push("hubspot");
          },
        },
      ),
    );
  }

  it("the first press opens the fold and disconnects nothing", () => {
    const ended: string[] = [];
    adminCard(ended);

    fireEvent.click(screen.getByText("Ngắt kết nối…"));

    expect(ended).toEqual([]);
    expect(screen.getByText("Các bản ghi đã vào kho thô vẫn được giữ nguyên.")).toBeDefined();
  });

  it("the second press names the account and disconnects it", () => {
    const ended: string[] = [];
    adminCard(ended);

    fireEvent.click(screen.getByText("Ngắt kết nối…"));
    fireEvent.click(screen.getByRole("button", { name: "Ngắt kết nối ops@acme.test" }));

    expect(ended).toEqual(["hubspot"]);
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
          onResync={noop}
          canRun={true}
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
          onResync={noop}
          canRun={true}
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
  /** An admin's card that records every choice it sends. */
  function adminCard(over: Parameters<typeof connection>[1] = {}): CadenceChoice[] {
    const chosen: CadenceChoice[] = [];
    render(
      card(over, {
        canRun: true,
        onCadence: (choice: CadenceChoice): void => {
          chosen.push(choice);
        },
      }),
    );
    return chosen;
  }

  function select(): HTMLSelectElement {
    return screen.getByRole<HTMLSelectElement>("combobox", { name: "Tần suất đồng bộ" });
  }

  it("offers an admin the presets and custom, with the stored one selected; a preset saves on change", () => {
    const chosen = adminCard({ cadence: "daily" });

    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Mỗi giờ",
      "Mỗi 6 giờ",
      "Hằng ngày",
      "Tạm dừng",
      "Tuỳ chỉnh (cron)",
    ]);
    expect(select().value).toBe("daily");

    fireEvent.change(select(), { target: { value: "hourly" } });

    expect(chosen).toEqual([{ cadence: "hourly" }]);
  });

  it("custom saves nothing on selection: it opens the expression, previews its fires and saves on Save", () => {
    const chosen = adminCard({ cadence: "daily" });

    fireEvent.change(select(), { target: { value: "custom" } });
    expect(chosen).toEqual([]);
    expect(select().value).toBe("custom");

    fireEvent.change(screen.getByLabelText("Biểu thức cron"), {
      target: { value: "30 7 * * 1-5" },
    });

    // The confirmation is the fires themselves, in Singapore time -- three of them.
    expect(screen.getByText("Ba lần chạy kế tiếp (giờ Singapore)")).toBeDefined();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Lưu lịch" }));

    expect(chosen).toEqual([{ cadence: "custom", cron: "30 7 * * 1-5" }]);
  });

  it("an expression the scheduler cannot keep says why, and Save stays off", () => {
    adminCard({ cadence: "daily" });
    fireEvent.change(select(), { target: { value: "custom" } });

    fireEvent.change(screen.getByLabelText("Biểu thức cron"), {
      target: { value: "* * * * *" },
    });

    expect(
      screen.getByText(
        "Biểu thức này chạy dày hơn 5 phút một lần, nhanh hơn nhịp của bộ lập lịch.",
      ),
    ).toBeDefined();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Lưu lịch" }).hasAttribute("disabled")).toBe(true);
  });

  it("a stored custom schedule opens holding its expression, with nothing yet to save", () => {
    adminCard({ cadence: "custom", cron: "0 9 * * *" });

    expect(select().value).toBe("custom");
    expect(screen.getByLabelText<HTMLInputElement>("Biểu thức cron").value).toBe("0 9 * * *");
    expect(screen.getByRole("button", { name: "Lưu lịch" }).hasAttribute("disabled")).toBe(true);
  });

  it("a viewer reads the cadence as a word, and a custom one with its expression", () => {
    render(card({ cadence: "every_6h" }, { canRun: false }));
    expect(screen.getByText("Mỗi 6 giờ")).toBeDefined();
    cleanup();

    render(card({ cadence: "custom", cron: "30 7 * * 1-5" }, { canRun: false }));
    expect(screen.getByText("Tuỳ chỉnh (cron)")).toBeDefined();
    expect(screen.getByText("30 7 * * 1-5")).toBeDefined();
    expect(screen.queryByLabelText("Biểu thức cron")).toBeNull();
  });
});

describe("the full re-sync", () => {
  // ADR 0082: a second schedule, off until an admin opts in, for the edits a source's change
  // filter never reports; the card says when a re-sync needs more than a day of requests.
  const OFF = {
    cadence: "paused",
    cron: null,
    lastWholeReadAt: null,
    days: null,
    budget: 4000,
  } as const;

  function resyncSelect(): HTMLSelectElement {
    return screen.getByRole<HTMLSelectElement>("combobox", { name: "Tần suất đọc lại toàn bộ" });
  }

  it("is off until an admin turns it on, and a choice saves as the re-sync, not the cadence", () => {
    const resyncs: CadenceChoice[] = [];
    const cadences: CadenceChoice[] = [];
    render(
      card(
        { resync: OFF },
        {
          canRun: true,
          onCadence: (choice: CadenceChoice): void => {
            cadences.push(choice);
          },
          onResync: (choice: CadenceChoice): void => {
            resyncs.push(choice);
          },
        },
      ),
    );

    expect(resyncSelect().value).toBe("paused");
    expect(resyncSelect().selectedOptions[0]?.textContent).toBe("Tắt");

    fireEvent.change(resyncSelect(), { target: { value: "daily" } });

    expect(resyncs).toEqual([{ cadence: "daily" }]);
    expect(cadences).toEqual([]);
  });

  it("warns when one re-sync takes more than a day of the provider's requests", () => {
    render(card({ resync: { ...OFF, cadence: "daily", days: 2 } }, { canRun: true }));

    expect(screen.getByText(/Một lần đọc lại toàn bộ cần khoảng 2 ngày/u)).toBeDefined();
  });

  it("is not offered for a source with nothing to re-sync", () => {
    render(card({ resync: null }, { canRun: true }));

    expect(screen.queryByRole("combobox", { name: "Tần suất đọc lại toàn bộ" })).toBeNull();
  });
});
