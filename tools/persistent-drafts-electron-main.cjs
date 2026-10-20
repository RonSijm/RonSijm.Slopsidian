const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const arg = name => process.argv.find(item => item.startsWith("--" + name + "="))?.slice(name.length + 3);
const phase = arg("phase"), port = Number(arg("port")), web = arg("web");
app.setPath("userData", arg("user-data"));
app.commandLine.appendSwitch("disable-gpu");
app.on("window-all-closed", () => {});

const server = http.createServer((request, response) => {
  const name = request.url === "/" ? "index.html" : path.basename(request.url.split("?")[0]);
  fs.readFile(path.join(web, name), (error, data) => {
    if (error) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "content-type": name.endsWith(".js") ? "text/javascript" : "text/html" }); response.end(data);
  });
});

const content = "Unsaved 中文\r\nSecond line\r\n😀";
const common = `
  const h = window.harness;
  const backend = h.createIndexedDbBackend();
  const sessions = new Map();
  const mk = (path, text, over = {}) => ({ originRoot: "D:\\\\Vault A", dirty: true, isSaving: false, text, document: { file: { path }, version: "v-base", hasBom: true }, ...over });
`;

async function evaluate(window, body) { return window.webContents.executeJavaScript("(async()=>{" + common + body + "})()"); }

app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
  const open = async () => {
    const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    await window.loadURL(`http://127.0.0.1:${port}/`);
    return window;
  };
  let result;
  if (phase === "write") {
    let window = await open();
    const written = await evaluate(window, `
      const store = new h.PersistentDraftStore(backend, { ownerId: "renderer-1" });
      sessions.set("Notes/中文.md", mk("Notes/中文.md", ${JSON.stringify(content)}));
      sessions.set("Second.md", mk("Second.md", "second\\n", { document: { file: { path: "Second.md" }, version: "v2", hasBom: false } }));
      const capture = new h.PersistentDraftCapture(store, () => sessions, { heartbeatMs: 1000 });
      const health = await capture.flush();
      return { protecting: health.protecting, failures: health.failures.length };`);
    // A reload is a new renderer document: the old page's timers are gone and its owner lease is not renewed.
    window.webContents.reload();
    await new Promise(resolve => window.webContents.once("did-finish-load", resolve));
    const reloaded = await evaluate(window, `
      const store = new h.PersistentDraftStore(backend, { ownerId: "renderer-2" });
      const listing = await store.list();
      return listing.drafts.map(item => ({ path: item.record.path, ownership: item.ownership, content: item.record.content, bom: item.record.hasBom, eol: item.record.eol, base: item.record.baseVersion }));`);
    // Destroy the renderer outright (no pagehide cooperation), then keep the process alive for the next window.
    window.destroy();
    window = await open();
    const afterDestroy = await evaluate(window, `
      const store = new h.PersistentDraftStore(backend, { ownerId: "renderer-3" });
      return (await store.list()).drafts.length;`);
    window.destroy();
    const ok = written.protecting === 2 && written.failures === 0 && reloaded.length === 2 && reloaded.every(item => item.ownership === "active-elsewhere") && reloaded.find(item => item.path === "Notes/中文.md")?.content === content && afterDestroy === 2;
    result = { ok, written, reloaded, afterDestroy };
  } else if (phase === "read") {
    const window = await open();
    const listing = await evaluate(window, `
      const store = new h.PersistentDraftStore(backend, { ownerId: "after-restart" });
      const l = await store.list();
      return { corrupt: l.corrupt.length, drafts: l.drafts.map(item => ({ path: item.record.path, ownership: item.ownership, content: item.record.content, bom: item.record.hasBom, eol: item.record.eol, base: item.record.baseVersion, root: item.record.vaultRoot })) };`);
    window.destroy();
    result = { ok: listing.corrupt === 0 && listing.drafts.length === 2 && listing.drafts.every(item => item.ownership === "orphaned" && item.root === "D:\\Vault A") && listing.drafts.find(item => item.path === "Notes/中文.md")?.content === content && listing.drafts.find(item => item.path === "Notes/中文.md")?.bom === true && listing.drafts.find(item => item.path === "Notes/中文.md")?.eol === "crlf", listing };
  } else if (phase === "recover") {
    const window = await open();
    const outcome = await evaluate(window, `
      const store = new h.PersistentDraftStore(backend, { ownerId: "recovering" });
      const files = new Map([["Notes/中文.md", { content: "original", bom: true }], ["Second.md", { content: "changed externally", bom: false }]]);
      const ver = file => file.content + "|" + file.bom;
      const writes = [];
      const vault = { rootPath: "D:\\\\Vault A", getAbstractFileByPath: p => files.has(p) ? {} : null,
        readDocument: async p => ({ content: files.get(p).content, version: ver(files.get(p)), hasBom: files.get(p).bom }),
        writeDocument: async (p, c, v, create) => { if (create && files.has(p)) { throw new Error("exists"); } if (!create && ver(files.get(p)) !== v) { throw new Error("stale"); } writes.push([p, c, create]); files.set(p, { content: c, bom: files.get(p)?.bom ?? false }); } };
      const listing = await store.list();
      const out = {};
      for (const { record } of listing.drafts) {
        const base = record.path === "Notes/中文.md" ? { ...record, baseVersion: "original|true" } : record;
        // Re-key assessments against the simulated vault: the first note is unchanged since capture, the second is not.
        const reading = await h.readSource(vault, record.path);
        const assessment = h.assessRecovery(base, "D:\\\\Vault A", reading);
        out[record.path] = { status: assessment.status, replaceable: assessment.canReplace };
        if (record.path === "Second.md") { out.refused = (await h.applyRecovery(store, vault, record, { kind: "replace" })).ok; out.second = (await h.applyRecovery(store, vault, record, { kind: "create", path: "Second (recovered).md" })).ok; }
      }
      out.writes = writes; out.final = Object.fromEntries([...files].map(([k, v]) => [k, v.content]));
      out.left = (await store.list()).drafts.map(item => item.record.path);
      return out;`);
    window.destroy();
    result = { ok: outcome.second === true && outcome.refused === false && outcome.final["Notes/中文.md"] === "original" && outcome.final["Second.md"] === "changed externally" && outcome.final["Second (recovered).md"] === "second\n" && outcome.left.length === 1 && outcome.left[0] === "Notes/中文.md" && outcome["Second.md"].status === "changed", outcome };
  } else if (phase === "verify-empty") {
    const window = await open();
    const left = await evaluate(window, `const store = new h.PersistentDraftStore(backend, { ownerId: "verify" }); return (await store.list()).drafts.map(item => ({ path: item.record.path, content: item.record.content }));`);
    window.destroy();
    result = { ok: left.length === 1 && left[0].path === "Notes/中文.md" && left[0].content === content, left };
  } else if (phase === "fence") {
    const window = await open();
    const outcome = await evaluate(window, `
      const T = 5_000_000, raw = backend;
      const hooks = {};
      const wrapped = { list: p => raw.list(p), get: k => raw.get(k), update: (k, c) => raw.update(k, c), async transact(keys, change) { await hooks.before?.(); const r = await raw.transact(keys, change); await hooks.after?.(); return r; } };
      const result = { deterministic: [], races: { removedFirst: 0, renewedFirst: 0, violations: [] } };
      const mkStores = async tag => {
        const a = new h.PersistentDraftStore(raw, { ownerId: "fa-" + tag, now: () => T }), b = new h.PersistentDraftStore(wrapped, { ownerId: "fb-" + tag, now: () => T });
        const stalled = new h.PersistentDraftStore(raw, { ownerId: "fa-" + tag, now: () => T - 2 * h.LEASE_MS });
        await stalled.heartbeat();
        const input = { vaultRoot: "D:\\\\Fence", path: tag + ".md", baseVersion: "v", hasBom: true, content: "fence " + tag };
        await a.put(input);
        const record = (await b.list()).drafts.find(item => item.record.path === tag + ".md");
        return { a, b, input, record: record.record, ownership: record.ownership, stalled };
      };
      const state = async (ctx) => ({ present: (await raw.get(h.draftKey(ctx.record.id))) !== null, tombstone: (await raw.get(h.REVOKED_KEY_PREFIX + ctx.record.id)) !== null });
      // Renewal commits before the removal commit.
      { const ctx = await mkStores("before"); hooks.before = async () => { hooks.before = null; await ctx.a.heartbeat(); };
        const removed = await ctx.b.resolve(ctx.record); result.deterministic.push({ name: "renewal-first", ownership: ctx.ownership, removed, ...(await state(ctx)), next: await ctx.a.put(ctx.input) }); }
      // Removal commits first, then the stale owner renews and writes the same text again.
      { const ctx = await mkStores("after"); hooks.before = null; hooks.after = async () => { hooks.after = null; await ctx.a.heartbeat(); };
        const removed = await ctx.b.resolve(ctx.record); result.deterministic.push({ name: "removal-first", ownership: ctx.ownership, removed, ...(await state(ctx)), next: await ctx.a.put(ctx.input) }); }
      hooks.before = hooks.after = null;
      // Unsynchronised races on the real IndexedDB: the record/tombstone invariant must hold in every outcome.
      for (let i = 0; i < 60; i++) {
        const ctx = await mkStores("race" + i);
        const [removed] = await Promise.all([ctx.b.resolve(ctx.record), ctx.a.heartbeat()]);
        const s = await state(ctx);
        if (removed && !s.present && s.tombstone) { result.races.removedFirst++; } else if (!removed && s.present && !s.tombstone) { result.races.renewedFirst++; } else { result.races.violations.push({ i, removed, ...s }); }
      }
      return result;`);
    window.destroy();
    const [renewalFirst, removalFirst] = outcome.deterministic;
    result = {
      ok: renewalFirst.ownership === "orphaned" && renewalFirst.removed === false && renewalFirst.present && !renewalFirst.tombstone && renewalFirst.next === "unchanged"
        && removalFirst.removed === true && !removalFirst.present && removalFirst.tombstone && removalFirst.next === "revoked" && outcome.races.violations.length === 0,
      outcome,
    };
  }
  console.log("RESULT " + JSON.stringify(result));
  server.close();
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
