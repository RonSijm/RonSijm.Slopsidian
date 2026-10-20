import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Development-only browser fixture: production GitHub code against installed Example packages.
// No proxy, override or fixture flag ships in the app. --all-enabled uses the unchanged enabled list.
const allEnabled = process.argv.includes("--all-enabled");
const root = fileURLToPath(new URL("../", import.meta.url)), output = join(root, ".runtime", allEnabled ? "github-plugin-fixture-all" : "github-plugin-fixture");
const site = join(root, ".runtime/web/wwwroot"), example = join(root, "Example");
const commit = "a".repeat(40), tree = "b".repeat(40), assets = new Map();
const walk = async (directory, prefix = "") => {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.isSymbolicLink() || item.name.startsWith(".") && !(prefix === "" && item.name === ".obsidian")) continue;
    if (prefix.startsWith(".obsidian/plugins/") && item.name === "obsidian_askpass.sh") continue;
    const path = prefix + item.name;
    if (item.isDirectory()) await walk(join(directory, item.name), path + "/");
    else if (item.isFile()) assets.set("Example/" + path, await readFile(join(directory, item.name)));
  }
};
await walk(example);
// The default fixture executes only these two existing packages. --all-enabled exercises
// the complete Example enabled list; all installed packages remain discoverable in either mode.
if (!allEnabled) assets.set("Example/.obsidian/community-plugins.json", Buffer.from(JSON.stringify(["calendar", "dataview"])));
const listing = [...assets].map(([path, bytes]) => ({ path, type: "blob", mode: "100644", size: bytes.length, sha: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") }));
await mkdir(output, { recursive: true });
const transport = `
const originalFetch = globalThis.fetch.bind(globalThis);
export async function fixtureFetch(input, options) {
  const url = new URL(String(input));
  if (url.hostname === "api.github.com") {
    if (url.pathname.includes("/commits/")) return Response.json({sha:${JSON.stringify(commit)},commit:{tree:{sha:${JSON.stringify(tree)}}}});
    if (url.pathname.endsWith("/git/trees/${tree}")) return originalFetch("/fixture-tree.json", options);
  }
  if (url.hostname === "raw.githubusercontent.com") {
    const marker = "/${commit}/", offset = url.pathname.indexOf(marker);
    if (offset >= 0) return originalFetch("/fixture-file/" + url.pathname.slice(offset + marker.length), options);
  }
  throw new Error("Unexpected network request in the local GitHub plugin fixture: " + url.origin);
}
`;
await writeFile(join(output, "transport.js"), transport);
const original = await readFile(join(root, "client/editor-host.ts"), "utf8"), needle = "const github = new GitHubVaultHost();";
assert.equal(original.split(needle).length, 2, "The fixture must patch exactly one development bundle constructor");
const fixtureDirectory = allEnabled ? "github-plugin-fixture-all" : "github-plugin-fixture";
const source = `import {GitHubReader,IndexedDbGitHubCache} from "../plugins/github-vault/provider";\nimport {fixtureFetch} from "../.runtime/${fixtureDirectory}/transport.js";\n` + original.replace(needle, `const github = new GitHubVaultHost(new GitHubReader(new IndexedDbGitHubCache("github-local-plugin-fixture${allEnabled ? "-all" : ""}-v1"), fixtureFetch));`);
await build({ stdin: { contents: source, loader: "ts", resolveDir: join(root, "client") }, outfile: join(output, "editor-host.js"), bundle: true, format: "esm", platform: "browser", target: "es2022", external: ["electron"], logLevel: "silent" });
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const port = Number(process.argv.find(value => value.startsWith("--port="))?.slice(7) ?? 5187);
const server = createServer(async (request, response) => {
  try {
    if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405).end(); return; }
    const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    let body, extension;
    if (path === "/fixture-tree.json") { body = Buffer.from(JSON.stringify({ tree: listing, truncated: false })); extension = ".json"; }
    else if (path.startsWith("/fixture-file/")) { body = assets.get(path.slice("/fixture-file/".length)); extension = extname(path); }
    else if (path === "/js/editor-host.js") { body = await readFile(join(output, "editor-host.js")); extension = ".js"; }
    else {
      const relative = path === "/" || path.startsWith("/remote-vault/") ? "index.html" : path.slice(1);
      const file = resolve(site, relative);
      if (!file.startsWith(resolve(site) + "/") && !file.startsWith(resolve(site) + "\\")) { response.writeHead(400).end(); return; }
      body = await readFile(file); extension = extname(file);
    }
    if (!body) { response.writeHead(404).end(); return; }
    response.writeHead(200, { "Content-Type": types[extension] ?? "application/octet-stream", "Cache-Control": "no-store", "Content-Length": body.length });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch (error) { response.writeHead(error.code === "ENOENT" ? 404 : 500).end(error.message); }
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
console.log(`GITHUB_PLUGIN_FIXTURE_READY http://127.0.0.1:${server.address().port}/remote-vault/github.com/RonSijm/RonSijm.Slopsidian/tree/main/Example`);
console.log(`LOCAL_FIXTURE_FILES ${listing.length}; enabled fixture packages: ${allEnabled ? "unchanged Example enabled list" : "calendar, dataview"}; editor source: ${dirname(output)}`);
