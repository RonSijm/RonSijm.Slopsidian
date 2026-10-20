import { createServer } from "node:http";
import { randomInt } from "node:crypto";
export async function createPageClipPages() {
  const requests = [], paragraph = "The article describes a quiet walk beside the river, changing autumn light and a thoughtful conversation. 中文 and 😀 stay part of the story. ";
  const pages = createServer((request, response) => {
    requests.push({ url: request.url, token: request.headers["x-vault-token"] ?? null });
    if (request.url === "/assets/pixel") { response.writeHead(200, { "Content-Type": "image/png" }); response.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII=", "base64")); return; }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": "pageClipSession=private;path=/", "Cache-Control": "no-store" });
    if (request.url === "/short") { response.end("<title>Short page</title><body>X</body>"); return; }
    if (request.url === "/empty") { response.end('<title>Controls only</title><body><form><p>form-secret</p><input value="input-secret"></form><div hidden>hidden-secret</div><div contenteditable>editing-secret</div></body>'); return; }
    if (request.url === "/large") { response.end("<title>Large page</title><body><p>" + "x".repeat(2_000_001) + "</p></body>"); return; }
    if (request.url === "/elements") { response.end("<title>Many elements</title><body>" + "<span>x</span>".repeat(20_001) + "</body>"); return; }
    if (request.url === "/numbering") { response.end('<title>Alphabetic list</title><body><ol type="A"><li>First</li><li>Second</li></ol></body>'); return; }
    if (request.url === "/hidden-table") { response.end('<title>Hidden table row</title><body><table><tr><td rowspan="2">Keep</td><td>First</td></tr><tr hidden><td>hidden-secret</td></tr></table></body>'); return; }
    if (request.url === "/wide-table") { response.end("<title>Wide table</title><body><table><tr>" + "<td>Column</td>".repeat(101) + "</tr></table></body>"); return; }
    if (request.url === "/embedded") { response.end("<title>Embedded</title><body>embedded-secret</body>"); return; }
    response.end('<!doctype html><html lang="en"><head><title>A full-page story</title><base href="/assets/"><style>body{font:18px sans-serif;margin:24px}.css-hidden{display:none}.invisible{visibility:hidden}.transparent{opacity:0}.content-hidden{content-visibility:hidden}</style></head><body>' +
      '<header><nav><a href="next?q=one#part">Page navigation</a></nav></header><aside>Sidebar note</aside><main><article><h1>A full-page story</h1><p>' + paragraph.repeat(7) +
      '</p><h2>Page details</h2><p>Words have <strong>bold</strong> and <em>emphasis</em>. Literal ![[Secret]] and &lt;script&gt;literal()&lt;/script&gt; stay text. <a href="next?q=one#part">Relative detail</a> and <a href="javascript:alert(1)">Unsafe detail</a>.</p>' +
      '<ol start="7"><li>Seventh item</li><li>Eighth item</li></ol><table><tr><th colspan="2">Shared heading</th></tr><tr><td>Left cell</td><td>Right cell</td></tr></table><figure><img src="pixel" alt="A quiet riverside"><figcaption>Page caption</figcaption></figure><pre><code>\u0060\u0060\u0060mermaid\ngraph TD\n\u0060\u0060\u0060\n&lt;script&gt;codeLiteral()&lt;/script&gt;</code></pre><p id="snapshot-text">Snapshot before review.</p><p>' + paragraph.repeat(7) +
      '</p></article></main><footer>Footer note</footer><div hidden>hidden-secret</div><div class="css-hidden">css-secret</div><div class="invisible">visibility-secret</div><div class="transparent">opacity-secret</div><div class="content-hidden">content-secret</div><div aria-hidden="true">aria-secret</div><form><p>form-secret</p><input value="input-secret"></form><textarea>textarea-secret</textarea><select><option>select-secret</option></select><div contenteditable>editing-secret</div><canvas>canvas-secret</canvas><dialog open>dialog-secret</dialog><iframe src="/embedded" title="Embedded fixture"></iframe><label>Original input <input id="original-input" value=""></label><div style="height:800px">Page tail</div>' +
      '<script>window.originalRuns=1;window.scrollEvents=0;addEventListener("scroll",()=>scrollEvents++);window.Readability=function(){throw Error("spoofed reader")};Document.prototype.cloneNode=function(){throw Error("spoofed clone")};</script></body></html>');
  });
  let started = false;
  for (let index = 0; index < 30; index++) {
    try {
      await new Promise((resolve, reject) => { const failed = error => { pages.removeListener("listening", ready); reject(error); }; const ready = () => { pages.removeListener("error", failed); resolve(); }; pages.once("error", failed); pages.once("listening", ready); pages.listen(randomInt(49152, 65536), "127.0.0.1"); });
      started = true; break;
    } catch (error) { if (error.code !== "EADDRINUSE" && error.code !== "EACCES") { throw error; } }
  }
  if (!started) { throw new Error("No available full-page fixture port."); }
  return { origin: "http://127.0.0.1:" + pages.address().port, requests, close: () => new Promise((resolve, reject) => { pages.close(error => error ? reject(error) : resolve()); pages.closeAllConnections(); }) };
}
