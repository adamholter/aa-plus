// The page-side half of AA Plus. It runs in Artificial Analysis's own JavaScript world so it can reach
// the store its charts read from, and it changes nothing as the page loads: no data is rewritten in
// transit, so the page boots exactly as it does without the extension.
//
// AA keeps the models a page charts in one React context: the selected rows, the full list, and a
// setter. Handing that setter new rows is all it takes for every chart under it to redraw, with AA's
// own animation. So:
//  - Subscription pricing = the same selection, as copies whose cost fields are scaled by the plan's share.
//  - An effort choice     = a different selection: other configurations of the same models.
// The headline cards above are not under that store (the server sends them finished), so the UI half
// redraws those itself from the rows this file reports.
/* global __aaPlusShared */
(() => {
  if (window.__aaPlusBridge) return;
  window.__aaPlusBridge = true;
  const S = __aaPlusShared;
  const SRC = Symbol("aaplus.source"), STAMP = Symbol("aaplus.share");
  let cfg = null, defaults = new Set(), lastSet = null, base = null, doneRev = null, pathSeen = null, anchor = null;
  let sentRows = null, sentState = "";

  const fiberOf = (el) => { for (const k in el) if (k.startsWith("__reactFiber$")) return el[k]; return null; };
  const srcOf = (row) => row[SRC] ?? row;
  // A model's configurations share a release. The home page gives it an id and a slug, the models page only a slug.
  const relOf = (row) => row.release?.slug ?? row.release?.id ?? row.id;
  const isCost = (key) => /cost/i.test(key) && !/^price|token/i.test(key);
  const scale = (v, r) => typeof v === "number" ? (Number.isFinite(v) ? v * r : v)
    : Array.isArray(v) ? v.map((x) => scale(x, r))
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scale(x, r)])) : v;
  const total = (c) => c == null ? null : typeof c === "number" ? c : typeof c.total === "number" ? c.total : typeof c.cost?.total === "number" ? c.cost.total : null;

  /** A second store inside the first: the model releases a "by release" chart draws, each holding its own rows. */
  let relAnchor = null;
  function releaseStore() {
    const from = (el) => {
      for (let f = fiberOf(el), n = 0; f && n < 160; f = f.return, n++) {
        const v = f.memoizedProps?.value;
        if (v && typeof v === "object" && typeof v.setSelectedReleases === "function" && Array.isArray(v.selectedReleases) && Array.isArray(v.allReleases)) return { value: v, fiber: f };
      }
      return null;
    };
    if (relAnchor?.isConnected) { const hit = from(relAnchor); if (hit) return hit; }
    for (const el of document.querySelectorAll("[data-aaplus-scope] h3, [data-aaplus-scope] .recharts-wrapper")) { const hit = from(el); if (hit) { relAnchor = el; return hit; } }
    relAnchor = null;
    return null;
  }

  /* Rows AA Plus reprices where they are (see `inPlace`). API holds what AA published for each; a row is always
   * rewritten from that, never from its current value, so switching back and forth cannot drift. */
  const API = new WeakMap(), FACTOR = new WeakMap();
  const apiValue = (row, key) => { const kept = API.get(row); return kept && key in kept ? kept[key] : row[key]; };
  /**
   * Some charts read rows the selection does not hold: the scatter's Pareto line and its faded off-selection
   * points come from the full model list, and the by-release chart from the releases store. Neither has a
   * setter for rows, so those rows are repriced in place, and each store is then handed a copy of something
   * it already holds (its selected releases, its filters) so that everything derived from the rows is
   * recomputed. Both go through the raw state setters, which leave the address bar alone.
   */
  function inPlace(prov, releases) {
    let changed = false;
    const visit = (row) => {
      if (!row || typeof row !== "object" || typeof row.slug !== "string") return;
      const factor = (cfg.pricing === "plan" ? S.share(cfg.prices, cfg.plans, row.slug) : null) ?? 1;
      if ((FACTOR.get(row) ?? 1) === factor) return;
      if (!API.has(row)) API.set(row, Object.fromEntries(Object.keys(row).filter((key) => isCost(key) && row[key] != null).map((key) => [key, row[key]])));
      for (const [key, value] of Object.entries(API.get(row))) row[key] = factor === 1 ? value : scale(value, factor);
      FACTOR.set(row, factor);
      changed = true;
    };
    for (const row of prov.all) visit(row);
    if (releases) for (const rel of releases.value.allReleases) for (const row of rel.models ?? []) visit(row);
    if (!changed) return;
    if (releases) { const sel = releases.value.selectedReleases; (rawSetter(releases.fiber, sel) ?? releases.value.setSelectedReleases)([...sel]); }
    const filters = prov.value.selectedFilters, setFilters = filters && typeof filters === "object" ? rawSetter(prov.fiber, filters) : null;
    if (setFilters) setFilters({ ...filters });
  }

  /**
   * The page's model store, under whichever names this page gives it: the home and models pages call it
   * selectedPageModels / allPageModels, an evaluation's page selectedModels / allModels. Same shape either way.
   */
  const storeOf = (v) => !v || typeof v !== "object" ? null
    : typeof v.setSelectedPageModels === "function" && Array.isArray(v.selectedPageModels) && Array.isArray(v.allPageModels) ? { sel: v.selectedPageModels, all: v.allPageModels, set: v.setSelectedPageModels }
    : typeof v.setSelectedModels === "function" && Array.isArray(v.selectedModels) && Array.isArray(v.allModels) ? { sel: v.selectedModels, all: v.allModels, set: v.setSelectedModels }
    : null;

  /** The context that holds the page's model selection, found by walking up from something inside it. */
  function provider() {
    const from = (el) => {
      let f = fiberOf(el), n = 0;
      while (f && n++ < 160) {
        const v = f.memoizedProps?.value;
        const store = storeOf(v);
        if (store) return { value: v, fiber: f, ...store };
        f = f.return;
      }
      return null;
    };
    if (anchor?.isConnected) { const hit = from(anchor); if (hit) return hit; }
    for (const el of document.querySelectorAll("h2, h3, .recharts-wrapper")) { const hit = from(el); if (hit) { anchor = el; return hit; } }
    anchor = null;
    return null;
  }

  /** Mark the DOM the store covers, so the UI only offers controls on charts that really follow it. */
  function markScope(fiber) {
    if (document.querySelector("[data-aaplus-scope]")) return;
    const walk = (f, depth) => { for (let c = f.child; c; c = c.sibling) { if (c.tag === 5 && c.stateNode?.setAttribute) c.stateNode.setAttribute("data-aaplus-scope", ""); else if (depth < 60) walk(c, depth + 1); } };
    walk(fiber, 0);
  }

  /** The raw state setter behind the selection: unlike the public one it does not write the selection into the address bar. */
  function rawSetter(fiber, sel) {
    for (const owner of [fiber.return, fiber.return?.alternate]) {
      for (let hook = owner?.memoizedState, i = 0; hook && i < 80; hook = hook.next, i++) if (hook.memoizedState === sel && typeof hook.queue?.dispatch === "function") return hook.queue.dispatch;
    }
    return null;
  }

  /* ---- headline cards: the finished bar lists the server sent, for both of AA's effort options ---- */
  const LAZY = Symbol.for("react.lazy");
  /** Bar lists written out in a piece of page data that React has not parsed. */
  function fromText(text, out) {
    const start = /"data":(?=\[\{"id":"[0-9a-f-]{36}","label":)/g;
    for (let m; (m = start.exec(text));) {
      let depth = 0, quoted = false, end = -1;
      for (let i = m.index + m[0].length; i < text.length; i++) {
        const c = text[i];
        if (quoted) { if (c === "\\") i++; else if (c === '"') quoted = false; }
        else if (c === '"') quoted = true;
        else if (c === "[" || c === "{") depth++;
        else if ((c === "]" || c === "}") && --depth === 0) { end = i; break; }
      }
      if (end < 0) break;
      try { const list = JSON.parse(text.slice(m.index + m[0].length, end + 1)); if (Array.isArray(list) && list[0] && "displayValue" in list[0]) out.push(list); } catch { /* not a list after all */ }
      start.lastIndex = end;
    }
    return out;
  }
  function lists(node, out, depth = 0) {
    if (!node || typeof node !== "object" || depth > 60) return out;
    if (Array.isArray(node)) { for (const x of node) lists(x, out, depth + 1); return out; }
    if (node.$$typeof === LAZY) {
      // The option that is not on screen has not been read by React yet: its payload is still the text the server sent.
      const p = node._payload, value = p?.value ?? p?._result;
      return typeof value === "string" ? fromText(value, out) : lists(value, out, depth + 1);
    }
    const props = node.$$typeof ? node.props : node;
    if (!props || typeof props !== "object") return out;
    for (const [key, v] of Object.entries(props)) {
      if (key === "data" && Array.isArray(v) && v[0] && typeof v[0] === "object" && "displayValue" in v[0] && "id" in v[0]) out.push(v);
      else if (v && typeof v === "object" && key !== "_owner" && key !== "_store") lists(v, out, depth + 1);
    }
    return out;
  }
  function headline() {
    const group = document.querySelector('[role="group"][aria-label="Effort level"]');
    let options = null;
    for (let f = group && fiberOf(group), n = 0; f && n < 60; f = f.return, n++) if (Array.isArray(f.memoizedProps?.options) && f.memoizedProps.options[0]?.content) { options = f.memoizedProps.options; break; }
    const pick = (value) => { const o = options?.find((x) => x.value === value); return o ? lists(o.content, []) : []; };
    let highest = pick("highest-effort"), marked = pick("default-effort");
    if (!highest.length) {
      // No effort switch on this page (or its contents are not readable): the cards that are mounted.
      const seen = new Set();
      for (const el of document.querySelectorAll(".recharts-wrapper")) { if (el.closest("[data-aaplus-scope]")) continue; for (let f = fiberOf(el), n = 0; f && n < 40; f = f.return, n++) { const d = f.memoizedProps?.data; if (Array.isArray(d) && d[0] && typeof d[0] === "object" && "displayValue" in d[0]) { if (!seen.has(d)) { seen.add(d); highest.push(d); } break; } } }
    }
    if (!highest.length) return null;
    const patterns = {};
    for (const list of [...highest, ...marked]) for (const b of list) if (typeof b.pattern === "string" && b.pattern && b.pattern !== "$undefined") patterns[b.id] = b.pattern;
    return { ids: [...new Set(highest.flat().map((b) => String(b.id)))], defaultIds: [...new Set(marked.flat().map((b) => String(b.id)))], patterns };
  }

  /* ---- the selection ---- */
  function sync({ fiber, sel, all, set }) {
    const selected = new Map(sel.map((r) => [r.id, srcOf(r)]));
    // A model's configurations: from the full list, preferring the selected copy of a row (it carries more fields).
    const byRel = new Map();
    const add = (row) => { const k = relOf(row), list = byRel.get(k) ?? byRel.set(k, []).get(k); if (!list.some((x) => x.id === row.id)) list.push(row); };
    for (const r of selected.values()) add(r);
    for (const r of all) add(selected.get(r.id) ?? r);
    const pickFor = (rel) => S.choose((byRel.get(rel) ?? []).map((row) => ({ id: row.id, eff: S.effortOf(row.suffix), ii: row.intelligenceIndex ?? null, row })), cfg.efforts, defaults).map((c) => c.row);

    // The models on the charts are AA's (or the visitor's) choice; an effort choice only changes which of their configurations show.
    if (sel !== lastSet) { const present = new Set(sel.map(relOf)); base = new Set([...present, ...(base ? [...base].filter((rel) => !pickFor(rel).length) : [])]); }

    let target = null, moved = false;
    if (cfg.rev !== doneRev) {
      if (doneRev === null && cfg.efforts.mode === "highest") doneRev = cfg.rev;      // AA opens on each model's highest effort already
      else if (all.length <= sel.length) return { byRel, pending: true };            // the full list has not arrived yet
      else { target = [...base].flatMap(pickFor).sort((a, b) => (b.intelligenceIndex ?? -1) - (a.intelligenceIndex ?? -1)); doneRev = cfg.rev; moved = true; }
    }
    target ??= sel.map(srcOf);

    const current = new Map(sel.map((r) => [srcOf(r), r]));
    const desired = target.map((src) => {
      const r = (cfg.pricing === "plan" ? S.share(cfg.prices, cfg.plans, src.slug) : null) ?? 1, cur = current.get(src);
      // AA's own row serves as it is at API price, unless it is one that gets repriced in place: then only a copy is safe to show.
      if (cur && (cur === src ? r === 1 && !API.has(src) : cur[STAMP] === r)) return cur;
      if (r === 1 && !API.has(src)) return src;
      const copy = { ...src };
      for (const key of Object.keys(src)) if (isCost(key) && src[key] != null) copy[key] = r === 1 ? apiValue(src, key) : scale(apiValue(src, key), r);
      Object.defineProperty(copy, SRC, { value: src });
      Object.defineProperty(copy, STAMP, { value: r });
      return copy;
    });
    if (desired.length !== sel.length || desired.some((d, i) => d !== sel[i])) {
      lastSet = desired;
      // A changed set of models goes through AA's own setter (it keeps the address bar in step); a repricing of the same set does not need to.
      ((!moved && rawSetter(fiber, sel)) || set)(desired);
    } else lastSet = sel;
    return { byRel };
  }

  function report(prov, synced, head) {
    const post = (msg) => window.postMessage(msg, location.origin);
    const byRel = synced?.byRel;
    if (byRel && prov.all !== sentRows) {
      sentRows = prov.all;
      const rows = [];
      for (const [rel, list] of byRel) for (const r of list) rows.push({ id: String(r.id), slug: r.slug, name: r.shortName ?? r.name, rel: String(rel), eff: S.effortOf(r.suffix), ii: r.intelligenceIndex ?? null, time: typeof r.intelligenceIndexTimePerTask === "number" ? r.intelligenceIndexTimePerTask : null, cost: total(apiValue(r, "intelligenceIndexCostPerTask")), color: r.creator?.color, logo: r.creator?.logo, sel: !!r.chartDefaultSelected });
      post({ aaplus: "rows", path: location.pathname, rows });
    }
    const sel = prov?.sel ?? [];
    const available = byRel && base ? S.EFFORTS.filter((e) => [...base].some((rel) => (byRel.get(rel) ?? []).some((r) => r.intelligenceIndex != null && S.effortOf(r.suffix) === e))) : [];
    const state = { aaplus: "state", path: location.pathname, scope: !!prov, pending: !!synced?.pending, selection: { count: sel.length, repriced: sel.filter((r) => r[STAMP] != null && r[STAMP] !== 1).length, efforts: [...new Set(sel.map((r) => S.effortOf(r.suffix)))], top: sel.filter((r) => r.intelligenceIndex != null).sort((a, b) => b.intelligenceIndex - a.intelligenceIndex).slice(0, 80).map((r) => ({ slug: r.slug, rel: String(relOf(r)), name: r.shortName ?? r.name, ii: r.intelligenceIndex, color: r.creator?.color, logo: r.creator?.logo })) }, available, headline: head };
    const sig = JSON.stringify(state);
    if (sig !== sentState) { sentState = sig; post(state); }
  }

  function tick() {
    try {
      if (location.pathname !== pathSeen) { pathSeen = location.pathname; lastSet = null; base = null; doneRev = null; sentRows = null; sentState = ""; }
      const prov = provider(), head = headline();
      if (head) defaults = new Set(head.defaultIds);
      if (prov) markScope(prov.fiber);
      if (prov && cfg) inPlace(prov, releaseStore());
      report(prov, prov && cfg ? sync(prov) : null, head);
    } catch (e) { console.warn("AA Plus:", e); }
  }

  /* ---- the model picker's "Select all" ---- */
  /**
   * AA's model picker (a cmdk list) filters its options as you type, but its "Select all" still selects every model. With
   * something typed, AA Plus makes it select what the search shows ("openai" → every OpenAI configuration listed), added to
   * the current selection, through the same store setter AA uses. With the search empty, AA's own Select all runs.
   */
  function selectShown(button) {
    const pop = button.closest('[role="dialog"]'), root = pop?.querySelector("[cmdk-root]"), query = root?.querySelector("[cmdk-input]")?.value.trim();
    if (!query) return false;
    const shown = new Set([...root.querySelectorAll("[cmdk-item]")].map((el) => el.getAttribute("data-value")).filter((v) => v && !v.startsWith("group:")));
    if (!shown.size) return false;
    // The store this picker edits: the page's model selection, or the releases store of a "by release" chart. Both sit above
    // every picker, so the one meant is the one whose total is the "N of M models" its button shows.
    const total = Number(/of (\d+)/.exec(document.querySelector(`[aria-controls="${pop.id}"]`)?.textContent ?? "")?.[1]);
    const stores = [];
    for (let f = fiberOf(button), n = 0; f && n < 200; f = f.return, n++) {
      const v = f.memoizedProps?.value;
      if (!v || typeof v !== "object") continue;
      const models = storeOf(v);
      if (models) stores.push({ all: models.all, selected: models.sel, set: models.set, key: (r) => r.slug, id: (r) => r.id });
      else if (typeof v.setSelectedReleases === "function" && Array.isArray(v.selectedReleases) && Array.isArray(v.allReleases))
        stores.push({ all: v.allReleases, selected: v.selectedReleases, set: v.setSelectedReleases, key: (r) => r?.slug ?? r?.id, id: (r) => r?.slug ?? r?.id });
    }
    const store = stores.find((x) => x.all.length === total) ?? (Number.isFinite(total) ? null : stores[0]);
    if (!store || !store.all.some((r) => shown.has(store.key(r)))) return false;
    const have = new Set(store.selected.map(store.id)), add = store.all.filter((r) => shown.has(store.key(r)) && !have.has(store.id(r)));
    if (add.length) store.set([...store.selected, ...add]);
    return true;
  }
  // Ahead of React, which listens at its root: a click taken here never reaches AA's own handler.
  window.addEventListener("click", (e) => {
    const button = e.target instanceof Element ? e.target.closest("button") : null;
    if (!button || button.textContent.trim() !== "Select all" || !button.closest('[role="dialog"]')?.querySelector("[cmdk-root]")) return;
    try { if (selectShown(button)) { e.stopPropagation(); e.preventDefault(); } } catch (err) { console.warn("AA Plus:", err); }
  }, true);

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || typeof e.data !== "object") return;
    if (e.data.aaplus === "config") { cfg = { pricing: e.data.pricing, prices: e.data.prices, plans: e.data.plans ?? {}, efforts: e.data.efforts ?? { mode: "highest", list: [] }, rev: e.data.rev }; tick(); }
    else if (e.data.aaplus === "ask") { sentRows = null; sentState = ""; tick(); }
  });
  setInterval(tick, 350);
})();
