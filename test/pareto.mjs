// Deterministic semantics for chart-local isolation. The live AA checks remain in run.mjs.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage();
  const ids = ['start', 'end', 'collinear', 'near', 'tie'];
  const chart = (name) => `<section id="${name}"><h3>Chart ${name}</h3>
    <div><svg width="20" height="8"><line/></svg><span>Pareto line</span></div>
    <svg class="recharts-surface" width="400" height="300">
      <g clip-path="url(#clip)"><path stroke-dasharray="0.1 6" d="M 10 100 L 100 10"/><path class="connector" d="M 10 100 L 60 60"/></g>
      ${[[10, 100], [100, 10], [50, 60], [100.01, 10.01], [100, 10]].map(([x, y], i) => `<g class="recharts-scatter-symbol"><circle data-chart-item-id="${ids[i]}" cx="${x}" cy="${y}"/></g>`).join('')}
      <g aria-hidden="true" pointer-events="none">${ids.map(id => `<g data-label="${id}"><text>${id}</text></g>`).join('')}</g>
      <rect class="hit" x="0" y="0" width="400" height="300"/>
    </svg></section>`;
  await page.setContent(`<main>${chart('A')}${chart('B')}</main>`);
  // Supply the two React contracts the extension reads, without loading React or AA.
  const hydrateFixtures = () => {
    for (const card of document.querySelectorAll('section')) {
      for (const group of card.querySelectorAll('[data-label]')) group.__reactFiber$fixture = { key: group.dataset.label };
      const hit = card.querySelector('.hit');
      if (!hit) continue;
      hit.__reactProps$fixture = { onMouseMove() {}, onMouseLeave() { card.dataset.cleared = 'yes'; } };
      hit.__reactFiber$fixture = { memoizedProps: { maxRadiusPx: 40, data: [{ id: 'start' }], activeDatum: null } };
    }
  };
  await page.evaluate(hydrateFixtures);
  await page.addScriptTag({ path: path.join(extension, 'pareto.js') });
  const toggle = page.locator('#A .aap-pareto-toggle input');
  await toggle.waitFor();
  const masked = () => page.evaluate(() => [...document.querySelectorAll('#A circle')].filter(c => c.closest('[data-aap-pareto-hidden]')).map(c => c.dataset.chartItemId));
  const line = page.locator('#A path[stroke-dasharray]');
  const settle = () => page.waitForTimeout(70);

  assert.equal(await toggle.isChecked(), false, 'new charts start off');
  await toggle.check();
  assert.deepEqual(await masked(), ['collinear', 'near'], 'keep native vertices and tied points; exclude collinear and merely nearby points');
  assert.equal(await page.locator('#A [data-label="collinear"]').isVisible(), false, 'hide associated labels');
  assert.equal(await page.locator('#A .connector').isVisible(), false, 'hide release connectors');
  assert.equal(await page.locator('#B [data-aap-pareto-hidden]').count(), 0, 'other chart remains unchanged');
  console.log('ok   Pareto membership, ties, labels, connectors, and chart independence');

  await line.evaluate(el => el.setAttribute('d', 'M 50 60'));
  await settle();
  assert.deepEqual(await masked(), ['start', 'end', 'near', 'tie'], 'follow a live single-vertex frontier');
  await page.evaluate(() => {
    const symbol = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    symbol.setAttribute('class', 'recharts-scatter-symbol');
    symbol.innerHTML = '<circle data-chart-item-id="new" cx="80" cy="80"/>';
    document.querySelector('#A .recharts-surface').append(symbol);
  });
  await settle();
  assert.deepEqual(await masked(), ['start', 'end', 'near', 'tie', 'new'], 'hide a newly arrived off-frontier point');
  console.log('ok   Pareto isolation follows changed line membership and new data');

  await page.evaluate(() => {
    const card = document.querySelector('#A');
    card.querySelector('.hit').__reactFiber$fixture.memoizedProps.activeDatum = { id: 'start' };
    card.querySelector('path[stroke-dasharray]').setAttribute('d', 'M 50 60 L 80 80');
  });
  await settle();
  assert.equal(await page.locator('#A').getAttribute('data-cleared'), 'yes', 'clear a native hover that becomes hidden');
  await toggle.uncheck();
  assert.equal(await page.locator('#A [data-aap-pareto-hidden]').count(), 0, 'remove every mask on off');
  assert.equal(await page.locator('#A [data-label="collinear"]').isVisible(), true, 'restore labels');
  assert.equal(await page.locator('#A .connector').isVisible(), true, 'restore connectors');
  await toggle.focus();
  await page.keyboard.press('Space');
  assert.equal(await toggle.isChecked(), true, 'keyboard toggles the control');
  console.log('ok   Native hover cleanup, exact mask removal, and keyboard toggle');

  await line.evaluate(el => el.setAttribute('d', 'M 50 60 Q 70 70 80 90'));
  await settle();
  assert.equal(await page.locator('#A [data-aap-pareto-hidden]').count(), 0, 'unknown native geometry fails open');
  console.log('ok   Unknown Pareto geometry leaves native chart visible');

  await page.evaluate(() => {
    const original = document.querySelector('#A');
    const replacement = original.cloneNode(true);
    replacement.id = 'C';
    replacement.querySelector('.aap-pareto-toggle').remove();
    replacement.querySelectorAll('[data-aap-pareto-hidden]').forEach(el => el.removeAttribute('data-aap-pareto-hidden'));
    replacement.removeAttribute('data-aap-pareto-active');
    original.remove();
    document.querySelector('main').append(replacement);
  });
  const replacement = page.locator('#C .aap-pareto-toggle input');
  await replacement.waitFor();
  assert.equal(await replacement.isChecked(), false, 'a new chart with the same title starts off');
  assert.equal(await page.locator('#B .aap-pareto-toggle input').isChecked(), false, 'independent chart retains its own state');
  console.log('ok   A newly mounted chart cannot inherit another chart’s state by title');

  const lazyPage = await browser.newPage();
  await lazyPage.setContent(`<main><section id="A"><h3>Chart A</h3><div><span>Pareto line</span></div></section>${chart('B')}</main>`);
  await lazyPage.evaluate(hydrateFixtures);
  await lazyPage.addScriptTag({ path: path.join(extension, 'pareto.js') });
  const lazyToggle = lazyPage.locator('#A .aap-pareto-toggle input');
  await lazyPage.waitForTimeout(70);
  assert.equal(await lazyToggle.count(), 0, 'do not bind an unmounted chart legend to a neighboring chart');
  await lazyPage.evaluate(() => {
    document.querySelector('#A').append(document.querySelector('#B .recharts-surface').cloneNode(true));
  });
  await lazyPage.evaluate(hydrateFixtures);
  await lazyToggle.waitFor();
  await lazyToggle.check();
  assert.equal(await lazyPage.locator('#A circle').evaluateAll(circles => circles.filter(c => c.closest('[data-aap-pareto-hidden]')).length), 2, 'resolve the current chart after a neighboring chart hydrates first');
  assert.equal(await lazyPage.locator('#B [data-aap-pareto-hidden]').count(), 0, 'lazy mounting cannot transfer isolation into a neighboring chart');
  await lazyPage.close();
  console.log('ok   Lazy chart mounting keeps the toggle bound to its current chart');


} finally {
  await browser.close();
}
