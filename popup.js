// The toolbar popup: the same settings as the controls on the page. It only writes chrome.storage;
// every open Artificial Analysis tab hears the change and updates in place.
/* global __aaPlusShared, chrome */
(() => {
  const S = __aaPlusShared, $ = (id) => document.getElementById(id);
  let settings = S.settingsOf(), prices = null, metrics = null, diag = null;

  const save = (patch) => {
    settings = S.settingsOf({ ...settings, ...patch }); chrome.storage.local.set({ settings }); draw();
    // A change made here counts as using AA Plus for the one-time GitHub star ask (content.js).
    chrome.storage.local.get("star", (got) => { const star = got?.star ?? { visits: 0, last: 0, clicked: false, shown: false }; if (!star.clicked && !star.shown) chrome.storage.local.set({ star: { ...star, clicked: true } }); });
  };
  const button = (attr, value, text, pressed) => { const b = document.createElement("button"); b.type = "button"; b.dataset[attr] = value; b.textContent = text; b.setAttribute("aria-pressed", String(pressed)); return b; };

  const selectOf = (items, value) => { const s = document.createElement("select"); s.append(...items.map(([v, t]) => new Option(t, v))); s.value = value; return s; };
  const rowOf = (text, control) => { const row = document.createElement("label"), name = document.createElement("span"); row.className = "row"; name.textContent = text; row.append(name, control); return row; };
  /** The same choices as the Advanced panel on the page. */
  function drawAdvanced() {
    const n = S.advancedCount(settings);
    $("advanced-title").textContent = n ? `Advanced · ${n}` : "Advanced";
    const source = (kind, text) => { const list = (metrics?.sources ?? []).filter((s) => s[kind]); if (!list.length) return []; const sel = selectOf([["aa", "Artificial Analysis"], ...list.map((s) => [s.id, s.name])], settings[`${kind}Source`]); sel.dataset.set = `${kind}Source`; return [rowOf(text, sel)]; };
    $("sources").replaceChildren(...source("cost", "Cost data"), ...source("time", "Time data"));
    $("released").value = settings.released; $("weights").value = settings.weights; $("planOnly").checked = settings.planOnly; $("freeTiers").checked = settings.freeTiers;
    const groups = new Map();
    for (const m of Object.values(prices?.models ?? {})) if (m.readings) { const key = Object.keys(m.readings).join("|"), g = groups.get(key) ?? { names: [], options: m.readings }; g.names.push(m.name); groups.set(key, g); }
    $("readings").replaceChildren(...[...groups.values()].map((g) => { const items = Object.entries(g.options), sel = selectOf(items.map(([id, o]) => [id, o.name]), settings.reading && g.options[settings.reading] ? settings.reading : items[0]?.[0]); sel.dataset.set = "reading"; return rowOf(`${g.names.slice(0, 2).join(", ")} rate`, sel); }));
    $("lab-filter").replaceChildren(...(diag?.labs ?? []).map((l) => { const row = document.createElement("label"), box = document.createElement("input"); row.className = "check"; box.type = "checkbox"; box.dataset.offLab = l.id; box.checked = !settings.labsOff.includes(l.id); row.append(box, ` ${l.name}`); return row; }));
  }

  function draw() {
    const plan = settings.pricing === "plan", e = settings.efforts;
    for (const b of $("pricing").children) b.setAttribute("aria-pressed", String(b.dataset.pricing === settings.pricing));
    $("pricing-help").textContent = plan ? "Each model at its plan's share of API price. Models with no plan stay at API price." : "Artificial Analysis's own costs, at API prices.";
    for (const b of $("mode").children) b.setAttribute("aria-pressed", String(e.mode === b.dataset.effort));
    $("efforts").replaceChildren(...S.EFFORTS.filter((x) => x !== "minimal" || e.list.includes(x)).map((x) => button("effort", x, S.EFFORT_LABEL[x], e.mode === "pick" && e.list.includes(x))));
    $("effort-help").textContent = e.mode === "pick" ? "Charts show the models at the efforts picked. Models with one configuration always show." : e.mode === "default" ? "The effort Artificial Analysis marks as a model's API default, where it marks one." : "Each model at its highest effort.";
    $("chart").checked = !!settings.chart;
    $("radar").checked = !!settings.radar;
    for (const b of $("theme").children) b.setAttribute("aria-pressed", String(b.dataset.theme === settings.theme));
    const labs = plan && prices ? prices.labs.map((l) => ({ l, plans: S.planChoices(prices, l).plans })).filter((x) => x.plans.length > 1) : [];
    $("plans").hidden = !labs.length;
    $("labs").replaceChildren(...labs.map(({ l, plans }) => {
      const select = selectOf([["", "Default"], ...plans.map((p) => [p.plan, `${p.plan}${Number.isFinite(p.feeUsd) ? ` · $${p.feeUsd}` : ""}`])], settings.plans[l.id] ?? "");
      select.dataset.lab = l.id;
      return rowOf(l.name, select);
    }));
    drawAdvanced();
    $("data").textContent = prices?.date ? `Data: Priors, ${prices.date}` : "Data loads from Priors on first use";
  }

  document.addEventListener("click", (ev) => {
    if (ev.target instanceof Element && ev.target.id === "reset") return save({ ...S.ADVANCED, labsOff: [] });
    const t = ev.target instanceof Element ? ev.target.closest("button[data-pricing], button[data-effort], button[data-theme]") : null;
    if (!t) return;
    if (t.dataset.pricing) save({ pricing: t.dataset.pricing }); else if (t.dataset.theme) save({ theme: t.dataset.theme }); else save({ efforts: S.toggleEffort(settings.efforts, t.dataset.effort) });
  });
  document.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.id === "chart") return save({ chart: t.checked });
    if (t.id === "radar") return save({ radar: t.checked });
    if (t.id === "released" || t.id === "weights") return save({ [t.id]: t.value });
    if (t.id === "planOnly" || t.id === "freeTiers") return save({ [t.id]: t.checked });
    if (t.dataset?.set) return save({ [t.dataset.set]: t.value });
    if (t.dataset?.offLab) return save({ labsOff: t.checked ? settings.labsOff.filter((l) => l !== t.dataset.offLab) : [...settings.labsOff, t.dataset.offLab] });
    if (t.dataset?.lab) { const plans = { ...settings.plans }; if (t.value) plans[t.dataset.lab] = t.value; else delete plans[t.dataset.lab]; save({ plans }); }
  });

  chrome.storage.local.get(["settings", "cache", "metrics", "diag"], (got) => {
    settings = S.settingsOf(got?.settings); diag = got?.diag ?? null;
    if (got?.cache?.data) prices = S.adoptPrices(got.cache.data, got.cache.at);
    if (got?.metrics?.data) metrics = S.adoptMetrics(got.metrics.data, got.metrics.at);
    draw();
    chrome.runtime.sendMessage({ type: "prices" }, (res) => { if (!chrome.runtime.lastError && res?.ok) { prices = S.adoptPrices(res.data, res.at); draw(); } });
    chrome.runtime.sendMessage({ type: "metrics" }, (res) => { if (!chrome.runtime.lastError && res?.ok) { metrics = S.adoptMetrics(res.data, res.at); draw(); } });
  });
  // The page's own controls write the same settings; keep an open popup in step with them.
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.settings) { settings = S.settingsOf(changes.settings.newValue); draw(); } });
  draw();
})();
