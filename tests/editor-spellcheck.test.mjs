import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Compartment, EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { MutationLock } from "../client/editor-barrier.ts";
import { errorLogStub } from "./error-log-stub.mjs";

const require = createRequire(import.meta.url);
const { installSpellcheck, initializeSpellcheckLanguages, SPELLCHECK_CHANNEL } = require("../desktop/spellcheck.cjs");
const root = fileURLToPath(new URL("../", import.meta.url));
let directory, feature;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "spellcheck-tests-"));
  const output = join(directory, "spellcheck.mjs");
  await build({ stdin: { contents: 'export * from "./client/editor-spellcheck"; export * from "./client/spellcheck-settings"; export { Editor } from "./client/editor";', resolveDir: root, loader: "ts" }, outfile: output, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent", plugins: [errorLogStub] });
  feature = await import(pathToFileURL(output).href);
});
after(async () => { if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/spellcheck-tests-[^/]+$/); await rm(directory, { recursive: true }); } });

test("spellcheck defaults on but malformed saved values are explicitly disabled", () => {
  assert.deepEqual(feature.spellcheckPreference(undefined), { enabled: true, valid: true });
  for (const value of [true, false]) assert.deepEqual(feature.spellcheckPreference(value), { enabled: value, valid: true });
  for (const value of ["true", "false", 1, null, {}, []]) assert.deepEqual(feature.spellcheckPreference(value), { enabled: false, valid: false });
});

test("a held older native context cannot dispatch after a newer request or clear that request's ownership", async () => {
  const owner = new feature.SpellingRequestOwner(), generation = owner.invalidate(), events = [];
  let firstReady, secondReady;
  const firstGate = new Promise(resolve => { firstReady = resolve; }), secondGate = new Promise(resolve => { secondReady = resolve; });
  const run = async (gate, token, name) => { await gate; if (owner.finish(generation, token)) events.push(name); };
  const first = run(firstGate, owner.begin(generation), "first"), second = run(secondGate, owner.begin(generation), "second");
  secondReady(); await second; assert.deepEqual(events, ["second"]);
  const third = owner.begin(generation);
  firstReady(); await first; assert.deepEqual(events, ["second"]);
  assert.equal(owner.finish(generation, third), true, "finishing an old request does not clear a later owner");
  const obsolete = owner.begin(generation), replacement = owner.invalidate(), current = owner.begin(replacement);
  assert.equal(owner.begin(generation), null, "old extension handlers cannot claim ownership");
  assert.equal(owner.finish(generation, obsolete), false, "extension replacement invalidates pending native responses");
  assert.equal(owner.finish(replacement, current), true);
});

function stateFixture() {
  const lock = new MutationLock(), compartment = new Compartment(), editable = new Compartment();
  const source = "😀 mispelled\r\nKeep\r\n";
  const view = { state: EditorState.create({ doc: source, selection: EditorSelection.single(3, 12), extensions: [history(), EditorState.lineSeparator.of("\r\n"), lock.extension(), editable.of(EditorView.editable.of(true)), compartment.of(feature.editorSpellcheck({}, true))] }),
    dispatch(spec) { this.state = this.state.update(spec).state; } };
  view.dispatch = view.dispatch.bind(view);
  const attrs = () => Object.assign({}, ...view.state.facet(EditorView.contentAttributes).map(value => typeof value === "function" ? value(view) : value));
  return { view, lock, compartment, editable, attrs, source };
}

test("spelling attributes follow editability and mutation locks without changing CRLF text, selections or Undo", () => {
  const f = stateFixture(), document = f.view.state.doc, selection = f.view.state.selection;
  assert.equal(f.attrs().spellcheck, "true");
  f.view.dispatch({ effects: f.lock.set(true) }); assert.equal(f.attrs().spellcheck, "false");
  f.view.dispatch({ effects: f.lock.set(false) }); assert.equal(f.attrs().spellcheck, "true");
  f.view.dispatch({ effects: f.editable.reconfigure(EditorView.editable.of(false)) }); assert.equal(f.attrs().spellcheck, "false");
  f.view.dispatch({ effects: [f.editable.reconfigure(EditorView.editable.of(true)), f.compartment.reconfigure(feature.editorSpellcheck({}, false))] });
  assert.equal(f.attrs().spellcheck, "false");
  assert.equal(f.view.state.doc, document); assert.equal(f.view.state.selection, selection); assert.equal(f.view.state.sliceDoc(), f.source); assert.equal(undo(f.view), false);
});

test("refreshing the actual Editor facade retains its state history and reads the accepted vault preference", () => {
  const f = stateFixture(), api = Object.create(feature.Editor.prototype), configuration = { value: undefined, get() { return this.value; } };
  Object.assign(api, { cm: f.view, spellcheckCompartment: f.compartment, owner: { app: { configuration } } });
  f.view.dispatch({ changes: { from: f.view.state.doc.length, insert: "typed" }, userEvent: "input.type" });
  const document = f.view.state.doc, selection = f.view.state.selection;
  configuration.value = false; api.refreshSpellcheck(); assert.equal(f.attrs().spellcheck, "false");
  configuration.value = true; api.refreshSpellcheck(); assert.equal(f.attrs().spellcheck, "true");
  assert.equal(f.view.state.doc, document); assert.equal(f.view.state.selection, selection);
  assert.equal(undo(f.view), true); assert.equal(f.view.state.sliceDoc(), f.source);
});

test("native word targeting requires the entire exact clicked Unicode word with raw CRLF offsets", () => {
  const text = "😀 café\r\nמילה mispelled mispelled\r\n";
  for (const word of ["café", "מילה", "mispelled"]) {
    const from = text.indexOf(word);
    for (const cursor of [from, from + 1, from + word.length]) assert.deepEqual(feature.spellingWordRange(text, cursor, word), { from, to: from + word.length });
  }
  assert.equal(feature.spellingWordRange("prefixmispelled", 8, "mispelled"), null);
  assert.equal(feature.spellingWordRange("𠮷mispelled", 3, "mispelled"), null);
  assert.equal(feature.spellingWordRange("mispelledSuffix", 4, "mispelled"), null);
  assert.equal(feature.spellingWordRange(text, 0, "mispelled"), null);
  for (const [cursor, word] of [[-1, "café"], [NaN, "café"], [4, ""], [4, "two words"], [4, "a\nb"], [4, "a".repeat(257)]]) assert.equal(feature.spellingWordRange(text, cursor, word), null);
  assert.equal(feature.spellingWordRange("a".repeat(feature.MAX_SPELLING_SOURCE + 1), 2, "a"), null);
});

function settingsFixture(value) {
  const calls = [], tab = Object.create(feature.EditorSpellcheckSettings.prototype);
  const app = { vault: { rootPath: "vault-A" }, changingVault: false, configuration: { async write(previous, data) { calls.push({ previous, data }); return { ...previous, version: "v2", data }; } } };
  Object.assign(tab, { app, document: { root: "vault-A", id: "app", version: "v1", data: { opaque: { kept: "中文" }, ...(value === undefined ? {} : { spellcheck: value }) } }, writes: Promise.resolve(), saving: 0, unwatch: () => {}, generation: 1,
    containerEl: { isConnected: true, remove() { this.isConnected = false; } }, pending: new Set(), pages: [], cleanups: [], domState: [], displayed: false, epoch: 0 });
  return { tab, app, calls };
}
test("Editor settings use the opened version, preserve unknown data, and reject invalid or inactive writes", async () => {
  const f = settingsFixture();
  assert.equal(f.tab.getControlValue("spellcheck"), true);
  await f.tab.setControlValue("spellcheck", false);
  assert.equal(f.calls[0].previous.version, "v1"); assert.deepEqual(f.calls[0].data, { opaque: { kept: "中文" }, spellcheck: false });
  assert.equal(f.tab.getControlValue("spellcheck"), false);
  await f.tab.setControlValue("spellcheck", true); assert.equal(f.calls[1].previous.version, "v2");
  for (const [key, value] of [["spellcheck", "true"], ["unknown", true]]) await assert.rejects(f.tab.setControlValue(key, value), /Boolean/);
  f.app.vault.rootPath = "vault-B"; await assert.rejects(f.tab.setControlValue("spellcheck", false), /inactive vault/);
  f.app.vault.rootPath = "vault-A"; f.tab.containerEl.isConnected = false; await assert.rejects(f.tab.setControlValue("spellcheck", false), /inactive vault/);
  assert.equal(f.calls.length, 2);
  const invalid = settingsFixture("false"); assert.equal(invalid.tab.getControlValue("spellcheck"), false);
  assert.match(invalid.tab.getSettingDefinitions()[0].desc, /saved value is invalid/);
});

test("a refused versioned settings write keeps its baseline and a queued write cannot follow a vault change", async () => {
  const f = settingsFixture(true), previous = f.tab.document;
  f.app.configuration.write = async () => { throw new Error("External version changed"); };
  await assert.rejects(f.tab.setControlValue("spellcheck", false), /External version/);
  assert.equal(f.tab.document, previous); assert.equal(f.tab.getControlValue("spellcheck"), true);
  let release; f.tab.writes = new Promise(resolve => { release = resolve; });
  const queued = f.tab.setControlValue("spellcheck", false); f.app.vault.rootPath = "vault-B"; release();
  await assert.rejects(queued, /inactive vault/); assert.equal(f.tab.document, previous);
});

test("closed and still-connected hidden Editor controls cannot save or adopt held open/Reload responses", async () => {
  const f = settingsFixture(true);
  await f.tab.closeSettings(); f.tab.containerEl.isConnected = true;
  await assert.rejects(f.tab.setControlValue("spellcheck", false), /inactive vault or page/);
  assert.equal(f.tab.document, null); assert.equal(f.calls.length, 0);

  const opening = settingsFixture(true); let release, inserted = 0;
  opening.app.configuration.read = () => new Promise(resolve => { release = resolve; });
  opening.app.configuration.watch = () => () => {};
  opening.tab.showSettings = async () => {};
  const pendingOpen = opening.tab.open({ isConnected: true, replaceChildren() { inserted++; } });
  for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
  assert.equal(typeof release, "function");
  await opening.tab.closeSettings(); release({ root: "vault-A", id: "app", version: "late", data: { spellcheck: false } }); await pendingOpen;
  assert.equal(inserted, 0); assert.equal(opening.tab.document, null);

  const reloading = settingsFixture(true); let finishRead, updated = 0;
  reloading.app.configuration.read = () => new Promise(resolve => { finishRead = resolve; });
  reloading.tab.update = () => { updated++; };
  const pendingReload = reloading.tab.getSettingDefinitions().at(-1).action();
  for (let i = 0; i < 20 && !finishRead; i++) await Promise.resolve();
  assert.equal(typeof finishRead, "function");
  await reloading.tab.closeSettings(); reloading.tab.containerEl.isConnected = true;
  finishRead({ root: "vault-A", id: "app", version: "late", data: { spellcheck: false } }); await pendingReload;
  assert.equal(reloading.tab.document, null); assert.equal(updated, 0);
});

function languageSession(languages = []) {
  return { languages, availableSpellCheckerLanguages: ["en-US", "en-GB", "nl-NL"], spellCheckerEnabled: true, additions: [],
    getSpellCheckerLanguages() { return [...this.languages]; }, setSpellCheckerLanguages(values) { this.languages = values; }, addWordToSpellCheckerDictionary(word) { this.additions.push(word); return true; } };
}
test("native language initialization preserves choices, prefers the supported locale, and has a bounded English fallback", () => {
  const existing = languageSession(["nl-NL"]); assert.deepEqual(initializeSpellcheckLanguages(existing, "en-US"), { initialized: false, error: null }); assert.deepEqual(existing.languages, ["nl-NL"]);
  for (const [locale, expected] of [["nl_NL", "nl-NL"], ["en-AU", "en-US"], ["xx-ZZ", "en-US"]]) { const session = languageSession(); assert.equal(initializeSpellcheckLanguages(session, locale).initialized, true); assert.deepEqual(session.languages, [expected]); }
  const absent = languageSession(); absent.availableSpellCheckerLanguages = []; assert.match(initializeSpellcheckLanguages(absent).error, /No supported/);
  const failure = languageSession(); failure.setSpellCheckerLanguages = () => { throw new Error("Unavailable dictionary service"); }; assert.match(initializeSpellcheckLanguages(failure).error, /Unavailable dictionary service/);
});

function nativeFixture(options = {}) {
  let tick = 1_000, closing = false, handler;
  const contents = new EventEmitter(); Object.assign(contents, { mainFrame: { url: "http://localhost/app" }, session: languageSession(), isDestroyed: () => false });
  if (options.session) Object.assign(contents.session, options.session);
  const owner = new EventEmitter(); Object.assign(owner, { webContents: contents, isDestroyed: () => false });
  const popout = new EventEmitter(); Object.assign(popout, { mainFrame: { url: "about:blank" }, session: contents.session, isDestroyed: () => false });
  const child = { webContents: popout };
  const installed = installSpellcheck({ ...options, owner, ipcMain: { handle(channel, callback) { assert.equal(channel, SPELLCHECK_CHANNEL); handler = callback; } }, localUrl: url => url === "http://localhost/app", popouts: { names: () => ["valid"], get: name => name === "valid" ? child : null }, now: () => tick, isClosing: () => closing, locale: "nl-NL" });
  const event = { sender: contents, senderFrame: contents.mainFrame };
  const context = (params = {}, target = contents) => target.emit("context-menu", {}, { isEditable: true, misspelledWord: "mispelled", dictionarySuggestions: ["misspelled"], x: 12, y: 23, ...params });
  return { contents, owner, popout, child, event, context, installed, request: (op, data, from = event) => handler(from, op, data), advance: delta => { tick += delta; }, close: () => { closing = true; } };
}
test("native dictionary info is scoped to an owned local main frame and never replaces document text", async () => {
  const f = nativeFixture();
  assert.deepEqual((await f.request("state", {})).languages, ["nl-NL"]);
  f.context({ dictionarySuggestions: ["misspelled", "misspelled", "a\nb", 1, ...Array.from({ length: 10 }, (_, i) => "word" + i)] });
  const result = await f.request("context", { x: 12, y: 23 }); assert.equal(result.word, "mispelled"); assert.equal(result.suggestions.length, 6); assert.equal(new Set(result.suggestions).size, 6);
  for (const event of [{ sender: f.contents, senderFrame: { url: "http://localhost/app" } }, { sender: {}, senderFrame: f.contents.mainFrame }]) await assert.rejects(f.request("state", {}, event), /owning local editor/);
  f.contents.mainFrame.url = "https://foreign.invalid"; await assert.rejects(f.request("state", {}), /owning local editor/);
  f.contents.mainFrame.url = "http://localhost/app"; f.close(); await assert.rejects(f.request("state", {}), /owning local editor/);
});
test("native context can arrive after its request; mismatched coordinates and stale contexts are unavailable", async () => {
  const f = nativeFixture(), pending = f.request("context", { x: 12, y: 23 });
  queueMicrotask(() => f.context()); assert.equal((await pending).word, "mispelled");
  assert.equal(await f.request("context", { x: 99, y: 99 }), null);
  f.advance(501); assert.equal(await f.request("context", { x: 12, y: 23 }), null);
  await assert.rejects(f.request("context", { x: NaN, y: 23 }), /coordinates/);
});
test("add-to-dictionary requires the current native token and cannot survive navigation, expiry or reuse", async () => {
  const f = nativeFixture(); f.context(); const result = await f.request("context", { x: 12, y: 23 });
  await assert.rejects(f.request("add", { token: "a".repeat(32) }), /no longer current/);
  assert.equal(await f.request("add", { token: result.token }), true); assert.deepEqual(f.contents.session.additions, ["mispelled"]);
  await assert.rejects(f.request("add", { token: result.token }), /no longer current/);
  f.context(); const beforeNavigation = await f.request("context", { x: 12, y: 23 }); f.contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
  await assert.rejects(f.request("add", { token: beforeNavigation.token }), /no longer current/);
  f.context(); const expired = await f.request("context", { x: 12, y: 23 }); f.advance(30_001); await assert.rejects(f.request("add", { token: expired.token }), /no longer current/);
});
test("only registered same-owner popouts obtain dictionary context", async () => {
  const f = nativeFixture(); f.owner.webContents.emit("did-create-window", f.child, { frameName: "valid" }); f.context({}, f.popout);
  const event = { sender: f.popout, senderFrame: f.popout.mainFrame };
  assert.equal((await f.request("context", { x: 12, y: 23 }, event)).word, "mispelled");
  f.popout.mainFrame.url = "https://foreign.invalid"; await assert.rejects(f.request("state", {}, event), /owning local editor/);
});

async function managementFixture(initialWords = [], options = {}) {
  const folder = await mkdtemp(join(directory, "native-profile-")), languagesPath = join(folder, "spellcheck-languages.json");
  const words = new Set(initialWords), changes = [];
  const f = nativeFixture({ languagesPath, platform: "win32", session: {
    isPersistent: () => true,
    async listWordsInSpellCheckerDictionary() { return [...words]; },
    addWordToSpellCheckerDictionary(word) { changes.push(["add", word]); words.add(word); return true; },
    removeWordFromSpellCheckerDictionary(word) { changes.push(["remove", word]); return words.delete(word); },
  }, ...options });
  return { ...f, folder, languagesPath, words, changes, read: () => f.request("management/read", {}) };
}

test("native management snapshots are bounded capabilities and never expose mutation without a persistent supported host", async () => {
  const f = await managementFixture(["kept", "λword"]), data = await f.read();
  assert.match(data.token, /^[a-f0-9]{32}$/); assert.deepEqual(data.languages, ["nl-NL"]); assert.deepEqual(data.words, ["kept", "λword"]);
  assert.equal(data.canSetLanguages, true); assert.equal(data.canManageWords, true); assert.equal(data.osSharedDictionary, true);
  assert.deepEqual(f.changes, []); assert.equal((await readdir(f.folder)).length, 0, "review does not write a preferences file");
  await assert.rejects(f.request("management/languages", { token: "0".repeat(32), languages: ["en-US"] }), /expired or changed/);
  const unsupported = await managementFixture([], { platform: "darwin" }), state = await unsupported.read();
  assert.equal(state.canSetLanguages, false); assert.equal(state.canManageWords, false);
  await assert.rejects(unsupported.request("management/add", { token: state.token, word: "never" }), /unavailable/); assert.deepEqual(unsupported.changes, []);
});

test("language choices persist in the owned profile file, preserve opaque fields and restore on another install", async () => {
  const f = await managementFixture();
  await writeFile(f.languagesPath, JSON.stringify({ schemaVersion: 1, languages: ["nl-NL"], opaque: { retain: ["中文", 42] } }));
  const before = await f.read(), next = await f.request("management/languages", { token: before.token, languages: ["en-GB", "en-US"] });
  assert.deepEqual(next.languages, ["en-GB", "en-US"]); assert.deepEqual(f.contents.session.getSpellCheckerLanguages(), next.languages);
  const saved = await readFile(f.languagesPath); assert.deepEqual(JSON.parse(saved), { schemaVersion: 1, languages: ["en-GB", "en-US"], opaque: { retain: ["中文", 42] } });
  const reopened = nativeFixture({ languagesPath: f.languagesPath, platform: "win32" });
  assert.deepEqual((await reopened.request("state", {})).languages, ["en-GB", "en-US"]); assert.deepEqual(await readFile(f.languagesPath), saved);
  await assert.rejects(f.request("management/languages", { token: before.token, languages: ["nl-NL"] }), /expired or changed/);
  assert.deepEqual(f.changes, []);
});

test("unsupported, duplicate, empty and excessive language selections refuse before touching native choices or profile bytes", async () => {
  const f = await managementFixture(), data = await f.read();
  for (const languages of [[], ["xx-ZZ"], ["en-US", "en-US"], [true], Array(9).fill("en-US"), "en-US", null]) {
    await assert.rejects(f.request("management/languages", { token: data.token, languages }), /one to eight/);
  }
  assert.deepEqual(f.contents.session.getSpellCheckerLanguages(), ["nl-NL"]); assert.deepEqual(await readdir(f.folder), []);
});

test("external preference or dictionary changes invalidate a reviewed management capability", async () => {
  for (const change of [async f => { f.words.add("independent"); }, async f => { f.contents.session.languages = ["en-US"]; }, async f => { await writeFile(f.languagesPath, '{"schemaVersion":1,"languages":["nl-NL"],"external":true}'); }]) {
    const f = await managementFixture(["original"]), data = await f.read(); await change(f);
    const before = f.contents.session.getSpellCheckerLanguages();
    await assert.rejects(f.request("management/languages", { token: data.token, languages: ["en-GB"] }), /changed.*Reload/);
    assert.deepEqual(f.contents.session.getSpellCheckerLanguages(), before); assert.deepEqual(f.changes, []);
  }
});

test("an external language change during an awaited dictionary read cannot be overwritten by an older language snapshot", async () => {
  const f = await managementFixture(), data = await f.read(); let release;
  f.contents.session.listWordsInSpellCheckerDictionary = () => new Promise(resolve => { release = resolve; });
  const pending = f.request("management/languages", { token: data.token, languages: ["en-GB"] });
  for (let i = 0; i < 20 && !release; i++) await Promise.resolve(); assert.equal(typeof release, "function");
  f.contents.session.languages = ["en-US"]; release([]);
  await assert.rejects(pending, /changed.*Reload/); assert.deepEqual(f.contents.session.languages, ["en-US"]); assert.deepEqual(await readdir(f.folder), []);
});

test("profile publication races refuse and restore the previous native language choice without overwriting external bytes", async () => {
  const f = await managementFixture(), data = await f.read();
  const original = f.contents.session.setSpellCheckerLanguages.bind(f.contents.session); let interfered = false;
  f.contents.session.setSpellCheckerLanguages = values => {
    original(values);
    if (!interfered) { interfered = true; writeFileSync(f.languagesPath, '{"schemaVersion":1,"languages":["nl-NL"],"independent":"kept"}'); }
  };
  await assert.rejects(f.request("management/languages", { token: data.token, languages: ["en-GB"] }), /changed outside/);
  assert.deepEqual(f.contents.session.languages, ["nl-NL"]); assert.deepEqual(JSON.parse(await readFile(f.languagesPath)), { schemaVersion: 1, languages: ["nl-NL"], independent: "kept" });
  assert.deepEqual(await readdir(f.folder), ["spellcheck-languages.json"]);
});

test("custom-word add/remove calls are tested only with the explicit in-memory session double, with exact identities and single-use snapshots", async () => {
  const f = await managementFixture(["retain"]), first = await f.read();
  for (const word of ["", "two words", "\u0000", "x".repeat(257), 1]) await assert.rejects(f.request("management/add", { token: first.token, word }), /one word/);
  await assert.rejects(f.request("management/add", { token: first.token, word: "retain" }), /already/);
  const added = await f.request("management/add", { token: first.token, word: "λSynthetic" });
  assert.deepEqual(added.words, ["retain", "λSynthetic"]); assert.deepEqual(f.changes, [["add", "λSynthetic"]]);
  await assert.rejects(f.request("management/remove", { token: first.token, word: "λSynthetic" }), /expired or changed/);
  const removed = await f.request("management/remove", { token: added.token, word: "λSynthetic" });
  assert.deepEqual(removed.words, ["retain"]); assert.deepEqual(f.changes, [["add", "λSynthetic"], ["remove", "λSynthetic"]]);
  assert.equal(removed.osSharedDictionary, true, "the production API's OS boundary remains visible even though this test uses a double");
});

test("navigation, explicit release, expiry, superseded review and window closing refuse held native spelling management writes", async () => {
  for (const revoke of [f => f.contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false }), f => f.request("management/release", {}), f => f.advance(120_001), f => f.read(), f => f.close()]) {
    const f = await managementFixture(), data = await f.read(); await revoke(f);
    await assert.rejects(f.request("management/add", { token: data.token, word: "never" }), /expired|current|owning/); assert.deepEqual(f.changes, []);
  }
  const f = await managementFixture(); let release;
  f.contents.session.listWordsInSpellCheckerDictionary = () => new Promise(resolve => { release = resolve; });
  const pending = f.read(); for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
  await f.request("management/release", {}); release([]); await assert.rejects(pending, /no longer current/); assert.deepEqual(f.changes, []);
});

test("native management rechecks token expiry after queue admission and the awaited host dictionary read", async () => {
  const f = await managementFixture(), data = await f.read(); let release;
  f.advance(119_999); f.contents.session.listWordsInSpellCheckerDictionary = () => new Promise(resolve => { release = resolve; });
  const pending = f.request("management/add", { token: data.token, word: "SyntheticExpired" });
  for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
  f.advance(2); release([]); await assert.rejects(pending, /no longer current/); assert.deepEqual(f.changes, []);
});

test("legacy context adds serialize with dictionary review, revoke management capabilities and recheck the queued context", async () => {
  const f = await managementFixture(); let release;
  f.contents.session.listWordsInSpellCheckerDictionary = () => new Promise(resolve => { release = resolve; });
  const reading = f.read(); for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
  f.context(); const context = await f.request("context", { x: 12, y: 23 });
  const adding = f.request("add", { token: context.token }); await Promise.resolve(); assert.deepEqual(f.changes, []);
  f.contents.session.listWordsInSpellCheckerDictionary = async () => [...f.words]; release([]);
  const snapshot = await reading; assert.equal(await adding, true); assert.deepEqual(f.changes, [["add", "mispelled"]]);
  await assert.rejects(f.request("management/languages", { token: snapshot.token, languages: ["en-US"] }), /expired or changed/);
  for (const invalidate of [fixture => fixture.advance(30_001), fixture => fixture.context({ misspelledWord: "newer" }), fixture => fixture.contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false })]) {
    const held = await managementFixture(); let finish;
    held.contents.session.listWordsInSpellCheckerDictionary = () => new Promise(resolve => { finish = resolve; });
    const read = held.read(); for (let i = 0; i < 20 && !finish; i++) await Promise.resolve();
    held.context(); const prior = await held.request("context", { x: 12, y: 23 }), change = held.request("add", { token: prior.token });
    const refused = assert.rejects(change, /no longer current/); invalidate(held); finish([]);
    await Promise.allSettled([read]); await refused; assert.deepEqual(held.changes, []);
  }
  const refused = nativeFixture({ session: { addWordToSpellCheckerDictionary: () => false } }); refused.context();
  const contextBeforeRefusal = await refused.request("context", { x: 12, y: 23 });
  await assert.rejects(refused.request("add", { token: contextBeforeRefusal.token }), /did not accept/);
});

test("management refuses malformed profile files and oversized/unsupported native dictionary data without partial results", async () => {
  for (const bytes of [Buffer.from([0xff]), Buffer.from('{"schemaVersion":2,"languages":["en-US"]}'), Buffer.alloc(16_385, 32)]) {
    const f = await managementFixture(); await writeFile(f.languagesPath, bytes); await assert.rejects(f.read()); assert.deepEqual(await readFile(f.languagesPath), bytes); assert.deepEqual(f.changes, []);
  }
  for (const words of [Array(10_001).fill("x"), ["two words"], ["x".repeat(257)], Array.from({ length: 4_101 }, (_, i) => "x".repeat(252) + String(i))]) {
    const f = await managementFixture(); f.contents.session.listWordsInSpellCheckerDictionary = async () => words;
    await assert.rejects(f.read(), /limit|unsupported|excessive/); assert.deepEqual(f.changes, []);
  }
});

function managementState(overrides = {}) {
  return { token: "a".repeat(32), supported: ["en-US", "nl-NL"], languages: ["en-US"], words: [], canSetLanguages: true, canManageWords: true, osSharedDictionary: true, maxLanguages: 8, maxWords: 10_000, ...overrides };
}

test("renderer management snapshots validate bounded native data without coercion and keep accepted arrays immutable", () => {
  const state = feature.spellingManagementState(managementState()); assert.throws(() => state.languages.push("nl-NL"));
  for (const patch of [{ token: "x" }, { supported: ["en-US", "en-US"] }, { languages: ["unavailable"] }, { words: ["two words"] }, { words: ["x", "x"] }, { canManageWords: "true" }, { maxLanguages: 99 }]) assert.throws(() => feature.spellingManagementState(managementState(patch)), /unsupported/);
  assert.equal(feature.validSpellingWord("λSynthetic"), true); assert.equal(feature.validSpellingWord("two words"), false);
  assert.equal(feature.validSpellingLanguages(["en-US"], state.supported), true); assert.equal(feature.validSpellingLanguages([], state.supported), false);
});

test("renderer management discards superseded replies but refreshes busy state when the final old read drains", async () => {
  const releases = [], updates = [], errors = []; let session;
  session = new feature.SpellingManagementSession(operation => operation === "management/read" ? new Promise(resolve => releases.push(resolve)) : Promise.resolve(true), () => true,
    () => updates.push(session.busy), message => errors.push(message), () => {});
  const first = session.reload(), second = session.reload(); for (let i = 0; i < 20 && releases.length < 2; i++) await Promise.resolve();
  releases[1](managementState({ token: "b".repeat(32), languages: ["nl-NL"] })); assert.equal(await second, true);
  releases[0](managementState()); assert.equal(await first, false); assert.deepEqual(session.state.languages, ["nl-NL"]); assert.equal(session.busy, false); assert.equal(updates.at(-1), false); assert.deepEqual(errors, [""]);
  await session.close();
});

test("closing renderer controls drains an accepted mutation, invalidates spelling contexts and never adopts or revives its late UI", async () => {
  const calls = [], updates = []; let release, mutations = 0, session;
  session = new feature.SpellingManagementSession((operation, request) => {
    calls.push({ operation, request }); if (operation === "management/read") return Promise.resolve(managementState());
    if (operation === "management/languages") return new Promise(resolve => { release = resolve; }); return Promise.resolve(true);
  }, () => true, () => updates.push(session.state), () => {}, () => { mutations++; });
  await session.reload(); const pending = session.change("languages", ["nl-NL"]);
  for (let i = 0; i < 20 && !release; i++) await Promise.resolve(); assert.equal(typeof release, "function");
  const closed = session.close(), count = updates.length; release(managementState({ token: "b".repeat(32), languages: ["nl-NL"] }));
  assert.equal(await pending, false); await closed; assert.equal(session.state, null); assert.equal(updates.length, count); assert.equal(mutations, 1);
  assert.deepEqual(calls.map(value => value.operation), ["management/read", "management/languages", "management/release"]);
  assert.equal(await session.change("add", "never"), false); assert.equal(await session.reload(), false);
});

test("a dispatched mutation followed by a rejected or malformed review still invalidates retained contexts and requires Reload", async () => {
  for (const malformed of [false, true]) {
    const errors = []; let applied = 0, invalidated = 0;
    const session = new feature.SpellingManagementSession(async operation => {
      if (operation === "management/read") return managementState();
      if (operation === "management/languages") { applied++; if (malformed) return { token: "incomplete" }; throw new Error("The host dictionary did not finish loading."); }
      return true;
    }, () => true, () => {}, message => errors.push(message), () => { invalidated++; });
    await session.reload(); assert.equal(await session.change("languages", ["nl-NL"]), false);
    assert.equal(applied, 1); assert.equal(invalidated, 1); assert.equal(session.state, null); assert.match(errors.at(-1), /may already have been applied.*Reload spelling controls/);
    assert.equal(await session.change("languages", ["en-US"]), false); await session.close();
  }
  let reject, invalidated = 0, updates = 0;
  const session = new feature.SpellingManagementSession(operation => operation === "management/read" ? Promise.resolve(managementState())
    : operation === "management/languages" ? new Promise((_, refuse) => { reject = refuse; }) : Promise.resolve(true),
  () => true, () => { updates++; }, () => {}, () => { invalidated++; });
  await session.reload(); const pending = session.change("languages", ["nl-NL"]);
  for (let i = 0; i < 20 && !reject; i++) await Promise.resolve();
  const closed = session.close(), count = updates; reject(new Error("Post-write dictionary read failed."));
  assert.equal(await pending, false); await closed; assert.equal(invalidated, 1); assert.equal(updates, count); assert.equal(session.state, null);
});

function fakeDom() {
  class Element {
    constructor(tag = "div") {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.dataset = {}; this.style = {}; this.attributes = new Map(); this.listeners = new Map(); this.value = ""; this.textContent = ""; this.connected = false;
      const classes = () => (this.className ?? "").split(/\s+/).filter(Boolean);
      this.classList = { contains: name => classes().includes(name), add: (...names) => { this.className = [...new Set([...classes(), ...names])].join(" "); },
        remove: (...names) => { this.className = classes().filter(name => !names.includes(name)).join(" "); },
        toggle: (name, force) => { const on = force ?? !classes().includes(name); if (on) this.classList.add(name); else this.classList.remove(name); return on; } };
    }
    get isConnected() { return this.connected || Boolean(this.parentElement?.isConnected); }
    get textContent() { return this.content + this.children.map(child => child.textContent).join(""); }
    set textContent(value) { this.content = String(value ?? ""); for (const child of this.children) child.parentElement = null; this.children = []; }
    append(...children) { for (let child of children) { if (typeof child === "string") { const text = new Element("text"); text.textContent = child; child = text; } child.parentElement = this; this.children.push(child); } }
    appendChild(child) { this.append(child); return child; }
    replaceChildren(...children) { this.textContent = ""; this.append(...children); }
    contains(child) { for (let node = child; node; node = node.parentElement) if (node === this) return true; return false; }
    querySelectorAll(selector) {
      const matches = element => selector.split(",").some(part => {
        const value = part.trim();
        if (value.startsWith(".")) return element.classList.contains(value.slice(1));
        const data = /^\[data-([a-z-]+)\]$/.exec(value);
        if (data) return data[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase()) in element.dataset;
        return element.tagName.toLowerCase() === value.toLowerCase();
      });
      return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    setAttribute(key, value) { this.attributes.set(key, value); }
    removeAttribute(key) { this.attributes.delete(key); }
    addEventListener(type, listener) { const listeners = this.listeners.get(type) ?? []; listeners.push(listener); this.listeners.set(type, listeners); }
    dispatch(type) { for (const listener of this.listeners.get(type) ?? []) listener({ target: this }); }
    focus() {}
  }
  return { Element, document: { createElement: tag => new Element(tag), createTextNode: text => Object.assign(new Element("text"), { textContent: text }) } };
}

test("the actual declarative settings render and later state refresh keep browser spelling management disabled with its host boundary visible", async () => {
  const prior = globalThis.document, dom = fakeDom(); globalThis.document = dom.document;
  try {
    const f = settingsFixture(true), definition = f.tab.getSettingDefinitions().find(item => item.name === "Spellcheck languages and dictionary");
    f.tab.containerEl = new dom.Element(); f.tab.containerEl.connected = true; f.tab.getSettingDefinitions = () => [definition];
    await f.tab.showSettings();
    const button = f.tab.containerEl.querySelectorAll("[data-spelling-management-open]")[0], row = f.tab.containerEl.querySelectorAll("[data-spelling-management-entry]")[0];
    assert.equal(button.disabled, true); assert.match(row.textContent, /managed by your browser/);
    f.tab.refreshDomState(); assert.equal(button.disabled, true, "generic settings disabled-state refresh cannot enable a host-unavailable control");
    assert.equal(row.classList.contains("is-disabled"), true);
  } finally { if (prior === undefined) delete globalThis.document; else globalThis.document = prior; }
});

test("detached language checkboxes cannot change the current language draft after the filter rebuilds controls", () => {
  const prior = globalThis.document, dom = fakeDom(); globalThis.document = dom.document;
  try {
    const modal = Object.create(feature.SpellcheckManagementModal.prototype), data = feature.spellingManagementState(managementState());
    const fields = Object.fromEntries(["languages", "languageFilter", "selected", "apply", "wordFilter", "wordInput", "add", "list", "summary", "status", "reload", "modalEl"].map(key => [key, new dom.Element()]));
    fields.languages.connected = true;
    Object.assign(modal, fields, { management: { state: data, busy: false }, chosen: new Set(data.languages), initialized: true, listeners: new AbortController(), message: "", available: () => true });
    modal.render(false); const old = fields.languages.children[0].children[0];
    fields.languageFilter.value = "en"; modal.render(false); assert.equal(old.isConnected, false); old.checked = false; old.dispatch("change"); assert.deepEqual([...modal.chosen], ["en-US"]);
    const elsewhere = new dom.Element(); elsewhere.connected = true; elsewhere.append(old); old.dispatch("change"); assert.deepEqual([...modal.chosen], ["en-US"]);
    const current = fields.languages.children[0].children[0]; current.checked = false; current.dispatch("change"); assert.deepEqual([...modal.chosen], []);
  } finally { if (prior === undefined) delete globalThis.document; else globalThis.document = prior; }
});

test("unsupported native controls explicitly describe unavailable management without implying an empty dictionary", () => {
  const prior = globalThis.document, dom = fakeDom(); globalThis.document = dom.document;
  try {
    const modal = Object.create(feature.SpellcheckManagementModal.prototype), data = feature.spellingManagementState(managementState({ canSetLanguages: false, canManageWords: false }));
    const fields = Object.fromEntries(["languages", "languageFilter", "selected", "apply", "wordFilter", "wordInput", "add", "list", "summary", "status", "reload", "modalEl"].map(key => [key, new dom.Element()]));
    fields.modalEl.dataset.spellingManagedWords = "9";
    Object.assign(modal, fields, { management: { state: data, busy: false }, chosen: new Set(), initialized: false, listeners: new AbortController(), message: "", available: () => true });
    modal.render(true);
    assert.match(fields.summary.textContent, /Custom dictionary management is unavailable/); assert.doesNotMatch(fields.summary.textContent, /0 custom words/);
    assert.match(fields.selected.textContent, /Language management is unavailable/); assert.match(fields.list.children[0].textContent, /unavailable/);
    assert.equal("spellingManagedWords" in fields.modalEl.dataset, false);
    for (const name of ["languageFilter", "apply", "wordFilter", "wordInput", "add"]) assert.equal(fields[name].disabled, true, name);
    assert.equal(fields.reload.disabled, false, "review can be retried if host capabilities change");
  } finally { if (prior === undefined) delete globalThis.document; else globalThis.document = prior; }
});

test("two synchronous Manage actions waiting for one old dialog drain create only one replacement modal", async () => {
  const prior = globalThis.document, dom = fakeDom(), originalOpen = feature.SpellcheckManagementModal.prototype.open, opened = []; globalThis.document = dom.document;
  feature.SpellcheckManagementModal.prototype.open = function () { this.opened = true; opened.push(this); };
  try {
    const f = settingsFixture(true); let release;
    const gate = new Promise(resolve => { release = resolve; }); f.tab.nativeDialog = { isOpen: false, whenIdle: () => gate };
    f.tab.containerEl.ownerDocument = { defaultView: { require: () => ({ ipcRenderer: { invoke: async () => true } }) } };
    const first = f.tab.openSpellingManagement(), second = f.tab.openSpellingManagement(); release(); await Promise.all([first, second]);
    assert.equal(opened.length, 1); assert.equal(f.tab.nativeDialog, opened[0]); opened[0].opened = false;
  } finally { feature.SpellcheckManagementModal.prototype.open = originalOpen; if (prior === undefined) delete globalThis.document; else globalThis.document = prior; }
});

test("a held old spelling dialog drain cannot tear down a rapidly reopened Editor settings page", async () => {
  const f = settingsFixture(true); let release, opened = false, unwatches = 0;
  const gate = new Promise(resolve => { release = resolve; }), fresh = { root: "vault-A", id: "app", version: "new", data: { spellcheck: true } };
  f.tab.nativeDialog = { close() {}, whenIdle: () => gate }; f.tab.unwatch = () => { unwatches++; };
  f.app.configuration.read = async () => fresh; f.app.configuration.watch = () => () => { unwatches++; }; f.tab.showSettings = async () => {};
  const closing = f.tab.closeSettings(), opening = f.tab.open({ isConnected: true, replaceChildren() { f.tab.containerEl.isConnected = true; opened = true; } });
  for (let i = 0; i < 30; i++) await Promise.resolve();
  assert.equal(opened, false, "a replacement page waits for all previous native controls to drain"); assert.equal(f.tab.document, null); assert.equal(f.tab.unwatch, null);
  release(); await Promise.all([closing, opening]);
  assert.equal(f.tab.document, fresh); assert.equal(f.tab.containerEl.isConnected, true); assert.equal(typeof f.tab.unwatch, "function"); assert.equal(unwatches, 1);
});
