const lists = {
  // EasyList exempts generic cosmetic rules on loopback. These explicit host rules still exercise subscriptions alongside the real bundled list.
  a: "! Title: Fixture list A\n! Version: 1\n/subads/a.js\n127.0.0.1##.sub-hide-a\n127.0.0.1#@#.sub-never\n",
  b: "! Title: Fixture list B\n! Version: 2\n/subads/b.js\n127.0.0.1##.sub-hide-b\nexample.com##+js(abort-on-property-read, x)\nexample.com#?#div:has(> p)\n!!bad line\n",
  c: "! Title: Fixture list A updated\n! Version: 3\n/subads/a.js\n/subads/c.js\n127.0.0.1##.sub-hide-a\n127.0.0.1##.sub-hide-c\n",
};
const state = { mutable: "a" };

/** Local subscription lists and a page with network ads and static hide targets; the control route switches the mutable list. */
export function serveSubscriptionFixture(request, response) {
  const url = new URL(request.url, "http://fixture.test");
  const phase = url.searchParams.get("phase") || "initial";
  if (url.pathname === "/sub-control") { state.mutable = url.searchParams.get("set") || "a"; response.writeHead(204); response.end(); return true; }
  const text = (body, type = "text/plain; charset=utf-8") => { response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }); response.end(body); return true; };
  if (url.pathname === "/sub/a.txt") { return text(lists.a); }
  if (url.pathname === "/sub/b.txt") { return text(lists.b); }
  if (url.pathname === "/sub/mutable.txt") { return text(lists[state.mutable]); }
  if (url.pathname === "/sub/html.txt") { return text("<!doctype html><html><body>Not a filter list</body></html>", "text/html; charset=utf-8"); }
  if (url.pathname === "/sub/binary.txt") { return text("||x.example^\n\u0000\n"); }
  if (url.pathname === "/sub/big.txt") { return text("||x.example^\n".repeat(400000)); }
  if (url.pathname === "/sub/redirect.txt") { response.writeHead(302, { Location: "/sub/a.txt" }); response.end(); return true; }
  const script = url.pathname === "/subads/a.js" ? "subA" : url.pathname === "/subads/b.js" ? "subB" : url.pathname === "/subads/c.js" ? "subC" : url.pathname === "/sub-normal.js" ? "subNormal" : null;
  if (script) { return text(`document.documentElement.dataset.${script}=${JSON.stringify(phase)}`, "text/javascript"); }
  if (url.pathname !== "/sub-story") { return false; }
  return text(`<!doctype html><html><head><title>Subscription fixture</title><style>.sub-hide-a,.sub-hide-b,.sub-hide-c,.sub-keep,.sub-never{display:block;padding:6px;margin:4px;background:#fdd}</style></head><body style="font:20px sans-serif;padding:30px"><h1>Subscription fixture</h1>
<div class="sub-hide-a" id="hide-a">Ad A</div><div class="sub-hide-b" id="hide-b">Ad B</div><div class="sub-hide-c" id="hide-c">Ad C</div><div class="sub-keep" id="keep">Normal content</div><div class="sub-never" id="never">Excepted</div>
<script src="/subads/a.js?phase=${encodeURIComponent(phase)}"></script><script src="/subads/b.js?phase=${encodeURIComponent(phase)}"></script><script src="/subads/c.js?phase=${encodeURIComponent(phase)}"></script><script src="/sub-normal.js?phase=${encodeURIComponent(phase)}"></script>
<script>globalThis.loadSub=phase=>Promise.all(["a","b","c"].map(name=>new Promise(resolve=>{const script=document.createElement("script");script.src="/subads/"+name+".js?phase="+encodeURIComponent(phase);script.onload=script.onerror=()=>resolve();document.body.append(script)})));</script></body></html>`, "text/html; charset=utf-8");
}
