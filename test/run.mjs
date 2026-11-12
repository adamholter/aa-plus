// Loads the unpacked extension in a headless Chromium and checks it on the live Artificial Analysis site.
//   node test/run.mjs [--base http://localhost:48766] [--shots <dir>]
// No window opens. The profile is a throwaway directory, never a real Chrome profile.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLAYWRIGHT = process.env.PLAYWRIGHT ?? "playwright";
const { chromium } = await import(PLAYWRIGHT);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const ext = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), base = arg("--base"), shots = arg("--shots");
if (shots) mkdirSync(shots, { recursive: true });
const failures = [];
const check = async (name, fn) => { try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.error(`FAIL ${name}: ${e.message}`); } };

await check("the page-side copy of the shared code matches the original", async () => {
  // Chrome injects one file into one world only, so the page-side script loads a copy. `cp shared.js shared.page.js` after editing.
  assert.equal(readFileSync(path.join(ext, "shared.page.js"), "utf8"), readFileSync(path.join(ext, "shared.js"), "utf8"));
});

await check("nothing about models, plans or benchmarks is written into the extension", async () => {
  // All of it is fetched from Priors (background.js) or read from the page; a name in the source would be a frozen copy.
  for (const file of readdirSync(ext).filter((f) => /\.(js|html)$/.test(f))) {
    const hit = readFileSync(path.join(ext, file), "utf8").match(/claude|gpt-\d|gemini|grok|opus|sonnet|briefcase|omniscience|frontiercode|chatgpt plus|claude pro/i);
    assert.equal(hit, null, `${file} names "${hit?.[0]}"`);
  }
});

const profile = mkdtempSync(path.join(tmpdir(), "aaplus-test-"));
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1440, height: 1000 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
try {
  const worker = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  const id = new URL(worker.url()).host;
  if (base) await worker.evaluate((b) => chrome.storage.local.set({ base: b }), base);
  const fetched = new Set();
  worker.on("request", (r) => { if (/\/api\/(plan-prices|aa-strengths)$/.test(r.url())) fetched.add(new URL(r.url()).pathname); });
  ctx.on("request", (r) => { if (/\/api\/(plan-prices|aa-strengths)$/.test(r.url())) fetched.add(new URL(r.url()).pathname); });
  const page = await ctx.newPage();
  const errors = [];
  let loads = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (/AA Plus:/.test(m.text())) errors.push(m.text()); });
  page.on("load", () => loads++);
  const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
  const head = page.locator('[data-aaplus-bar][data-at="head"]'), scopeBar = page.locator('[data-aaplus-bar][data-at="scope"]');
  /** A headline card as AA Plus draws it: its bars left to right, each with the model's label and the value shown. */
  const card = (title) => page.evaluate((t) => {
    const c = [...document.querySelectorAll("h3")].find((h) => h.textContent.trim().startsWith(t) && !h.closest("[data-aaplus-scope]"))?.closest(".rounded-lg");
    return [...(c?.querySelectorAll("[data-aaplus-plot] svg > g:last-child > g") ?? [])].map((g) => ({ x: Number(/translate\(([\d.-]+)/.exec(g.getAttribute("transform"))[1]), value: g.querySelector('text[text-anchor="middle"]').textContent, name: [...g.querySelectorAll("tspan")].map((s) => s.textContent).join(" ") })).sort((a, b) => a.x - b.x);
  }, title);
  const dollars = (bars) => bars.map((b) => Number(b.value.replace(/[$,]/g, "")));
  /** Every AA chart under its model store whose title carries the pricing switch, with the dollar figures it draws. */
  const switched = async () => {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < Math.min(height, 20000); y += 700) { await page.evaluate((to) => window.scrollTo(0, to), y); await page.waitForTimeout(250); }
    await page.waitForTimeout(1200);
    const out = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-aaplus-scope] h3")].filter((h) => h.querySelector("[data-aaplus-note]")).map((h, i) => {
      let box = h.parentElement;
      while (box.parentElement && !box.querySelector(".recharts-surface")) box = box.parentElement;
      return [`${i} ${[...h.childNodes].filter((n) => n.nodeType === 3 || !n.hasAttribute?.("data-aaplus-ui")).map((n) => n.textContent).join("").trim()}`, [...box.querySelectorAll("svg text")].map((t) => t.textContent.trim()).filter((t) => /^\$[\d.,]+[kKmM]?$/.test(t)).join(" ")];
    })));
    await page.evaluate(() => window.scrollTo(0, 0));
    return out;
  };
  const models = async () => Number((await page.locator("text=/^\\d+ of \\d+ models$/").first().innerText()).split(" ")[0]);

  await page.goto("https://artificialanalysis.ai/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await head.waitFor({ timeout: 45000 });
  await page.waitForTimeout(2500);

  let plan;
  await check("the controls sit inline where AA's effort switch was, and the cost card opens on subscription pricing", async () => {
    assert.equal(await page.locator('[role="group"][aria-label="Effort level"]').isVisible(), false, "AA's own Max | API Default switch is replaced");
    const text = (await head.innerText()).replace(/\s+/g, " ");
    for (const word of ["AA Plus", "Pricing", "API", "Subscription", "Effort", "Highest", "API default", "High", "Max", "Plans"]) assert.ok(text.includes(word), `the row has "${word}": ${text}`);
    assert.deepEqual(await head.locator('[aria-pressed="true"]').allInnerTexts(), ["Subscription", "Highest"]);
    plan = await card("Cost per Task");
    assert.ok(plan.length >= 8, `the cost card is drawn (${plan.length} bars)`);
    assert.deepEqual(dollars(plan), [...dollars(plan)].sort((a, b) => a - b), "cheapest first");
    assert.equal(await page.locator("#aaplus-root").count(), 0, "no floating panel");
    await shot("home-plan");
  });

  await check("switching to API updates the cards in place, with the bars moving through the values between", async () => {
    await head.locator('[data-aaplus-pricing="api"]').click();
    await page.waitForTimeout(200);
    const mid = await card("Cost per Task");
    await page.waitForTimeout(900);
    const api = await card("Cost per Task");
    assert.ok(Math.max(...dollars(api)) > Math.max(...dollars(plan)) * 2, `API costs are well above plan costs (${Math.max(...dollars(api))} vs ${Math.max(...dollars(plan))})`);
    assert.deepEqual(dollars(api), [...dollars(api)].sort((a, b) => a - b), "still cheapest first");
    const top = Math.max(...dollars(mid));
    assert.ok(top > Math.max(...dollars(plan)) && top < Math.max(...dollars(api)), `a frame in between shows a value in between (${top})`);
    assert.equal(loads, 1, "the page was not reloaded");
    assert.deepEqual(await page.locator('h3:has-text("Cost per Task") [data-aaplus-note] [aria-pressed="true"]').first().allInnerTexts(), ["API"], "the switch on the card follows");
    await shot("home-api");
  });

  await check("an effort pick changes which configuration each headline model shows", async () => {
    const before = await card("Intelligence");
    await head.locator('[data-aaplus-effort="high"]').click();
    await page.waitForTimeout(1100);
    const high = await card("Intelligence");
    assert.ok(high.length >= 5, `bars at high effort: ${high.map((b) => b.name).join(", ")}`);
    for (const b of high) assert.ok(!/\((max|xhigh|medium|low)\)/.test(b.name), `${b.name} is not another effort`);
    assert.ok(high.some((b) => /\(high\)/.test(b.name)) && before.some((b) => /\(max\)/.test(b.name)), "labels name the effort shown");
    assert.deepEqual(await head.locator('[aria-pressed="true"]').allInnerTexts(), ["API", "High"]);
    await head.locator('[data-aaplus-effort="default"]').click();
    await page.waitForTimeout(1100);
    const marked = await card("Intelligence");
    assert.notDeepEqual(marked.map((b) => b.name), before.map((b) => b.name), "API default differs from highest");
    await head.locator('[data-aaplus-effort="highest"]').click();
    await page.waitForTimeout(1100);
    assert.deepEqual((await card("Intelligence")).map((b) => b.name), before.map((b) => b.name), "Highest restores AA's own set");
  });

  await check("every control in the row above the cards can be clicked, at either pricing and at narrower widths", async () => {
    // The row once wrapped onto a second line under Subscription pricing, and the line it pushed up sat under AA's sticky tabs.
    const covered = () => page.evaluate(() => {
      const bar = document.querySelector('[data-aaplus-bar][data-at="head"]'), tabs = [...document.querySelectorAll(".sticky")].find((e) => e.querySelector('[aria-current]'));
      const bad = [...bar.querySelectorAll("button, summary")].filter((b) => { const r = b.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !hit || !b.contains(hit); }).map((b) => b.textContent.trim() || b.getAttribute("aria-label"));
      return { bad, under: tabs ? bar.getBoundingClientRect().top < tabs.getBoundingClientRect().bottom - 1 : null, flow: bar.getAttribute("data-flow"), tight: bar.hasAttribute("data-tight") };
    });
    const seen = [];
    for (const pricing of ["plan", "api"]) {
      await head.locator(`[data-aaplus-pricing="${pricing}"]`).click();
      for (const width of [1440, 1280, 1024]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.waitForTimeout(700);
        const got = await covered();
        seen.push(`${pricing}@${width}:${got.flow ?? (got.tight ? "tight" : "full")}`);
        assert.deepEqual(got.bad, [], `${pricing} pricing at ${width}px: covered controls`);
        assert.equal(got.under, false, `${pricing} pricing at ${width}px: the row reaches under AA's tabs`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(700);
    const at = await head.boundingBox();
    await head.locator('[data-aaplus-pricing="plan"]').click();
    await page.waitForTimeout(700);
    assert.deepEqual(await head.boundingBox(), at, "the row keeps its place when the pricing changes");
    await head.locator('[data-aaplus-effort="medium"]').click();
    await page.waitForTimeout(900);
    assert.deepEqual(await head.locator('[aria-pressed="true"]').allInnerTexts(), ["Subscription", "Medium"], `an effort pick under Subscription pricing (${seen.join(" ")})`);
    await head.locator('[data-aaplus-effort="highest"]').click();
    await head.locator('[data-aaplus-pricing="api"]').click();
    await page.waitForTimeout(900);
  });

  let apiCharts;
  await check("AA's own charts follow: the switch beside a cost chart's title reprices it without a reload", async () => {
    apiCharts = await switched();
    assert.ok(Object.keys(apiCharts).length >= 2, `cost charts with a switch: ${Object.keys(apiCharts).join(" | ")}`);
    const first = page.locator("[data-aaplus-scope] h3:has([data-aaplus-note])").first();
    await first.scrollIntoViewIfNeeded();
    await first.locator('[data-aaplus-pricing="plan"]').click();
    await page.waitForTimeout(2500);
    const planCharts = await switched();
    const same = Object.entries(planCharts).filter(([title, figures]) => !figures || figures === apiCharts[title]).map(([title]) => title);
    for (const [title, figures] of Object.entries(planCharts)) console.log(`     ${title}: plan [${figures.slice(0, 60)}] api [${(apiCharts[title] ?? "").slice(0, 60)}]`);
    assert.deepEqual(same, [], "charts carrying the switch whose figures did not change");
    assert.equal(loads, 1, "still the same page load");
    assert.deepEqual(await head.locator('[aria-pressed="true"]').allInnerTexts(), ["Subscription", "Highest"], "every copy of the control agrees");
  });

  await check("the row above AA's charts picks efforts for them, and Highest puts the selection back", async () => {
    await scopeBar.scrollIntoViewIfNeeded();
    const before = await models();
    await scopeBar.locator('[data-aaplus-effort="medium"]').click();
    await page.waitForTimeout(2500);
    const medium = await models();
    assert.notEqual(medium, before, `the selection changed (${before} -> ${medium})`);
    await scopeBar.locator('[data-aaplus-effort="max"]').click();
    await page.waitForTimeout(2500);
    assert.ok(await models() > medium, "a second effort adds configurations");
    assert.deepEqual(await scopeBar.locator('[aria-pressed="true"]').allInnerTexts(), ["Subscription", "Medium", "Max"]);
    await scopeBar.locator('[data-aaplus-effort="highest"]').click();
    await page.waitForTimeout(2500);
    assert.equal(await models(), before, "back to AA's own selection");
    await shot("scope-bar");
  });

  await check("a plan picked for a lab reprices its models, and the added chart moves with it", async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const before = await card("Cost per Task");
    const chart = page.locator("[data-aaplus-card]:not([data-aaplus-radar])");
    assert.equal(await chart.locator("h3").innerText(), "Plan Price vs. API Price");
    const shares = () => chart.locator('svg text[text-anchor="middle"]').allTextContents();
    const sharesBefore = await shares();
    assert.ok(sharesBefore.length >= 4 && sharesBefore.every((t) => /^\d+(\.\d)?%$/.test(t)), `every bar carries its share: ${sharesBefore.join(" ")}`);
    await head.locator(".aap-plans summary").click();
    const select = head.locator('select[data-aaplus-lab="anthropic"]');
    assert.ok((await select.locator("option").count()) >= 3, "Anthropic's plans are listed");
    await select.selectOption({ index: 1 });
    await page.waitForTimeout(1200);
    assert.notDeepEqual(dollars(await card("Cost per Task")), dollars(before), "the cost card changed");
    assert.notDeepEqual(await shares(), sharesBefore, "the added chart changed");
    assert.ok(await select.isVisible(), "the plan list stays open while the page redraws");
    await select.selectOption({ index: 0 });
    await page.mouse.click(300, 300);
    assert.equal(await select.isVisible(), false, "a click elsewhere closes it");
    if (shots) { await chart.scrollIntoViewIfNeeded(); await chart.screenshot({ path: path.join(shots, "added-chart.png") }); }
  });

  await check("with something typed in AA's model picker, Select all selects what the search shows; with nothing typed it selects every model", async () => {
    const trig = page.locator("[data-aaplus-scope] button", { hasText: /^\d+ of \d+ models$/ }).first();
    await trig.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -260));
    await page.waitForTimeout(500);
    const count = async () => Number((await trig.textContent()).split(" ")[0]);
    const start = await count();
    await trig.click();
    const pop = page.locator('[role="dialog"]:has([cmdk-root])').last();
    await pop.getByRole("button", { name: "Clear" }).click();
    await page.waitForTimeout(600);
    assert.equal(await count(), 0, "cleared");
    await pop.locator("[cmdk-input]").fill("openai");
    await page.waitForTimeout(600);
    const shown = (await pop.locator("[cmdk-item]").evaluateAll((els) => els.map((e) => e.getAttribute("data-value")).filter((v) => !v.startsWith("group:")))).length;
    assert.ok(shown > 3, `the search shows some models (${shown})`);
    await pop.getByRole("button", { name: "Select all" }).click();
    await page.waitForTimeout(1200);
    assert.equal(await count(), shown, "Select all with a search selects exactly what it shows");
    await pop.locator("[cmdk-input]").fill("");
    await page.waitForTimeout(400);
    await pop.getByRole("button", { name: "Select all" }).click();
    await page.waitForTimeout(1200);
    const all = Number((await trig.textContent()).match(/of (\d+)/)[1]);
    assert.equal(await count(), all, "with nothing typed, AA's own Select all selects every model");
    await pop.getByRole("button", { name: "Reset (to default)" }).click();
    await page.waitForTimeout(1200);
    assert.equal(await count(), start, "Reset puts AA's default selection back");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  });

  await check("the Pareto line is drawn through the repriced points, at either pricing", async () => {
    // AA computes the line from its full model list, not the selection; every vertex must sit on a point the chart draws.
    const frontier = async () => {
      const h = page.locator("[data-aaplus-scope] h3", { hasText: "Intelligence Index vs. Cost per Task" }).first();
      await h.scrollIntoViewIfNeeded();
      await page.waitForTimeout(2500);
      return page.evaluate(() => {
        const fiberOf = (el) => { for (const k in el) if (k.startsWith("__reactFiber$")) return el[k]; };
        const h3 = [...document.querySelectorAll("[data-aaplus-scope] h3")].find((e) => e.textContent.trim().startsWith("Intelligence Index vs. Cost per Task") && !/Release/.test(e.textContent));
        let box = h3.parentElement;
        while (!box.querySelector(".recharts-surface")) box = box.parentElement;
        let line = null, items = null;
        for (let f = fiberOf(box.querySelector(".recharts-wrapper")), n = 0; f && n < 60; f = f.return, n++) for (let hook = f.memoizedState, i = 0; hook && typeof hook === "object" && "memoizedState" in hook && i < 45; hook = hook.next, i++) {
          const v = Array.isArray(hook.memoizedState) ? hook.memoizedState[0] : null;
          if (!Array.isArray(v) || !v[0] || typeof v[0] !== "object") continue;
          if (Object.keys(v[0]).join() === "x,y") line = v;
          else if ("x" in v[0] && "y" in v[0] && "id" in v[0] && (!items || v.length > items.length)) items = v;
        }
        return { line: line?.map((q) => [q.x, q.y]), items: items?.map((q) => [q.x, q.y]) };
      });
    };
    const onPoints = ({ line, items }) => line.filter(([x, y]) => !items.some(([ix, iy]) => Math.abs(ix - x) <= 1e-9 * Math.max(1, x) && Math.abs(iy - y) < 1e-9));
    await scopeBar.locator('[data-aaplus-pricing="plan"]').click();
    const plan = await frontier();
    assert.ok(plan.line?.length >= 5 && plan.items?.length >= 10, "the chart's line and points were read");
    assert.deepEqual(onPoints(plan), [], "vertices of the line that are not on a drawn point, at plan prices");
    await scopeBar.locator('[data-aaplus-pricing="api"]').click();
    const api = await frontier();
    assert.deepEqual(onPoints(api), [], "vertices of the line that are not on a drawn point, at API prices");
    assert.ok(Math.max(...api.line.map(([x]) => x)) > Math.max(...plan.line.map(([x]) => x)) * 2, "the line itself moved");
    await scopeBar.locator('[data-aaplus-pricing="plan"]').click();
    await page.waitForTimeout(1500);
    await shot("scatter-plan");
  });

  await check("the strengths radar sits in the Benchmarks section and says what each evaluation measures", async () => {
    const radar = page.locator("[data-aaplus-radar]");
    // Below the sticky row, which would otherwise sit over the card's own controls.
    await radar.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 260));
    await page.waitForTimeout(1200);
    assert.ok(await radar.evaluate((el) => { const h2 = [...document.querySelectorAll("h2")].find((h) => h.textContent.trim() === "Benchmarks"), section = h2.closest("section"); return section.contains(el) && !!(h2.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING); }), "inside the Benchmarks section, after its heading");
    const shapes = () => radar.locator("svg > g:nth-of-type(2) > g").count(), legend = () => radar.locator(".aap-legend li[data-key]").allInnerTexts();
    assert.equal(await shapes(), 4, "four models by default");
    const spokes = await radar.locator('svg g[style*="help"]').count();
    assert.ok(spokes >= 5, `one spoke per evaluation in the index (${spokes})`);
    await radar.locator('svg g[style*="help"]').nth(1).hover();
    const tip = await radar.locator(".aap-tip").innerText();
    assert.match(tip, /% of the index/);
    assert.ok(tip.split("\n").some((line) => line.length > 40), `the card describes the evaluation: ${tip.slice(0, 120)}`);
    assert.ok((await legend()).every((name) => tip.includes(name.split("\n")[0].trim().replace(/\s*\d+$/, ""))), "and gives each charted model's score");
    await page.mouse.move(5, 500);
    await radar.locator('[data-aaplus-radar-top="6"]').click();
    await page.waitForTimeout(900);
    assert.equal(await shapes(), 6, "six on request");
    const before = await legend();
    await scopeBar.locator('[data-aaplus-effort="high"]').click();
    await page.waitForTimeout(3000);
    assert.notDeepEqual(await legend(), before, "the radar follows the effort picked for AA's charts");
    await scopeBar.locator('[data-aaplus-effort="highest"]').click();
    await radar.locator('[data-aaplus-radar-top="4"]').click();
    await page.waitForTimeout(2500);
    if (shots) await radar.screenshot({ path: path.join(shots, "radar.png") });
  });

  await check("dark mode inverts the page but not its photos, and is on before the first paint next time", async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const look = () => page.evaluate(() => ({ theme: document.documentElement.getAttribute("data-aaplus-theme"), page: getComputedStyle(document.documentElement).filter, photo: (() => { const img = [...document.querySelectorAll("img")].find((i) => !/logos|\.svg/.test(i.getAttribute("src") ?? "")); return img ? getComputedStyle(img).filter : null; })(), logo: (() => { const img = document.querySelector('img[src*="logos"]'); return img ? getComputedStyle(img).filter : "none"; })() }));
    assert.equal((await look()).theme, null, "light to begin with (the test browser's system setting is light)");
    await head.locator("[data-aaplus-theme]").click();
    await page.waitForTimeout(600);
    const dark = await look();
    assert.equal(dark.theme, "dark");
    assert.match(dark.page, /invert/);
    // The page is marked dark with the same attribute the moon button carries; a click on the page must not be taken for the button's.
    assert.equal(await page.evaluate(() => { const e = new MouseEvent("click", { bubbles: true, cancelable: true }); document.body.dispatchEvent(e); return e.defaultPrevented; }), false, "a click on the page is left to the page");
    if (dark.photo !== null) assert.match(dark.photo, /invert\(1\)/, "a photo is turned back");
    assert.equal(dark.logo, "none", "a logo is left inverted with the page");
    await shot("dark");
    await page.goto("https://artificialanalysis.ai/", { waitUntil: "commit", timeout: 60000 });
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute("data-aaplus-theme")), "dark", "set as soon as the next page starts");
    await head.waitFor({ timeout: 45000 });
    await page.waitForTimeout(2000);
    await head.locator("[data-aaplus-theme]").click();
    await page.waitForTimeout(400);
    assert.equal((await look()).theme, null, "and off again");
    loads = 1;
  });

  await check("the sticky row leaves with the language-model charts", async () => {
    const media = page.locator("[data-aaplus-scope] h2", { hasText: "More from Artificial Analysis" });
    if (!(await media.count())) return;
    await page.locator("h2", { hasText: "Benchmarks" }).first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    assert.ok(await scopeBar.isVisible(), "there among the charts");
    await media.evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY + 300, behavior: "instant" }));
    await page.waitForFunction(() => [...document.querySelectorAll("[data-aaplus-scope] h2")].some((h) => h.textContent.trim().startsWith("More from Artificial Analysis") && h.getBoundingClientRect().top < 0), null, { timeout: 5000 });
    await scopeBar.waitFor({ state: "hidden", timeout: 5000 });
    assert.equal(await scopeBar.isVisible(), false, "gone below them");
    await page.evaluate(() => window.scrollTo(0, 0));
  });

  await check("plan prices and evaluation scores were fetched from Priors", async () => {
    assert.deepEqual([...fetched].sort(), ["/api/aa-strengths", "/api/plan-prices"]);
    const stored = await worker.evaluate(() => chrome.storage.local.get(["cache", "strengths"]));
    const age = (iso) => (Date.now() - Date.parse(iso)) / 3600000;
    assert.ok(age(stored.cache.data.generatedAt) < 6, `plan prices come from a snapshot built ${age(stored.cache.data.generatedAt).toFixed(1)}h ago`);
    assert.ok(age(stored.strengths.data.generatedAt) < 6, "so do the evaluation scores");
  });

  await check("the toolbar popup edits the same settings, and the open page follows", async () => {
    const pop = await ctx.newPage();
    await pop.setViewportSize({ width: 340, height: 520 });
    await pop.goto(`chrome-extension://${id}/popup.html`);
    await pop.locator('button[data-pricing][aria-pressed="true"]').waitFor();
    assert.deepEqual(await pop.locator('#pricing [aria-pressed="true"]').allInnerTexts(), ["Subscription"]);
    if (shots) await pop.screenshot({ path: path.join(shots, "popup.png") });
    await pop.locator('button[data-pricing="api"]').click();
    await pop.locator('button[data-effort="high"]').click();
    await pop.close();
    await page.bringToFront();
    await page.waitForTimeout(1500);
    assert.deepEqual(await head.locator('[aria-pressed="true"]').allInnerTexts(), ["API", "High"]);
    assert.ok((await card("Intelligence")).some((b) => /\(high\)/.test(b.name)));
    assert.equal(loads, 1, "still no reload");
  });

  await check("the GitHub star ask shows once, on a second visit after an AA Plus click, and never again", async () => {
    assert.equal(await page.locator(".aap-toast").count(), 0, "no ask during the first visit");
    const star = () => worker.evaluate(() => chrome.storage.local.get("star").then((g) => g.star));
    assert.ok((await star())?.clicked, "the clicks so far are counted");
    // A second visit: AA opened again after more than half an hour away.
    await worker.evaluate(() => chrome.storage.local.get("star").then(({ star }) => chrome.storage.local.set({ star: { ...star, visits: 1, last: Date.now() - 31 * 60 * 1000, clicked: false } })));
    await page.goto("https://artificialanalysis.ai/", { waitUntil: "domcontentloaded" });
    await head.waitFor({ timeout: 45000 });
    await page.waitForTimeout(3500);
    assert.equal((await star()).visits, 2, "the visit is counted");
    assert.equal(await page.locator(".aap-toast").count(), 0, "no ask before an AA Plus control is used");
    await head.scrollIntoViewIfNeeded();
    await head.locator('[data-aaplus-pricing="api"]').click();
    const toast = page.locator(".aap-toast");
    await toast.waitFor({ timeout: 5000 });
    assert.equal(await toast.locator("a").getAttribute("href"), "https://github.com/adamholter/aa-plus");
    await shot("star-ask");
    await toast.locator("button").click();
    await page.waitForTimeout(500);
    assert.equal(await toast.count(), 0, "closed");
    assert.equal((await star()).shown, true);
    await worker.evaluate(() => chrome.storage.local.get("star").then(({ star }) => chrome.storage.local.set({ star: { ...star, last: Date.now() - 2 * 60 * 60 * 1000 } })));
    await page.reload({ waitUntil: "domcontentloaded" });
    await head.waitFor({ timeout: 45000 });
    await head.locator('[data-aaplus-pricing="plan"]').click();
    await page.waitForTimeout(2500);
    assert.equal(await page.locator(".aap-toast").count(), 0, "never shown again");
  });

  await check("an evaluation's page gets the same pricing switch, and its cost charts follow it", async () => {
    // These pages keep their models in a store with other names (selectedModels / allModels) but the same shape.
    await page.goto("https://artificialanalysis.ai/evaluations/terminalbench-4-0", { waitUntil: "domcontentloaded", timeout: 60000 });
    await scopeBar.waitFor({ timeout: 45000 });
    await page.waitForTimeout(2500);
    await scopeBar.locator('[data-aaplus-pricing="plan"]').click();
    await page.waitForTimeout(1500);
    const planCharts = await switched();
    await scopeBar.locator('[data-aaplus-pricing="api"]').click();
    await page.waitForTimeout(2500);
    const apiCharts = await switched();
    for (const [title, figures] of Object.entries(planCharts)) console.log(`     ${title}: plan [${figures.slice(0, 50)}] api [${(apiCharts[title] ?? "").slice(0, 50)}]`);
    assert.ok(Object.keys(planCharts).length >= 2, "cost charts on the evaluation's page carry the switch");
    assert.deepEqual(Object.entries(planCharts).filter(([title, figures]) => !figures || figures === apiCharts[title]).map(([title]) => title), [], "charts carrying the switch whose figures did not change");
    await scopeBar.locator('[data-aaplus-pricing="plan"]').click();
    await page.waitForTimeout(1000);
    await shot("evaluation-plan");
  });

  await check("the models page works the same way, and nothing threw", async () => {
    await page.goto("https://artificialanalysis.ai/models", { waitUntil: "domcontentloaded", timeout: 60000 });
    await head.waitFor({ timeout: 45000 });
    await page.waitForTimeout(3000);
    const high = await card("Intelligence");
    assert.ok(high.length >= 5 && high.some((b) => /\(high\)/.test(b.name)), `the settings carried over: ${high.map((b) => b.name).join(", ")}`);
    await head.locator('[data-aaplus-effort="highest"]').click();
    await head.locator('[data-aaplus-pricing="plan"]').click();
    await page.waitForTimeout(1500);
    assert.ok(Math.max(...dollars(await card("Cost per Task"))) < 10, "plan costs on the models page");
    const planCharts = await switched();
    await head.locator('[data-aaplus-pricing="api"]').click();
    await page.waitForTimeout(2500);
    const apiCharts = await switched();
    for (const [title, figures] of Object.entries(planCharts)) console.log(`     ${title}: plan [${figures.slice(0, 50)}] api [${(apiCharts[title] ?? "").slice(0, 50)}]`);
    assert.ok(Object.keys(planCharts).length >= 1, "cost charts on /models carry the switch");
    assert.deepEqual(Object.entries(planCharts).filter(([title, figures]) => !figures || figures === apiCharts[title]).map(([title]) => title), [], "charts on /models carrying the switch whose figures did not change");
    await head.locator('[data-aaplus-pricing="plan"]').click();
    await page.evaluate(() => window.scrollTo(0, 600));
    await shot("models-plan");
    assert.deepEqual(errors.filter((e) => /aaplus|AA Plus|chrome-extension/i.test(e)), []);
  });
  if (errors.length) console.log(`page errors seen (the site's own included): ${errors.slice(0, 5).join(" | ")}`);
} finally {
  await ctx.close();
  rmSync(profile, { recursive: true, force: true });
}
if (failures.length) { console.error(`\n${failures.length} failed`); process.exit(1); }
console.log("\nall checks passed");
