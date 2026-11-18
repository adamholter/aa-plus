// The form behind "Report a bug or request a feature". Reports go to Priors, into the same inbox as mypriors.com/request.
// Nothing is sent until the person presses Send, and the technical details are shown first and can be left out.
/* global __aaPlusShared, chrome */
(() => {
  const S = __aaPlusShared, $ = (id) => document.getElementById(id), DEFAULT_BASE = "https://mypriors.com", MAX_SHOTS = 3, MAX_SIDE = 1800;
  const COPY = { bug: "What went wrong, and on which chart", feature: "What should AA Plus do", other: "What do you want to say" };
  let kind = "bug", shots = [], base = DEFAULT_BASE, client = "", pageUrl = "";

  function browserName() {
    const brand = navigator.userAgentData?.brands?.find((b) => !/not.a.brand|chromium/i.test(b.brand));
    if (brand) return `${brand.brand} ${brand.version}`;
    return /Firefox\/(\d+)/.exec(navigator.userAgent)?.[0] ?? /Chrome\/(\d+)/.exec(navigator.userAgent)?.[0] ?? "unknown browser";
  }
  function contextOf(settings, diag) {
    const s = S.settingsOf(settings), plans = Object.entries(s.plans).map(([lab, plan]) => `${lab}:${plan}`).join(",") || "default";
    const parts = [`AA Plus ${chrome.runtime.getManifest().version}`, browserName(), diag?.path ? `page ${diag.path}` : null, `pricing ${s.pricing}`, `efforts ${s.efforts.mode}${s.efforts.list.length ? `:${s.efforts.list.join(",")}` : ""}`, `plans ${plans}`, `cost ${s.costSource}`, `time ${s.timeSource}`, `released ${s.released}`, `weights ${s.weights}`, `labs hidden ${s.labsOff.length}`, s.planOnly ? "plan-only" : null, s.freeTiers ? "free tiers" : null, diag ? `charted ${diag.charted}, priced ${diag.priced}` : null, diag?.noPlan?.length ? `no plan ${diag.noPlan.join(",")}` : null];
    return parts.filter(Boolean).join(" · ").slice(0, 600);
  }
  /** Screenshots are redrawn smaller, so several fit one request and any metadata in the original file stays behind. */
  async function shrink(file) {
    const image = await createImageBitmap(file), scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas"); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height); image.close();
    const blob = await new Promise((done) => canvas.toBlob(done, "image/jpeg", 0.85));
    return new File([blob], `${(file.name || "screenshot").replace(/\.[^.]*$/, "")}.jpg`, { type: "image/jpeg" });
  }
  function drawShots() {
    $("shots").replaceChildren(...shots.map((f, i) => { const row = document.createElement("span"), x = document.createElement("button"); row.textContent = f.name; x.type = "button"; x.textContent = "×"; x.setAttribute("aria-label", `Remove ${f.name}`); x.onclick = () => { shots.splice(i, 1); drawShots(); }; row.append(x); return row; }));
  }
  async function addShots(list) {
    showError("");
    for (const f of [...list].filter((x) => x.type.startsWith("image/"))) {
      if (shots.length >= MAX_SHOTS) { showError(`Attach at most ${MAX_SHOTS} screenshots.`); break; }
      try { shots.push(await shrink(f)); } catch { showError(`${f.name} could not be read as an image.`); }
    }
    drawShots();
  }
  function showError(text) { $("error").textContent = text; $("error").hidden = !text; }

  $("kind").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-kind]"); if (!b) return;
    kind = b.dataset.kind;
    for (const x of $("kind").children) x.setAttribute("aria-pressed", String(x === b));
    $("text-label").textContent = COPY[kind];
  });
  $("files").addEventListener("change", async (e) => { await addShots(e.target.files); e.target.value = ""; });
  document.addEventListener("paste", (e) => { if (e.clipboardData?.files?.length) { e.preventDefault(); addShots(e.clipboardData.files); } });
  $("again").addEventListener("click", () => { $("text").value = ""; shots = []; drawShots(); $("done").hidden = true; $("form").hidden = false; $("text").focus(); });
  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("text").value.trim();
    if (!text) { showError(kind === "bug" ? "Write what went wrong." : "Write what you are asking for."); $("text").focus(); return; }
    showError(""); $("send").disabled = true; $("send").textContent = "Sending";
    const form = new FormData();
    form.set("kind", kind); form.set("text", text); form.set("client", client); form.set("website", $("website").value);
    if ($("contact").value.trim()) form.set("contact", $("contact").value.trim());
    if ($("include").checked) { form.set("context", $("context").textContent); if (pageUrl) form.set("url", pageUrl); } else form.set("context", `AA Plus ${chrome.runtime.getManifest().version}`);
    for (const f of shots) form.append("file", f, f.name);
    try {
      const res = await fetch(`${base}/api/feedback`, { method: "POST", body: form, headers: { "x-aa-plus": chrome.runtime.getManifest().version } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error || "The report could not be sent. Try again in a moment.");
      $("done-text").textContent = body.filesDropped ? "Thanks. The report arrived, but a screenshot could not be stored." : "Thanks. It went to the person who builds AA Plus.";
      $("form").hidden = true; $("done").hidden = false;
    } catch (err) { showError(err instanceof TypeError ? "Priors could not be reached. Check your connection and try again." : err.message); }
    finally { $("send").disabled = false; $("send").textContent = "Send"; }
  });

  chrome.storage.local.get(["settings", "diag", "base", "reportClient"], (got) => {
    base = got.base ?? DEFAULT_BASE;
    client = got.reportClient ?? crypto.randomUUID().replaceAll("-", "");
    if (!got.reportClient) chrome.storage.local.set({ reportClient: client });
    pageUrl = got.diag?.path ? `https://artificialanalysis.ai${got.diag.path}` : "";
    $("context").textContent = contextOf(got.settings, got.diag);
    $("text").focus();
  });
})();
