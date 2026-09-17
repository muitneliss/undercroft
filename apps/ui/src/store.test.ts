import { beforeEach, describe, expect, test } from "bun:test";
import { useUiStore } from "./store.ts";

// CASE-ids, never real tenant names (.claude/rules/pii.md).
const CASE_A = "CASE-0001";
const CASE_B = "CASE-0002";

describe("the UI store owns the selected tenant", () => {
  beforeEach(() => {
    useUiStore.setState({ selectedTenantId: null });
  });

  test("selecting a tenant focuses it; selecting a different one replaces the focus", () => {
    useUiStore.getState().selectTenant(CASE_A);
    expect(useUiStore.getState().selectedTenantId).toBe(CASE_A);

    useUiStore.getState().selectTenant(CASE_B);
    expect(useUiStore.getState().selectedTenantId).toBe(CASE_B);
  });

  test("selecting the already-selected tenant clears the selection", () => {
    useUiStore.getState().selectTenant(CASE_A);
    useUiStore.getState().selectTenant(CASE_A);
    expect(useUiStore.getState().selectedTenantId).toBeNull();
  });
});
