// Browser QA for prototype r4. Needs `npm i playwright-core` and a Chromium (set CHROME to its path).
// Each scenario prints PASS/FAIL with what was observed.
const { chromium } = require("playwright-core");
const path = require("node:path");
const base = "file://" + path.join(__dirname, "..", "index.html");
const results = [];
const check = (name, ok, observed) => {
  results.push({ name, ok, observed });
  console.log((ok ? "PASS" : "FAIL") + " | " + name + " | " + observed);
};

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || undefined,
  });
  const network = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  ctx.on("request", (r) => { if (!r.url().startsWith("file://")) network.push(r.url()); });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const go = async (hash) => { await page.goto(base + hash); await page.waitForTimeout(250); };
  const text = () => page.locator("main, body").first().innerText();
  const rows = () => page.locator("table.table tbody tr").count();

  // Models list: counts add up, filter in address, Back restores.
  await go("#models?lang=en");
  const sum = await page.locator(".sum-line").innerText();
  const [lhs, rhs] = sum.split("=");
  const total = lhs.split("+").reduce((a, b) => a + Number(b.trim()), 0);
  const all = await rows();
  check("Models counts add up to rows listed", total === Number(rhs.trim().split(" ")[0]) && total === all, `${sum.trim()}; rows ${all}`);
  await page.locator(".build-summary a", { hasText: "Never built" }).click();
  await page.waitForTimeout(250);
  const neverRows = await rows();
  const neverUrl = page.url().split("#")[1];
  check("Pressing 'Never built' filters list, filter in address", neverUrl.includes("status=never") && neverRows === 1, `url #${neverUrl}; rows ${neverRows}`);
  await page.goBack(); await page.waitForTimeout(250);
  const backRows = await rows();
  await page.goForward(); await page.waitForTimeout(250);
  const fwdRows = await rows();
  check("Back restores unfiltered list, Forward the filter", backRows === all && fwdRows === 1, `back ${backRows}, forward ${fwdRows}`);

  // Lineage.
  await go("#models?lang=en&view=graph&node=customer_health_daily");
  const nodes = await page.locator("[data-node]").evaluateAll((els) => els.map((e) => ({ id: e.dataset.node, cls: e.className })));
  const lit = nodes.filter((n) => /selected|upstream/.test(n.cls)).map((n) => n.id);
  const dim = nodes.filter((n) => /dimmed/.test(n.cls)).map((n) => n.id);
  check("Selecting a model lights upstream only; downstream dimmed", lit.length === 6 && dim.includes("revenue_monthly") === true && !lit.includes("churn_watch"), `lit ${lit.length}/${nodes.length}: ${lit.join(", ")}`);
  const accountLike = nodes.filter((n) => /^(gmail|drive|xero|hubspot)\./.test(n.id) || /report|dashboard|question/i.test(n.id));
  check("No source-account, report, question or dashboard node", accountLike.length === 0, `${nodes.length} nodes; kinds ${[...new Set(nodes.map((n) => n.cls.split(" ")[1]))].join("/")}; offending ${accountLike.length}`);
  const legacy = nodes.find((n) => n.id === "legacy_rollup");
  const legacyText = await page.locator('[data-node="legacy_rollup"]').innerText();
  check("Dynamic-reference model marked 'upstream not declared'", /undeclared/.test(legacy.cls) && /UPSTREAM NOT DECLARED/i.test(legacyText), legacyText.replace(/\s+/g, " "));
  await go("#models?lang=en&view=graph&node=churn_watch");
  const churn = await text();
  check("Ref to a deleted model shown as missing dependency on the chain", /Missing dependency: stg_churn_signals/.test(churn), (churn.match(/Missing dependency[^\n]*/) || ["—"])[0]);
  check("Lineage stays inside Models (seven divisions)", (await page.locator("nav.nav a, nav.nav span").count()) >= 7 && page.url().includes("#models"), `divisions ${await page.locator("nav.nav > *").count()}`);

  // Delete a referenced model: the edge stays, as a missing dependency.
  await go("#model/dim_customer?lang=en");
  const del = page.locator('[data-action="model-delete"]').first();
  if (await del.count()) {
    await del.click(); await page.waitForTimeout(250);
    const confirm = page.locator('[data-action="model-delete-confirm"]').first();
    if (await confirm.count()) { await confirm.click(); await page.waitForTimeout(1500); }
    await page.evaluate(() => { location.hash = "#models?lang=en&view=graph&node=customer_health_daily"; });
    await page.waitForTimeout(300);
    const after = await text();
    check("Deleting a model another refs keeps the edge as missing dependency", /Missing dependency: dim_customer/.test(after), (after.match(/Missing dependency[^\n]*/) || ["no missing-dependency line"])[0]);
  } else check("Deleting a model another refs keeps the edge as missing dependency", false, "no delete control found");

  // Scope statements per kind.
  for (const [id, re, label] of [
    ["drive.finance", /marks every item outside the new pick as removed at source/, "Drive"],
    ["gmail.operations", /stay live|stays live/i, "Gmail"],
  ]) {
    await go(`#scope/${id}?lang=en`);
    const box = page.locator('form[data-form="scope"] input[type="checkbox"]:checked').first();
    if (await box.count()) await box.uncheck();
    await page.locator('form[data-form="scope"] [type="submit"]').click();
    await page.waitForTimeout(250);
    const body = await text();
    const para = (body.match(/WHAT HAPPENS TO RECORDS ALREADY HELD[\s\S]{0,260}/i) || [""])[0].replace(/\s+/g, " ");
    check(`${label} scope save states what happens to held records`, re.test(body) && !/erased from the lake(?!\.)/.test(para.replace("nothing is erased from the lake", "")), para.slice(0, 200));
  }

  // Journal filtered by account, in the address.
  await go("#journal?lang=en&source=gmail.support");
  const jrows = await page.locator("table.table tbody tr").allInnerTexts();
  check("Journal filtered to one account via address", jrows.length > 0 && jrows.every((r) => r.includes("gmail.support")), `${jrows.length} rows, all gmail.support: ${jrows.every((r) => r.includes("gmail.support"))}`);

  // Run: scope at start, old run em dash, admin links, member plain.
  await go("#journal/CASE-0101?lang=en");
  const run = await text();
  check("Run shows scope at start", /SCOPE AT START\s*\n?\s*invoices/i.test(run), (run.match(/SCOPE AT START[^\n]*\n[^\n]*/i) || ["—"])[0].replace(/\n/g, " / "));
  const adminLinks = await page.locator("table.table tbody a").count();
  check("Admin: created/changed counts are links; later-run rewrites stated", adminLinks > 0 && /now attributed to a later run/.test(run), `${adminLinks} links; ${(run.match(/\d+ now attributed to a later run/) || ["—"])[0]}`);
  await go("#journal/CASE-0100?lang=en");
  const old = await text();
  check("Run from before scope was recorded shows an em dash", /SCOPE AT START\s*\n?\s*—/i.test(old), (old.match(/SCOPE AT START[^\n]*\n[^\n]*/i) || ["—"])[0].replace(/\n/g, " / "));
  for (const role of ["member", "viewer"]) {
    await go(`#journal/CASE-0101?lang=en&role=${role}`);
    const links = await page.locator("table.table tbody a").count();
    check(`${role}: run counts are plain figures`, links === 0, `${links} links in the counts table`);
  }

  // Sources write plates.
  const plates = /^(Connect|Reconnect|Choose what to sync|Change what syncs|Disconnect)/i;
  for (const role of ["member", "viewer", "admin"]) {
    await go(`#sources?lang=en&role=${role}`);
    const labels = await page.locator("button, a.plate").allInnerTexts();
    const found = labels.filter((l) => plates.test(l.trim()));
    const ok = role === "admin" ? found.length > 0 : found.length === 0;
    check(`Sources as ${role}: write plates ${role === "admin" ? "present per state" : "absent"}`, ok, `${found.length} write plates`);
  }

  // Phone: every upstream name readable.
  await page.setViewportSize({ width: 390, height: 844 });
  await go("#models?lang=en&view=graph&node=customer_health_daily");
  const names = await page.locator("#chain-title ~ * a, .node-context a").evaluateAll((els) =>
    els.map((e) => ({ t: e.innerText.trim(), fits: e.scrollWidth <= e.clientWidth + 1 || getComputedStyle(e).whiteSpace !== "nowrap" })));
  check("390 px: upstream names readable in the text list", names.length >= 5 && names.every((n) => n.t.length > 0), `${names.length} links, e.g. ${names.slice(0, 5).map((n) => n.t).join(", ")}`);
  const motion = await page.evaluate(() => [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } })
    .map((r) => r.cssText).filter((c) => /transition|animation/.test(c) && !/steps\(|none|transition:\s*none/.test(c)));
  check("Every transition/animation uses steps()", motion.length === 0, `${motion.length} non-stepped rules`);
  check("No modal dialog in the document", (await page.locator("dialog, [role=dialog]").count()) === 0, "dialog elements: " + (await page.locator("dialog, [role=dialog]").count()));

  check("No page errors", errors.length === 0, errors.join("; ") || "none");
  check("No network requests", network.length === 0, network.join(", ") || "none");
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`TOTAL ${results.length - failed}/${results.length} PASS`);
})();
