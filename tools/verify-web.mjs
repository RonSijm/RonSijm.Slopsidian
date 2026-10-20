import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { startWebServer } from "./serve-web.mjs";

const arguments_ = process.argv.slice(2);
if (arguments_.length > 1 || arguments_[0] && !arguments_[0].startsWith("--base=")) {
  throw new Error("Use verify:web with an optional --base=/RonSijm.Slopsidian/.");
}
const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, ".runtime", "web");
const site = join(output, "wwwroot");
const { basePath } = JSON.parse(await readFile(join(output, "publish-info.json"), "utf8"));
if (arguments_.length) {
  assert.equal(basePath, arguments_[0].slice("--base=".length), "The published base path must match the deployment URL.");
}
const html = await readFile(join(site, "index.html"), "utf8");
assert.equal([...html.matchAll(/<base href="[^"]*" \/>/g)].length, 1, "The site needs exactly one base path.");
assert.ok(html.includes(`<base href="${basePath}" />`), "The entry page must use the published base path.");
assert.equal(brotliDecompressSync(await readFile(join(site, "index.html.br"))).toString(), html, "Brotli must contain the same entry page.");
assert.equal(gunzipSync(await readFile(join(site, "index.html.gz"))).toString(), html, "Gzip must contain the same entry page.");
assert.equal(await readFile(join(site, "404.html"), "utf8"), html, "The Pages fallback must use the same base path.");
assert.equal((await stat(join(site, ".nojekyll"))).size, 0, "Pages must serve the _framework directory without Jekyll.");
assert.equal(await readFile(join(site, "CNAME"), "utf8"), await readFile(join(root, "src", "RonSijm.Slopsidian.Web", "wwwroot", "CNAME"), "utf8"), "Deployment must preserve the configured custom domain.");
const assembly = (await readdir(join(site, "_framework"))).find(name => name.startsWith("RonSijm.Slopsidian.Web.") && name.endsWith(".wasm"));
assert.ok(assembly, "The published .NET WebAssembly application is missing.");

const host = await startWebServer({ port: 0 });
try {
  const response = await fetch(host.endpoint);
  assert.equal(response.status, 200, "The published entry page must be served.");
  assert.equal(await response.text(), html);
  await Promise.all([
    "CNAME", "app.css", "browser.css", "icons.svg", "icons-LICENSE.txt", "mermaid-frame.html", "js/mermaid-frame.js", "js/mermaid-api.js", "js/mermaid-api.js.LEGAL.txt", "js/mermaid-licenses.txt",
    "js/editor-host.js", "js/editor-host.css", "js/codemirror-license.txt", "js/hypermd-license.txt",
    "js/web-reader-extract.js", "js/web-reader-extract.js.LEGAL.txt", "js/web-reader-licenses.txt",
    "js/browser-host.js", "js/search-worker.js", "js/graph-worker.js", "js/bases-worker.js",
    "_framework/blazor.webassembly.js", "_framework/" + assembly,
  ].map(async asset => {
    const response = await fetch(new URL(asset, host.endpoint), { method: "HEAD" });
    assert.equal(response.status, 200, `Missing published asset: ${asset}`);
    assert.ok(Number(response.headers.get("content-length")) > 0, `Empty published asset: ${asset}`);
    if (asset.endsWith(".wasm")) {
      assert.equal(response.headers.get("content-type"), "application/wasm");
    }
  }));
  console.log("Verified standalone WASM assets, compressed pages and static serving at " + basePath);
} finally {
  await host.close();
}
