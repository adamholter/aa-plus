// Builds the Chrome Web Store upload: store/dist/aa-plus-<version>.zip.
//   node store/package.mjs
// Only the files the extension runs are packed. The localhost host permission (used by `node test/run.mjs --base`
// against a local Priors) is dropped from the store build, so the extension asks for no more than it uses there.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
const FILES = ["background.js", "chart.js", "content.js", "page.js", "pareto.js", "popup.html", "popup.js", "shared.js", "shared.page.js", "icons/16.png", "icons/32.png", "icons/48.png", "icons/128.png"];
if (readFileSync(path.join(root, "shared.js"), "utf8") !== readFileSync(path.join(root, "shared.page.js"), "utf8")) throw new Error("shared.page.js is not a copy of shared.js: cp shared.js shared.page.js");
const stage = mkdtempSync(path.join(tmpdir(), "aaplus-store-"));
for (const f of FILES) { mkdirSync(path.dirname(path.join(stage, f)), { recursive: true }); cpSync(path.join(root, f), path.join(stage, f)); }
manifest.host_permissions = manifest.host_permissions.filter((h) => !h.startsWith("http://localhost"));
writeFileSync(path.join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
const out = path.join(root, "store/dist", `aa-plus-${manifest.version}.zip`);
mkdirSync(path.dirname(out), { recursive: true });
rmSync(out, { force: true });
execFileSync("zip", ["-q", "-X", "-r", out, "."], { cwd: stage });
rmSync(stage, { recursive: true, force: true });
console.log(`${out} (${manifest.name} ${manifest.version}, hosts: ${manifest.host_permissions.join(" ")})`);
