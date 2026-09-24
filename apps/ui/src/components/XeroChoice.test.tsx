/**
 * What Xero's "kinds of data" list promises: both one-step controls, and that they work.
 *
 * It had neither until #175. Empty reads every kind the spec declares, including one it gains
 * later; every kind ticked reads the listed ones only -- so the two are worded apart and each
 * is reachable in one step.
 *
 * No mocks: the real component, the real store and the real catalogues. `mount` hands the
 * component the draft the store holds, again on every change, the way `ScopePicker` does.
 */

import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { XeroChoice } from "@/components/XeroChoice.tsx";
// The side effect is the point: `useTranslation` resolves against the module-level i18next
// singleton, and without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";
import { useUiStore } from "@/store.ts";

const SOURCE = "xero";
const ORGANISATION = { id: "org-1", name: "Example Trading" };

/** What `mount` subscribed to the store, stopped after each test. */
const subscriptions: (() => void)[] = [];

afterEach(() => {
  for (const stop of subscriptions.splice(0)) {
    stop();
  }
  cleanup();
  // The store is the real module-level one, so a draft left behind would be the next test's.
  useUiStore.setState({ scopeDraft: null });
});

/** The picker as `ScopePicker` renders it: handed the draft the store holds for this source. */
function picker(): React.JSX.Element {
  const draft = useUiStore.getState().scopeDraft;
  return (
    <XeroChoice
      source={SOURCE}
      organisations={[ORGANISATION]}
      organisation={ORGANISATION}
      entities={draft?.source === SOURCE ? draft.entities : []}
    />
  );
}

/** Mount it, and hand it the draft again on every store change, as `ScopePicker`'s hook would. */
function mount(): void {
  const view = render(picker());
  subscriptions.push(
    useUiStore.subscribe(() => {
      view.rerender(picker());
    }),
  );
}

function ticked(): boolean[] {
  return screen.getAllByRole<HTMLInputElement>("checkbox").map((box) => box.checked);
}

describe("kinds of data", () => {
  it("select all ticks every kind, and clear all returns to none", () => {
    mount();
    expect(screen.queryByRole("button", { name: "Bỏ chọn tất cả" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Chọn tất cả" }));

    expect(ticked()).toEqual([true, true, true, true]);
    expect(screen.queryByRole("button", { name: "Chọn tất cả" })).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(
      "Chỉ các loại dữ liệu trong danh sách: Liên hệ, Hóa đơn, Thanh toán, Giấy báo có. Loại dữ liệu được bổ sung sau này sẽ không được đọc cho đến khi được chọn.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Bỏ chọn tất cả" }));

    expect(ticked()).toEqual([false, false, false, false]);
    expect(screen.getByRole("status").textContent).toBe(
      "Mọi loại dữ liệu: liên hệ, hóa đơn, thanh toán, giấy báo có",
    );
  });
});
