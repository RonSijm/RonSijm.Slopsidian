// Bounded, credential-free live read of the public registry statistics and a README through the production
// native downloader endpoint. It never installs anything and uses no vault. Not GUI evidence.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { root, startHost } from "../tests/host.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

const vault = await mkdtemp(join(tmpdir(), "slopsidian-live-"));
const host = await startHost(vault);
const result = { checkedAt: new Date().toISOString(), reads: [] };
try {
  const read = async (name, url, limit) => {
    const response = await host.request("/api/community-download", "POST", { url, limit });
    const bytes = Buffer.from(await response.arrayBuffer());
    result.reads.push({ name, url, status: response.status, bytes: bytes.length });
    return { response, bytes };
  };
  const stats = await read("statistics", "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugin-stats.json", 8 * 1024 * 1024);
  assert.equal(stats.response.status, 200, "Production downloader could not read live statistics: " + stats.bytes.toString("utf8").slice(0, 200));
  const parsed = JSON.parse(stats.bytes.toString("utf8"));
  const plugins = Object.entries(parsed).filter(([, value]) => value && typeof value.downloads === "number" && Number.isSafeInteger(value.downloads) && value.downloads >= 0);
  assert.ok(plugins.length > 100, "Live statistics should contain many plugins with real download counts.");
  result.statistics = { plugins: Object.keys(parsed).length, withDownloads: plugins.length, sample: plugins.slice(0, 3).map(([id, value]) => ({ id, downloads: value.downloads })) };
  const readme = await read("README", "https://raw.githubusercontent.com/obsidianmd/obsidian-sample-plugin/HEAD/README.md", 512 * 1024);
  assert.equal(readme.response.status, 200, readme.bytes.toString("utf8").slice(0, 200));
  assert.ok(readme.bytes.length > 100 && readme.bytes.toString("utf8").includes("Obsidian"));
  const missing = await read("missing README", "https://raw.githubusercontent.com/obsidianmd/obsidian-sample-plugin/HEAD/readme.md", 512 * 1024);
  result.missingReadmeStatus = missing.response.status;
  result.script = { path: "tools/community-live-check.mjs", sha256: sha256(await readFile(fileURLToPath(import.meta.url))) };
  result.downloader = { path: "src/RonSijm.Slopsidian/Services/CommunityDownloads.cs", sha256: sha256(await readFile(join(root, "src", "RonSijm.Slopsidian", "Services", "CommunityDownloads.cs"))) };
  result.responseSha256 = { statistics: sha256(stats.bytes), README: sha256(readme.bytes) };
  result.scope = "Production native downloader endpoint only; credential-free; no vault, install or GUI.";
  const text = JSON.stringify(result, null, 2);
  const evidence = join(root, ".runtime", "evidence");
  await mkdir(evidence, { recursive: true });
  await writeFile(join(evidence, "community-live-check.json"), text + "\n");
  console.log(text);
} finally {
  await host.stop();
  await rm(vault, { recursive: true, force: true });
}
