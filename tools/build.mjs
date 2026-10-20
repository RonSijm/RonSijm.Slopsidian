import assert from "node:assert/strict";
import { builtinModules } from "node:module";
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { buildCoreVerificationCatalog, coreVerificationInputs } from "./core-verification-inputs.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const verification = await coreVerificationInputs(root);
const coreVerificationContract = JSON.parse(await readFile(join(root, "shared/core-plugins.json"), "utf8"));
const coreVerificationCases = Object.fromEntries(coreVerificationContract.plugins.map(plugin => [plugin.id, [...coreVerificationContract.commonCases, ...plugin.workflows].map(test => plugin.id + ":" + test.id)]));
await writeFile(join(root, "src/RonSijm.Slopsidian/wwwroot/core-verification.json"), JSON.stringify(await buildCoreVerificationCatalog(root, verification.sourceFingerprint), null, 2) + "\n");
const iconProvenance = JSON.parse(await readFile(join(root, "vendor", "lucide-static", "provenance.json"), "utf8"));
for (const [path, expected] of Object.entries(iconProvenance.sha256)) {
  assert.equal(createHash("sha256").update(await readFile(join(root, path))).digest("hex"), expected, "Pinned icon asset changed: " + path);
}
await import("./build-github-vault.mjs");
const upstream = join(root, "vendor", "obsidian-sample-plugin");
const provenance = JSON.parse(await readFile(join(root, "vendor", "sample-plugin.provenance.json"), "utf8"));
const hypermd = join(root, "vendor", "hypermd-mode");
const hypermdProvenance = JSON.parse(await readFile(join(root, "vendor", "hypermd-mode.provenance.json"), "utf8"));
for (const [directory, record] of [[upstream, provenance], [hypermd, hypermdProvenance]]) {
  for (const [path, expected] of Object.entries(record.sha256)) {
    const bytes = await readFile(join(directory, ...path.split("/")));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected, `Upstream source changed: ${join(directory, path)}`);
  }
}

const output = join(root, "src", "RonSijm.Slopsidian", "wwwroot", "js");
await mkdir(output, { recursive: true });
// Native-only network filter bundle, outside the served/published browser assets.
const adblockDirectory = join(root, ".runtime", "web-adblock");
await mkdir(adblockDirectory, { recursive: true });
const adblockProvenance = JSON.parse(await readFile(join(root, "vendor", "easylist", "provenance.json"), "utf8"));
for (const [path, expected] of Object.entries(adblockProvenance.sha256)) {
  assert.equal(createHash("sha256").update(await readFile(join(root, "vendor", "easylist", path))).digest("hex"), expected, "Bundled EasyList changed: " + path);
}
const adblockBuild = await build({
  entryPoints: [join(root, "desktop", "web-adblock-engine.cjs")], outfile: join(adblockDirectory, "engine.cjs"),
  bundle: true, platform: "node", format: "cjs", target: "node22", legalComments: "linked", metafile: true,
});
const adblockPackages = new Set();
for (const input of Object.keys(adblockBuild.metafile.inputs)) {
  const parts = input.replaceAll("\\", "/").split("/"), index = parts.lastIndexOf("node_modules");
  if (index >= 0) { adblockPackages.add(parts.slice(0, index + (parts[index + 1].startsWith("@") ? 3 : 2)).join("/")); }
}
const adblockNotices = ["Packages in the native Web viewer network-filtering engine.\n"];
for (const path of [...adblockPackages].sort()) {
  const directory = resolve(root, path), manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  adblockNotices.push(`\n=== ${manifest.name} ${manifest.version} (${manifest.license ?? "See package notices"}) ===\n`);
  for (const name of (await readdir(directory)).filter(name => /^(?:licen[cs]e|copying|notice)(?:$|[.\-])/i.test(name)).sort()) {
    adblockNotices.push(`\n${name}\n` + await readFile(join(directory, name), "utf8"));
  }
}
await writeFile(join(adblockDirectory, "licenses.txt"), adblockNotices.join("\n"));
await build({
  entryPoints: [join(root, "client", "editor-host.ts"), join(root, "client", "browser-host.ts"), join(root, "client", "search-worker.ts"), join(root, "client", "graph-worker.ts"), join(root, "client", "bases-worker.ts")],
  outdir: output,
  bundle: true,
  format: "esm",
  platform: "browser",
  external: ["electron"],
  target: "es2022",
  define: { __CORE_VERIFICATION_SOURCE__: JSON.stringify(verification.sourceFingerprint), __CORE_VERIFICATION_CASES__: JSON.stringify(coreVerificationCases) },
  sourcemap: true,
  legalComments: "linked",
});
await copyFile(join(root, "node_modules", "codemirror", "LICENSE"), join(output, "codemirror-license.txt"));
await copyFile(join(hypermd, "LICENSE"), join(output, "hypermd-license.txt"));
await build({
  entryPoints: [join(root, "client", "web-reader-extract.ts")], outfile: join(output, "web-reader-extract.js"),
  bundle: true, format: "iife", globalName: "SlopsidianWebReader", platform: "browser", target: "es2022",
  minify: true, sourcemap: true, legalComments: "linked",
});
await writeFile(join(output, "web-reader-licenses.txt"), "Mozilla Readability 0.6.0\n\n"
  + await readFile(join(root, "node_modules", "@mozilla", "readability", "LICENSE.md"), "utf8")
  + "\n\nDOMPurify\n\n" + await readFile(join(root, "node_modules", "dompurify", "LICENSE"), "utf8"));

const vault = join(root, ".runtime", "DemoVault");
// A classic script works inside an opaque-origin sandbox without module CORS.
// Keep the engine out of the normal editor bundle and resolve its imports locally.
const [mermaidBuild, mermaidApiBuild] = await Promise.all([build({
  entryPoints: [join(root, "client", "mermaid-frame.ts")],
  outfile: join(output, "mermaid-frame.js"), bundle: true, format: "iife", platform: "browser",
  absWorkingDir: root, target: "es2022", minify: true, sourcemap: true, legalComments: "linked", metafile: true,
}), build({
  entryPoints: [join(root, "client", "mermaid-api.ts")],
  outfile: join(output, "mermaid-api.js"), bundle: true, format: "esm", platform: "browser",
  absWorkingDir: root, target: "es2022", minify: true, sourcemap: true, legalComments: "linked", metafile: true,
})]);
const mermaidPackages = new Set();
for (const input of Object.keys({ ...mermaidBuild.metafile.inputs, ...mermaidApiBuild.metafile.inputs })) {
  const parts = input.replaceAll("\\", "/").split("/"), index = parts.lastIndexOf("node_modules");
  if (index >= 0) { mermaidPackages.add(parts.slice(0, index + (parts[index + 1].startsWith("@") ? 3 : 2)).join("/")); }
}
const notices = ["Third-party packages bundled into the Mermaid renderer and lazy plugin API.\n"];
for (const path of [...mermaidPackages].sort()) {
  const directory = resolve(root, path), manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  notices.push(`\n=== ${manifest.name} ${manifest.version} (${manifest.license ?? "See package notices"}) ===\n`);
  for (const name of (await readdir(directory)).filter(name => /^(?:licen[cs]e|copying|notice)(?:$|[.\-])/i.test(name)).sort()) {
    notices.push(`\n${name}\n` + await readFile(join(directory, name), "utf8"));
  }
}
await writeFile(join(output, "mermaid-licenses.txt"), notices.join("\n"));
const plugins = join(vault, ".obsidian", "plugins");
const external = ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules, ...builtinModules.map(name => `node:${name}`)];
for (const [directory, entry, license] of [
  [upstream, join(upstream, "src", "main.ts"), true],
  [join(root, "plugins", "editor-probe"), join(root, "plugins", "editor-probe", "main.ts"), false],
]) {
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  const destination = join(plugins, manifest.id);
  await mkdir(destination, { recursive: true });
  await build({ entryPoints: [entry], outfile: join(destination, "main.js"), bundle: true, platform: "browser", format: "cjs", target: "es2022", external, legalComments: "inline" });
  await copyFile(join(directory, "manifest.json"), join(destination, "manifest.json"));
  if (license) {
    await copyFile(join(directory, "styles.css"), join(destination, "styles.css"));
    await copyFile(join(directory, "LICENSE"), join(destination, "LICENSE"));
  }
}

const welcome = join(vault, "Welcome.md");
try {
  await access(welcome);
} catch (error) {
  if (error.code !== "ENOENT") {
    throw error;
  }
  await writeFile(welcome, "# Slopsidian\n\nThis editor uses a C# vault service and a Blazor interface.\n\nTODO: Enable the sample plugins in Settings > Community plugins.\n", { flag: "wx" });
}
console.log("Built the editor and unchanged upstream sample plugin. Demo vault: " + vault);
