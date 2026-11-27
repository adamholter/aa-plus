// Check the native Cost per Intelligence Index Task chart against the live site.
// Run with node test/pricing.mjs, or pass an unpacked extension directory as the first argument.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const ext = path.resolve(process.argv[2] ?? fileURLToPath(new URL("..", import.meta.url)));
const profile = mkdtempSync(path.join(tmpdir(), "aaplus-pricing-"));
try {
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    const page = await ctx.newPage();
    await page.goto("https://artificialanalysis.ai/", { waitUntil: "domcontentloaded" });
    const title = page.locator('[data-aaplus-scope] h3:has([data-aaplus-note])', { hasText: /^Cost per Intelligence Index Task/ }).first();
    await title.locator('[data-aaplus-pricing="plan"]').click({ timeout: 45_000 });

    const chart = title.locator('xpath=ancestor::*[.//*[contains(concat(" ", normalize-space(@class), " "), " recharts-bar ")]]').last();
    const bars = chart.locator(".recharts-bar-rectangle path");
    await bars.first().waitFor({ state: "attached" });
    await page.waitForTimeout(2_000);

    const originalURL = page.url();
    let loads = 0;
    page.on("load", () => loads++);
    const figures = () => bars.evaluateAll((paths) => paths.map((bar) => bar.getAttribute("d")));
    const select = async (mode) => {
      const button = title.locator(`[data-aaplus-pricing="${mode}"]`);
      await button.click();
      await button.and(title.locator('[aria-pressed="true"]')).waitFor();
      await page.waitForTimeout(1_800);
      assert.equal(page.url(), originalURL);
      assert.equal(loads, 0);
      return figures();
    };

    const subscription = await figures();
    assert.equal(await title.locator('[data-aaplus-pricing="plan"]').getAttribute("aria-pressed"), "true");
    const api = await select("api");
    assert.notDeepEqual(api, subscription, "API pricing redraws the native cost bars");
    assert.deepEqual(await select("plan"), subscription, "Subscription restores its original bars");
    assert.deepEqual(await select("api"), api, "switching back restores the same API bars");
    console.log("ok   Native Cost per Intelligence Index Task chart switches both ways without a reload");
  } finally {
    await ctx.close();
  }
} finally {
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chromium may still hold a file on Windows. */ }
}
