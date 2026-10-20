import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".wasm": "application/wasm" };

export async function startWebServer({ port = 5173 } = {}) {
  const output = join(root, ".runtime", "web");
  const directory = join(output, "wwwroot");
  const { basePath } = JSON.parse(await readFile(join(output, "publish-info.json"), "utf8"));
  const server = createServer(async (request, response) => {
    try {
      if (!["GET", "HEAD"].includes(request.method)) {
        response.writeHead(405, { Allow: "GET, HEAD" }).end();
        return;
      }
      const url = new URL(request.url, "http://localhost");
      if (basePath !== "/" && url.pathname === basePath.slice(0, -1)) {
        response.writeHead(302, { Location: basePath }).end();
        return;
      }
      if (!url.pathname.startsWith(basePath)) {
        response.writeHead(404).end("Not found");
        return;
      }
      const name = decodeURIComponent(url.pathname.slice(basePath.length)) || "index.html";
      const file = resolve(directory, name);
      const difference = relative(directory, file);
      if (difference.startsWith("..") || isAbsolute(difference)) {
        response.writeHead(403).end("Outside the published site");
        return;
      }
      if (!(await stat(file)).isFile()) {
        response.writeHead(404).end("Not found");
        return;
      }
      const content = await readFile(file);
      response.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store", "Content-Length": content.length });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      if (error.code === "ENOENT") {
        response.writeHead(404).end("Not found");
      } else if (error instanceof URIError) {
        response.writeHead(400).end("Invalid URL encoding");
      } else {
        console.error("Static web request failed:", error);
        response.writeHead(500).end("Static web request failed");
      }
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const endpoint = `http://127.0.0.1:${server.address().port}${basePath}`;
  return { server, endpoint, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argument = process.argv.find(argument => argument.startsWith("--port="));
  const port = argument ? Number(argument.slice("--port=".length)) : 5173;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("Supply --port=0..65535.");
  }
  const host = await startWebServer({ port });
  console.log("WEB_READY " + host.endpoint);
  if (process.argv.includes("--open")) {
    const child = spawn("pwsh", ["-NoProfile", "-Command", `Start-Process '${host.endpoint}'`], { stdio: "inherit" });
    child.on("error", error => console.error("Cannot open your browser; open the WEB_READY URL manually:", error.message));
    child.on("exit", code => {
      if (code) {
        console.error("Cannot open your browser; open the WEB_READY URL manually.");
      }
    });
  }
}
