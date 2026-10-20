import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";

const root = fileURLToPath(new URL("../", import.meta.url));
const arguments_ = process.argv.slice(2);
let basePath = "/";
let noRestore = false;
for (let index = 0; index < arguments_.length; index++) {
  const argument = arguments_[index];
  if (argument === "--base") {
    basePath = arguments_[++index];
  } else if (argument.startsWith("--base=")) {
    basePath = argument.slice("--base=".length);
  } else if (argument === "--no-restore") {
    noRestore = true;
  } else {
    throw new Error("Unknown web publish argument: " + argument);
  }
}
if (typeof basePath !== "string" || !/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(basePath) || basePath.split("/").some(part => part === "." || part === "..")) {
  throw new Error("Use an absolute, trailing-slash base path, for example --base=/RonSijm.Slopsidian/.");
}

const output = join(root, ".runtime", "web");
const child = spawn("dotnet", ["publish", join(root, "src", "RonSijm.Slopsidian.Web", "RonSijm.Slopsidian.Web.csproj"), "--configuration", "Release", "--output", output, "--nologo", ...(noRestore ? ["--no-restore"] : [])], {
  cwd: root, stdio: "inherit", env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1" },
});
const [code, signal] = await once(child, "exit");
if (code !== 0 || signal) {
  throw new Error(`WebAssembly publish failed: exit=${code}, signal=${signal}`);
}
const site = join(output, "wwwroot");
const indexPath = join(site, "index.html");
const index = await readFile(indexPath, "utf8");
if ([...index.matchAll(/<base href="[^"]*" \/>/g)].length !== 1) {
  throw new Error("The published entry page has no expected base-path placeholder.");
}
const html = index.replace(/<base href="[^"]*" \/>/, `<base href="${basePath}" />`);
await writeFile(indexPath, html);
await writeFile(indexPath + ".br", brotliCompressSync(html));
await writeFile(indexPath + ".gz", gzipSync(html));
await writeFile(join(site, "404.html"), html);
await writeFile(join(site, ".nojekyll"), "");
await mkdir(output, { recursive: true });
await writeFile(join(output, "publish-info.json"), JSON.stringify({ basePath }, null, 2));
console.log(`Published standalone WASM site: ${site}\nBase path: ${basePath}\nNo desktop server or vault files are included.`);
