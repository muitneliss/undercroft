/**
 * What the tests form promises an author who cannot see it: the column box offers the last
 * build's columns, and every tick and every Remove says which row it belongs to.
 *
 * Both fail silently. The box's `list` named an id no datalist carried, so the suggestions its
 * own hint promises never appeared, and nothing on screen said they were missing. And with two
 * columns under test, a screen reader's list of controls was "Không rỗng, Duy nhất, Bỏ" twice
 * over, with nothing to say which column a press would change.
 *
 * No mocks: the real component, store and catalogues; the draft is synthetic.
 */

import { afterEach, expect, test as it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";

// The side effect is the point: without it every key renders as itself. See `@/i18n`.
import "@/i18n/index.ts";
import { TestsForm } from "@/components/ModelPanels.tsx";
import type { ModelDraft } from "@/lib/modelDraft.ts";

afterEach(cleanup);

const TESTS = { deal_id: ["not_null", "unique"], stage: ["not_null"] } as const;
const DRAFT: ModelDraft = {
  tenantId: "CASE-0042",
  name: "stg_deals",
  sql: "select 1 as deal_id",
  tests: TESTS,
  saved: { sql: "select 1 as deal_id", tests: TESTS },
  stored: { columns: { deal_id: ["not_null", "unique"], stage: ["not_null"] } },
};

it("offers the last build's columns as suggestions for the column to test", () => {
  render(<TestsForm draft={DRAFT} columns={["deal_id", "amount"]} canEdit={true} />);

  const box = screen.getByRole("combobox", { name: "Thêm cột" });
  const list = document.querySelector(`datalist[id="${box.getAttribute("list") ?? ""}"]`);
  const offered = [...(list?.querySelectorAll("option") ?? [])].map((option) => option.value);
  expect(offered).toEqual(["deal_id", "amount"]);
});

it("names every tick and every Remove by the column on its row", () => {
  render(<TestsForm draft={DRAFT} columns={[]} canEdit={true} />);

  const stageUnique = screen.getByRole("checkbox", { name: "Duy nhất: cột stage" });
  const dealUnique = screen.getByRole("checkbox", { name: "Duy nhất: cột deal_id" });
  expect((stageUnique as HTMLInputElement).checked).toBe(false);
  expect((dealUnique as HTMLInputElement).checked).toBe(true);
  expect(screen.getByRole("button", { name: "Bỏ cột stage" })).toBeDefined();
  expect(screen.getByRole("button", { name: "Bỏ cột deal_id" })).toBeDefined();
});
