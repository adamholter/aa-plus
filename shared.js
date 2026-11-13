// Logic both halves of the extension need: the page-side bridge (page.js) and the UI (content.js, popup.js).
// Loaded into each world separately; nothing here touches the DOM.
// eslint-disable-next-line no-unused-vars
var __aaPlusShared = (() => {
  /** Reasoning efforts, lowest first. `default` is a model with a single configuration: it is always shown. */
  const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
  const RANK = { none: 0, minimal: 1, low: 2, medium: 3, default: 3.5, high: 4, xhigh: 5, max: 6 };
  const EFFORT_LABEL = { none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "XHigh", max: "Max" };
  const THEMES = ["auto", "light", "dark"], RADAR_SIZES = [3, 4, 6];
  const DEFAULTS = { pricing: "plan", plans: {}, efforts: { mode: "highest", list: [] }, chart: true, radar: true, radarTop: 4, radarPicks: null, theme: "auto" };

  /** AA names a model's configuration in its `suffix`: "Max, Default Fallback", "Non-reasoning", "Reasoning", none at all. */
  function effortOf(suffix) {
    const first = String(suffix ?? "").toLowerCase().split(",")[0].trim();
    if (first in RANK && first !== "default") return first;
    return first === "non-reasoning" ? "none" : "default";
  }

  /**
   * Which of one model's configurations to show. `rows`: [{ id, eff, ii }] for a single model.
   * - highest: its highest effort (what AA calls Max).
   * - default: the one AA marks as the API default, when it marks one; otherwise as highest.
   * - pick: every configuration at a picked effort.
   * A configuration AA has not scored (`ii` null) is never chosen over one it has.
   */
  function choose(rows, efforts, defaultIds) {
    const scored = rows.filter((r) => r.ii != null), pool = scored.length ? scored : rows;
    const top = () => pool.reduce((a, b) => (RANK[b.eff] - RANK[a.eff] || (b.ii ?? -1) - (a.ii ?? -1)) > 0 ? b : a);
    if (!pool.length) return [];
    if (efforts?.mode === "pick" && efforts.list?.length) return pool.filter((r) => r.eff === "default" || efforts.list.includes(r.eff));
    if (efforts?.mode === "default") { const marked = pool.find((r) => defaultIds?.has(r.id)); return [marked ?? top()]; }
    return [top()];
  }

  /** The share of API price a subscriber pays for this model, on the plan picked for its lab; null when no plan sells it. */
  function share(prices, plans, slug) {
    const id = prices?.slugs?.[slug], m = id && prices.models?.[id];
    if (!m) return null;
    const picked = plans?.[m.lab], r = (picked && m.plans?.[picked]) ?? m.r;
    return r > 0 && r < 1 ? r : null;
  }

  /** Keep only the shapes the UI reads from Priors' `/api/plan-prices`. A free tier is not a price: a free model uses its paid plan. */
  function adoptPrices(data, at) {
    const models = {}, slugs = {};
    for (const m of Array.isArray(data?.models) ? data.models : []) {
      const p = m.free ? m.paid : m;
      if (!p || !(p.ratio > 0)) continue;
      models[m.id] = { name: String(m.name), lab: String(m.lab), r: p.ratio, plan: String(p.plan), fee: Number.isFinite(p.feeUsd) ? p.feeUsd : undefined, conf: String(p.confidence), plans: m.plans ? Object.fromEntries(Object.entries(m.plans).filter(([, v]) => v?.ratio > 0).map(([k, v]) => [k, v.ratio])) : undefined };
      for (const slug of m.aa ?? []) slugs[String(slug)] = m.id;
    }
    const labs = (Array.isArray(data?.labs) ? data.labs : []).map((l) => ({ id: String(l.id), name: String(l.name), plans: (Array.isArray(l.plans) ? l.plans : []).map((p) => ({ plan: String(p.plan), ...(Number.isFinite(p.feeUsd) ? { feeUsd: p.feeUsd } : {}) })) }));
    return { date: String(data?.date ?? ""), at, labs, models, slugs };
  }

  const settingsOf = (stored) => ({
    ...DEFAULTS, ...stored, plans: { ...stored?.plans },
    efforts: { ...DEFAULTS.efforts, ...stored?.efforts, list: [...(stored?.efforts?.list ?? [])].filter((e) => EFFORTS.includes(e)) },
    theme: THEMES.includes(stored?.theme) ? stored.theme : DEFAULTS.theme, radarTop: RADAR_SIZES.includes(stored?.radarTop) ? stored.radarTop : DEFAULTS.radarTop,
    // The models picked for the radar (AA model release ids). null: the top models of AA's selection.
    radarPicks: Array.isArray(stored?.radarPicks) ? stored.radarPicks.map(String).slice(0, 24) : null,
  });

  /**
   * Keep only the shapes the radar reads from Priors' `/api/aa-strengths`: the index's evaluations, and each
   * configuration's score on them by AA slug. A spoke runs from the field's lowest score to its highest.
   */
  function adoptStrengths(data, at) {
    const num = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
    const axes = (Array.isArray(data?.axes) ? data.axes : []).map((a) => ({ id: String(a.id), name: String(a.name), label: String(a.label ?? a.name), description: String(a.description ?? ""), unit: String(a.unit ?? ""), higherIsBetter: a.higherIsBetter !== false, share: num(a.share) ?? 0, min: num(a.min) ?? 0, max: num(a.max) ?? 0, median: num(a.median) }));
    const models = {};
    for (const [slug, row] of Object.entries(data?.models && typeof data.models === "object" ? data.models : {})) if (Array.isArray(row)) models[slug] = axes.map((_, i) => num(row[i]));
    return { date: String(data?.date ?? ""), index: String(data?.index ?? ""), at, axes, models };
  }
  /** Where a score sits on its spoke: 0.1 at the field's worst, 1 at its best. */
  function spoke(axis, value) {
    if (value == null || !(axis.max > axis.min)) return null;
    const t = Math.min(1, Math.max(0, (value - axis.min) / (axis.max - axis.min)));
    return 0.1 + 0.9 * (axis.higherIsBetter ? t : 1 - t);
  }
  /** A score as its evaluation publishes it. */
  const score = (axis, value) => value == null ? "no score" : axis.unit === "percent" ? `${value.toFixed(1)}%` : axis.unit === "elo" ? value.toFixed(0) : String(+value.toFixed(2));
  /** A description for a place that already shows the name: the "Name: " opening is dropped. */
  function blurb(name, description) {
    const text = String(description ?? "").trim(), lead = text.match(/^([^:]{2,60}):\s+(?=\S)/);
    return lead && name.toLowerCase().startsWith(lead[1].toLowerCase()) ? text.slice(lead[0].length).replace(/^[a-z]/, (c) => c.toUpperCase()) : text;
  }
  const isDark = (theme) => theme === "dark" || (theme !== "light" && typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches);

  /** The effort setting after a click on one control of the picker. */
  function toggleEffort(efforts, what) {
    if (what === "highest" || what === "default") return { mode: what, list: [] };
    const list = efforts.mode === "pick" ? (efforts.list.includes(what) ? efforts.list.filter((e) => e !== what) : [...efforts.list, what]) : [what];
    return list.length ? { mode: "pick", list: EFFORTS.filter((e) => list.includes(e)) } : { mode: "highest", list: [] };
  }

  return { EFFORTS, RANK, EFFORT_LABEL, DEFAULTS, THEMES, RADAR_SIZES, effortOf, choose, share, adoptPrices, adoptStrengths, spoke, score, blurb, isDark, settingsOf, toggleEffort };
})();
