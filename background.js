// Fetches AA Plus's data from Priors. A content script on artificialanalysis.ai cannot reach another
// origin under that page's rules, so the requests are made here and the answers cached for a while.
// Nothing about models, plans or benchmarks is written into the extension: it all comes from these
// endpoints, which Priors answers from its live snapshot (rebuilt by its scrape job every 15 minutes).
const DEFAULT_BASE = "https://mypriors.com", MAX_AGE_MS = 30 * 60 * 1000;
const SOURCES = {
  prices: { path: "/api/plan-prices", key: "cache", ok: (d) => Array.isArray(d?.models) },
  strengths: { path: "/api/aa-strengths", key: "strengths", ok: (d) => Array.isArray(d?.axes) && d.models && typeof d.models === "object" },
  metrics: { path: "/api/aa-task-metrics", key: "metrics", ok: (d) => Array.isArray(d?.sources) },
};

async function load(kind, force) {
  const source = SOURCES[kind];
  const got = await chrome.storage.local.get(["base", source.key]), base = got.base ?? DEFAULT_BASE, cache = got[source.key];
  if (!force && cache && cache.base === base && Date.now() - cache.at < MAX_AGE_MS) return { ok: true, data: cache.data, at: cache.at };
  try {
    const res = await fetch(`${base}${source.path}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Priors answered ${res.status}`);
    const data = await res.json();
    if (!source.ok(data)) throw new Error("Priors sent something unexpected");
    const at = Date.now();
    await chrome.storage.local.set({ [source.key]: { base, at, data } });
    return { ok: true, data, at };
  } catch (e) {
    // The last good answer is better than nothing while Priors is unreachable.
    return cache && cache.base === base ? { ok: true, data: cache.data, at: cache.at, stale: String(e.message ?? e) } : { ok: false, error: String(e.message ?? e) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  // The report form is its own page, opened beside the tab it is about.
  if (msg?.type === "open-report") { chrome.tabs.create({ url: chrome.runtime.getURL("report.html") }); return false; }
  if (!msg || !(msg.type in SOURCES)) return false;
  load(msg.type, !!msg.force).then(reply);
  return true;
});
