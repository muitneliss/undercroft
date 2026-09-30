// Browser QA for Customers, Reports and People in prototype r5b. Needs `npm i playwright-core`
// and a Chromium (set CHROME to its path). Each scenario prints PASS/FAIL with what was observed.
const { chromium } = require("playwright-core");
const path = require("node:path");
const base = "file://" + path.join(__dirname, "..", "index.html");
const results = [];
const check = (name, ok, observed) => {
  results.push({ name, ok, observed });
  console.log((ok ? "PASS" : "FAIL") + " | " + name + " | " + observed);
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const network = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  ctx.on("request", (r) => { if (!r.url().startsWith("file://")) network.push(r.url()); });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const go = async (hash) => { await page.goto(base + hash); await page.waitForTimeout(300); };
  const main = () => page.locator("main").innerText();
  const figure = (text, label) => (text.match(new RegExp(label + "\\s*\\n+\\s*([0-9,.]+)", "i")) || [])[1];

  // Reports: totals, filter in the address, Back/Forward.
  await go("#dashboard/d-performance?lang=en");
  let text = await main();
  check("Revenue dashboard, all segments", figure(text, "REVENUE IN SELECTED RANGE") === "654,302.25" && figure(text, "LAST MONTH IN RANGE") === "128,600.50",
    `range ${figure(text, "REVENUE IN SELECTED RANGE")}, last month ${figure(text, "LAST MONTH IN RANGE")}`);
  await page.selectOption('form[data-form="ws-report-filter"] select[name="segment"]', "services");
  await page.locator('form[data-form="ws-report-filter"] [type="submit"]').click();
  await page.waitForTimeout(300);
  text = await main();
  const url = page.url().split("#")[1];
  check("Services filter narrows totals and lives in the address", figure(text, "REVENUE IN SELECTED RANGE") === "399,501.75" && /segment=services/.test(url),
    `range ${figure(text, "REVENUE IN SELECTED RANGE")}, last month ${figure(text, "LAST MONTH IN RANGE")}; #${url}`);
  await page.goBack(); await page.waitForTimeout(300);
  const back = figure(await main(), "REVENUE IN SELECTED RANGE");
  await page.goForward(); await page.waitForTimeout(300);
  const fwd = figure(await main(), "REVENUE IN SELECTED RANGE");
  check("Back restores all segments, Forward the Services filter", back === "654,302.25" && fwd === "399,501.75", `back ${back}, forward ${fwd}`);

  // Case books stay separate.
  await go("#reports?lang=en&tenant=CASE-0067");
  const atlasReports = await main();
  await go("#models?lang=en&view=graph&tenant=CASE-0067");
  const atlasNodes = await page.locator("[data-node]").count();
  await go("#sources?lang=en&tenant=CASE-0067");
  const atlasSources = await main();
  check("Atlas Example book shows none of Demo Co.'s reports, models or sources",
    !/Business performance|Nhịp kinh doanh/.test(atlasReports) && atlasNodes === 0 && !/xero\.demo|gmail\.operations/.test(atlasSources),
    `Demo report titles present: ${/Business performance/.test(atlasReports)}; lineage nodes ${atlasNodes}; Demo sources present: ${/xero\.demo/.test(atlasSources)}`);

  // Lineage never shows product nodes, in any book.
  await go("#models?lang=en&view=graph");
  const ids = await page.locator("[data-node]").evaluateAll((els) => els.map((e) => e.dataset.node));
  check("No product or report node in lineage", ids.length > 0 && !ids.some((id) => /^product\.|report|dashboard/i.test(id)), `${ids.length} nodes, product-like ${ids.filter((id) => /^product\./.test(id)).length}`);

  // People: last administrator shown, not offered a lower role or removal (issue: People and Customers).
  await go("#people?lang=en");
  const rosterText = await main();
  await go("#people/p-operator?lang=en");
  text = await main();
  const roleSelects = await page.locator('form[data-form="ws-role-save"] select[name="role"]').count();
  const reviewSteps = await page.locator("button, a, [type=submit]").evaluateAll((els) => els.filter((e) => /review role change/i.test(e.innerText || e.value || "")).length);
  const removeCtl = await page.locator("button, a").evaluateAll((els) => els.filter((e) => /^remove/i.test(e.innerText.trim())).length);
  check("Last administrator is shown and offered neither a lower role nor Remove", /last administrator/i.test(rosterText) && /last administrator/i.test(text) && roleSelects === 0 && removeCtl === 0 && reviewSteps === 0,
    `roster label ${/last administrator/i.test(rosterText)}; page label ${/last administrator/i.test(text)}; role selects ${roleSelects}; remove controls ${removeCtl}; review steps ${reviewSteps}`);
  await go("#people/p-analyst?lang=en");
  await page.selectOption('form[data-form="ws-role-save"] select[name="role"]', "admin");
  await page.waitForTimeout(400);
  await go("#people/p-operator?lang=en");
  const operatorSelects = await page.locator('form[data-form="ws-role-save"] select[name="role"]').count();
  const operatorRemove = await page.locator("button, a").evaluateAll((els) => els.filter((e) => /^remove/i.test(e.innerText.trim())).length);
  check("With a second admin, both admin rows offer a role and Remove; choosing saves in one step", operatorSelects === 1 && operatorRemove === 1,
    `after making the analyst admin by selection: operator role selects ${operatorSelects}, remove controls ${operatorRemove}`);

  // People: withdrawing an invitation takes a second press that names the address.
  await go("#people?lang=en&view=invites");
  const firstInvite = await page.locator(".roster-row h2").first().innerText();
  const invBefore = await page.locator(".roster-row").count();
  await page.locator("button", { hasText: /^Withdraw invitation/ }).first().click();
  await page.waitForTimeout(300);
  const afterFirst = await page.locator(".roster-row").count();
  const named = await page.locator("button", { hasText: "Withdraw " + firstInvite.trim() }).count();
  await page.locator("button", { hasText: "Withdraw " + firstInvite.trim() }).first().click();
  await page.waitForTimeout(400);
  await go("#people?lang=en&view=invites");
  const afterSecond = await page.locator(".roster-row").count();
  check("Withdrawing an invitation takes a named second press", afterFirst === invBefore && named === 1 && afterSecond === invBefore - 1,
    `rows ${invBefore} → ${afterFirst} after first press → ${afterSecond} after second; second press names the address ${named === 1}`);

  // People: each role's rights stated beside the invitation form, not folded away.
  await go("#invite?lang=en");
  const rightsOpen = await page.locator(".detail-band table").count();
  check("Role rights are stated beside the invitation form", rightsOpen === 1, `${rightsOpen} rights table beside the form`);

  // Roles on Reports and People.
  await go("#reports?lang=en&role=viewer");
  const viewerCtl = await page.locator("a, button").evaluateAll((els) => els.map((e) => e.innerText.trim()).filter((s) => /^(New dashboard|New question|Edit)/i.test(s)));
  check("Viewer has no report authoring controls", viewerCtl.length === 0, `${viewerCtl.length} authoring controls`);
  await go("#reports?lang=en&role=member");
  const memberCtl = await page.locator("a, button").evaluateAll((els) => els.map((e) => e.innerText.trim()).filter((s) => /^(New dashboard|New question)/i.test(s)));
  await go("#people?lang=en&role=member");
  const memberInvite = await page.locator("a, button").evaluateAll((els) => els.map((e) => e.innerText.trim()).filter((s) => /invite/i.test(s)));
  check("Member may author reports but not invite people", memberCtl.length > 0 && memberInvite.length === 0, `authoring ${memberCtl.length}, invite controls ${memberInvite.length}`);

  // Invitation is not membership. Hash navigation keeps the in-memory fixture.
  const hash = async (h) => { await page.evaluate((v) => { location.hash = v; }, h); await page.waitForTimeout(400); };
  const tally = (s) => ({ members: (s.match(/Members · (\d+)/) || [])[1], invites: (s.match(/Open invitations · (\d+)/) || [])[1] });
  await go("#people?lang=en");
  const before = tally(await main());
  await hash("#invite?lang=en");
  await page.locator('form[data-form="ws-invite"] input[name="email"]').fill("new.person@example.test");
  await page.locator('form[data-form="ws-invite"] [type="submit"]').click();
  await page.waitForTimeout(1200);
  await hash("#people?lang=en");
  const afterText = await main();
  const after = tally(afterText);
  check("An invitation adds a pending invite, not a member",
    Number(after.invites) === Number(before.invites) + 1 && after.members === before.members,
    `members ${before.members} → ${after.members}; open invitations ${before.invites} → ${after.invites}`);

  // Customers index.
  await go("#customers?lang=en&role=viewer");
  const custText = await main();
  check("Customer index lists only permitted books", /3 accessible customers/.test(custText), (custText.match(/\d+ accessible customers/) || ["—"])[0]);

  check("No page errors", errors.length === 0, errors.join("; ") || "none");
  check("No network requests", network.length === 0, network.join(", ") || "none");
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`TOTAL ${results.length - failed}/${results.length} PASS`);
})();
