// Plan picks, data sources, filters and the report form, in a headless Chromium on the live Artificial Analysis site.
//   node test/advanced.mjs [--base http://localhost:48766] [--shots <dir>]
// No window opens. Reports are sent with the form's trap field filled, so the server answers and stores nothing.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const ext = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), base = arg("--base"), shots = arg("--shots");
if (shots) mkdirSync(shots, { recursive: true });
const failures = [];
const check = async (name, fn) => { try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.error(`FAIL ${name}: ${e.message.split("\n").slice(0, 3).join(" ")}`); } };
const profile = mkdtempSync(path.join(tmpdir(), "aaplus-adv-"));
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1440, height: 1000 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
try {
  const worker = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  const id = new URL(worker.url()).host;
  if (base) await worker.evaluate((b) => chrome.storage.local.set({ base: b }), base);
  const page = await ctx.newPage(), errors = []; let loads = 0;
  page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (/AA Plus:/.test(m.text())) errors.push(m.text()); }); page.on("load", () => loads++);
  const bar = page.locator('[data-aaplus-bar][data-at="scope"]');
  const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
  await page.goto("https://artificialanalysis.ai/", { waitUntil: "domcontentloaded", timeout: 90000 });
  await bar.waitFor({ state: "attached", timeout: 60000 }); await page.waitForTimeout(3500);
  /** The rows AA's charts draw from, read out of AA's own store. */
  const store = () => page.evaluate(() => {
    const fiber = (el) => { for (const k in el) if (k.startsWith("__reactFiber$")) return el[k]; };
    for (const el of document.querySelectorAll("h2,h3,.recharts-wrapper")) for (let f = fiber(el), n = 0; f && n < 160; f = f.return, n++) {
      const v = f.memoizedProps?.value;
      if (v?.selectedPageModels && v.allPageModels) return v.selectedPageModels.map((r) => { const c = r.intelligenceIndexCostPerTask; return { slug: r.slug, lab: r.creator?.slug, open: r.isOpenWeights, date: r.releaseDate, cost: c == null ? null : typeof c === "number" ? c : c.total ?? null, time: r.intelligenceIndexTimePerTask ?? null }; });
    }
    return [];
  });
  const stored = (keys) => worker.evaluate((k) => chrome.storage.local.get(k), keys);
  const set = (patch) => worker.evaluate(async (p) => { const { settings } = await chrome.storage.local.get("settings"); await chrome.storage.local.set({ settings: { ...settings, ...p } }); }, patch);
  const settle = () => page.waitForTimeout(1500);
  const openPanel = async (kind) => { await page.evaluate(() => scrollTo(0, 0)); const d = bar.locator(`details[data-pop="${kind}"]`); await d.locator("summary").scrollIntoViewIfNeeded(); if (!await d.evaluate((e) => e.open)) await d.locator("summary").click(); await page.waitForTimeout(150); return d; };
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= Math.max(Math.abs(b) * 0.01, 1e-5), `${msg}: ${a} vs ${b}`);
  await page.waitForFunction(() => document.querySelector('[data-aaplus-bar][data-at="scope"] details[data-pop="advanced"]'), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const { cache, metrics } = await stored(["cache", "metrics"]);
  const bySlug = new Map(cache.data.models.flatMap((m) => m.aa.map((s) => [s, m])));
  await set({ pricing: "api" }); await settle();
  const api = await store(), apiCost = new Map(api.map((r) => [r.slug, r.cost])), start = api.map((r) => r.slug).sort();
  await set({ pricing: "plan" }); await settle();

  await check("a picked plan reprices the newest models on the chart, and the panel says which it reaches", async () => {
    const pick = api.flatMap((r) => { const m = bySlug.get(r.slug), own = m && (m.free ? m.paid : m); const e = m?.plans && Object.entries(m.plans).find(([, p]) => Math.abs(p.ratio - own.ratio) / own.ratio > 0.2); return r.cost > 0 && e ? [{ slug: r.slug, m, plan: e[0], ratio: e[1].ratio }] : []; })[0];
    assert.ok(pick, "a charted model has another plan at a different price");
    const panel = await openPanel("plans");
    assert.match(await panel.locator(".aap-pop > p").innerText(), /of \d+ models on this page have plan prices/);
    const select = panel.locator(`select[data-aaplus-lab="${pick.m.lab}"]`);
    assert.ok(await select.locator("optgroup", { hasText: "" }).count() >= 1, "plans are grouped");
    await select.selectOption(pick.plan); await settle();
    near((await store()).find((r) => r.slug === pick.slug).cost, apiCost.get(pick.slug) * pick.ratio, `${pick.slug} on ${pick.plan}`);
    assert.equal(await bar.locator('details[data-pop="plans"]').evaluate((e) => e.open), true, "the panel stays open");
    assert.ok((await bar.locator(`details[data-pop="plans"] .aap-lab-note`).count()) >= 1, "the pick explains what it covered");
    await shot("plan-picked");
    await bar.locator(`select[data-aaplus-lab="${pick.m.lab}"]`).selectOption(""); await settle();
  });

  await check("a plan with no price for any model on the page is listed apart, and says it changes nothing", async () => {
    const panel = await openPanel("plans"), lab = await panel.evaluate((d) => { for (const s of d.querySelectorAll("select[data-aaplus-lab]")) { const g = [...s.querySelectorAll("optgroup")]; if (g.length === 2) return { id: s.dataset.aaplusLab, plan: g[1].querySelector("option").value }; } return null; });
    assert.ok(lab, "a lab has both kinds of plan");
    await panel.locator(`select[data-aaplus-lab="${lab.id}"]`).selectOption(lab.plan); await settle();
    assert.match(await bar.locator('details[data-pop="plans"]').innerText(), /Changes no model on this page/);
    await bar.locator(`select[data-aaplus-lab="${lab.id}"]`).selectOption(""); await settle();
  });

  await check("Advanced is closed until asked for, and a cost source replaces the costs on AA's charts", async () => {
    await page.evaluate(() => scrollTo(0, 0));
    const source = metrics.data.sources.filter((s) => s.cost).sort((a, b) => api.filter((r) => b.cost.models[r.slug]).length - api.filter((r) => a.cost.models[r.slug]).length)[0];
    const panel = await openPanel("advanced");
    await panel.locator('select[data-aaplus-set="costSource"]').selectOption(source.id); await settle();
    const after = await store(), hit = after.find((r) => source.cost.models[r.slug] && bySlug.get(r.slug)), miss = after.find((r) => !source.cost.models[r.slug]);
    assert.ok(hit, "a charted model has the source's cost");
    const m = bySlug.get(hit.slug); near(hit.cost, source.cost.models[hit.slug] * (m.free ? m.paid?.listRatio ?? m.paid?.ratio ?? 1 : m.listRatio ?? m.ratio), "cost is the source's, at the plan share");
    if (miss) assert.equal(miss.cost, null, "a model the source did not measure has no cost");
    assert.equal(after.length, api.length, "models stay on the other charts");
    assert.match(await page.locator("h3 [data-aaplus-note] .aap-src").first().innerText(), new RegExp(`${source.name.split(" ")[0]}.*per `), "the chart names its source");
    await shot("cost-source");
    await bar.locator('select[data-aaplus-set="costSource"]').selectOption("aa"); await set({ pricing: "api" }); await settle();
    for (const r of await store()) near(r.cost ?? 0, apiCost.get(r.slug) ?? 0, `${r.slug} is back at AA's own cost`);
    await set({ pricing: "plan" }); await settle();
  });

  await check("a time source replaces the times, and going back restores them", async () => {
    const source = metrics.data.sources.filter((s) => s.time).sort((a, b) => api.filter((r) => b.time.models[r.slug]).length - api.filter((r) => a.time.models[r.slug]).length)[0];
    await set({ timeSource: source.id }); await settle();
    const after = await store(), hit = after.find((r) => source.time.models[r.slug]);
    near(hit.time, source.time.models[hit.slug], "time is the source's");
    await set({ timeSource: "aa" }); await settle();
    for (const r of await store()) near(r.time ?? 0, api.find((x) => x.slug === r.slug).time ?? 0, `${r.slug} time restored`);
  });

  await check("filters narrow every chart's models, and Reset brings the same ones back", async () => {
    const panel = await openPanel("advanced");
    await panel.locator('select[data-aaplus-set="weights"]').selectOption("open"); await settle();
    let now = await store(); assert.ok(now.length > 0 && now.length < api.length && now.every((r) => r.open === true), `open weights only (${now.length})`);
    await bar.locator('select[data-aaplus-set="weights"]').selectOption("all"); await settle();
    const lab = api.reduce((best, r, _, all) => all.filter((x) => x.lab === r.lab).length > all.filter((x) => x.lab === best).length ? r.lab : best, api[0].lab);
    await bar.locator(`input[data-aaplus-off-lab="${lab}"]`).uncheck(); await settle();
    now = await store(); assert.ok(now.length && now.every((r) => r.lab !== lab), `lab ${lab} leaves`);
    await bar.locator('select[data-aaplus-set="released"]').selectOption("3"); await settle();
    const cut = new Date(); cut.setMonth(cut.getMonth() - 3); now = await store();
    assert.ok(now.every((r) => !r.date || Date.parse(r.date) >= cut), "only recent models");
    await bar.locator('[data-aaplus-reset]').click(); await settle();
    assert.deepEqual((await store()).map((r) => r.slug).sort(), start, "Reset restores the page's models");
    await bar.locator('input[data-aaplus-check="planOnly"]').check(); await settle();
    now = await store(); assert.ok(now.every((r) => bySlug.has(r.slug)), "only models with plan prices");
    await bar.locator('[data-aaplus-reset]').click(); await settle();
    await bar.locator('[data-aaplus-labs="none"]').click(); await settle();
    assert.deepEqual((await store()).map((r) => r.slug).sort(), start, "filters that match nothing leave the charts alone");
    assert.match(await bar.locator('details[data-pop="advanced"]').innerText(), /No model on this page passes/);
    await bar.locator('[data-aaplus-reset]').click(); await settle();
    assert.deepEqual((await store()).map((r) => r.slug).sort(), start);
  });

  await check("free tiers count only when asked", async () => {
    const free = api.find((r) => bySlug.get(r.slug)?.free && r.cost > 0);
    assert.ok(free, "a charted model is free today");
    assert.ok((await store()).find((r) => r.slug === free.slug).cost > 0, "priced on its paid plan by default");
    await set({ freeTiers: true }); await settle();
    assert.equal((await store()).find((r) => r.slug === free.slug).cost, 0);
    await set({ freeTiers: false }); await settle();
  });

  await check("the toolbar popup holds the same advanced settings", async () => {
    const pop = await ctx.newPage();
    await pop.goto(`chrome-extension://${id}/popup.html`); await pop.locator("#advanced summary").click();
    await pop.locator("#weights").selectOption("closed"); await settle();
    assert.ok((await store()).every((r) => r.open === false), "the open page follows the popup");
    await pop.locator("#reset").click(); await pop.close(); await settle();
    assert.deepEqual((await store()).map((r) => r.slug).sort(), start);
  });

  await check("the report button opens a form that sends to Priors and shows what it includes", async () => {
    await page.evaluate(() => scrollTo(0, 0));
    const [form] = await Promise.all([ctx.waitForEvent("page", { timeout: 10000 }), bar.locator('button[data-aaplus-report]').first().click()]);
    await form.waitForLoadState("domcontentloaded");
    assert.match(form.url(), /report\.html$/);
    await form.getByRole("button", { name: "Send" }).click();
    assert.match(await form.locator("#error").innerText(), /Write what went wrong/);
    assert.match(await form.locator("#context").textContent(), /^AA Plus \d+\.\d+\.\d+ .*page \/.*pricing plan/);
    await form.getByRole("button", { name: "Feature request" }).click();
    await form.locator("#text").fill("Automated test of the report form");
    await form.locator("#files").setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64") });
    await form.locator("#shots span").waitFor({ timeout: 5000 });
    await form.locator("#website").evaluate((el) => { el.value = "test"; });
    const answer = form.waitForResponse((r) => r.url().endsWith("/api/feedback"), { timeout: 30000 });
    await form.getByRole("button", { name: "Send" }).click();
    assert.equal((await answer).status(), 200);
    await form.locator("#done").waitFor({ timeout: 10000 });
    assert.equal(await form.locator("#form").isVisible(), false, "the form gives way to the confirmation");
    if (shots) await form.screenshot({ path: path.join(shots, "report-sent.png") });
    await form.close();
  });

  await check("nothing reloaded and nothing threw", async () => { assert.equal(loads, 1, "page loads"); assert.ok(!errors.length, errors.join(" | ").slice(0, 900)); });
} finally { await ctx.close(); rmSync(profile, { recursive: true, force: true }); }
if (failures.length) { console.error(`${failures.length} failed`); process.exit(1); }
console.log("all checks passed");
