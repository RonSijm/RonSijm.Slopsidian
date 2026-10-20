import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createFaviconPages } from "./web-favicon-fixtures.mjs";

export async function checkWebFavicons({ host, restart, until, directory, pass, capture, targets, connect }) {
  const active = "app.workspace.activeLeaf.view", provider = 'app.core.getEnabledPluginById("webviewer")', cache = provider + ".favicons", historyStore = provider + ".history";
  const config = join(directory, ".obsidian"), historyPath = join(config, "vault-dotnet-web-history.json"), key = "webviewer-favicons-v1";
  const settings = await readFile(join(config, "webviewer.json")), workspace = await readFile(join(config, "workspace.json")), note = await readFile(join(directory, "Welcome.md"));
  const jpeg = await readFile(new URL("./fixtures/web-favicon.jpg", import.meta.url)), endpoint = await host.evaluate("location.origin");
  const sites = await Promise.all(Array.from({ length: 3 }, () => createFaviconPages(() => endpoint, jpeg)));
  const urls = sites.map((site, index) => site.origin + "/page?icon=" + ["png", "ico", "jpeg"][index]), data = new Map();
  let pane;
  const selector = child => pane + " " + child, control = action => selector('[data-web-history-action="' + action + '"]');
  const idle = () => host.evaluate(historyStore + ".whenIdle()");
  const read = async () => JSON.parse((await readFile(historyPath, "utf8")).replace(/^\ufeff/, ""));
  const profile = () => host.evaluate("app.loadLocalStorage(" + JSON.stringify(key) + ")");
  const requests = () => sites.flatMap(site => site.requests);
  async function ready() {
    await host.wait(active + '.getViewType()==="webviewer-history"&&' + active + ".snapshot&&!" + active + ".busy&&!" + active + ".refreshing", "favicon history ready");
    pane = "[data-leaf-id=" + JSON.stringify(await host.evaluate("app.workspace.activeLeaf.id")) + "]";
  }
  async function history() { await host.evaluate('app.commands.execute("webviewer:open-history")'); await ready(); }
  async function recording(value) {
    if (await host.evaluate(active + ".recording.checked") !== value) { await host.click(selector("[data-web-history-recording]")); await idle(); await ready(); }
  }
  async function nativeVisit(url, waitIcon = true) {
    await host.evaluate(provider + ".openUrl(" + JSON.stringify(url) + ",true)");
    await host.wait(active + '.getViewType()==="webviewer"&&' + active + ".getState().url===" + JSON.stringify(url) + "&&!" + active + ".loading", "native favicon visit");
    await host.evaluate("globalThis.faviconSourceView=" + active + ";undefined");
    if (waitIcon) { await host.wait(cache + ".get(" + JSON.stringify(url) + ")!==null&&faviconSourceView.faviconTasks===0", "native icon cached"); }
    await idle();
  }
  async function closePages() {
    await host.evaluate('(async()=>{for(const leaf of app.workspace.getLeavesOfType("webviewer"))await app.workspace.closeLeaf(leaf)})()'); await history();
  }
  async function settled() { await host.wait("faviconSourceView.faviconTasks===0", "favicon capture settled"); await idle(); }
  async function loadedImages(expected) {
    if (expected !== undefined) { await host.wait("document.querySelectorAll(" + JSON.stringify(selector("[data-web-history-favicon]")) + ").length===" + expected, "expected cached history image count"); }
    await host.wait("[...document.querySelectorAll(" + JSON.stringify(selector("[data-web-history-favicon]")) + ")].every(image=>image.complete&&image.naturalWidth>0)", "cached history images decoded");
  }
  async function pixel(url) {
    await loadedImages();
    return host.evaluate("(()=>{const image=[...document.querySelectorAll(" + JSON.stringify(selector("[data-web-history-icon]")) + ")].find(holder=>holder.dataset.webHistoryIcon===" + JSON.stringify(url) + ").querySelector('img');const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);return [...context.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data]})()");
  }
  async function clear() { await host.click(control("clear-icons")); assert.equal(await profile(), null); }
  async function switchVault(path) {
    await host.click("#vault-switcher"); await host.wait('document.querySelector("#vault-dialog").open', "favicon vault dialog");
    await host.fill("#vault-open-path", path); await host.click("#confirm-open-vault");
    await host.wait("app.vault.rootPath===" + JSON.stringify(path) + '&&!app.changingVault&&!document.querySelector("#vault-dialog").open', "favicon vault switch");
  }
  try {
    if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
    await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()'); await idle();
    await writeFile(historyPath, '\ufeff{"version":1,"recording":true,"entries":[],"future":{"keep":["中文",true]}}\r\n');
    await host.evaluate(cache + '.clear();app.saveLocalStorage("favicon-canary-v1",{keep:["中文",true]});undefined');
    for (let index = 0; index < urls.length; index++) {
      await nativeVisit(urls[index]); data.set(sites[index].origin, await host.evaluate(cache + ".get(" + JSON.stringify(urls[index]) + ")"));
      const target = (await targets()).find(item => item.url === urls[index]); assert.ok(target);
      const remote = await connect(target);
      assert.deepEqual(await remote.evaluate('({node:typeof require,opener:window.opener===null,input:document.querySelector("#keep-input").value,cookie:document.cookie.includes("favicon-private")})'), { node: "undefined", opener: true, input: "unchanged", cookie: true });
      assert.ok(sites[index].requests.some(request => request.url.startsWith("/icon/") && request.cookie === null));
    }
    await closePages(); await loadedImages(3);
    const expected = [[30, 120, 220, 255], [210, 50, 30, 255], [40, 180, 70, 255]];
    for (let index = 0; index < urls.length; index++) {
      const color = await pixel(urls[index]); assert.ok(color.every((channel, position) => Math.abs(channel - expected[index][position]) <= 12), "Decoded native format " + index + ": " + color);
    }
    const firstProfile = await profile(); assert.equal(firstProfile.entries.length, 3);
    assert.ok(firstProfile.entries.every(entry => entry.png.startsWith("data:image/png;base64,") && entry.png.length <= 16384 && !("url" in entry)));
    const count = requests().length, sourceBytes = await readFile(historyPath); await host.click(control("refresh")); await idle(); await ready(); await loadedImages();
    assert.equal(requests().length, count); assert.deepEqual(await readFile(historyPath), sourceBytes);
    await capture("icons");
    pass("Actual recorded native PNG/JPEG/Windows ICO visits normalize to small PNG icons with decoded expected pixels; remote pages retain input/cookie/Node/opener isolation, a credential-free icon request is observed, history refresh uses cached data without requests or history writes, and only origins/images enter the bounded vault-local profile cache");

    await recording(false); const removed = (await read()).entries.find(entry => entry.url === urls[2]);
    await host.click(selector("[data-web-history-id=" + JSON.stringify(removed.id) + '] [data-web-history-action="remove"]')); await idle(); await ready();
    const undo = await host.evaluate(historyStore + ".getUndo(" + active + ".snapshot)"), unchanged = await readFile(historyPath);
    await host.fill(selector("[data-web-history-search]"), "Icon");
    const first = (await read()).entries[0]; await host.click(selector("[data-web-history-select=" + JSON.stringify(first.id) + "]")); await host.click(control("remove-matching"));
    const review = await host.evaluate(active + ".review.revision"), revision = await host.evaluate(active + ".revision");
    await clear();
    assert.equal(await host.evaluate(active + ".selected.size"), 1); assert.equal(await host.evaluate(active + ".review.revision"), review); assert.equal(await host.evaluate(active + ".revision"), revision);
    assert.equal(await host.evaluate(historyStore + ".getUndo(" + active + ".snapshot).id"), undo.id); assert.deepEqual(await readFile(historyPath), unchanged);
    assert.equal(await host.evaluate("document.querySelectorAll(" + JSON.stringify(selector("[data-web-history-favicon]")) + ").length"), 0);
    await host.click(control("cancel-clear")); await host.click(selector("[data-web-history-id=" + JSON.stringify(first.id) + "] .web-history-open")); await closePages();
    // Reopen the menu through the actual keyboard path, then deliver a previously captured icon as a bounded metadata fixture.
    await host.click(selector("[data-web-history-id=" + JSON.stringify(first.id) + "] [data-web-history-select]"));
    await host.evaluate("document.querySelector(" + JSON.stringify(selector("[data-web-history-id=" + JSON.stringify(first.id) + "] .web-history-open")) + ").focus()");
    await host.press("F10", "F10", 121, 8); await host.wait('Boolean(document.querySelector("[data-web-history-menu]"))', "favicon visit menu");
    await host.evaluate(cache + ".set(" + JSON.stringify(urls[0]) + "," + JSON.stringify(data.get(sites[0].origin)) + "," + cache + ".generation)");
    assert.equal(await host.evaluate('Boolean(document.querySelector("[data-web-history-menu]"))'), true);
    assert.equal(await host.evaluate(historyStore + ".getUndo(" + active + ".snapshot).id"), undo.id); assert.deepEqual(await readFile(historyPath), unchanged);
    await host.press("Escape", "Escape", 27); await host.click(control("undo")); await idle(); await ready();
    const restored = await read(), noteBytes = await readFile(historyPath), markdown = await host.evaluate(active + '.snapshot.history.archive("Icon",{}).markdown');
    await host.click(control("archive")); await host.wait('Boolean(document.querySelector("[data-web-history-archive]"))', "favicon-free archive preview");
    assert.doesNotMatch(await host.evaluate('document.querySelector("[data-web-history-archive-preview]").value'), /data:image/);
    await host.fill("[data-web-history-archive-path]", "History/Icon visits.md"); await host.click('[data-web-history-archive-action="save"]');
    await host.wait('app.workspace.getActiveFile()?.path==="History/Icon visits.md"&&!document.querySelector("[data-web-history-archive]")', "favicon-free archive saved");
    assert.equal(await readFile(join(directory, "History/Icon visits.md"), "utf8"), markdown);
    await host.evaluate(active + '.setMode("preview")'); await host.wait(active + ".previewEl.querySelectorAll('a[href^=\"http\"]').length===3", "favicon archive Reading");
    assert.equal(await host.evaluate(active + '.previewEl.querySelectorAll("img,script,iframe").length'), 0);
    await history(); assert.deepEqual(await readFile(historyPath), noteBytes); await clear();
    await nativeVisit(sites[0].origin + "/page?icon=png&paused", false); await settled(); await closePages();
    assert.equal(await profile(), null); assert.deepEqual((await read()).entries, restored.entries);
    assert.deepEqual(await host.evaluate('app.loadLocalStorage("favicon-canary-v1")'), { keep: ["中文", true] });
    await capture("cleared");
    pass("Actual Clear icons removes only the selected vault's local icon cache while selections, inline reviews, ownership counters and Undo remain intact; a bounded captured-icon update preserves an open keyboard menu, inverse restoration and exact archive Markdown/Reading do not include image data, and paused navigation creates neither history nor cache metadata");

    await recording(true);
    for (const mode of ["svg", "large", "redirect", "missing"]) {
      await nativeVisit(sites[0].origin + "/page?icon=" + mode + "&bad=" + mode, false); await settled(); assert.equal(await host.evaluate(cache + ".get(" + JSON.stringify(urls[0]) + ")"), null);
    }
    await closePages();
    for (const phase of ["clear", "pause", "navigate", "close"]) {
      await recording(true);
      const url = sites[0].origin + "/page?icon=png&hold=" + phase;
      await nativeVisit(url, false); await until(() => sites[0].held.has(phase), "held native icon " + phase);
      if (phase === "navigate") {
        const next = sites[0].origin + "/page?icon=svg&replaced";
        await host.evaluate("faviconSourceView.request('navigate',{url:" + JSON.stringify(next) + "})");
        await host.wait("faviconSourceView.url===" + JSON.stringify(next) + "&&!faviconSourceView.loading", "new native document replaces held icon");
        await until(async () => (await read()).entries.at(-1)?.url === next, "replacement native visit saved");
      } else if (phase === "close") {
        await host.evaluate("app.workspace.closeLeaf(faviconSourceView.leaf)");
      } else {
        await history(); if (phase === "clear") { await clear(); } else { await recording(false); }
      }
      const before = await readFile(historyPath); sites[0].release(phase); await settled(); await closePages();
      assert.equal(await host.evaluate(cache + ".get(" + JSON.stringify(urls[0]) + ")"), null); assert.deepEqual(await readFile(historyPath), before);
    }
    await capture("guards");
    pass("Real unsupported SVG, oversized, redirecting and missing icons fall back without breaking page/history behavior; held native captures cannot repopulate a cleared cache, persist after recording is paused, overwrite a new document or survive owner closure, and exact history bytes remain unchanged after those decisions");

    await recording(true);
    for (const url of urls) { await nativeVisit(url); }
    await host.evaluate("globalThis.oldFaviconOwner=faviconSourceView;globalThis.invokeOldFavicon=()=>oldFaviconOwner.captureFavicon({url:oldFaviconOwner.url,navigationId:oldFaviconOwner.navigationId});undefined");
    await closePages(); await recording(false); const sourceFinal = await readFile(historyPath), sourceProfile = await profile(), sourceState = await host.evaluate(active + ".getState()");
    assert.equal(JSON.stringify(sourceState).includes("data:image"), false);
    const expectedImageCount = (await read()).entries.length;
    const countBeforeRestart = requests().length; await host.evaluate("app.workspace.flushLayout()"); await restart(); await ready(); await loadedImages(expectedImageCount);
    assert.deepEqual(await profile(), sourceProfile); assert.deepEqual(await readFile(historyPath), sourceFinal); assert.equal(requests().length, countBeforeRestart);
    await host.evaluate('app.core.setEnabled("webviewer",false)'); await host.evaluate("app.workspace.flushLayout()"); await restart();
    assert.equal(await host.evaluate('app.core.isEnabled("webviewer")'), false); assert.deepEqual(await host.evaluate("app.loadLocalStorage(" + JSON.stringify(key) + ")"), sourceProfile);
    await host.evaluate('app.core.setEnabled("webviewer",true)'); await ready(); await loadedImages(); assert.deepEqual(await host.evaluate(active + ".getState()"), sourceState);
    const other = join(directory, ".web-favicon-other-vault"), otherConfig = join(other, ".obsidian"), otherHistoryPath = join(otherConfig, "vault-dotnet-web-history.json");
    const otherSettings = Buffer.from('\ufeff{"enableAdblocking":false,"future":{"keep":"favicon target"}}\r\n'), otherNote = Buffer.from("\ufeff# Keep\r\nFavicon target 中文 😀.\r\n");
    await mkdir(otherConfig, { recursive: true }); await writeFile(join(other, "Keep.md"), otherNote); await writeFile(join(otherConfig, "webviewer.json"), otherSettings);
    await writeFile(join(otherConfig, "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(state=>[state.id,["webviewer","command-palette","file-explorer"].includes(state.id)]))')));
    const sharedEntry = (await read()).entries.find(entry => entry.url === urls[0]);
    const otherHistory = "\ufeff" + JSON.stringify({ version: 1, recording: true, entries: [sharedEntry], future: { keep: "target" } }) + "\r\n"; await writeFile(otherHistoryPath, otherHistory);
    await switchVault(other); await history(); assert.equal(await profile(), null); assert.equal(await host.evaluate("document.querySelectorAll(" + JSON.stringify(selector("[data-web-history-favicon]")) + ").length"), 0);
    sites[0].setIcon("jpeg"); await nativeVisit(urls[0]); await closePages(); const targetProfile = await profile();
    assert.equal(targetProfile.entries.length, 1); assert.notEqual(targetProfile.entries[0].png, data.get(sites[0].origin)); assert.equal(await readFile(otherHistoryPath, "utf8"), otherHistory);
    await switchVault(directory); await ready(); await loadedImages(); assert.deepEqual(await profile(), sourceProfile); assert.deepEqual(await readFile(historyPath), sourceFinal);
    await switchVault(other); await ready(); assert.deepEqual(await profile(), targetProfile); await switchVault(directory); await ready(); await loadedImages(); await capture("restored");
    assert.deepEqual(await profile(), sourceProfile); assert.deepEqual(await readFile(historyPath), sourceFinal);
    assert.equal(await readFile(join(directory, "History/Icon visits.md"), "utf8"), markdown);
    assert.deepEqual(await readFile(join(config, "webviewer.json")), settings); assert.deepEqual(await readFile(join(config, "workspace.json")), workspace); assert.deepEqual(await readFile(join(directory, "Welcome.md")), note);
    assert.deepEqual(await readFile(join(otherConfig, "webviewer.json")), otherSettings); assert.deepEqual(await readFile(join(other, "Keep.md")), otherNote);
    assert.deepEqual(await host.evaluate('app.loadLocalStorage("favicon-canary-v1")'), { keep: ["中文", true] });
    assert.ok(requests().every(request => request.token === null)); assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), "");
    pass("Full enabled/disabled restarts preserve cached PNGs without restoring page sessions or making icon requests; repeated actual same-ID/same-origin vault switches keep distinct source/target icons and fallback for a fresh target, while history/notes/settings/original workspace/profile canaries/BOM/CRLF/Unicode survive and image data stays out of leaf state");
  } finally { await Promise.allSettled(sites.map(site => site.close())); }
}
