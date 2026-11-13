// Isolate a chart's own rendered Pareto vertices without changing AA's model selection.
// Runs in the page world because AA's label groups are keyed by React, not marked in the DOM.
(() => {
  if (window.__aaPlusPareto) return;
  window.__aaPlusPareto = true;
  const bound = new WeakSet();
  let chartStates = new WeakMap();
  const known = new Set();
  let path = location.pathname, queued = false;
  const fiberKey = (el) => { for (const k in el) if (k.startsWith('__reactFiber$')) return el[k]?.key; return null; };
  const style = document.createElement('style');
  style.textContent = `
    [data-aap-pareto-hidden]{display:none!important}
    .aap-pareto-toggle{display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap}
    .aap-pareto-toggle input{appearance:none;-webkit-appearance:none;width:14px;height:14px;margin:0;border:1px solid currentColor;border-radius:50%;background:transparent;cursor:pointer}
    .aap-pareto-toggle input:checked{box-shadow:inset 0 0 0 3px white;background:currentColor}
    .aap-pareto-toggle input:focus-visible{outline:2px solid currentColor;outline-offset:2px}
  `;
  function clear(box) {
    box.removeAttribute('data-aap-pareto-active');
    box.querySelectorAll('[data-aap-pareto-hidden]').forEach(el => el.removeAttribute('data-aap-pareto-hidden'));
  }
  function syncUnsafe(box, enabled) {
    clear(box);
    if (!enabled) return;
    const svg = box.querySelector('.recharts-surface');
    const paths = [...(svg?.querySelectorAll('path[stroke-dasharray]') ?? [])].filter(p => /^0\.1[ ,]+6$/.test(p.getAttribute('stroke-dasharray')) && p.closest('g[clip-path]'));
    const circles = [...(svg?.querySelectorAll('circle[data-chart-item-id]') ?? [])];
    if (paths.length !== 1 || !circles.length) return;
    const d = paths[0].getAttribute('d') ?? '';
    const commands = [...d.matchAll(/([ML])\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*[, ]\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/gi)];
    if (commands.length < 1 || d.replace(/([ML])\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*[, ]\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/gi, '').trim()) return;
    const points = commands.map(m => [Number(m[2]), Number(m[3])]);
    const ids = new Set(), keep = new Set();
    for (const c of circles) {
      const id = c.getAttribute('data-chart-item-id'), x = Number(c.getAttribute('cx')), y = Number(c.getAttribute('cy'));
      if (!id || !Number.isFinite(x) || !Number.isFinite(y)) return;
      ids.add(id);
      if (points.some(([px, py]) => Math.abs(px-x) < 1e-6 && Math.abs(py-y) < 1e-6)) keep.add(id);
    }
    const labelGroups = [...svg.querySelectorAll('g[aria-hidden="true"][pointer-events="none"] > g')];
    const labels = labelGroups.map(el => [el, fiberKey(el)]);
    if (!keep.size || labels.some(([, id]) => !id || !ids.has(id))) return;
    for (const c of circles) if (!keep.has(c.getAttribute('data-chart-item-id'))) c.closest('.recharts-scatter-symbol')?.setAttribute('data-aap-pareto-hidden', '');
    for (const [el, id] of labels) if (!keep.has(id)) el.setAttribute('data-aap-pareto-hidden', '');
    // Release charts may draw additional model-to-model connectors in this same clipped layer.
    for (const p of paths[0].parentElement.querySelectorAll('path')) if (p !== paths[0]) p.setAttribute('data-aap-pareto-hidden', '');
    // AA's transparent hit rectangle finds the nearest datum, including hidden circles.
    // Gate its native handler only when that nearest datum is hidden; retain frontier hover/click.
    const hit = [...svg.querySelectorAll('rect')].find(el => {
      const props = Object.entries(el).find(([k]) => k.startsWith('__reactProps$'))?.[1];
      return typeof props?.onMouseMove === 'function' && typeof props?.onMouseLeave === 'function';
    });
    let f = hit && Object.entries(hit).find(([k]) => k.startsWith('__reactFiber$'))?.[1];
    while (f && !(Number.isFinite(f.memoizedProps?.maxRadiusPx) && Array.isArray(f.memoizedProps?.data))) f = f.return;
    if (!hit || !f) { clear(box); return; }
    hit.__aaPlusParetoHit = { box, svg, circles, radius: f.memoizedProps.maxRadiusPx, keep };
    const hitProps = () => Object.entries(hit).find(([k]) => k.startsWith('__reactProps$'))?.[1];
    if (f.memoizedProps.activeDatum && !keep.has(String(f.memoizedProps.activeDatum.id))) hitProps()?.onMouseLeave?.();
    if (!bound.has(hit)) {
      bound.add(hit);
      const gate = e => {
        const current = hit.__aaPlusParetoHit;
        if (!current?.box.hasAttribute('data-aap-pareto-active')) return;
        const matrix = current.svg.getScreenCTM();
        if (!matrix) return;
        let nearest = null, distance = current.radius ** 2;
        for (const c of current.circles) {
          const pt = new DOMPoint(Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))).matrixTransform(matrix);
          const d = (pt.x-e.clientX)**2 + (pt.y-e.clientY)**2;
          if (d < distance) { distance = d; nearest = c; }
        }
        let owner = Object.entries(hit).find(([k]) => k.startsWith('__reactFiber$'))?.[1];
        while (owner && !(Number.isFinite(owner.memoizedProps?.maxRadiusPx) && Array.isArray(owner.memoizedProps?.data))) owner = owner.return;
        const active = owner?.memoizedProps?.activeDatum;
        if (!nearest?.closest('[data-aap-pareto-hidden]') && !(e.type === 'click' && active && !current.keep.has(String(active.id)))) return;
        const props = Object.entries(hit).find(([k]) => k.startsWith('__reactProps$'))?.[1];
        props?.onMouseLeave?.();
        e.stopPropagation();
      };
      hit.addEventListener('mousemove', gate, true);
      hit.addEventListener('click', gate, true);
    }
    box.setAttribute('data-aap-pareto-active', '');
  }
  function sync(box, enabled) {
    try { syncUnsafe(box, enabled); } catch (error) { clear(box); console.warn("AA Plus Pareto:", error); }
  }
  function chartFor(legend) {
    let box = legend;
    while (box && !box.querySelector(".recharts-surface")) {
      // Do not cross a chart heading into a neighboring, already mounted chart.
      if (box.querySelector("h3")) return null;
      box = box.parentElement;
    }
    if (box && (box.querySelectorAll("h3").length > 1 || [...box.querySelectorAll("span")].filter(el => el.textContent.trim() === "Pareto line").length !== 1)) return null;
    return box?.querySelectorAll(".recharts-surface").length === 1 ? box : null;
  }
  function render() {
    queued = false;
    if (path !== location.pathname) { for (const box of known) clear(box); known.clear(); chartStates = new WeakMap(); path = location.pathname; }
    if (!style.isConnected) document.head.append(style);
    const legends = [...document.querySelectorAll('span')].filter(el => el.textContent.trim() === 'Pareto line');
    const seen = new Set();
    legends.forEach((span) => {
      const legend = span.parentElement;
      const box = chartFor(legend);
      if (!box) return;
      seen.add(box); known.add(box);
      let label = legend.querySelector('.aap-pareto-toggle');
      if (!label) {
        label = document.createElement('label'); label.className = 'aap-pareto-toggle'; label.setAttribute('data-aaplus-ui', '');
        label.innerHTML = '<input type="checkbox"> <span>Isolate Pareto Line</span>';
        legend.append(label);
        label.querySelector('input').addEventListener('change', e => { const current = chartFor(legend); if (!current) return; chartStates.set(current, e.target.checked); sync(current, e.target.checked); });
      }
      const input = label.querySelector('input'); if (!chartStates.has(box)) chartStates.set(box, false); input.checked = chartStates.get(box);
      sync(box, input.checked);
    });
    for (const box of known) if (!seen.has(box)) { clear(box); known.delete(box); }
  }
  function schedule() { if (!queued) { queued = true; requestAnimationFrame(render); } }
  function start() {
    schedule();
    new MutationObserver(mutations => {
      if (mutations.every(m => m.type === 'attributes' && /^data-aap-pareto-/.test(m.attributeName) || (m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest?.('.aap-pareto-toggle'))) return;
      schedule();
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['d','cx','cy','transform','opacity','data-aap-pareto-hidden','data-aap-pareto-active'] });
    window.addEventListener('resize', schedule);
  }
  if (document.readyState === 'complete') start(); else window.addEventListener('load', () => setTimeout(start, 200), {once:true});
})();
