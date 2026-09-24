/**
 * What the file-type list promises about ticking everything at once.
 *
 * Empty means every type, including one nobody has heard of yet; every curated type ticked is
 * a CLOSED list that reads those and nothing else. These pin the two things an admin could be
 * misled by: Select all silently dropping a type they typed in, and the full list being worded
 * like the empty one.
 *
 * No mocks: the real component, the real store and the real catalogues. `mount` hands the
 * component the draft the store holds, again on every change, the way `ScopePicker` does -- so
 * a tick is only visible if the store actually recorded it.
 */

import { afterEach, describe, expect, test as it } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { FileTypeChoice } from "@/components/FileTypeChoice.tsx";
// The side effect is the point: `useTranslation` resolves against the module-level i18next
// singleton, and without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";
import { CURATED_FILE_TYPES } from "@/lib/fileTypes.ts";
import { useUiStore } from "@/store.ts";

const SOURCE = "gmail";
/** A type the curated list does not carry, so it can only arrive by being typed. */
const CUSTOM = "image/tiff";

/** What `mount` subscribed to the store, stopped after each test. */
const subscriptions: (() => void)[] = [];

afterEach(() => {
  for (const stop of subscriptions.splice(0)) {
    stop();
  }
  cleanup();
  // The store is the real module-level one, so a draft left behind would be the next test's.
  useUiStore.setState({ scopeDraft: null, fileTypeInput: { source: "", value: "" } });
});

/** The picker as `ScopePicker` renders it: handed the draft the store holds for this source. */
function picker(): React.JSX.Element {
  const draft = useUiStore.getState().scopeDraft;
  return (
    <FileTypeChoice source={SOURCE} fileTypes={draft?.source === SOURCE ? draft.fileTypes : []} />
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

function selectAll(): void {
  fireEvent.click(screen.getByRole("button", { name: "Chọn tất cả" }));
}

describe("select all file types", () => {
  it("ticks every curated type and keeps a type the admin typed in", () => {
    mount();
    fireEvent.change(screen.getByRole("textbox", { name: "Thêm loại tệp khác" }), {
      target: { value: CUSTOM },
    });
    fireEvent.click(screen.getByRole("button", { name: "Thêm" }));

    selectAll();

    const boxes = screen.getAllByRole<HTMLInputElement>("checkbox");
    expect(boxes).toHaveLength(CURATED_FILE_TYPES.length + 1);
    expect(boxes.every((box) => box.checked)).toBe(true);
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: CUSTOM }).checked).toBe(true);
  });

  it("then offers only Clear all, and says the full list apart from the empty one", () => {
    mount();
    const empty = screen.getByRole("status").textContent;

    selectAll();

    expect(screen.queryByRole("button", { name: "Chọn tất cả" })).toBeNull();
    expect(screen.getByRole("button", { name: "Bỏ chọn tất cả" })).toBeDefined();
    expect(empty).toBe("Mọi loại tệp");
    expect(screen.getByRole("status").textContent).toBe(
      "Chỉ các loại tệp trong danh sách. Loại tệp khác sẽ không được đọc.",
    );
  });
});
