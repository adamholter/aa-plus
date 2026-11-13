// The UI half of AA Plus on artificialanalysis.ai. Everything it adds sits inline, in AA's own look:
//  - a control row (pricing, effort, plans) where AA's "Effort: Max | API Default" switch was, and
//    again above the main charts;
//  - an API | Subscription switch beside the title of every cost chart it can really reprice;
//  - the three headline cards, redrawn so they follow the same controls and animate between states;
//  - one added chart, "Plan Price vs. API Price".
// Settings live in chrome.storage (the toolbar popup edits the same ones) and nothing reloads the page:
// page.js hands AA's own chart store new rows, and the headline cards tween.
/* global AAPlusChart, __aaPlusShared, chrome */
(() => {
  const S = __aaPlusShared, C = AAPlusChart, esc = C.esc;
  let settings = S.settingsOf(), prices = null, strengths = null, rows = null, rowsPath = null, state = null, rev = 1, plansOpen = false, alive = true;
  try { localStorage.removeItem("aaplus:v1"); } catch { /* an older version kept its settings here */ }

  /* ---------------- dark mode ----------------
   * Artificial Analysis has no dark theme, so AA Plus makes one: the page is inverted and its hues turned
   * back, which keeps every chart colour recognisable, and photos and videos are inverted a second time so
   * they look as they were. Logos stay inverted (most are black marks). The choice is remembered in the
   * page's own storage too, so it is applied before the first paint instead of flashing white. */
  const THEME_KEY = "aaplus:theme";
  const THEME_STYLE = `
html[data-aaplus-theme="dark"]{filter:invert(.93) hue-rotate(180deg);background:#fff!important}
html[data-aaplus-theme="dark"] :is(img,video,canvas,iframe):not([src*="logos"]):not([src$=".svg"]){filter:invert(1) hue-rotate(180deg)}
html[data-aaplus-theme="dark"] .aap-brand svg{filter:invert(1) hue-rotate(180deg)}`;
  function applyTheme(theme) {
    const root = document.documentElement;
    if (!root) return;
    if (!document.getElementById("aaplus-theme-style")) { const style = document.createElement("style"); style.id = "aaplus-theme-style"; style.textContent = THEME_STYLE; (document.head ?? root).append(style); }
    root.toggleAttribute("data-aaplus-theme", false);
    if (S.isDark(theme)) root.setAttribute("data-aaplus-theme", "dark");
  }
  try { applyTheme(S.settingsOf({ theme: localStorage.getItem(THEME_KEY) }).theme); } catch { /* storage blocked: the theme arrives with the settings */ }
  try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(settings.theme)); } catch { /* fine */ }

  /* ---------------- settings and plan prices ---------------- */

  const effortKey = () => JSON.stringify(settings.efforts);
  function configure() {
    window.postMessage({ aaplus: "config", pricing: settings.pricing, plans: settings.plans, efforts: settings.efforts, rev, prices: prices && { models: prices.models, slugs: prices.slugs } }, location.origin);
  }
  function adopt(next) {
    const before = effortKey();
    settings = S.settingsOf(next);
    if (effortKey() !== before) rev++;
    try { localStorage.setItem(THEME_KEY, settings.theme); } catch { /* fine */ }
    applyTheme(settings.theme);
    configure(); render();
  }
  function change(patch) {
    adopt({ ...settings, ...patch });
    try { chrome.storage.local.set({ settings }); } catch { alive = false; }
  }
  try {
    chrome.storage.local.get(["settings", "cache", "strengths"], (got) => {
      if (got?.cache?.data) prices = S.adoptPrices(got.cache.data, got.cache.at);
      if (got?.strengths?.data) strengths = S.adoptStrengths(got.strengths.data, got.strengths.at);
      adopt(got?.settings);
      // Both come from Priors' live snapshot; the stored copies only cover the moment before the answers arrive.
      chrome.runtime.sendMessage({ type: "prices" }, (res) => { if (!chrome.runtime.lastError && res?.ok) { prices = S.adoptPrices(res.data, res.at); configure(); render(); } });
      chrome.runtime.sendMessage({ type: "strengths" }, (res) => { if (!chrome.runtime.lastError && res?.ok) { strengths = S.adoptStrengths(res.data, res.at); render(); } });
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.cache?.newValue?.data) prices = S.adoptPrices(changes.cache.newValue.data, changes.cache.newValue.at);
      if (changes.strengths?.newValue?.data) strengths = S.adoptStrengths(changes.strengths.newValue.data, changes.strengths.newValue.at);
      if (changes.settings) adopt(changes.settings.newValue); else if (changes.cache || changes.strengths) { configure(); render(); }
    });
  } catch { alive = false; }

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || typeof e.data !== "object") return;
    if (e.data.aaplus === "rows" && Array.isArray(e.data.rows)) { rows = e.data.rows; rowsPath = e.data.path; render(); }
    else if (e.data.aaplus === "state") { state = e.data; render(); }
  });

  const share = (slug) => S.share(prices, settings.plans, slug);
  const plan = () => settings.pricing === "plan";

  /* ---------------- styles ---------------- */

  const STYLE = `
[data-aaplus-off="row"]{display:none!important}
[data-aaplus-off="chart"]{position:absolute!important;left:16px;right:16px;opacity:0!important;pointer-events:none!important}
[data-aaplus-bar]{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:6px 14px;font:12px/1.2 suisseIntl,ui-sans-serif,system-ui,sans-serif;color:inherit;position:relative;z-index:5}
[data-aaplus-bar][data-at="scope"]{justify-content:flex-start;margin:0 0 20px;padding:8px 12px;border:1px solid rgba(128,128,128,.32);border-radius:8px;position:sticky;top:118px;z-index:20;background:#fff}
@media (min-width:768px){[data-aaplus-bar][data-at="head"]{position:absolute;bottom:100%;right:0;margin-bottom:4px;flex-wrap:nowrap;width:max-content}}
@media (max-width:767px){[data-aaplus-bar][data-at="head"]{align-self:flex-end;margin-bottom:8px}}
[data-aaplus-bar][data-at="head"][data-flow]{position:static;width:auto;flex-wrap:wrap;margin:0 0 8px}
[data-aaplus-bar][data-at="head"][data-flow="narrow"]{margin:0 0 -16px}
[data-aaplus-bar][data-tight] .aap-lbl{display:none}
[data-aaplus-bar][data-at="scope"][data-away]{visibility:hidden}
.aap-group{display:inline-flex;align-items:center;gap:8px}
.aap-brand{display:inline-flex;align-items:center;gap:6px;font-weight:500;white-space:nowrap}
.aap-brand svg{width:18px;height:18px;border-radius:4px;display:block}
.aap-lbl{color:rgb(82,82,82);white-space:nowrap}
.aap-seg{display:inline-flex;align-items:center;gap:4px;border-radius:4px;background:rgb(241,242,244);padding:2px}
.aap-seg button,.aap-plans>summary{height:28px;padding:0 9px;border:1px solid transparent;border-radius:4px;background:transparent;font:500 12px/1 suisseIntl,ui-sans-serif,system-ui,sans-serif;color:inherit;cursor:pointer;white-space:nowrap}
.aap-seg button[aria-pressed="true"]{background:#fff;border-color:rgb(231,231,231)}
.aap-seg i{width:1px;height:16px;background:rgba(128,128,128,.4);margin:0 2px}
.aap-plans{position:relative}
.aap-pick .aap-pop{width:300px}
.aap-pick-head{display:flex;gap:6px;align-items:center;margin-bottom:6px}
.aap-pick-head input{flex:1;min-width:0;height:28px;padding:0 8px;border:1px solid rgb(217,217,217);border-radius:4px;font:inherit;font-size:12.5px;background:#fff;color:#000}
.aap-pick-head button{height:28px;padding:0 8px;border:1px solid rgb(231,231,231);border-radius:4px;background:#fff;font:500 12px/1 suisseIntl,ui-sans-serif,system-ui,sans-serif;cursor:pointer;color:#000}
.aap-pick label{justify-content:flex-start}
.aap-pick label[hidden]{display:none}
.aap-pick label input{margin:0}
.aap-pick label small{margin-left:auto;color:rgb(130,130,130)}
.aap-pick .aap-note{margin:4px 0 2px;font-size:11.5px;color:rgb(130,130,130)}
[data-aaplus-radar] .aap-empty{padding:40px 0;text-align:center;color:rgb(130,130,130);font-size:13px}
.aap-plans>summary{display:inline-flex;align-items:center;gap:5px;list-style:none;border-color:rgb(231,231,231)}
.aap-plans>summary::-webkit-details-marker{display:none}
.aap-plans[data-idle]>summary{color:rgb(130,130,130)}
.aap-plans>summary::after{content:"";width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:translateY(-2px) rotate(45deg)}
.aap-pop{position:absolute;right:0;top:calc(100% + 6px);z-index:60;width:290px;max-height:360px;overflow:auto;background:#fff;color:#000;border:1px solid rgb(217,217,217);border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.14);padding:10px 12px}
[data-at="scope"] .aap-pop{right:auto;left:0}
.aap-pop p{margin:0 0 8px;font-size:11.5px;line-height:1.4;opacity:.65}
.aap-pop label{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:6px;font-size:12.5px}
.aap-pop select{max-width:170px;height:28px;border:1px solid rgb(217,217,217);border-radius:4px;background:transparent;color:inherit;padding:0 6px;font:12px suisseIntl,ui-sans-serif,system-ui,sans-serif}
.aap-mini{display:inline-flex;vertical-align:middle;margin-left:10px;position:relative;top:-2px}
.aap-mini button{height:22px;padding:0 8px;font-size:11px}
[data-aaplus-plot]{width:100%;overflow-x:auto;overflow-y:hidden}
[data-aaplus-card]{border:1px solid rgba(128,128,128,.32);border-radius:8px;padding:16px;margin-top:16px;position:relative}
[data-aaplus-card] .ap-head{display:flex;align-items:baseline;gap:8px;margin-bottom:12px}
[data-aaplus-card] .ap-sq{width:16px;height:16px;flex:none;background:#8841FD}
[data-aaplus-card] h3{font-family:victorSerifBasic,Georgia,Cambria,serif;font-size:24px;line-height:32px;font-weight:500;margin:0}
[data-aaplus-card] .ap-sub,[data-aaplus-card] .ap-foot{font-size:12px;line-height:16px;opacity:.6}
[data-aaplus-card] .ap-sub{margin-bottom:16px}
[data-aaplus-card] .ap-foot{margin-top:10px}
[data-aaplus-card] a{text-decoration:underline;text-underline-offset:2px}
[data-aaplus-card] .ap-head .aap-group{margin-left:auto;font:12px/1.2 suisseIntl,ui-sans-serif,system-ui,sans-serif}
.aap-theme{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:1px solid rgb(231,231,231);border-radius:4px;background:transparent;color:inherit;cursor:pointer}
.aap-theme svg{width:15px;height:15px}
.aap-legend{display:flex;flex-wrap:wrap;gap:6px 18px;margin:0 0 6px;padding:0;list-style:none;font-size:14px}
.aap-legend li{display:flex;align-items:center;gap:7px;cursor:default}
.aap-legend svg{flex:none}
.aap-legend small{font-size:12px;opacity:.55}
.aap-tip{position:absolute;z-index:30;width:min(290px,100%);background:#fff;color:#000;border:1px solid rgb(217,217,217);border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.14);padding:10px 12px;font:12px/1.45 suisseIntl,ui-sans-serif,system-ui,sans-serif;pointer-events:none}
.aap-tip strong{display:block;font-size:13px;font-weight:500}
.aap-tip .sub{display:block;opacity:.55;margin-bottom:5px}
.aap-tip p{margin:0 0 7px;padding-bottom:7px;border-bottom:1px solid rgb(231,231,231);opacity:.8}
.aap-tip .row{display:grid;grid-template-columns:10px 1fr auto;align-items:center;gap:7px}
.aap-tip .row i{width:8px;height:8px;border-radius:50%}
.aap-tip .row b{font-weight:500}
.aap-toast{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:flex;align-items:center;gap:12px;max-width:min(380px,calc(100vw - 40px));padding:12px 12px 12px 14px;background:#fff;color:#000;border:1px solid rgb(217,217,217);border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.14);font:13px/1.4 suisseIntl,ui-sans-serif,system-ui,sans-serif;opacity:0;transform:translateY(8px);transition:opacity .25s ease,transform .25s ease}
.aap-toast[data-in]{opacity:1;transform:none}
.aap-toast .aap-brand svg{width:22px;height:22px}
.aap-toast p{margin:0;flex:1}
.aap-toast a{flex:none;height:30px;display:inline-flex;align-items:center;padding:0 11px;border-radius:4px;background:#000;color:#fff;font-weight:500;text-decoration:none;white-space:nowrap}
.aap-toast button{flex:none;width:26px;height:26px;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;font-size:18px;line-height:1;cursor:pointer;opacity:.55}
.aap-toast button:hover{opacity:1;background:rgb(241,242,244)}`;
  const MOON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z"/></svg>';
  const SUN = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="2.9"/><path d="M8 1.4v1.5M8 13.1v1.5M1.4 8h1.5M13.1 8h1.5M3.3 3.3l1.1 1.1M11.6 11.6l1.1 1.1M3.3 12.7l1.1-1.1M11.6 4.4l1.1-1.1"/></svg>';
  const LOGO = '<svg viewBox="0 0 200 200" aria-hidden="true"><rect width="200" height="200" rx="40" fill="#8841FD"/><g fill="#fff"><g transform="translate(-9 9)"><path d="M100 43h28.5v28.5H118L89.5 100H43V71.5h28.5z"/><rect x="128.5" y="71.5" width="28.5" height="28.5"/><path d="M100 100h28.5v28.5H118L89.5 157H43v-28.5h28.5z"/><rect x="128.5" y="128.5" width="28.5" height="28.5"/></g><path d="M149.5 29h11v12.5H173v11h-12.5V65h-11V52.5H137v-11h12.5z"/></g></svg>';

  /* ---------------- the control row ---------------- */

  const textOf = (h) => [...h.childNodes].filter((n) => !(n.nodeType === 1 && n.hasAttribute("data-aaplus-ui"))).map((n) => n.textContent).join("").trim();
  const pricingSeg = (cls = "") => `<span class="aap-seg ${cls}" role="group" aria-label="Cost pricing"><button type="button" data-aaplus-pricing="api" aria-pressed="${!plan()}" title="Artificial Analysis's own costs, at API prices">API</button><button type="button" data-aaplus-pricing="plan" aria-pressed="${plan()}" title="Each model at its plan's share of API price (data: Priors). Models with no plan stay at API price.">Subscription</button></span>`;

  function barHTML() {
    const e = settings.efforts, on = (what) => e.mode === what;
    const known = state?.available?.length ? state.available : ["low", "medium", "high", "xhigh", "max"];
    const efforts = S.EFFORTS.filter((x) => known.includes(x) || (e.mode === "pick" && e.list.includes(x)));
    const labs = prices ? prices.labs.filter((l) => l.plans.length > 1) : [];
    const picked = labs.filter((l) => settings.plans[l.id]).length;
    return `<span class="aap-brand" title="These controls are added by the AA Plus extension, not by Artificial Analysis">${LOGO}AA Plus</span>
<span class="aap-group"><span class="aap-lbl">Pricing</span>${pricingSeg()}</span>
<span class="aap-group"><span class="aap-lbl">Effort</span><span class="aap-seg" role="group" aria-label="Reasoning effort">
<button type="button" data-aaplus-effort="highest" aria-pressed="${on("highest")}" title="Each model at its highest effort">Highest</button>${state?.headline?.defaultIds?.length ? `<button type="button" data-aaplus-effort="default" aria-pressed="${on("default")}" title="The effort Artificial Analysis marks as each model's API default, where it marks one">API default</button>` : ""}<i></i>${efforts.map((x) => `<button type="button" data-aaplus-effort="${x}" aria-pressed="${e.mode === "pick" && e.list.includes(x)}" title="Show models at ${esc(S.EFFORT_LABEL[x])} effort">${esc(S.EFFORT_LABEL[x])}</button>`).join("")}</span></span>
${labs.length ? `<details class="aap-plans"${plansOpen ? " open" : ""}${plan() ? "" : " data-idle"}><summary title="${plan() ? "The plan each lab's models are priced on" : "Plans apply under Subscription pricing; picking one switches to it"}">Plans${picked ? ` · ${picked}` : ""}</summary><div class="aap-pop"><p>The plan each lab's models are priced on. Default is the plan a model's price was measured on.${plan() ? "" : " Picking one switches the costs to Subscription pricing."}</p>${labs.map((l) => `<label>${esc(l.name)}<select data-aaplus-lab="${esc(l.id)}"><option value="">Default</option>${l.plans.map((p) => `<option value="${esc(p.plan)}"${settings.plans[l.id] === p.plan ? " selected" : ""}>${esc(p.plan)}${Number.isFinite(p.feeUsd) ? ` · $${esc(p.feeUsd)}` : ""}</option>`).join("")}</select></label>`).join("")}</div></details>` : ""}
<button type="button" class="aap-theme" data-aaplus-theme="${S.isDark(settings.theme) ? "light" : "dark"}" aria-pressed="${S.isDark(settings.theme)}" aria-label="Dark mode" title="${S.isDark(settings.theme) ? "Back to the light page" : "Dark mode"}">${S.isDark(settings.theme) ? SUN : MOON}</button>`;
  }

  /** The row above the cards is one line beside AA's tabs when it fits (its labels go first), and otherwise a row of its own
   *  above the cards. It never wraps upward: a second line would sit under AA's sticky tab row, where nothing can be clicked. */
  function fitHead(bar, alone) {
    const kids = [...bar.children], need = () => kids.reduce((w, k) => w + k.offsetWidth, 0) + 14 * (kids.length - 1);
    bar.removeAttribute("data-tight");
    let flow = alone ? "alone" : "";
    if (!flow && innerWidth >= 768) {
      const room = bar.parentElement.clientWidth - 440;
      if (need() > room) { bar.setAttribute("data-tight", ""); if (need() > room) { bar.removeAttribute("data-tight"); flow = "narrow"; } }
    }
    if (flow) bar.setAttribute("data-flow", flow); else bar.removeAttribute("data-flow");
  }

  function placeBar(at, where, how) {
    let bar = document.querySelector(`[data-aaplus-bar][data-at="${at}"]`);
    if (!where) { bar?.remove(); return; }
    if (!bar) { bar = document.createElement("div"); bar.dataset.aaplusBar = ""; bar.dataset.at = at; bar.setAttribute("data-aaplus-ui", ""); }
    if (how === "after" ? where.nextElementSibling !== bar : where.previousElementSibling !== bar) where[how](bar);
    const html = barHTML();
    // Rebuilt only when something it shows changed: a rebuild would close the plan list under the pointer.
    if (bar.dataset.key !== html) { bar.dataset.key = html; bar.innerHTML = html; }
  }

  /* ---------------- headline cards ---------------- */

  const CARDS = [
    { title: "Intelligence", value: (r) => r.ii, sort: (a, b) => b.value - a.value, format: (v) => v.toFixed(0), label: "inside", priced: false },
    { title: "Time per Task", value: (r) => r.time == null ? null : r.time / 60, sort: (a, b) => a.value - b.value, format: (v) => v.toFixed(1), label: "inside", priced: false },
    { title: "Cost per Task", value: (r, ratio) => r.cost == null ? null : r.cost * (ratio ?? 1), sort: (a, b) => a.value - b.value, format: C.usd, label: "top", priced: true },
  ];
  const charts = new WeakMap();
  /** One configuration per headline model under an effort choice: its best-scoring one when several qualify. */
  function variants(head, efforts) {
    const byId = new Map(rows.map((r) => [r.id, r])), rels = [...new Set(head.ids.map((id) => byId.get(id)?.rel).filter(Boolean))];
    const defaults = new Set(head.defaultIds), checked = new Set(Object.keys(head.patterns ?? {}).map((id) => byId.get(id)?.rel));
    return rels.flatMap((rel) => {
      const best = S.choose(rows.filter((r) => r.rel === rel), efforts, defaults).reduce((a, b) => (a && (a.ii ?? -1) >= (b.ii ?? -1) ? a : b), null);
      return best ? [{ ...best, pattern: checked.has(rel) }] : [];
    });
  }
  function headlineCards() {
    const head = state?.headline, ready = head && rows && rowsPath === location.pathname && state.path === location.pathname;
    const found = CARDS.map((def) => [...document.querySelectorAll("h3")].find((h) => !h.closest("[data-aaplus-scope], [data-aaplus-card]") && textOf(h) === def.title)?.closest(".rounded-lg"));
    const picked = ready ? variants(head, settings.efforts) : [];
    const ok = ready && picked.length >= 3 && found.every(Boolean);
    const row = document.querySelector('[role="group"][aria-label="Effort level"]')?.parentElement;
    if (!ok) {
      // Not enough to redraw them faithfully: leave AA's own cards and switch exactly as they are.
      for (const card of found) { if (!card) continue; card.querySelector('[data-aaplus-off="chart"]')?.removeAttribute("data-aaplus-off"); card.querySelector("[data-aaplus-plot]")?.remove(); charts.delete(card); }
      row?.removeAttribute("data-aaplus-off");
      placeBar("head", null);
      return false;
    }
    // In AA's own switch's place, where it sits above the cards; on a page without one, in a row of its own before them.
    if (row) { row.setAttribute("data-aaplus-off", "row"); placeBar("head", row, "after"); } else placeBar("head", found[0].parentElement, "before");
    fitHead(document.querySelector('[data-aaplus-bar][data-at="head"]'), !row);
    const draw = (def, list, pricing) => list.map((r) => { const ratio = def.priced && pricing ? share(r.slug) : null, value = def.value(r, ratio); return value == null ? null : { key: r.rel, name: r.name, color: r.color, logo: r.logo, pattern: r.pattern, value, title: `${r.name}: ${def.format(value)}${def.priced ? (ratio ? ` at ${C.pct(ratio)} of API price (${C.usd(r.cost)})` : " at API price") : ""}` }; }).filter(Boolean).sort(def.sort);
    CARDS.forEach((def, i) => {
      const card = found[i], theirs = [...card.children].find((c) => c.querySelector(".recharts-responsive-container") && !c.hasAttribute("data-aaplus-plot"));
      let host = card.querySelector("[data-aaplus-plot]"), chart = charts.get(card);
      const width = Math.floor(card.clientWidth - 32);
      if (!host || !chart) {
        host?.remove();
        host = document.createElement("div"); host.dataset.aaplusPlot = ""; host.setAttribute("data-aaplus-ui", "");
        (theirs ?? card.lastElementChild).after(host);
        chart = new C.Bars(host, { height: theirs?.firstElementChild?.clientHeight || 288, format: def.format, label: def.label, ariaLabel: def.title });
        charts.set(card, chart);
        // Start from what AA itself shows (highest effort, API prices), so the first change is seen happening.
        chart.update(draw(def, variants(head, { mode: "highest", list: [] }), false), { width });
        chart.key = "";
      }
      theirs?.setAttribute("data-aaplus-off", "chart");
      const items = draw(def, picked, plan()), key = JSON.stringify([items.map((x) => [x.key, x.name, x.value]), width]);
      if (chart.key !== key) { chart.key = key; chart.update(items, { width }); }
    });
    return true;
  }

  /* ---------------- switches on cost charts, and the added chart ---------------- */

  function chartSwitches(cardsOurs) {
    for (const h of document.querySelectorAll("h2, h3")) {
      if (h.closest("[data-aaplus-card]")) continue;
      const mine = h.querySelector(":scope > [data-aaplus-note]"), text = textOf(h);
      // Only where the pricing really applies: charts under AA's model store, and the headline card AA Plus draws.
      const wants = /\bCost\b/.test(text) && !/Image|Video|Speech|Music|Audio/.test(text) && (h.closest("[data-aaplus-scope]") ? !!state?.scope : cardsOurs && text === "Cost per Task" && !!h.closest(".rounded-lg"));
      if (!wants) { mine?.remove(); continue; }
      const html = pricingSeg("aap-mini");
      if (!mine) { const s = document.createElement("span"); s.dataset.aaplusNote = ""; s.setAttribute("data-aaplus-ui", ""); s.dataset.key = html; s.innerHTML = html; h.append(s); }
      else if (mine.dataset.key !== html) { mine.dataset.key = html; mine.innerHTML = html; }
    }
  }

  let added = null;
  function addedChart() {
    const old = document.querySelector("[data-aaplus-card]:not([data-aaplus-radar])");
    const heads = [...document.querySelectorAll("h2, h3")].filter((h) => !h.closest("[data-aaplus-card]"));
    const where = !settings.chart || !rows || !prices || rowsPath !== location.pathname ? null
      : heads.find((h) => textOf(h) === "Cost per Task")?.closest(".rounded-lg")?.parentElement ?? heads.find((h) => /^Cost per Intelligence Index Task|^Cost to Run/.test(textOf(h)))?.closest('[class*="scroll-mt"]') ?? null;
    const pick = (list) => {
      const seen = new Map(); let left = 0;
      for (const row of list) {
        const id = prices.slugs[row.slug], m = id && prices.models[id], r = share(row.slug);
        if (!m || r == null) { left++; continue; }
        const lab = prices.labs.find((l) => l.id === m.lab), chosen = settings.plans[m.lab] && m.plans?.[settings.plans[m.lab]] ? settings.plans[m.lab] : m.plan;
        const fee = chosen === m.plan ? m.fee : lab?.plans.find((p) => p.plan === chosen)?.feeUsd;
        if (!seen.has(id)) seen.set(id, { key: id, name: m.name, color: row.color, logo: row.logo, value: r, title: `${m.name}: ${C.pct(r)} of API price on ${chosen}${fee ? ` ($${fee}/mo)` : ""}. Confidence: ${m.conf}.${row.cost != null ? ` Cost per task: ${C.usd(row.cost * r)} on the plan, ${C.usd(row.cost)} at API price.` : ""}` });
      }
      return { items: [...seen.values()].sort((a, b) => a.value - b.value), left };
    };
    let data = where ? pick(rows.filter((r) => r.sel)) : { items: [], left: 0 };
    if (where && data.items.length < 4) data = pick(rows.filter((r) => r.ii != null).sort((a, b) => b.ii - a.ii).slice(0, 40));
    if (!where || data.items.length < 3) { old?.remove(); added = null; return; }
    let card = old;
    if (!card || !added) {
      old?.remove();
      card = document.createElement("div"); card.dataset.aaplusCard = ""; card.setAttribute("data-aaplus-ui", "");
      card.innerHTML = '<div class="ap-head"><div class="ap-sq"></div><h3>Plan Price vs. API Price</h3></div><div class="ap-sub">Share of the API price a subscriber pays for the same tokens (%) · Lower is better</div><div data-aaplus-plot></div><div class="ap-foot"></div>';
      added = new C.Bars(card.querySelector("[data-aaplus-plot]"), { height: 300, format: C.pct, label: "top", ariaLabel: "Plan price as a share of API price, by model" });
      added.key = "";
    }
    if (card.previousElementSibling !== where) where.after(card);
    const width = Math.floor(card.clientWidth - 34), key = JSON.stringify([data.items.map((x) => [x.key, x.value]), width]);
    if (added.key !== key) { added.key = key; added.update(data.items, { width }); }
    const foot = `Added by AA Plus, not Artificial Analysis. Plan data from <a href="https://mypriors.com" target="_blank" rel="noreferrer">Priors</a>, ${esc(prices.date)}.${data.left ? ` ${data.left} charted model${data.left === 1 ? " has" : "s have"} no first-party plan and ${data.left === 1 ? "is" : "are"} left out.` : ""}`;
    const footEl = card.querySelector(".ap-foot");
    if (footEl.dataset.key !== foot) { footEl.dataset.key = foot; footEl.innerHTML = foot; }
  }

  /* ---------------- strengths radar, in the Benchmarks section ---------------- */

  let radar = null, radarOpen = false, radarQuery = "", lastCand = null, lastPath = null;
  /** Most shapes the radar overlays before it says so; picks past it still draw. */
  const RADAR_READABLE = 6;
  const DASHES = [undefined, "7 4", "2 3"];
  const swatch = (color, dash) => `<svg width="22" height="10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" stroke="${esc(color)}" stroke-width="2.5" stroke-linecap="round"${dash ? ` stroke-dasharray="${esc(dash)}"` : ""}/></svg>`;
  function strengthsCard() {
    const old = document.querySelector("[data-aaplus-radar]");
    const h2 = [...document.querySelectorAll("h2")].find((h) => textOf(h) === "Benchmarks"), section = h2?.closest("section");
    const header = section && [...section.children].find((c) => c.contains(h2));
    const top = state?.selection?.top;
    // A spoke runs from the worst to the best of the models AA is charting, so the leaders spread out instead of
    // crowding the rim as they would against every small model ever scored. With too few of them, Priors' whole field.
    const axes = (strengths?.axes ?? []).map((axis, i) => {
      const scores = (top ?? []).map((row) => strengths.models[row.slug]?.[i]).filter((v) => v != null).sort((x, y) => x - y);
      if (scores.length < 5) return axis;
      const mid = scores.length >> 1;
      return { ...axis, min: scores[0], max: scores.at(-1), median: scores.length % 2 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2 };
    });
    // The models it can draw: those selected on AA's page that the index's evaluations cover, one per model (its best
    // configuration), by Intelligence Index. As on Priors, it shows the top ones until models are picked; then the picks stick.
    const cand = [], seen = new Set();
    for (const row of settings.radar && header && top && axes.length >= 3 && state.path === location.pathname ? top : []) {
      const scores = strengths.models[row.slug];
      if (seen.has(row.rel) || !scores || scores.filter((v) => v != null).length < 3) continue;
      seen.add(row.rel); cand.push(row);
    }
    // It follows AA's selection: a model selected on the page joins the picks, one deselected leaves the radar (and comes back with it).
    const cur = new Set(cand.map((r) => r.rel));
    let picks = settings.radarPicks;
    const prevCand = lastPath === location.pathname ? lastCand : null;
    if (cand.length) { lastCand = cur; lastPath = location.pathname; }
    if (picks && prevCand && cand.length) {
      const added = [...cur].filter((r) => !prevCand.has(r) && !picks.includes(r));
      // Saved after this draw: saving redraws, and this one already uses them.
      if (added.length) { picks = [...picks, ...added].slice(0, 24); const next = picks; setTimeout(() => change({ radarPicks: next }), 0); }
    }
    const shown = picks ? cand.filter((r) => picks.includes(r.rel)) : cand.slice(0, settings.radarTop);
    const tint = new Map(), series = [];
    for (const row of shown) {
      const scores = strengths.models[row.slug];
      const color = row.color || "#888", used = tint.get(color) ?? 0;
      tint.set(color, used + 1);
      series.push({ key: row.rel, name: row.name, color, dash: DASHES[used % DASHES.length], ii: row.ii, scores, points: scores.map((v, i) => S.spoke(axes[i], v)) });
    }
    if (!cand.length) { old?.remove(); radar = null; return; }
    let card = old;
    if (!card || !radar) {
      old?.remove();
      card = document.createElement("div"); card.dataset.aaplusCard = ""; card.dataset.aaplusRadar = ""; card.setAttribute("data-aaplus-ui", "");
      card.innerHTML = '<div class="ap-head"><div class="ap-sq"></div><h3>Strengths by Evaluation</h3><span class="aap-group aap-pick-host"></span></div><div class="ap-sub"></div><ul class="aap-legend"></ul><p class="aap-empty" hidden>No models picked. Pick some under Models.</p><div data-aaplus-plot></div><div class="ap-foot"></div>';
      card.style.margin = "0 0 32px";
      radar = new C.Radar(card.querySelector("[data-aaplus-plot]"), { size: 380, tip: (i) => radar.tipHTML?.(i) ?? "" });
      radar.key = "";
      card.querySelector(".aap-legend").addEventListener("mouseover", (e) => radar?.focus(e.target.closest("li")?.dataset.key ?? null));
      card.querySelector(".aap-legend").addEventListener("mouseleave", () => radar?.focus(null));
    }
    if (header.nextElementSibling !== card) header.after(card);
    const set = (sel, html) => { const node = card.querySelector(sel); if (node.dataset.key !== html) { node.dataset.key = html; node.innerHTML = html; } };
    const on = new Set(shown.map((r) => r.rel));
    set(".aap-pick-host", `<details class="aap-plans aap-pick"${radarOpen ? " open" : ""}><summary title="Which models the radar draws">Models · ${shown.length} of ${cand.length}</summary><div class="aap-pop"><div class="aap-pick-head"><input type="search" placeholder="Search models" aria-label="Search models" data-aaplus-radar-search><button type="button" data-aaplus-radar-reset title="The top ${settings.radarTop} by Intelligence Index">Top ${settings.radarTop}</button><button type="button" data-aaplus-radar-none>None</button></div><p class="aap-note">The models selected on this page. Select more there and they join the radar.</p>${shown.length > RADAR_READABLE ? `<p class="aap-note">More than ${RADAR_READABLE} overlaid shapes get hard to read.</p>` : ""}${cand.map((r) => `<label data-name="${esc(r.name.toLowerCase())}"><input type="checkbox" data-aaplus-radar-pick="${esc(r.rel)}"${on.has(r.rel) ? " checked" : ""}>${esc(r.name)}<small>${esc(r.ii.toFixed(0))}</small></label>`).join("")}</div></details>`);
    const search = card.querySelector("[data-aaplus-radar-search]");
    if (search && search.value !== radarQuery) search.value = radarQuery;
    filterPicks(card);
    card.querySelector(".aap-empty").hidden = series.length > 0;
    card.querySelector("[data-aaplus-plot]").hidden = series.length === 0;
    card.querySelector(".aap-legend").hidden = series.length === 0;
    if (!series.length) return;
    set(".ap-sub", `The top charted models on each evaluation in the ${esc(strengths.index || "Intelligence Index")} · A spoke runs from the lowest score among the charted models to the highest · Hover an evaluation for what it measures`);
    set(".aap-legend", series.map((s) => `<li data-key="${esc(s.key)}">${swatch(s.color, s.dash)}${esc(s.name)}<small>${esc(s.ii.toFixed(0))}</small></li>`).join("") + '<li><svg width="18" height="10" aria-hidden="true"><rect x="1" y="1" width="16" height="8" rx="2" fill="currentColor" fill-opacity=".08" stroke="currentColor" stroke-opacity=".5" stroke-dasharray="2 2"/></svg><small>Median of charted models</small></li>');
    set(".ap-foot", `Added by AA Plus, not Artificial Analysis. Scores and descriptions from <a href="https://mypriors.com" target="_blank" rel="noreferrer">Priors</a>, ${esc(strengths.date)}, as Artificial Analysis published them.`);
    radar.tipHTML = (i) => { const a = axes[i]; return `<strong>${esc(a.name)}</strong><span class="sub">${esc(a.share.toFixed(0))}% of the index</span><p>${esc(S.blurb(a.name, a.description))}</p>${series.map((s) => `<span class="row"><i style="background:${esc(s.color)}"></i><span>${esc(s.name)}</span><b>${esc(S.score(a, s.scores[i]))}</b></span>`).join("")}`; };
    const key = JSON.stringify([axes.map((a) => a.id), series.map((s) => [s.key, s.name, s.color, s.dash, s.points])]);
    if (radar.key !== key) { radar.key = key; radar.update({ axes: axes.map((a) => ({ key: a.id, name: a.label })), series, ghost: axes.map((a) => S.spoke(a, a.median)) }); }
  }

  /** The picker's search narrows its list in place, so typing never redraws the card. */
  function filterPicks(root = document) {
    const q = radarQuery.trim().toLowerCase();
    for (const l of root.querySelectorAll(".aap-pick label[data-name]")) l.hidden = !!q && !l.dataset.name.includes(q);
  }

  /* ---------------- drawing, and staying on the page ---------------- */

  let queued = false;
  function render() {
    if (queued || !document.body) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      try {
        if (!document.getElementById("aaplus-style")) { const s = document.createElement("style"); s.id = "aaplus-style"; s.textContent = STYLE; document.head.append(s); }
        const ours = headlineCards();
        const scope = state?.scope && state.path === location.pathname ? document.querySelector("[data-aaplus-scope]") : null;
        placeBar("scope", scope, "before");
        chartSwitches(ours);
        addedChart();
        strengthsCard();
      } catch (e) { console.warn("AA Plus:", e); }
    });
  }

  /* ---------------- a one-time ask for a GitHub star ----------------
   * Shown once ever, to someone who has come back to AA with AA Plus (a second visit: AA opened again after half an hour
   * or more away) and has clicked at least one AA Plus control, here or in the popup. Never again after it has shown. */
  const STAR_KEY = "star", VISIT_GAP_MS = 30 * 60 * 1000, REPO = "https://github.com/adamholter/aa-plus";
  let star = null, asked = false;
  function starAsk() {
    if (asked || !star || star.shown || star.visits < 2 || !star.clicked || !alive) return;
    asked = true; star.shown = true;
    try { chrome.storage.local.set({ [STAR_KEY]: star }); } catch { alive = false; return; }
    setTimeout(() => {
      const toast = document.createElement("div");
      toast.className = "aap-toast"; toast.setAttribute("data-aaplus-ui", ""); toast.setAttribute("role", "status");
      toast.innerHTML = `<span class="aap-brand">${LOGO}</span><p>Finding AA Plus useful? A star on GitHub helps other people find it.</p><a href="${REPO}" target="_blank" rel="noopener">Star on GitHub</a><button type="button" aria-label="Close">×</button>`;
      const close = () => { toast.removeAttribute("data-in"); setTimeout(() => toast.remove(), 300); };
      toast.querySelector("a").addEventListener("click", close);
      toast.querySelector("button").addEventListener("click", close);
      document.body.append(toast);
      requestAnimationFrame(() => requestAnimationFrame(() => toast.setAttribute("data-in", "")));
    }, 1500);
  }
  function starVisit() {
    try {
      chrome.storage.local.get(STAR_KEY, (got) => {
        star = { visits: 0, last: 0, clicked: false, shown: false, ...(got?.[STAR_KEY] ?? {}) };
        if (star.shown) return;
        const now = Date.now();
        if (now - star.last >= VISIT_GAP_MS) star.visits++;
        star.last = now;
        chrome.storage.local.set({ [STAR_KEY]: star });
        starAsk();
      });
      // Time on AA keeps a visit going: what counts as away is half an hour without AA open.
      setInterval(() => { if (star && !star.shown && document.visibilityState === "visible") { star.last = Date.now(); try { chrome.storage.local.set({ [STAR_KEY]: star }); } catch { alive = false; } } }, 5 * 60 * 1000);
      chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes[STAR_KEY]?.newValue) { const n = changes[STAR_KEY].newValue; star = { ...star, ...n, clicked: !!(star?.clicked || n.clicked), shown: !!(star?.shown || n.shown) }; starAsk(); } });
    } catch { alive = false; }
  }
  function starClicked() {
    if (!star || star.shown || star.clicked) return;
    star.clicked = true;
    try { chrome.storage.local.set({ [STAR_KEY]: star }); } catch { alive = false; }
    starAsk();
  }

  document.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target.closest("button:is([data-aaplus-pricing], [data-aaplus-effort], [data-aaplus-theme], [data-aaplus-radar-top], [data-aaplus-radar-reset], [data-aaplus-radar-none])") : null;
    if (!t) {
      // A click elsewhere closes an open plan list or model picker.
      if ((plansOpen || radarOpen) && !(e.target instanceof Element && e.target.closest(".aap-plans"))) { plansOpen = false; radarOpen = false; for (const d of document.querySelectorAll(".aap-plans[open]")) d.open = false; }
      return;
    }
    e.preventDefault(); e.stopPropagation();
    if (!alive) return;
    starClicked();
    if (t.dataset.aaplusPricing) { if (t.dataset.aaplusPricing !== settings.pricing) change({ pricing: t.dataset.aaplusPricing }); }
    else if (t.dataset.aaplusTheme) change({ theme: t.dataset.aaplusTheme });
    else if (t.dataset.aaplusRadarTop) change({ radarTop: Number(t.dataset.aaplusRadarTop) });
    else if (t.hasAttribute("data-aaplus-radar-reset")) change({ radarPicks: null });
    else if (t.hasAttribute("data-aaplus-radar-none")) change({ radarPicks: [] });
    else change({ efforts: S.toggleEffort(settings.efforts, t.dataset.aaplusEffort) });
  }, true);
  document.addEventListener("toggle", (e) => {
    if (!(e.target instanceof Element) || !e.target.classList.contains("aap-plans")) return;
    if (e.target.classList.contains("aap-pick")) radarOpen = e.target.open; else plansOpen = e.target.open;
  }, true);
  document.addEventListener("input", (e) => {
    if (!(e.target instanceof Element) || !e.target.hasAttribute("data-aaplus-radar-search")) return;
    radarQuery = e.target.value; filterPicks();
  }, true);
  document.addEventListener("change", (e) => {
    const pick = e.target instanceof Element ? e.target.getAttribute("data-aaplus-radar-pick") : null;
    if (pick && alive) {
      // The first pick starts from what is drawn now (the top models), so ticking one adds it rather than replacing them.
      const boxes = [...document.querySelectorAll("[data-aaplus-radar-pick]")], listed = new Set(boxes.map((i) => i.getAttribute("data-aaplus-radar-pick")));
      // Picks for models not selected on the page right now are kept, so selecting one again brings it back.
      const kept = (settings.radarPicks ?? []).filter((r) => !listed.has(r));
      change({ radarPicks: [...kept, ...boxes.filter((i) => i.checked).map((i) => i.getAttribute("data-aaplus-radar-pick"))] });
      return;
    }
    const lab = e.target instanceof Element ? e.target.getAttribute("data-aaplus-lab") : null;
    if (!lab || !alive) return;
    starClicked();
    const plans = { ...settings.plans };
    if (e.target.value) plans[lab] = e.target.value; else delete plans[lab];
    // A plan only shows under Subscription pricing, so picking one turns it on.
    change(e.target.value && !plan() ? { plans, pricing: "plan" } : { plans });
  }, true);

  /** The sticky row belongs to AA's charts: once they have scrolled away, so has it. */
  function stickyRow() {
    const bar = document.querySelector('[data-aaplus-bar][data-at="scope"]');
    if (!bar) return;
    // On the home page AA's store also wraps the image, video and speech sections that follow; the row stops where they start.
    const media = [...document.querySelectorAll("[data-aaplus-scope] h2")].find((h) => /^More from/.test(textOf(h)));
    let bottom = -Infinity;
    for (const el of document.querySelectorAll("[data-aaplus-scope]")) bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
    if (media) bottom = Math.min(bottom, media.getBoundingClientRect().top);
    bar.toggleAttribute("data-away", bottom < 260);
  }

  function start() {
    configure(); render(); starVisit();
    let ticking = false;
    window.addEventListener("scroll", () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { ticking = false; stickyRow(); }); }, { passive: true });
    window.postMessage({ aaplus: "ask" }, location.origin);
    // AA is a single-page app: sections come and go, and it redraws its own headings.
    let timer;
    new MutationObserver((list) => {
      if (list.every((m) => (m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest?.("[data-aaplus-ui]"))) return;
      clearTimeout(timer); timer = setTimeout(render, 250);
    }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(render, 150); });
  }
  // After the page has drawn itself, so nothing is added while React is still claiming its markup.
  if (document.readyState === "complete") start(); else window.addEventListener("load", () => setTimeout(start, 200));
})();
