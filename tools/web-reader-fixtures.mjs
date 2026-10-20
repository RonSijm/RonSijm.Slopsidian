export function serveReaderFixture(request, response, vaultOrigin) {
  if (!request.url?.startsWith("/reader-")) { return false; }
  if (request.url === "/reader-image") {
    response.writeHead(200, { "Content-Type": "image/png" });
    response.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII=", "base64")); return true;
  }
  const strict = request.url === "/reader-strict";
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": "articleSession=retained;path=/", ...(strict ? { "Content-Security-Policy": "script-src 'none'; object-src 'none'" } : {}) });
  if (request.url === "/reader-empty") { response.end("<title>Short page</title><main><p>No article here.</p></main>"); return true; }
  if (request.url === "/reader-large") { response.end("<title>Large page</title><main hidden>" + "<span>element</span>".repeat(20_100) + "</main>"); return true; }
  const second = request.url.includes("next"), title = second ? "Another readable article" : "A quiet place to read";
  const paragraph = "A readable article keeps its structure while the surrounding menus fade away. This paragraph describes a walk beside the water, the changing light, and a conversation worth remembering. 中文 and 😀 remain part of the story. ";
  response.end(`<!doctype html><html lang="en"><head><title>${title}</title><meta name="author" content="Reader Fixture Author"></head><body style="font:18px sans-serif"><nav>Navigation and sponsored links</nav><aside>Sidebar advertisement</aside><article><h1>${title}</h1><p>Readneedle begins the article. ${paragraph.repeat(3)}</p><h2>A second heading</h2><p>${paragraph.repeat(4)}</p><blockquote>A thoughtful quotation.</blockquote><pre><code>const answer = 42;</code></pre><p>Readneedle appears again. ${paragraph.repeat(3)}</p><figure><img src="/reader-image" alt="A calm riverside"><figcaption>A caption stays readable.</figcaption></figure><table><tr><th>Season</th><th>Light</th></tr><tr><td>Autumn</td><td>Soft</td></tr></table><p><a id="next-article" href="/reader-next">Continue the story</a> · <a href="javascript:alert('unsafe')">Unsafe script link</a> · <a id="vault-link" href="${vaultOrigin()}/api/vault">Blocked local endpoint</a></p><form action="/reader-send"><input name="secret" value="do not copy"><button>Send</button></form></article><label>Original page input <input id="original-input"></label><div style="height:1400px">Original page footer</div><script>sessionStorage.readerLoads=String(Number(sessionStorage.readerLoads||0)+1);window.originalScriptRuns=1;window.Readability=function(){return{parse(){return{title:'Spoofed title',content:'<p>Spoofed</p>'}}}};Document.prototype.cloneNode=function(){throw new Error('page clone override')};</script></body></html>`);
  return true;
}
