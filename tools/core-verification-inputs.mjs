import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const excluded = new Set(["bin", "obj", "node_modules", ".runtime"]);
const code = /\.(?:ts|mjs|cjs|cs|csproj|razor|css|svg|html|py|ps1|json|txt)$/i;
export async function coreVerificationInputs(root) {
  const paths = [];
  async function walk(relative) {
    for (const item of await readdir(join(root, relative), { withFileTypes: true })) {
      const path = relative + "/" + item.name;
      if (item.isDirectory()) {
        if (!excluded.has(item.name) && path !== "src/RonSijm.Slopsidian/wwwroot/js") await walk(path);
      } else if (code.test(item.name) && !["shared/core-verification.json", "src/RonSijm.Slopsidian/wwwroot/core-verification.json"].includes(path)) paths.push(path);
    }
  }
  for (const directory of ["client", "desktop", "shared", "tools", "tests", "src", "plugins"]) await walk(directory);
  paths.push("package.json", "package-lock.json");
  const sources = [];
  for (const path of [...new Set(paths)].sort()) sources.push({ path, sha256: createHash("sha256").update((await readFile(join(root, path), "utf8")).replaceAll("\r\n", "\n")).digest("hex") });
  const sourceFingerprint = createHash("sha256").update(JSON.stringify(sources)).digest("hex");
  return { sourceFingerprint, sources };
}

export async function buildCoreVerificationCatalog(root, fingerprint) {
  const fallback = { schemaVersion: 1, sourceFingerprint: fingerprint, hosts: { desktop: {}, web: {} } };
  let record;
  try { record = JSON.parse(await readFile(join(root, "shared/core-verification.json"), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
  if (record.sourceFingerprint !== fingerprint || record.schemaVersion !== 1) return fallback;
  const contract = JSON.parse(await readFile(join(root, "shared/core-plugins.json"), "utf8"));
  for (const host of ["desktop", "web"]) {
    const entries = record.hosts?.[host];
    if (!entries || typeof entries !== "object") throw Error("Invalid core verification host: " + host);
    for (const [id, entry] of Object.entries(entries)) {
      const plugin = contract.plugins.find(plugin => plugin.id === id);
      if (!plugin || entry.status !== "verified-workflows" || !Number.isFinite(Date.parse(entry.checkedAt))) throw Error("Invalid verified core module: " + id);
      const required = [...contract.commonCases, ...plugin.workflows].map(test => id + ":" + test.id).sort();
      if (JSON.stringify([...entry.requiredCases].sort()) !== JSON.stringify(required)
        || JSON.stringify([...entry.passedCases].sort()) !== JSON.stringify(required)) throw Error("Incomplete verified core module: " + id);
    }
  }
  return { schemaVersion: 1, sourceFingerprint: fingerprint, hosts: record.hosts };
}
