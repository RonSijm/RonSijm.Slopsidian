import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

// Static only: GitHub requests are made by the browser, never proxied here.
const content = await readFile(new URL("./index.html", import.meta.url));
const portOption = process.argv.find(value => value.startsWith("--port="));
const port = portOption ? Number(portOption.slice(7)) : 5184;
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Supply --port=0..65535.");
const server = createServer((request, response) => {
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
  } else if (!["/", "/index.html"].includes(new URL(request.url, "http://localhost").pathname)) {
    response.writeHead(404).end("Not found");
  } else {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src https://api.github.com https://raw.githubusercontent.com; img-src blob:; media-src blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "Content-Length": content.length,
    });
    response.end(request.method === "HEAD" ? undefined : content);
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", resolve);
});
console.log(`GITHUB_PROBE_READY http://127.0.0.1:${server.address().port}/`);
