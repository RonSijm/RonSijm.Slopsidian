import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { EventEmitter } from "node:events";
import { root } from "./host.mjs";

let directory, realm, imp, groups, windows, Workspace, WorkspaceLeaf, WorkspaceWindow, WorkspaceSplit, WorkspaceTabs, MarkdownView, popouts;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "workspace-groups-popouts-tests-"));
  const output = join(directory, "bundle.cjs");
  await build({ stdin: { contents: 'export * as groups from "./client/workspace-groups"; export * as windows from "./client/workspace-window"; export * as realm from "./client/realm"; export * as imp from "./client/workspace-import"; export { Workspace, WorkspaceLeaf, WorkspaceWindow, WorkspaceSplit, WorkspaceTabs, MarkdownView } from "./client/workspace";', resolveDir: root }, outfile: output, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
  ({ groups, realm, imp, windows, Workspace, WorkspaceLeaf, WorkspaceWindow, WorkspaceSplit, WorkspaceTabs, MarkdownView } = createRequire(import.meta.url)(output));
  popouts = createRequire(import.meta.url)(join(root, "desktop", "popout-windows.cjs"));
});
after(async () => {
  if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/workspace-groups-popouts-tests-[^/]+$/); await rm(directory, { recursive: true }); }
});

const leaf = (id, extra = {}) => ({ id, type: "leaf", state: { type: "markdown", state: { file: id + ".md" }, ...extra } });
const tabs = (id, ...children) => ({ id, type: "tabs", currentTab: 0, children });
const split = (id, ...children) => ({ id, type: "split", direction: "vertical", children });

test("group data keeps only live linked leaves, rejects malformed entries and preserves unknown keys", () => {
  const reports = [];
  const parsed = groups.parseGroups({ links: { a: "g1", b: "g1", "bad key": "g1", c: 7 }, future: { keep: [1] } }, message => reports.push(message));
  assert.deepEqual([...parsed.links], [["a", "g1"], ["b", "g1"]]);
  assert.deepEqual(parsed.extras, { future: { keep: [1] } });
  assert.equal(reports.length, 1);
  assert.deepEqual(groups.parseGroups("nope", message => reports.push(message)).links.size, 0);
  const saved = groups.serializeGroups(new Map([["a", "g1"], ["b", "g1"], ["c", "g2"], ["gone", "g1"]]), new Set(["a", "b", "c"]), parsed.extras);
  assert.deepEqual(saved, { future: { keep: [1] }, links: { a: "g1", b: "g1" } });
  assert.deepEqual(groups.groupMembers(new Map([["a", "g1"], ["b", "g2"], ["c", "g1"]]), "g1"), ["a", "c"]);
  assert.match(groups.newGroupId(), groups.GROUP_ID);
});

test("group links round-trip prototype-named leaf IDs as own data", () => {
  const ids = ["__proto__", "constructor", "toString"];
  const json = '{"links":{"__proto__":"g1","constructor":"g1","toString":"g1"}}';
  const parsed = groups.parseGroups(JSON.parse(json));
  assert.deepEqual([...parsed.links.keys()], ids);
  const saved = groups.serializeGroups(parsed.links, new Set(ids), parsed.extras);
  assert.deepEqual(Object.keys(saved.links), ids);
  assert.equal(Object.getPrototypeOf(saved.links), Object.prototype);
  const again = groups.parseGroups(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual([...again.links], ids.map(id => [id, "g1"]));
});

for (const fails of [false, true]) {
  test(`the file-mutation barrier freezes every popout and restores prior inert state after ${fails ? "failure" : "success"}`, async () => {
    const previousDocument = globalThis.document;
    const main = { inert: false }, popout = { inert: false }, alreadyInert = { inert: true };
    const editable = [], locks = [];
    const view = Object.assign(Object.create(MarkdownView.prototype), {
      editor: { setEditable: value => editable.push(value), setMutationLock: value => locks.push(value) },
      getMode: () => "source",
    });
    const workspace = Object.create(Workspace.prototype);
    let release, entered, saved = 0;
    const held = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    Object.assign(workspace, {
      app: { changingVault: false, vault: { rootPath: "D:\\Test Vault" } },
      windows: [{ surface: { root: popout } }, { surface: { root: alreadyInert } }, { surface: null }],
      tasks: new Set(), layoutWrite: Promise.resolve(),
      requireInteractive() {}, leaves: () => [{ view }], track: operation => operation,
      layoutChanged() {}, requestSaveLayout: async () => { saved++; },
    });
    globalThis.document = { getElementById: id => id === "desktop-shell" ? main : null };
    try {
      const operation = workspace.withFileMutation(async () => {
        entered();
        await held;
        if (fails) { throw new Error("write refused"); }
        return "written";
      });
      assert.equal(workspace.changingFiles, true);
      assert.deepEqual([main.inert, popout.inert, alreadyInert.inert], [true, true, true]);
      assert.deepEqual(editable, [false]); assert.deepEqual(locks, [true]);
      await started;
      const result = fails ? assert.rejects(operation, /write refused/) : operation;
      release();
      assert.equal(await result, fails ? undefined : "written");
      assert.equal(workspace.changingFiles, false);
      assert.deepEqual([main.inert, popout.inert, alreadyInert.inert], [false, false, true]);
      assert.deepEqual(editable, [false, true]); assert.deepEqual(locks, [true, false]);
      assert.equal(saved, 1);
    } finally {
      release();
      if (previousDocument === undefined) { delete globalThis.document; }
      else { globalThis.document = previousDocument; }
    }
  });
}

test("an independent navigation on an in-flight automatic follower reserves its own intent and stops the older run", async () => {
  const markdown = (id, path) => { const view = Object.create(MarkdownView.prototype); view.file = { path }; return Object.assign(Object.create(WorkspaceLeaf.prototype), { id, pinned: false, running: 0, view, run: fn => fn() }); };
  const workspace = Object.create(Workspace.prototype), opened = [], events = [], gates = new Map();
  const [a, b, c] = ["a", "b", "c"].map(id => markdown(id, "start.md"));
  const leaves = [a, b, c], files = new Map();
  Object.assign(workspace, {
    restoring: false, changingLayout: false, app: { changingVault: false, vault: { rootPath: "D:\\Test Vault", getFileByPath: path => { if (!files.has(path)) { files.set(path, { path, basename: path }); } return files.get(path); } } },
    groupLinks: new Map([["a", "g"], ["b", "g"], ["c", "g"]]), followers: new WeakSet(), linkIntent: new Map(), trigger: (...args) => events.push(args),
    fileViewTypes: new Set(["markdown"]), extensions: new Map(), lastLinkedNavigation: null,
    leaves: () => leaves, requireInteractive() {}, refreshGroups() {}, layoutChanged() {},
    applyLeafState: async (target, state) => { await gates.get(target.id + ":" + state.state.file)?.promise; opened.push([target.id, state.state.file]); target.view.file = { path: state.state.file }; },
    openInLeaf: async (target, file, active, automatic) => {
      const request = { type: "markdown", state: { file: file.path }, active };
      if (automatic) { workspace.followers.add(request); }
      await workspace.setLeafState(target, request);
    },
  });
  const quiet = { error: console.error, log: console.log, warn: console.warn }, previousDocument = globalThis.document, previousWindow = globalThis.window, previousLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const fake = new Proxy(function () {}, { get: (_target, key) => key === Symbol.toPrimitive ? () => "" : fake, apply: () => fake, set: () => true });
  globalThis.document = { getElementById: () => null, createElement: () => fake, querySelector: () => fake, body: fake };
  globalThis.window = fake;
  Object.defineProperty(globalThis, "location", { value: { origin: "http://test", pathname: "/" }, configurable: true });
  console.error = console.log = console.warn = () => {};
  try {
    let release; gates.set("b:old.md", { promise: new Promise(resolve => { release = resolve; }) });
    const tick = () => new Promise(resolve => setImmediate(resolve));
    const older = workspace.setLeafState(a, { type: "markdown", state: { file: "old.md" } });
    await tick(); await tick();
    assert.ok(workspace.followers instanceof WeakSet);
    await workspace.setLeafState(b, { type: "markdown", state: { file: "new.md" } });
    release(); await older;
    assert.deepEqual(opened.filter(entry => entry[0] === "c").map(entry => entry[1]), ["new.md"], "c never follows the stale source");
    assert.equal(workspace.lastLinkedNavigation.path, "new.md");
    assert.equal(workspace.lastLinkedNavigation.source, "b");
    assert.equal(events.filter(event => event[0] === "linked-navigation").length, 1, "no stale notification");
    assert.equal(workspace.followers.has({}), false);
    assert.ok(opened.some(entry => entry[0] === "a" && entry[1] === "new.md"));
  } finally {
    Object.assign(console, quiet); globalThis.document = previousDocument;
    if (previousWindow === undefined) { delete globalThis.window; } else { globalThis.window = previousWindow; }
    if (previousLocation) { Object.defineProperty(globalThis, "location", previousLocation); } else { delete globalThis.location; }
  }
});

test("linked navigation is planned before any follower changes and refuses pinned, busy, deferred and non-following members", () => {
  const member = (id, extra = {}) => ({ id, pinned: false, busy: false, deferred: false, follow: "file", ...extra });
  const plan = groups.planLinkedNavigation("a", [member("a"), member("b"), member("c", { pinned: true }), member("d", { busy: true }), member("e", { deferred: true }), member("f", { follow: "hook" }), member("g", { follow: "none" })]);
  assert.deepEqual(plan.navigate, ["b"]);
  assert.deepEqual(plan.hook, ["f"]);
  assert.deepEqual(plan.skipped.map(entry => [entry.id, entry.reason]), [["c", "pinned"], ["d", "busy"], ["e", "unavailable provider"], ["g", "view does not follow linked navigation"]]);
});

test("a workspace propagates a leaf's file change to followers independently and reports per-follower failure", async () => {
  const workspace = Object.create(Workspace.prototype), events = [];
  const markdown = (id, extra = {}) => Object.assign(Object.create(WorkspaceLeaf.prototype), { id, pinned: false, running: 0, view: Object.create(MarkdownView.prototype), ...extra });
  const [a, b, c, d, hooked] = ["a", "b", "c", "d", "hooked"].map(id => markdown(id));
  c.pinned = true; d.running = 1;
  const hookCalls = [];
  hooked.view = { onLinkedNavigation: async (source, file) => { hookCalls.push([source.id, file.path]); }, constructor: Object };
  const opened = [];
  Object.assign(workspace, {
    restoring: false, changingLayout: false, app: { changingVault: false, vault: { getFileByPath: path => ({ path, basename: path }) } },
    groupLinks: new Map([["a", "g"], ["b", "g"], ["c", "g"], ["d", "g"], ["hooked", "g"]]), followers: new WeakSet(), linkIntent: new Map(), trigger: (...args) => events.push(args),
    leaves: () => [a, b, c, d, hooked],
    openInLeaf: async (target, file, active, automatic) => { assert.equal(automatic, true); opened.push([target.id, file.path]); },
  });
  const fence = (source, group = "g") => { const token = Symbol(); workspace.linkIntent.set(group, token); return { group, root: workspace.app.vault.rootPath, links: workspace.groupLinks, token }; };
  await workspace.followLinked(a, "Note.md", fence(a));
  assert.deepEqual(opened, [["b", "Note.md"]]);
  assert.deepEqual(hookCalls, [["a", "Note.md"]]);
  assert.deepEqual(workspace.lastLinkedNavigation.skipped.map(entry => entry.id), ["c", "d"]);
  assert.equal(events.at(-1)[0], "linked-navigation");
  workspace.openInLeaf = async () => { throw new Error("refused"); };
  workspace.leaves = () => [a, b];
  workspace.groupLinks = new Map([["a", "g"], ["b", "g"]]);
  const failures = [];
  workspace.lastLinkedNavigation = null;
  const quiet = { error: console.error, log: console.log, warn: console.warn }, previousDocument = globalThis.document, previousWindow = globalThis.window, previousLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const fake = new Proxy(function () {}, { get: (_target, key) => key === Symbol.toPrimitive ? () => "" : fake, apply: () => fake, set: () => true });
  globalThis.document = { getElementById: () => null, createElement: () => fake, querySelector: () => fake };
  globalThis.window = fake;
  Object.defineProperty(globalThis, "location", { value: { origin: "http://test", pathname: "/" }, configurable: true });
  console.error = console.log = console.warn = () => {};
  try { await workspace.followLinked(a, "Other.md", fence(a)).catch(error => failures.push(error)); }
  finally {
    Object.assign(console, quiet); globalThis.document = previousDocument;
    if (previousWindow === undefined) { delete globalThis.window; } else { globalThis.window = previousWindow; }
    if (previousLocation) { Object.defineProperty(globalThis, "location", previousLocation); } else { delete globalThis.location; }
  }
  assert.deepEqual(failures.map(error => error.message), []);
  assert.equal(workspace.lastLinkedNavigation.failed[0].message, "refused");
  assert.equal(a.pinned, false);
});

test("linked navigation is fenced: older held navigations never redirect a group after newer intent, regroup, unlink, vault switch or a mid-follower change", async () => {
  const markdown = (id, path) => { const view = Object.create(MarkdownView.prototype); view.file = { path }; return Object.assign(Object.create(WorkspaceLeaf.prototype), { id, pinned: false, running: 0, view, run: fn => fn() }); };
  const files = new Map();
  const make = () => {
    const workspace = Object.create(Workspace.prototype), opened = [], events = [], gates = new Map();
    const leaves = ["a", "b", "c"].map(id => markdown(id, "start.md"));
    const [a, b, c] = leaves;
    Object.assign(workspace, {
      restoring: false, changingLayout: false, app: { changingVault: false, vault: { rootPath: "C:/v1", getFileByPath: path => { if (!files.has(path)) { files.set(path, { path, basename: path }); } return files.get(path); } } },
      groupLinks: new Map([["a", "g"], ["b", "g"], ["c", "g"]]), followers: new WeakSet(), linkIntent: new Map(), trigger: (...args) => events.push(args),
      fileViewTypes: new Set(["markdown"]), extensions: new Map(), lastLinkedNavigation: null,
      leaves: () => leaves, requireInteractive() {}, refreshGroups() {}, layoutChanged() {},
      applyLeafState: async (target, state) => { await gates.get(state.state.file)?.promise; target.view.file = { path: state.state.file }; },
      openInLeaf: async (target, file) => { await gates.get("follower:" + target.id)?.promise; opened.push([target.id, file.path]); target.view.file = { path: file.path }; },
    });
    const gate = name => { let release; const promise = new Promise(resolve => { release = resolve; }); gates.set(name, { promise, release }); return () => gates.get(name).release(); };
    const go = (source, path) => workspace.setLeafState(source, { type: "markdown", state: { file: path } });
    return { workspace, opened, events, a, b, c, gate, go };
  };
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const quiet = { error: console.error, log: console.log, warn: console.warn }, previousDocument = globalThis.document, previousWindow = globalThis.window, previousLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const fake = new Proxy(function () {}, { get: (_target, key) => key === Symbol.toPrimitive ? () => "" : fake, apply: () => fake, set: () => true });
  globalThis.document = { getElementById: () => null, createElement: () => fake, querySelector: () => fake, body: fake };
  globalThis.window = fake;
  Object.defineProperty(globalThis, "location", { value: { origin: "http://test", pathname: "/" }, configurable: true });
  console.error = console.log = console.warn = () => {};
  try {
    // Newer navigation: the older held source must not drag followers back.
    let t = make(); let release = t.gate("old.md");
    const older = t.go(t.a, "old.md"); await tick();
    await t.go(t.a, "new.md");
    assert.deepEqual(t.opened.sort(), [["b", "new.md"], ["c", "new.md"]]);
    release(); await older;
    assert.deepEqual(t.opened.sort(), [["b", "new.md"], ["c", "new.md"]], "no stale target adopted");
    assert.equal(t.workspace.lastLinkedNavigation.path, "new.md");
    assert.equal(t.events.filter(event => event[0] === "linked-navigation").length, 1, "no stale notification");

    // Unlink and regroup while the source is held.
    t = make(); release = t.gate("old.md");
    let held = t.go(t.a, "old.md"); await tick();
    t.workspace.setGroup(t.a, null);
    release(); await held;
    assert.deepEqual(t.opened, []);
    assert.equal(t.workspace.lastLinkedNavigation, null);
    t = make(); release = t.gate("old.md");
    held = t.go(t.a, "old.md"); await tick();
    t.workspace.setGroup(t.b, "other");
    release(); await held;
    assert.deepEqual(t.opened, [], "a membership change invalidates the older plan");

    // Vault switch.
    t = make(); release = t.gate("old.md");
    held = t.go(t.a, "old.md"); await tick();
    t.workspace.app.vault.rootPath = "C:/v2";
    release(); await held;
    assert.deepEqual(t.opened, []);
    assert.equal(t.events.length, 0);

    // Mid-follower: a newer navigation lands while the first follower is awaited; the remaining follower and notification are dropped.
    t = make(); const free = t.gate("follower:b");
    const running = t.go(t.a, "mid.md"); await tick(); await tick();
    const newer = t.go(t.a, "later.md"); await tick();
    free(); await running; await newer;
    assert.deepEqual(t.opened.filter(entry => entry[1] === "mid.md").map(entry => entry[0]), ["b"], "the stale run stopped after its in-flight follower");
    assert.deepEqual(t.opened.filter(entry => entry[1] === "later.md").map(entry => entry[0]).sort(), ["b", "c"]);
    assert.equal(t.workspace.lastLinkedNavigation.path, "later.md");

    // Independent failures and explicit skips still report on a current fence.
    t = make(); t.c.pinned = true;
    t.workspace.openInLeaf = async target => { if (target.id === "b") { throw new Error("refused"); } };
    await t.go(t.a, "ok.md");
    assert.equal(t.workspace.lastLinkedNavigation.failed[0].message, "refused");
    assert.deepEqual(t.workspace.lastLinkedNavigation.skipped.map(entry => entry.id), ["c"]);
  } finally {
    Object.assign(console, quiet); globalThis.document = previousDocument;
    if (previousWindow === undefined) { delete globalThis.window; } else { globalThis.window = previousWindow; }
    if (previousLocation) { Object.defineProperty(globalThis, "location", previousLocation); } else { delete globalThis.location; }
  }
});
test("saved popout windows are validated, keep unknown data and refused entries, and fold into main without losing leaves", () => {
  const reserved = new Set(["main", "mt", "m1"]);
  const reports = [];
  const good = { root: split("w1", tabs("wt", leaf("p1", { pinned: true }), leaf("p2"))), bounds: { x: 10.4, y: 20, width: 800, height: 600 } };
  const clash = { root: split("w2", tabs("wt2", leaf("m1"))) };
  const malformed = { root: { id: "w3", type: "tabs", children: [] }, from: "future" };
  const value = { windows: [good, clash, malformed], active: "p2", other: { future: true } };
  const parsed = windows.parseWindows(value, reserved, message => reports.push(message));
  assert.equal(parsed.windows.length, 1);
  assert.deepEqual(parsed.windows[0].bounds, { x: 10, y: 20, width: 800, height: 600 });
  assert.equal(parsed.active, "p2");
  assert.deepEqual(parsed.extras, { other: { future: true } });
  assert.deepEqual(parsed.rejected, [clash, malformed]);
  assert.equal(reports.length, 2);
  const saved = windows.serializeWindows(parsed.windows, parsed.active, parsed.extras, parsed.rejected);
  assert.deepEqual(saved.windows.slice(1), [clash, malformed]);
  assert.deepEqual(saved.other, { future: true });
  assert.equal(windows.parseWindows(saved, reserved).windows.length, 1);
  assert.deepEqual(windows.validBounds({ x: 0, y: 0, width: 50, height: 50 }), null);
  const main = split("main", tabs("mt", leaf("m1")));
  const folded = windows.foldWindowsIntoMain(main, parsed.windows);
  assert.deepEqual(folded.children[0].children.map(entry => entry.id), ["m1", "p1", "p2"]);
  assert.equal(folded.children[0].children[1].state.pinned, true);
  assert.equal(main.children[0].children.length, 1);
  assert.deepEqual([...windows.layoutIds(parsed.windows[0].root)].sort(), ["p1", "p2", "w1", "wt"]);
  assert.equal(windows.popoutName("w1"), "slopsidian-popout-w1");
  assert.throws(() => windows.popoutName("bad id"), error => error.code === "unsupported");
});

test("the desktop popout manager only allows approved local about:blank windows and lets only the owner approve a close", () => {
  const owner = new EventEmitter(), sent = [];
  let url = "http://127.0.0.1:5000/", handler = null, destroyed = false;
  Object.assign(owner, { isDestroyed: () => destroyed });
  const contents = new EventEmitter();
  Object.assign(contents, { mainFrame: { url }, getURL: () => url, isDestroyed: () => false, send: (...args) => sent.push(args), setWindowOpenHandler: next => { handler = next; } });
  owner.webContents = contents;
  const ipc = new EventEmitter(), localUrl = value => value.startsWith("http://127.0.0.1:");
  const manager = popouts.installPopouts({ owner, ipcMain: ipc, localUrl, isClosing: () => false, max: 2 });
  const open = (name, target = "about:blank") => handler({ url: target, frameName: name }).action;
  assert.equal(open("slopsidian-popout-w1", "https://example.test/"), "deny");
  assert.equal(open("other"), "deny");
  assert.equal(open("slopsidian-popout-" + "x".repeat(65)), "deny");
  assert.equal(open("slopsidian-popout-w1"), "allow");
  const child = new EventEmitter();
  let closed = 0, childDestroyed = false;
  const nativeBounds = [];
  const childContents = new EventEmitter();
  Object.assign(childContents, { setWindowOpenHandler: next => { child.openHandler = next; } });
  Object.assign(child, { webContents: childContents, isDestroyed: () => childDestroyed, destroy: () => { childDestroyed = true; }, setBounds: value => nativeBounds.push(value), getBounds: () => ({ x: 160, y: 120, width: 727, height: 607 }), close() { closed++; child.emit("close", { preventDefault() { child.prevented = true; } }); if (!child.prevented) { child.emit("closed"); } } });
  contents.emit("did-create-window", child, { frameName: "slopsidian-popout-w1", options: { x: 160, y: 120, width: 724, height: 604 } });
  assert.deepEqual(nativeBounds, [{ x: 160, y: 120, width: 724, height: 604 }], "the requested outer rectangle is applied, not the constructor-expanded native bounds");
  assert.equal(open("slopsidian-popout-w1"), "deny");
  assert.equal(child.openHandler().action, "deny");
  assert.deepEqual(manager.names(), ["slopsidian-popout-w1"]);
  child.close();
  assert.deepEqual(sent.at(-1), ["slopsidian:popout-close-request", "slopsidian-popout-w1"]);
  assert.equal(manager.count(), 1);
  const approve = (sender, name = "slopsidian-popout-w1") => ipc.emit("slopsidian:popout-close-approved", { sender, senderFrame: { url: "http://127.0.0.1:5000/" } }, name);
  Object.assign(contents, { mainFrame: null });
  approve({}); approve(contents);
  assert.equal(manager.count(), 1);
  contents.mainFrame = contents.mainFrame ?? { url };
  const frame = { url: "http://127.0.0.1:5000/" };
  contents.mainFrame = frame;
  child.prevented = false;
  ipc.emit("slopsidian:popout-close-approved", { sender: contents, senderFrame: frame }, "slopsidian-popout-w1");
  assert.equal(manager.count(), 0);
  assert.deepEqual(sent.at(-1), ["slopsidian:popout-closed", "slopsidian-popout-w1"]);
  contents.emit("did-create-window", Object.assign(new EventEmitter(), { webContents: Object.assign(new EventEmitter(), { setWindowOpenHandler() {} }), isDestroyed: () => false, destroy() { childDestroyed = true; } }), { frameName: "slopsidian-popout-w2" });
  assert.equal(manager.count(), 1);
  contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
  assert.equal(manager.count(), 0);
});

test("native popout bounds preserve optional coordinates and explicitly refuse invalid or unapplicable rectangles", () => {
  for (const options of [{ width: 900, height: 700 }, { x: -1600, y: -120, width: 724, height: 604 }, { width: NaN, height: 604 }, { x: 1.5, width: 724, height: 604 }, { width: 0, height: 604 }, { width: 724, height: 604, fail: true }]) {
    const contents = new EventEmitter(), logs = [], applied = [];
    Object.assign(contents, { setWindowOpenHandler() {}, getURL: () => "http://127.0.0.1:5000/" });
    const owner = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false });
    const manager = popouts.installPopouts({ owner, ipcMain: new EventEmitter(), localUrl: () => true, isClosing: () => false, log: value => logs.push(value) });
    let destroyed = false;
    const child = Object.assign(new EventEmitter(), {
      webContents: Object.assign(new EventEmitter(), { setWindowOpenHandler() {} }),
      isDestroyed: () => destroyed, destroy: () => { destroyed = true; },
      setBounds(value) { if (options.fail) { throw new Error("native rectangle failed"); } applied.push(value); },
    });
    contents.emit("did-create-window", child, { frameName: "slopsidian-popout-geometry", options });
    if (options.fail || !Number.isInteger(options.width) || options.width <= 0 || (options.x !== undefined && !Number.isInteger(options.x))) {
      assert.equal(destroyed, true);
      assert.equal(manager.count(), 0, "a failed native rectangle is never adopted as a successful window");
      assert.equal(applied.length, 0);
      assert.match(logs[0], options.fail ? /native rectangle failed/ : /native bounds were invalid/);
    } else {
      const { fail, ...bounds } = options;
      assert.deepEqual(applied, [bounds], "dimensions-only creation does not invent a position, and negative monitor coordinates survive");
      assert.equal(manager.count(), 1);
      assert.equal(destroyed, false);
      assert.deepEqual(logs, []);
      manager.destroyAll();
    }
  }
});

test("window entry extras survive parse and serialize, and a broken desktop bridge throws instead of falling back", () => {
  const raw = { windows: [{ root: split("w1", tabs("t1", leaf("a"))), bounds: { x: 1, y: 2, width: 400, height: 300 }, future: { keep: [1, 2] } }], active: "a" };
  const parsed = windows.parseWindows(raw, new Set());
  assert.equal(parsed.windows.length, 1);
  assert.deepEqual(parsed.windows[0].extras?.future, { keep: [1, 2] });
  const out = windows.serializeWindows(parsed.windows, parsed.active ?? null, parsed.extras ?? {}, parsed.rejected ?? []);
  assert.deepEqual(out.windows[0].future, { keep: [1, 2] });
  assert.equal(windows.desktopPopoutBridge({ isDesktop: () => false, ipc: () => null }), null);
  assert.throws(() => windows.desktopPopoutBridge({ isDesktop: () => true, ipc: () => null }), /./);
});
test("instanceof checks accept events and nodes from a registered popout realm and reject lookalikes", async () => {
  const vm = await import("node:vm");
  class MouseEvent {}
  class Element {}
  const popup = vm.runInNewContext("({ MouseEvent: class MouseEvent {}, Element: class Element {}, Other: class Other {} })");
  const realms = new Set([popup]);
  realm.bridgeInstanceChecks({ MouseEvent, Element }, () => realms);
  assert.ok(new MouseEvent() instanceof MouseEvent);
  assert.ok(new popup.MouseEvent() instanceof MouseEvent);
  assert.ok(new popup.Element() instanceof Element);
  assert.ok(!(new popup.Element() instanceof MouseEvent));
  assert.ok(!(new popup.Other() instanceof Element));
  assert.ok(!({} instanceof MouseEvent));
  assert.ok(!(null instanceof MouseEvent));
  realms.clear();
  assert.ok(!(new popup.MouseEvent() instanceof MouseEvent));
  const doc = { nodeType: 9 };
  assert.equal(realm.ownerDoc(doc), doc);
  assert.equal(realm.ownerDoc({ target: { ownerDocument: doc } }), doc);
});

test("unavailable popout windows stay in the saved layout, never duplicate leaf ids, and track live edits and closed tabs", () => {
  const entry = { root: split("w1", tabs("wt", leaf("p1"), leaf("p2"))), bounds: { x: 5, y: 6, width: 700, height: 500 }, extras: { future: 1 } };
  const pending = [{ entry, ids: ["p1", "p2"] }];
  const liveMain = split("main", tabs("mt", leaf("m1"), leaf("p1", { pinned: true }), leaf("p2")));
  const first = windows.reconcilePending(liveMain, pending);
  assert.deepEqual(windows.collectLeaves(first.main).map(item => item.id), ["m1"]);
  assert.equal(first.windows.length, 1);
  assert.deepEqual(first.windows[0].extras, { future: 1 });
  assert.deepEqual(first.windows[0].bounds, entry.bounds);
  assert.equal(windows.collectLeaves(first.windows[0].root).find(item => item.id === "p1").state.pinned, true);
  const ids = [...windows.collectLeaves(first.main), ...windows.collectLeaves(first.windows[0].root)].map(item => item.id);
  assert.equal(new Set(ids).size, ids.length);
  // One tab closed in main: only the remaining one stays pending; both closed drops the window.
  const closedOne = windows.reconcilePending(split("main", tabs("mt", leaf("m1"), leaf("p2"))), first.pending);
  assert.deepEqual(windows.collectLeaves(closedOne.windows[0].root).map(item => item.id), ["p2"]);
  assert.equal(windows.reconcilePending(split("main", tabs("mt", leaf("m1"))), closedOne.pending).windows.length, 0);
  // When main would be empty a deterministic placeholder keeps the layout valid.
  const emptied = windows.reconcilePending(split("main", tabs("mt", leaf("p1"), leaf("p2"))), pending);
  assert.deepEqual(windows.collectLeaves(emptied.main).map(item => item.id), [windows.PLACEHOLDER_LEAF_ID]);
  const saved = windows.serializeWindows(emptied.windows, null, {}, []);
  assert.equal(windows.parseWindows(saved, windows.layoutIds(emptied.main)).windows.length, 1);
});

test("unobserved or malformed Obsidian floating windows are retained verbatim and warned about, while genuinely new popouts are appended by id", () => {
  const floating = { id: "fl", type: "floating", future: [1], children: [{ id: "w1", type: "window", x: 1, children: [{ id: "t1", type: "tabs", children: [] }] }] };
  const original = {
    main: { id: "main", type: "split", direction: "vertical", children: [{ id: "mt", type: "tabs", children: [{ id: "m1", type: "leaf", state: { type: "markdown", state: { file: "m1.md" } } }] }] },
    left: { id: "l", type: "split", direction: "horizontal", children: [], width: 300 }, right: { id: "r", type: "split", direction: "horizontal", children: [], width: 300 },
    floating, active: "m1",
  };
  const imported = imp.importObsidianWorkspace(original);
  assert.equal(imported.layout.views?.["workspace-windows"], undefined);
  assert.ok(imported.warnings.some(message => /Floating windows are retained/.test(message)));
  const layout = structuredClone(imported.layout);
  layout.views = { ...layout.views, "workspace-windows": { windows: [{ root: split("pw", tabs("pt", leaf("p1"))) }] } };
  const exported = imp.exportObsidianWorkspace(layout, original).floating;
  assert.deepEqual(exported.children[0], floating.children[0], "the refused original window stays verbatim");
  assert.deepEqual(exported.children.map(win => win.id), ["w1", "pw"]);
  assert.deepEqual({ ...exported, children: undefined }, { ...floating, children: undefined });
});

test("retrying a pending window rebuilds its nested splits, sizes and selected tabs around the live leaves, and the placeholder never reuses a taken id", () => {
  const entry = {
    root: { id: "w1", type: "split", direction: "vertical", children: [
      { id: "wt1", type: "tabs", dimension: 60, currentTab: 1, children: [leaf("p1"), leaf("p2")] },
      { id: "ws", type: "split", direction: "horizontal", dimension: 40, children: [tabs("wt2", leaf("p3"))] },
    ] }, bounds: { x: 1, y: 2, width: 800, height: 600 }, extras: { future: true },
  };
  const taken = split("main", { id: "popout-main-placeholder", type: "tabs", currentTab: 0, children: [leaf("p1"), leaf("p2"), leaf("p3")] });
  const placeholder = windows.reconcilePending(taken, [{ entry, ids: ["p1", "p2", "p3"] }]);
  assert.notEqual(windows.collectLeaves(placeholder.main)[0].id, "popout-main-placeholder");
  assert.equal(new Set([...windows.layoutIds(placeholder.main), ...windows.layoutIds(placeholder.windows[0].root)]).size, windows.layoutIds(placeholder.main).size + windows.layoutIds(placeholder.windows[0].root).size);

  const workspace = Object.create(Workspace.prototype);
  const quiet = { error: console.error, log: console.log, warn: console.warn }, previousDocument = globalThis.document, previousWindow = globalThis.window, previousLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const fake = new Proxy(function () {}, { get: (_target, key) => key === Symbol.toPrimitive ? () => "" : fake, apply: () => fake, set: () => true });
  globalThis.document = { getElementById: () => null, createElement: () => fake, createElementNS: () => fake, querySelector: () => fake, body: fake };
  globalThis.window = fake;
  Object.defineProperty(globalThis, "location", { value: { origin: "http://test", pathname: "/" }, configurable: true });
  console.error = console.log = console.warn = () => {};
  try {
    const main = split("main", tabs("mt", leaf("m1"), leaf("p1"), leaf("p2"), leaf("p3")));
    const rootSplit = { serialize: () => main };
    const leaves = new Map(["m1", "p1", "p2", "p3"].map(id => [id, { id, getRoot: () => rootSplit, serialize: () => leaf(id), containerEl: fake, tabHeaderEl: fake, tabHeaderInnerTitleEl: fake, parent: null, render() {}, onResize() {}, setGroupMember() {}, updateHeader() {}, onShow() {}, onHide() {} }]));
    const moved = [];
    const surface = { root: { replaceChildren() {} }, isClosed: () => false, focus() {}, bounds: () => entry.bounds };
    const opened = [];
    Object.assign(workspace, {
      rootSplit, windows: [], pendingWindows: [{ entry, ids: ["p1", "p2", "p3"] }], leftSplit: { children: [] }, rightSplit: { children: [] },
      app: { vault: { rootPath: "C:/vault" } }, tabDrag: { installGroup() {} }, restoring: false, changingLayout: false,
      popouts: { support: () => ({ ok: true }), open: (id, bounds) => { opened.push([id, bounds]); return surface; } },
      requireInteractive() {}, transact: fn => fn(), getLeafById: id => leaves.get(id) ?? null, render() {}, layoutChanged() {}, wireWindow() {},
      relocateLeaf: (target, tabsNode) => { moved.push([target.id, tabsNode.id]); tabsNode.children.push(target); },
    });
    assert.equal(workspace.retryPendingWindows(), 1);
    assert.equal(workspace.pendingWindows.length, 0);
    assert.deepEqual(opened, [["w1", entry.bounds]]);
    assert.deepEqual(moved, [["p1", "wt1"], ["p2", "wt1"], ["p3", "wt2"]]);
    const [win] = workspace.windows;
    assert.deepEqual(win.extras, { future: true });
    assert.deepEqual(win.children.map(child => [child.id, child.dimension]), [["wt1", 60], ["ws", 40]]);
    assert.equal(win.children[0].currentTab, 1);
    assert.equal(win.children[1].direction, "horizontal");
    assert.deepEqual(win.children[1].children.map(child => child.id), ["wt2"]);
  } finally {
    Object.assign(console, quiet); globalThis.document = previousDocument;
    if (previousWindow === undefined) { delete globalThis.window; } else { globalThis.window = previousWindow; }
    if (previousLocation) { Object.defineProperty(globalThis, "location", previousLocation); } else { delete globalThis.location; }
  }
});
test("a broken desktop bridge disables popouts with its reason and a failed approval never falls back to closing the surface", () => {
  const workspace = Object.create(Workspace.prototype);
  const closes = [];
  const surface = { isClosed: () => false, close: () => closes.push("close") };
  const quiet = { error: console.error, log: console.log, warn: console.warn }, previousDocument = globalThis.document, previousWindow = globalThis.window, previousLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const fake = new Proxy(function () {}, { get: (_target, key) => key === Symbol.toPrimitive ? () => "" : fake, apply: () => fake, set: () => true });
  globalThis.document = { getElementById: () => null, createElement: () => fake, querySelector: () => fake, body: fake };
  globalThis.window = fake;
  Object.defineProperty(globalThis, "location", { value: { origin: "http://test", pathname: "/" }, configurable: true });
  console.error = console.log = console.warn = () => {};
  try {
    Object.assign(workspace, { windows: [], app: { vault: { rootPath: "C:/vault" } }, popoutBridgeError: new Error("ipc missing"), popoutBridge: null });
    const support = workspace.popoutSupport();
    assert.equal(support.ok, false);
    assert.match(support.reason, /ipc missing/);
    workspace.popoutBridgeError = null;
    workspace.popoutBridge = { approveClose: () => { throw new Error("approve failed"); } };
    workspace.releaseSurface("w1", surface);
    assert.deepEqual(closes, []);
    workspace.popoutBridge = null;
    workspace.releaseSurface("w1", surface);
    assert.deepEqual(closes, ["close"]);
  } finally {
    Object.assign(console, quiet); globalThis.document = previousDocument;
    if (previousWindow === undefined) { delete globalThis.window; } else { globalThis.window = previousWindow; }
    if (previousLocation) { Object.defineProperty(globalThis, "location", previousLocation); } else { delete globalThis.location; }
  }
});
test("a view that cannot follow into a popout is refused before any window opens, and popoutNameFor only names live hosting surfaces", () => {
  const doc = {}, closed = {}, workspace = Object.create(Workspace.prototype);
  Object.assign(workspace, {
    windows: [{ surface: { document: doc, name: "slopsidian-popout-a", isClosed: () => false } }, { surface: { document: closed, name: "slopsidian-popout-b", isClosed: () => true } }],
    lastPopoutIssue: null, requireInteractive() {}, popoutSupport: () => ({ ok: true }), canMoveLeaf: () => true,
    popouts: { open() { throw new Error("must not open"); } },
  });
  assert.equal(workspace.popoutNameFor(doc), "slopsidian-popout-a");
  assert.equal(workspace.popoutNameFor(closed), null); assert.equal(workspace.popoutNameFor({}), null);
  const refusing = { parent: { children: [1] }, view: { windowMoveRefusal: () => "Wait for the clip." }, getDisplayText: () => "x" };
  assert.equal(workspace.canPopoutLeaf(refusing), false);
  assert.equal(workspace.canPopoutLeaf({ parent: { children: [1] }, view: { windowMoveRefusal: () => null } }), true);
  assert.throws(() => workspace.openWindow(refusing, null), /Wait for the clip/);
  assert.match(workspace.lastPopoutIssue.message, /Wait for the clip/);
  assert.equal(workspace.windows.length, 2);
});

test("restoreLeafToMain moves one popped-out leaf into a main group, prunes empty windows and ignores leaves already in main", () => {
  const win = Object.create(WorkspaceWindow.prototype), moved = [], calls = [];
  win.serialize = () => ({ id: "w", type: "split", direction: "vertical", children: [] }); win.bounds = null;
  const target = { children: [1, 2], id: "main-group" }, popped = { getRoot: () => win }, inMain = { getRoot: () => ({}) };
  const workspace = Object.create(Workspace.prototype);
  Object.assign(workspace, {
    rootSplit: {}, activeLeaf: popped, leaves: () => [popped, inMain],
    groups: root => root === workspace.rootSplit ? [target] : [],
    getMostRecentLeaf: () => null, transact: fn => fn(), snapshotTree: () => () => {}, relocateLeaf: (leaf, parent, index) => moved.push([leaf, parent, index]),
    pruneEmptyWindows: () => calls.push("prune"), setActiveLeaf: leaf => calls.push(["active", leaf]), render: () => calls.push("render"), layoutChanged: () => calls.push("layout"),
  });
  assert.equal(workspace.restoreLeafToMain(inMain), false); assert.equal(moved.length, 0);
  assert.equal(workspace.restoreLeafToMain(popped), true);
  assert.deepEqual(moved, [[popped, target, 2]]);
  assert.deepEqual(calls.filter(entry => entry === "prune" || entry === "layout"), ["prune", "layout"]);
  assert.deepEqual(calls.find(entry => entry[0] === "active"), ["active", popped]);
});
test("a native close veto after returnWindow keeps the window owned, moves the staged tabs back and allows a retry that commits only on the real close", () => {
  const quiet = { error: console.error }; console.error = () => {};
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { value: { origin: "http://test", pathname: "/" }, configurable: true });
  const notices = [];
  const owner = new EventEmitter(), contents = new EventEmitter(), ipc = new EventEmitter(), frame = { url: "http://127.0.0.1:5000/" };
  Object.assign(owner, { isDestroyed: () => false });
  let handler = null;
  Object.assign(contents, { mainFrame: frame, getURL: () => frame.url, isDestroyed: () => false, setWindowOpenHandler: next => { handler = next; } });
  owner.webContents = contents;
  const manager = popouts.installPopouts({ owner, ipcMain: ipc, localUrl: value => value.startsWith("http://127.0.0.1:"), isClosing: () => false });
  const NAME = "slopsidian-popout-w1", id = "w1";
  assert.equal(handler({ url: "about:blank", frameName: NAME }).action, "allow");
  const child = new EventEmitter(); let vetoGuest = true;
  Object.assign(child, { webContents: Object.assign(new EventEmitter(), { setWindowOpenHandler() {} }), isDestroyed: () => false, destroy() {}, close() { const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; child.emit("close", event); if (!event.defaultPrevented) { child.emit("closed"); } } });
  // Stands in for the hosted guest's reclaim: the same preventDefault the real web-viewer.cjs close handler issues.
  child.on("close", event => { if (!event.defaultPrevented && vetoGuest) { event.preventDefault(); } });
  contents.emit("did-create-window", child, { frameName: NAME });

  const workspace = Object.create(Workspace.prototype), listeners = { failed: null }, closedListeners = [];
  const win = Object.create(WorkspaceWindow.prototype);
  const popTabs = { children: [], id: "pop-tabs" }, mainTabs = { children: [], id: "main-tabs" }, leafA = { id: "a" };
  Object.assign(win, { id, releasing: false, staged: null, boundsTimer: null, children: [], render() {}, bounds: null, serialize: () => ({ id: "w1", type: "split", direction: "vertical", children: win.children.map(child => ({ id: child.id, type: "tabs", currentTab: 0, children: child.children.map(leaf => ({ id: leaf.id, type: "leaf" })) })) }) });
  win.surface = { name: NAME, isClosed: () => false, bounds: () => null, close() { throw new Error("must not force-close"); }, document: {} };
  popTabs.children.push(leafA); win.children.push(popTabs);
  const roots = { main: { id: "main" } };
  contents.send = (channel, name, reason) => {
    if (channel === "slopsidian:popout-close-failed") { listeners.failed(name.slice("slopsidian-popout-".length), reason); }
    if (channel === "slopsidian:popout-closed") { workspace.surfaceClosed(win); }
  };
  const bridge = {
    onCloseRequest() {}, approveClose: name => ipc.emit("slopsidian:popout-close-approved", { sender: contents, senderFrame: frame }, "slopsidian-popout-" + name),
    onCloseFailed: listener => { listeners.failed = listener; },
  };
  const events = [];
  Object.assign(workspace, {
    windows: [win], popoutBridge: bridge, unloading: false, rootSplit: roots.main, activeLeaf: leafA, closingWindows: new Set(),
    groups: root => root === win ? win.children.filter(child => child.children) : root === roots.main ? [mainTabs] : [],
    getMostRecentLeaf: () => null, transact: fn => fn(), leaves: () => [...popTabs.children, ...mainTabs.children],
    snapshotTree: () => { const before = [...popTabs.children]; return () => { mainTabs.children.length = 0; popTabs.children.splice(0, popTabs.children.length, ...before); win.children.splice(0, win.children.length, popTabs); }; },
    relocateLeaf: (leaf, to, index) => { for (const group of [popTabs, mainTabs]) { const at = group.children.indexOf(leaf); if (at >= 0) { group.children.splice(at, 1); } } to.children.splice(index, 0, leaf); leaf.parent = to; if (!popTabs.children.length) { win.children.splice(0, win.children.length); } },
    setActiveLeaf() {}, render: () => events.push("render"), layoutChanged: () => events.push("layout"),
  });
  workspace.popoutBridge.onCloseFailed((closeId, reason) => workspace.releaseFailed(workspace.windows.find(entry => entry.id === closeId), reason));

  workspace.returnWindow(win);
  assert.equal(workspace.windows.length, 1, "the window is not committed as disposed before the host answers");
  assert.equal(win.surface !== null, true);
  assert.equal(win.releasing, false, "the veto rolled the release back");
  assert.deepEqual(popTabs.children, [leafA], "the staged tab went back into the retained window");
  assert.deepEqual(mainTabs.children, []);
  assert.equal(manager.count(), 1);
  vetoGuest = false;
  workspace.returnWindow(win);
  assert.equal(workspace.windows.length, 0, "the window is removed only after the host confirms the close");
  assert.equal(win.surface, null); assert.equal(manager.count(), 0);
  assert.deepEqual(mainTabs.children, [leafA]);
  Object.assign(console, quiet);
  if (previousLocation) { Object.defineProperty(globalThis, "location", previousLocation); } else { delete globalThis.location; }
});

function nestedFixture() {
  const quiet = { error: console.error, log: console.log, warn: console.warn }, previousDocument = globalThis.document, previousWindow = globalThis.window, previousHtml = globalThis.HTMLElement, previousLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const fake = new Proxy(function () {}, { get: (_target, key) => key === Symbol.toPrimitive ? () => "" : fake, apply: () => fake, set: () => true });
  const shell = new Proxy({ inert: false }, { get: (target, key) => key in target ? target[key] : fake, set: (target, key, value) => { target[key] = value; return true; } });
  globalThis.document = { getElementById: () => shell, createElement: () => fake, createElementNS: () => fake, querySelector: () => fake, body: fake, activeElement: null };
  globalThis.window = fake; globalThis.HTMLElement = class {};
  Object.defineProperty(globalThis, "location", { value: { origin: "http://test", pathname: "/" }, configurable: true });
  console.error = console.log = console.warn = () => {};
  const workspace = Object.create(Workspace.prototype); workspace.tabDrag = { installGroup() {} };
  const held = { approved: [], failed: null };
  const bridge = { onCloseRequest() {}, approveClose: name => { held.approved.push(name); }, onCloseFailed: listener => { held.failed = listener; } };
  const mk = id => { const node = { id, parent: null, serialize: () => leaf(id), getRoot() { return node.parent.getRoot(); }, containerEl: fake, tabHeaderEl: fake, view: { cancelPreparedClose() {} }, render() {}, onResize() {} }; return node; };
  const rootSplit = new WorkspaceSplit(workspace, "vertical", "main"), mainTabs = new WorkspaceTabs(workspace, rootSplit, "mt");
  rootSplit.children.push(mainTabs);
  const m1 = mk("m1"); m1.parent = mainTabs; mainTabs.children.push(m1);
  const win = new WorkspaceWindow(workspace, "w1");
  win.direction = "vertical"; win.dimension = 7;
  const wt1 = new WorkspaceTabs(workspace, win, "wt1"), inner = new WorkspaceSplit(workspace, win, "horizontal", "ws"), wt2 = new WorkspaceTabs(workspace, inner, "wt2");
  wt1.dimension = 60; inner.dimension = 40; wt1.currentTab = 1;
  const [p1, p2, p3] = ["p1", "p2", "p3"].map(mk);
  [p1, p2].forEach(l => { l.parent = wt1; wt1.children.push(l); }); p3.parent = wt2; wt2.children.push(p3);
  inner.children.push(wt2); win.children.push(wt1, inner);
  win.bounds = { x: 1, y: 2, width: 800, height: 600 }; win.extras = { future: true };
  const surface = { name: "slopsidian-popout-w1", isClosed: () => false, bounds: () => null, close() { throw new Error("must not force-close"); }, document: {}, focus() {} };
  win.surface = surface;
  const before = structuredClone(win.serialize());
  const detach = l => {
    const from = l.parent; from.children.splice(from.children.indexOf(l), 1);
    for (let node = from; node.parent && !node.children.length; node = node.parent) { node.parent.children.splice(node.parent.children.indexOf(node), 1); }
  };
  const all = [m1, p1, p2, p3];
  Object.assign(workspace, {
    rootSplit, leftSplit: { children: [], serializeSidebar: () => null, restore() {}, direction: "vertical", id: "l" }, rightSplit: { children: [], serializeSidebar: () => null, restore() {}, direction: "vertical", id: "r" },
    windows: [win], popoutBridge: bridge, unloading: false, activeLeaf: p2, recentLeaves: [], closingWindows: new Set(), viewOptions: new Map(), groupLinks: new Map(), groupExtras: {}, windowExtras: {}, windowRejected: [], pendingWindows: [],
    app: { vault: { rootPath: "C:/vault" }, sidebars: { restore() {} } }, restoring: false, changingLayout: false, changingViews: 0, changingFiles: false, layoutReady: true, lastFile: null, restorationFailed: false, layoutWrite: Promise.resolve(), tasks: new Set(),
    leaves() { return all.filter(l => l.parent); }, getMostRecentLeaf: () => m1, render() {}, layoutChanged() {}, setActiveLeaf() {}, saveAll: async () => {}, notifyEditor() {}, requestSaveLayout: async () => {}, getActiveFile: () => null,
    relocateLeaf(leaf, to, index) { detach(leaf); to.children.splice(index, 0, leaf); leaf.parent = to; to.currentTab = index; },
  });
  held.failed = (id, reason) => workspace.releaseFailed(workspace.windows.find(entry => entry.id === id), reason);
  workspace.roots = () => [rootSplit, workspace.leftSplit, workspace.rightSplit, ...workspace.windows];
  workspace.groups = root => (function walk(node) { return node.children.flatMap(child => child instanceof WorkspaceSplit ? walk(child) : [child]); })(root);
  const saved = () => { const layout = workspace.getLayout(); return { main: layout.main, windows: layout.views[windows.WINDOWS_VIEW_ID]?.windows ?? [] }; };
  const restore = () => {
    Object.assign(console, quiet); globalThis.document = previousDocument; globalThis.HTMLElement = previousHtml;
    if (previousWindow === undefined) { delete globalThis.window; } else { globalThis.window = previousWindow; }
    if (previousLocation) { Object.defineProperty(globalThis, "location", previousLocation); } else { delete globalThis.location; }
  };
  return { workspace, held, win, surface, before, mainTabs, rootSplit, m1, p1, p2, p3, mk, saved, restore, wt1, wt2 };
}

test("an unapproved native close returns the same live tabs to main while preserving retryable nested window intent", () => {
  const f = nestedFixture();
  try {
    const { workspace, win, surface, before, mainTabs, rootSplit, p1, p2, p3, held, mk, saved } = f;
    const view = p2.view, editor = { doc: "unsaved popup text", selection: [2, 9], history: ["before edit"] };
    view.editor = editor;
    const newer = mk("newer");
    newer.parent = mainTabs;
    mainTabs.children.push(newer);
    workspace.leaves = () => [f.m1, newer, p1, p2, p3].filter(leaf => leaf.parent);
    surface.isClosed = () => true;
    const payloads = [], rendered = [];
    workspace.render = () => { rendered.push(mainTabs.children.map(leaf => leaf.id)); };
    workspace.layoutChanged = Workspace.prototype.layoutChanged;
    workspace.trigger = () => {};
    workspace.updateCaptionSpacing = () => {};
    workspace.requestSaveLayout = async () => { payloads.push(saved()); };

    workspace.surfaceClosed(win);

    assert.equal(workspace.windows.length, 0);
    assert.equal(win.surface, null);
    assert.equal(workspace.changingViews, 0);
    assert.deepEqual(held.approved, [], "a window that is already closed needs no approval or force-close");
    assert.deepEqual(mainTabs.children, [f.m1, newer, p1, p2, p3], "independent main work is retained");
    for (const leaf of [p1, p2, p3]) assert.equal(leaf.getRoot(), rootSplit);
    assert.equal(p2.view, view);
    assert.equal(p2.view.editor, editor);
    assert.deepEqual(editor, { doc: "unsaved popup text", selection: [2, 9], history: ["before edit"] });
    assert.equal(workspace.activeLeaf, p2);
    assert.ok(rendered.length > 0, "the owner redraws/adopts the recovered tabs synchronously");
    assert.equal(workspace.pendingPopoutCount, 1);
    assert.deepEqual(workspace.pendingWindows[0], { entry: { root: before, bounds: win.bounds, extras: { future: true } }, ids: ["p1", "p2", "p3"] });
    assert.equal(payloads.length, 1, "no intermediate flattened layout is persisted");
    assert.deepEqual(payloads[0].windows[0].root, before);
    assert.equal(payloads[0].windows[0].future, true);
    assert.deepEqual(windows.collectLeaves(payloads[0].main).map(leaf => leaf.id), ["m1", "newer"]);
    assert.equal(workspace.getLayout().views[windows.WINDOWS_VIEW_ID].active, "p2");
    workspace.surfaceClosed(win);
    assert.equal(workspace.pendingPopoutCount, 1, "duplicate close events do not duplicate saved intent");
    assert.equal(workspace.foldPendingWindows(), 1);
    assert.deepEqual(windows.collectLeaves(workspace.getLayout().main).map(leaf => leaf.id), ["m1", "newer", "p1", "p2", "p3"]);
  } finally { f.restore(); }
});

test("an unapproved close that cannot relocate keeps the original saved window and reports failure without dropping tabs", () => {
  const f = nestedFixture();
  try {
    const { workspace, win, surface, before, mainTabs, held } = f;
    surface.isClosed = () => true;
    workspace.relocateLeaf = () => { throw new Error("adoption refused"); };
    workspace.surfaceClosed(win);
    assert.equal(workspace.changingViews, 0);
    assert.deepEqual(workspace.windows, [win]);
    assert.equal(win.surface, null);
    assert.deepEqual(win.serialize(), before);
    assert.deepEqual(mainTabs.children, [f.m1]);
    assert.equal(workspace.pendingPopoutCount, 0);
    assert.deepEqual(held.approved, []);
  } finally { f.restore(); }
});

test("a deferred native return keeps the nested window owned and saved while pending, ignores nothing newer in main on veto, and commits only on the native close", () => {
  const f = nestedFixture();
  try {
    const { workspace, held, win, surface, before, mainTabs, m1, p2, saved, mk } = f;
    workspace.returnWindow(win);
    assert.equal(win.releasing, true); assert.deepEqual(held.approved, ["w1"]);
    assert.deepEqual(win.serialize(), before, "nothing moved while the host decides");
    assert.deepEqual(mainTabs.children.map(l => l.id), ["m1"]);
    const pending = saved();
    assert.deepEqual(pending.windows[0].root, before, "the nested window is saved exactly while pending");
    assert.equal(pending.windows[0].future, true);
    assert.deepEqual(windows.collectLeaves(pending.main).map(l => l.id), ["m1"], "no leaf id is saved twice");

    const m2 = mk("m2"); m2.parent = mainTabs; mainTabs.children.push(m2);
    workspace.leaves = () => [m1, m2, f.p1, p2, f.p3].filter(l => l.parent);
    held.failed("w1", "guest could not be reclaimed");
    assert.equal(win.releasing, false); assert.equal(win.closeRequested, false);
    assert.equal(workspace.windows[0], win); assert.equal(win.surface, surface);
    assert.deepEqual(win.serialize(), before, "the exact nested tree survives the veto");
    assert.deepEqual(mainTabs.children.map(l => l.id), ["m1", "m2"], "an independent main change is not rewound");
    assert.equal(workspace.activeLeaf, p2);
    assert.equal(workspace.releaseWaiters?.size ?? 0, 0);

    workspace.returnWindow(win);
    assert.equal(workspace.windows.length, 1); assert.equal(held.approved.length, 2);
    workspace.surfaceClosed(win);
    assert.equal(workspace.windows.length, 0); assert.equal(win.surface, null);
    assert.deepEqual(mainTabs.children.map(l => l.id), ["m1", "m2", "p1", "p2", "p3"]);
  } finally { f.restore(); }
});

test("an acknowledged return times out by clearing releasing and its waiters, stays retryable and a late native close still commits", async () => {
  const f = nestedFixture();
  try {
    const { workspace, win, before, mainTabs } = f;
    await assert.rejects(workspace.returnWindowAcknowledged(win, 10), /did not confirm/);
    assert.equal(win.releasing, false); assert.equal(workspace.releaseWaiters?.size ?? 0, 0);
    assert.deepEqual(win.serialize(), before); assert.equal(workspace.windows.length, 1);
    const retry = workspace.returnWindowAcknowledged(win, 1000);
    workspace.surfaceClosed(win);
    await retry;
    assert.equal(workspace.windows.length, 0);
    assert.deepEqual(mainTabs.children.map(l => l.id), ["m1", "p1", "p2", "p3"]);
    // A native close that arrives after a timeout (no retry) is committed, not treated as a crash.
    const g = nestedFixture();
    try {
      await assert.rejects(g.workspace.returnWindowAcknowledged(g.win, 10), /did not confirm/);
      g.workspace.surfaceClosed(g.win);
      assert.equal(g.workspace.windows.length, 0); assert.deepEqual(g.mainTabs.children.map(l => l.id), ["m1", "p1", "p2", "p3"]);
    } finally { g.restore(); }
  } finally { f.restore(); }
});

test("applying a layout waits for the popout's native close: a veto rejects the apply and keeps the old nested window, a confirmed close proceeds", async () => {
  const f = nestedFixture();
  try {
    const { workspace, held, win, before, mainTabs, surface } = f;
    const apply = workspace.applyLayout({ version: 1 });
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(win.releasing, true, "the apply is waiting for the native answer");
    held.failed("w1", "guest could not be reclaimed");
    await assert.rejects(apply, /guest could not be reclaimed/);
    assert.equal(workspace.windows.length, 1); assert.equal(workspace.windows[0], win); assert.equal(win.surface, surface);
    assert.deepEqual(win.serialize(), before); assert.deepEqual(mainTabs.children.map(l => l.id), ["m1"]);
    assert.equal(workspace.rootSplit, f.rootSplit); assert.equal(workspace.releaseWaiters?.size ?? 0, 0);
    assert.equal(workspace.pendingWindows.length, 0);
  } finally { f.restore(); }
});

test("the mutation lock makes real CodeMirror Undo/Redo refuse, retains history, and lets programmatic and synchronised edits through", async () => {
  const output = join(directory, "barrier.cjs");
  await build({ stdin: { contents: 'export { MutationLock } from "./client/editor-barrier"; export * as state from "@codemirror/state"; export * as commands from "@codemirror/commands";', resolveDir: root }, outfile: output, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
  const { MutationLock, state: cs, commands } = createRequire(import.meta.url)(output);
  const lock = new MutationLock();
  let current = cs.EditorState.create({ doc: "", extensions: [commands.history(), lock.extension()] });
  const apply = spec => { current = current.update(spec).state; };
  const run = command => { const before = current; command({ state: current, dispatch: tr => { current = tr.state; } }); return current !== before; };
  apply({ changes: { from: 0, insert: "one" }, userEvent: "input.type" });
  apply({ changes: { from: 3, insert: " two" }, userEvent: "input.type", annotations: commands.isolateHistory.of("full") });
  assert.equal(current.doc.toString(), "one two");
  assert.equal(run(commands.undo), true);
  const redoDepth = commands.redoDepth(current);
  assert.ok(redoDepth > 0);
  apply({ effects: lock.set(true) });
  assert.equal(current.readOnly, true);
  assert.equal(run(commands.undo), false, "Undo refuses while locked");
  assert.equal(run(commands.redo), false, "Redo refuses while locked");
  assert.equal(current.doc.toString(), "one");
  assert.equal(commands.redoDepth(current), redoDepth, "refused history commands retain the redo stack");
  apply({ effects: lock.set(false) });
  assert.equal(run(commands.redo), true, "the retained Redo resumes after release");
  assert.equal(current.doc.toString(), "one two");
  apply({ effects: lock.set(true) });
  apply({ changes: { from: 7, insert: " three" }, userEvent: "input.attach" });
  assert.equal(current.doc.toString(), "one two three", "a mutation's own programmatic edit still applies");
  assert.equal(commands.undoDepth(current) >= 1, true, "the undo history was retained");
  apply({ effects: lock.set(false) });
  assert.equal(current.readOnly, false);
  assert.equal(run(commands.undo), true, "Undo resumes");
  const afterUndo = current.doc.toString();
  assert.equal(commands.redoDepth(current) >= 1, true);
  assert.equal(run(commands.redo), true, "Redo resumes");
  assert.notEqual(current.doc.toString(), afterUndo);

  const inherited = new MutationLock();
  let protectedState = cs.EditorState.create({ extensions: [inherited.extension(), cs.EditorState.readOnly.of(true)] });
  assert.equal(protectedState.readOnly, true, "an idle mutation lock must not override another read-only policy");
  protectedState = protectedState.update({ effects: inherited.set(true) }).state;
  protectedState = protectedState.update({ effects: inherited.set(false) }).state;
  assert.equal(protectedState.readOnly, true, "release must preserve the existing read-only policy");
  let editableState = cs.EditorState.create({ extensions: [cs.EditorState.readOnly.of(false), inherited.extension()] });
  editableState = editableState.update({ effects: inherited.set(true) }).state;
  assert.equal(editableState.readOnly, true, "a held barrier takes precedence over an ordinary editable policy");
  editableState = editableState.update({ effects: inherited.set(false) }).state;
  assert.equal(editableState.readOnly, false);
});

test("syncWorkspaceChildren keeps state-preserving moves in one document and adopts across documents", async () => {
  const output = join(directory, "dom-sync.cjs");
  await build({ stdin: { contents: 'export { syncWorkspaceChildren } from "./client/workspace-dom";', resolveDir: root }, outfile: output, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
  const { syncWorkspaceChildren } = createRequire(import.meta.url)(output);
  const calls = [];
  const node = (doc, name) => ({ name, ownerDocument: doc, isConnected: true, parentNode: null, firstChild: null, nextSibling: null, childNodes: [] });
  const host = (doc, kids) => {
    const parent = node(doc, "parent");
    const link = () => { parent.childNodes = kids; parent.firstChild = kids[0] ?? null; kids.forEach((k, i) => { k.nextSibling = kids[i + 1] ?? null; }); };
    link();
    parent.moveBefore = (child, before) => { calls.push("move:" + child.name); const i = kids.indexOf(child); if (i >= 0) { kids.splice(i, 1); } kids.splice(before ? kids.indexOf(before) : kids.length, 0, child); link(); };
    parent.insertBefore = (child, before) => { calls.push("insert:" + child.name); const i = kids.indexOf(child); if (i >= 0) { kids.splice(i, 1); } kids.splice(before ? kids.indexOf(before) : kids.length, 0, child); child.ownerDocument = parent.ownerDocument; link(); };
    parent.removeChild = child => { kids.splice(kids.indexOf(child), 1); link(); };
    return parent;
  };
  const main = {}, popout = {};
  const a = node(main, "a"), b = node(main, "b");
  syncWorkspaceChildren(host(main, [a, b]), [b, a]);
  assert.deepEqual(calls, ["move:b"], "a connected same-document move preserves state");
  calls.length = 0;
  const foreign = node(popout, "foreign"), c = node(main, "c");
  const parent = host(main, [c]);
  syncWorkspaceChildren(parent, [foreign, c]);
  assert.deepEqual(calls, ["insert:foreign"], "a connected foreign-document node is adopted with insertBefore");
  assert.equal(foreign.ownerDocument, main);
  const bad = host(main, [c]);
  bad.moveBefore = () => { throw new Error("HierarchyRequestError"); };
  assert.throws(() => syncWorkspaceChildren(bad, [node(main, "x"), c].reverse()), /HierarchyRequestError/, "a genuine invalid hierarchy still surfaces");
});
function windowSurfaceFixture() {
  const el = () => ({ className: "", style: {}, append() {}, remove() {}, insertBefore() {}, querySelectorAll: () => [], getAttribute: () => null, setAttribute() {}, removeAttribute() {} });
  const adoptions = [];
  const makeDoc = () => {
    const doc = { title: "", head: el(), body: el(), documentElement: el(), querySelectorAll: () => [], adoptedStyleSheets: [] };
    doc.createElement = () => Object.assign(el(), { ownerDocument: doc, isConnected: true });
    doc.adoptNode = node => { adoptions.push({ node, from: node.ownerDocument, to: doc }); node.ownerDocument = doc; node.isConnected = false; return node; };
    return doc;
  };
  const timeouts = [], intervals = [], listeners = {};
  const popup = { closed: false, document: makeDoc(), screenX: 0, screenY: 0, outerWidth: 1, outerHeight: 1, addEventListener: (type, fn) => { listeners[type] = fn; }, close() {}, focus() {} };
  const opener = { open: () => popup, document: makeDoc(), requestAnimationFrame: () => 1, setInterval: fn => { intervals.push(fn); return 1; }, clearInterval() {}, setTimeout: fn => { timeouts.push(fn); return 1; } };
  return { popup, opener, adoptions, timeouts, intervals, listeners };
}

test("browser popouts restore outer dimensions through the standard APIs rather than reusing them as content dimensions", () => {
  const { popup, opener } = windowSurfaceFixture(), calls = [];
  Object.assign(popup, {
    outerWidth: 752, outerHeight: 716, innerWidth: 739, innerHeight: 646,
    resizeTo(width, height) { calls.push(["resize", width, height]); this.outerWidth = width; this.outerHeight = height; },
    moveTo(x, y) { calls.push(["move", x, y]); this.screenX = x; this.screenY = y; },
  });
  const previous = globalThis.MutationObserver;
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  try {
    const bounds = { x: 160, y: 120, width: 723, height: 603 };
    const surface = windows.createWindowPopoutHost(opener).open("browser-bounds", bounds, "t");
    assert.deepEqual(calls, [["resize", 723, 603], ["move", 160, 120]]);
    assert.deepEqual(surface.bounds(), bounds);
    surface.close();
  } finally { globalThis.MutationObserver = previous; }
});

test("an explicit browser bounds failure closes only the new popup and refuses restoration", () => {
  const { popup, opener, intervals } = windowSurfaceFixture();
  popup.resizeTo = () => { throw new Error("resize refused"); };
  popup.close = () => { popup.closed = true; };
  assert.throws(() => windows.createWindowPopoutHost(opener).open("refused-bounds", { x: 160, y: 120, width: 723, height: 603 }, "t"), error => error.code === "unsupported" && /resize refused/.test(error.message));
  assert.equal(popup.closed, true);
  assert.equal(intervals.length, 0, "a refused surface installs no lifetime poller");
});

test("desktop popouts leave outer sizing to the native host, not browser resize APIs", () => {
  const { popup, opener } = windowSurfaceFixture();
  popup.resizeTo = popup.moveTo = () => { throw new Error("the native path must not use browser geometry"); };
  const previous = globalThis.MutationObserver, electron = Object.getOwnPropertyDescriptor(process.versions, "electron");
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  Object.defineProperty(process.versions, "electron", { value: "test-native", configurable: true });
  try {
    const surface = windows.createWindowPopoutHost(opener).open("native-bounds", { x: 160, y: 120, width: 723, height: 603 }, "t");
    surface.close();
  } finally {
    globalThis.MutationObserver = previous;
    if (electron) { Object.defineProperty(process.versions, "electron", electron); } else { delete process.versions.electron; }
  }
});

test("a window that reports pagehide before closed is detected by the short recheck, not the 500ms poll", async () => {
  const { popup, opener, adoptions, timeouts, intervals, listeners } = windowSurfaceFixture();
  const previous = globalThis.MutationObserver;
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  try {
    const surface = windows.createWindowPopoutHost(opener).open("pop-x", null, "t");
    let closes = 0;
    surface.onClosed(() => closes++);
    assert.equal(surface.root.ownerDocument, popup.document);
    listeners.pagehide({ persisted: true });
    assert.equal(adoptions.length, 0, "a persisted page or a veto that never unloads does not park live DOM");
    assert.equal(timeouts.length, 0);
    listeners.pagehide({ persisted: false });
    assert.equal(adoptions.length, 1);
    assert.equal(adoptions[0].node, surface.root);
    assert.equal(adoptions[0].from, popup.document);
    assert.equal(surface.root.ownerDocument, opener.document, "the terminal document cannot clear the live subtree's event listeners");
    assert.equal(surface.root.isConnected, false, "parking is not an early visible move to main");
    assert.equal(surface.isClosed(), false, "parking does not approve or commit the window close");
    assert.equal(closes, 0, "the window has not reported closed yet");
    timeouts.shift()();
    assert.equal(closes, 0);
    popup.closed = true;
    assert.ok(timeouts.length, "a recheck is already scheduled without waiting for the interval");
    timeouts.shift()();
    assert.equal(closes, 1, "the confirmed close reaches the owner on the next recheck");
    listeners.pagehide({ persisted: false });
    assert.equal(closes, 1, "finish runs once");
    assert.ok(intervals.length === 1);
  } finally { globalThis.MutationObserver = previous; }
});

test("a parked disconnected view defers its document-move lifecycle until it is genuinely mounted", () => {
  const previous = globalThis.document, main = {}, popup = {}, moved = [];
  globalThis.document = main;
  try {
    const leaf = Object.create(WorkspaceLeaf.prototype);
    const containerEl = { ownerDocument: main, isConnected: false };
    leaf.homeDocument = popup;
    leaf.view = { containerEl, onWindowMoved: doc => moved.push(doc) };
    leaf.syncDocument();
    assert.equal(leaf.homeDocument, popup);
    assert.deepEqual(moved, [], "parking does not re-root observers or native guests before confirmed relocation");
    containerEl.isConnected = true;
    leaf.syncDocument();
    leaf.syncDocument();
    assert.deepEqual(moved, [main]);
    assert.equal(leaf.homeDocument, main);
  } finally { globalThis.document = previous; }
});