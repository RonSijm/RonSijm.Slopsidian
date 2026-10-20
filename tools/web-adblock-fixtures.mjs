export function serveAdblockFixture(request, response, vaultOrigin) {
  const url = new URL(request.url, "http://fixture.test");
  const phase = url.searchParams.get("phase") || "initial";
  const script = url.pathname === "/ads/cbr.js" ? "adScript" : url.pathname === "/ads/custom_ads.js" ? "secondAdScript" : url.pathname === "/adblock-normal.js" ? "normalScript" : null;
  if (script) {
    response.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
    response.end(`document.documentElement.dataset.${script}=${JSON.stringify(phase)}`); return true;
  }
  if (url.pathname !== "/adblock-story") { return false; }
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end(`<!doctype html><html><head><title>Network ad blocking</title></head><body style="font:20px sans-serif;padding:30px"><h1>Network ad blocking</h1><p>Normal page content stays available while ad requests are blocked.</p><input id="adblock-input" aria-label="Retained page input"><a id="adblock-hash" href="#section">Same page</a><h2 id="section">Section</h2><script src="/ads/cbr.js?phase=${encodeURIComponent(phase)}"></script><script src="/ads/custom_ads.js?phase=${encodeURIComponent(phase)}"></script><script src="/adblock-normal.js?phase=${encodeURIComponent(phase)}"></script><script>
  globalThis.loadAds=phase=>Promise.all(["/ads/cbr.js","/ads/custom_ads.js"].map(path=>new Promise(resolve=>{const script=document.createElement("script");script.src=path+"?phase="+encodeURIComponent(phase);script.onload=script.onerror=()=>resolve();document.body.append(script)})));
  fetch("/ads/cbr.js?phase=xhr-"+${JSON.stringify(phase)}).then(response=>response.text()).then(()=>document.documentElement.dataset.xhr="allowed");
  fetch(${JSON.stringify(vaultOrigin() + "/api/vault")}).then(()=>document.documentElement.dataset.vault="unexpected",()=>document.documentElement.dataset.vault="blocked");
  </script></body></html>`); return true;
}
