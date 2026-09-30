const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("../assets/workspace-domain.js");

test("money totals are exact beyond the safe integer boundary", () => {
  assert.equal(W.sum(["9007199254740993.0001", "0.0002"]), "9007199254740993.0003");
  assert.equal(W.sum(["0.1000", "0.2000"]), "0.3000");
  assert.equal(W.money("9007199254740993.1250"), "9,007,199,254,740,993.12");
});
test("missing values and empty sets do not become zero", () => {
  assert.equal(W.sum([]), null);
  assert.equal(W.sum(["12.0000", null]), null);
  assert.equal(W.money(null), "—");
  assert.equal(W.sum(["bad"]), null);
  assert.equal(W.position(null, "10.0000", 100), null);
});
test("filters affect the same rows used by chart and ledger", () => {
  const rows = W.filteredRevenue(W.seed().revenue, { period_from: "2026-09-01", period_to: "2026-09-30", segment: "services" });
  assert.equal(rows.length, 1);
  assert.equal(W.sum(rows.map((r) => r.revenue)), "78000.5000");
  assert.deepEqual(W.group(rows, "period", "revenue"), [{ label: "2026-09", value: "78000.5000", incomplete: false }]);
  assert.equal(W.filteredRevenue(W.seed().revenue, { period_from: "2027-01-01" }).length, 0);
});
test("an incomplete aging bucket is not a deceptively complete subtotal", () => {
  const current = W.group(W.seed().invoices, "age", "amount").find((r) => r.label === "current");
  assert.equal(current.value, null);
  assert.equal(current.incomplete, true);
});
test("last administrator refusal fires and stays quiet after a second is added", () => {
  const people = W.seed().people;
  assert.equal(W.permittedMembershipChange(people, "operator@example.test", "member"), "last-admin");
  assert.equal(W.permittedMembershipChange(people, "operator@example.test", null), "last-admin");
  assert.equal(W.permittedMembershipChange(people, "operator@example.test", "admin"), null);
  people[1].role = "admin";
  assert.equal(W.permittedMembershipChange(people, "operator@example.test", "viewer"), null);
});
test("members author reports; viewers cannot author", () => {
  assert.equal(W.own("member"), true);
  assert.equal(W.own("admin"), true);
  assert.equal(W.own("viewer"), false);
  assert.equal(W.own("bogus"), false);
});
test("CSV retains exact digits, preserves null and escapes formula-looking labels", () => {
  assert.equal(W.safeCsv([["=SUM(A1)", null, "9007199254740993.0010", "a,b"]]), '"\'=SUM(A1)","","9007199254740993.0010","a,b"');
});
test("customer search folds Vietnamese diacritics", () => {
  assert.equal(W.normalize("Đối Tác"), "doi tac");
});
test("report fixture references resolve and tenant books can be cloned separately", () => {
  const seed = W.seed();
  for (const dashboard of seed.dashboards) for (const id of dashboard.tiles) assert.ok(seed.questions.some((q) => q.id === id));
  const first = W.clone(seed.people), second = W.clone(seed.people);
  first[0].role = "viewer";
  assert.equal(second[0].role, "admin");
});
