import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Compartment, EditorSelection, EditorState, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { indentUnit } from "@codemirror/language";
import { indentMore, redo, undo } from "@codemirror/commands";
import { errorLogStub } from "./error-log-stub.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, feature;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "editor-preference-tests-"));
  const output = join(directory, "editor-preferences.mjs");
  await build({ stdin: { contents: 'export * from "./client/editor-preferences"; export { Editor } from "./client/editor"; export { EditorSpellcheckSettings } from "./client/editor-spellcheck";', resolveDir: root, loader: "ts" }, outfile: output, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent", plugins: [errorLogStub] });
  feature = await import(pathToFileURL(output).href);
});
after(async () => { if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/editor-preference-tests-[^/]+$/); await rm(directory, { recursive: true }); } });

test("editor preference defaults are bounded and malformed imports are never coerced", () => {
  assert.deepEqual(feature.EDITOR_PREFERENCE_DEFAULTS, { showLineNumber: false, lineWrap: true, readableLineLength: true, tabSize: 4, useTab: false, foldHeading: true, foldIndent: true, autoPairBrackets: true, autoPairMarkdown: true, smartIndentList: true });
  for (const key of ["showLineNumber", "lineWrap", "readableLineLength", "useTab", "foldHeading", "foldIndent", "autoPairBrackets", "autoPairMarkdown", "smartIndentList"]) {
    assert.deepEqual(feature.editorPreference(key, undefined), { value: feature.EDITOR_PREFERENCE_DEFAULTS[key], valid: true });
    for (const value of [true, false]) assert.deepEqual(feature.editorPreference(key, value), { value, valid: true });
    for (const value of [null, 0, 1, "false", [], {}]) assert.deepEqual(feature.editorPreference(key, value), { value: feature.EDITOR_PREFERENCE_DEFAULTS[key], valid: false });
  }
  for (let value = 2; value <= 8; value++) assert.deepEqual(feature.editorPreference("tabSize", value), { value, valid: true });
  for (const value of [null, true, "4", 0, 1, 9, 2.5, NaN, Infinity, {}, []]) assert.deepEqual(feature.editorPreference("tabSize", value), { value: 4, valid: false });
});

test("preference writes accept explicit supported Booleans or bounded integer sizes only", () => {
  for (const key of ["showLineNumber", "lineWrap", "readableLineLength", "useTab", "foldHeading", "foldIndent", "autoPairBrackets", "autoPairMarkdown", "smartIndentList"]) {
    for (const value of [true, false]) assert.doesNotThrow(() => feature.validateEditorPreference(key, value));
    for (const value of [undefined, null, "true", 1]) assert.throws(() => feature.validateEditorPreference(key, value), /Boolean/);
  }
  for (const value of [2, 4, 8]) assert.doesNotThrow(() => feature.validateEditorPreference("tabSize", value));
  for (const value of [undefined, "4", 1, 9, 4.5]) assert.throws(() => feature.validateEditorPreference("tabSize", value), /integer from 2 to 8/);
  for (const key of ["__proto__", "constructor", "unknown"]) { assert.equal(feature.isEditorPreference(key), false); assert.throws(() => feature.validateEditorPreference(key, true), /supported/); }
});

function stateFixture(overrides = {}) {
  const compartment = new Compartment(), spelling = new Compartment(), source = "😀 λ\r\nKeep\tindentation\r\n";
  const pluginField = StateField.define({ create: () => ({ keep: true }), update: value => value });
  const view = { state: EditorState.create({ doc: source, selection: EditorSelection.single(3, 4), extensions: [feature.editorBaseSetup, EditorState.lineSeparator.of("\r\n"), pluginField, compartment.of(feature.editorPreferences({ ...feature.EDITOR_PREFERENCE_DEFAULTS, ...overrides })), spelling.of([])] }),
    dispatch(spec) { this.state = this.state.update(spec).state; }, requestMeasure() { this.measures = (this.measures ?? 0) + 1; } };
  view.dispatch = view.dispatch.bind(view);
  const attrs = () => Object.assign({}, ...view.state.facet(EditorView.editorAttributes).map(value => typeof value === "function" ? value(view) : value));
  return { view, compartment, spelling, attrs, source, pluginField };
}

test("optional display and indentation extensions reconfigure without replacing text, selection, plugin state or Undo", () => {
  const f = stateFixture(), plugin = f.view.state.field(f.pluginField);
  f.view.dispatch({ changes: { from: f.view.state.doc.length, insert: "typed" }, userEvent: "input.type" });
  const document = f.view.state.doc, selection = f.view.state.selection;
  f.view.dispatch({ effects: f.compartment.reconfigure(feature.editorPreferences({ showLineNumber: false, lineWrap: false, readableLineLength: false, tabSize: 8, useTab: true })) });
  assert.equal(f.view.state.tabSize, 8); assert.equal(f.view.state.facet(indentUnit), "\t");
  assert.equal(f.attrs()["data-editor-line-numbers"], "false"); assert.equal(f.attrs()["data-editor-line-wrap"], "false"); assert.equal(f.attrs()["data-editor-readable-width"], "false");
  assert.equal(f.view.state.doc, document); assert.equal(f.view.state.selection, selection); assert.equal(f.view.state.field(f.pluginField), plugin);
  assert.equal(undo(f.view), true); assert.equal(f.view.state.sliceDoc(), f.source);
  assert.equal(redo(f.view), true); assert.equal(f.view.state.sliceDoc(), f.source + "typed");
});

test("indent commands follow the current spaces width or tab unit, preserve CRLF and Undo exactly", () => {
  const f = stateFixture({ tabSize: 2, useTab: false });
  f.view.dispatch({ selection: EditorSelection.single(f.view.state.doc.line(2).from) });
  indentMore(f.view); assert.equal(f.view.state.sliceDoc(), "😀 λ\r\n  Keep\tindentation\r\n");
  assert.equal(undo(f.view), true); assert.equal(f.view.state.sliceDoc(), f.source);
  f.view.dispatch({ effects: f.compartment.reconfigure(feature.editorPreferences({ ...feature.EDITOR_PREFERENCE_DEFAULTS, tabSize: 8, useTab: true })) });
  indentMore(f.view); assert.equal(f.view.state.sliceDoc(), "😀 λ\r\n\tKeep\tindentation\r\n");
  assert.equal(undo(f.view), true); assert.equal(f.view.state.sliceDoc(), f.source);
});

test("owned and standalone editors read accepted preferences and tolerate unavailable or malformed configuration", () => {
  const data = { showLineNumber: false, lineWrap: false, readableLineLength: false, tabSize: 7, useTab: true, foldHeading: false, foldIndent: true, autoPairBrackets: false, autoPairMarkdown: true, smartIndentList: true };
  assert.deepEqual(feature.readEditorPreferences({ editorComponent: { app: { configuration: { get: (_id, key) => data[key] } } } }), data);
  assert.deepEqual(feature.readEditorPreferences({ editorComponent: null }), feature.EDITOR_PREFERENCE_DEFAULTS);
  assert.deepEqual(feature.readEditorPreferences({ editorComponent: { app: { configuration: { get() { throw new Error("not ready"); } } } } }), feature.EDITOR_PREFERENCE_DEFAULTS);
});

test("the actual Editor facade refreshes accepted settings and spelling on its existing state", () => {
  const f = stateFixture(), api = Object.create(feature.Editor.prototype), data = { tabSize: 6, useTab: true, lineWrap: false };
  Object.assign(api, { cm: f.view, preferencesCompartment: f.compartment, spellcheckCompartment: f.spelling, owner: { app: { configuration: { get: (_id, key) => data[key] } } } });
  const document = f.view.state.doc, selection = f.view.state.selection;
  api.refreshPreferences(); assert.equal(f.view.state.tabSize, 6); assert.equal(f.view.state.facet(indentUnit), "\t"); assert.equal(f.attrs()["data-editor-line-wrap"], "false"); assert.equal(f.view.measures, 1);
  assert.equal(f.view.state.doc, document); assert.equal(f.view.state.selection, selection); assert.equal(undo(f.view), false);
});

function settingsFixture() {
  const calls = [], tab = Object.create(feature.EditorSpellcheckSettings.prototype);
  const app = { vault: { rootPath: "vault-A" }, changingVault: false, configuration: { async write(previous, data) { calls.push({ previous, data }); return { ...previous, version: "v" + (calls.length + 1), data }; } } };
  Object.assign(tab, { app, document: { root: "vault-A", id: "app", version: "v1", data: { opaque: { keep: "中文" }, spellcheck: false, unsupported: [1, 2] } }, writes: Promise.resolve(), saving: 0, unwatch: () => {}, generation: 1,
    containerEl: { isConnected: true, remove() { this.isConnected = false; } }, pending: new Set(), pages: [], cleanups: [], domState: [], displayed: false, epoch: 0 });
  return { tab, app, calls };
}

test("queued settings changes carry forward accepted versions and every unrelated field", async () => {
  const f = settingsFixture();
  await Promise.all([f.tab.setControlValue("showLineNumber", false), f.tab.setControlValue("tabSize", 8), f.tab.setControlValue("useTab", true)]);
  assert.deepEqual(f.calls.map(call => call.previous.version), ["v1", "v2", "v3"]);
  assert.deepEqual(f.tab.document.data, { opaque: { keep: "中文" }, spellcheck: false, unsupported: [1, 2], showLineNumber: false, tabSize: 8, useTab: true });
  for (const [key, value] of [["tabSize", 9], ["useTab", "true"], ["lineWrap", undefined]]) await assert.rejects(f.tab.setControlValue(key, value));
  assert.equal(f.calls.length, 3);
});

test("external version refusal and closing a queued control retain the accepted baseline", async () => {
  const f = settingsFixture(), baseline = f.tab.document;
  f.app.configuration.write = async () => { throw new Error("External version changed"); };
  await assert.rejects(f.tab.setControlValue("readableLineLength", false), /External version/); assert.equal(f.tab.document, baseline);
  let release; f.tab.writes = new Promise(resolve => { release = resolve; });
  const pending = f.tab.setControlValue("tabSize", 2); f.tab.generation++; release(); await assert.rejects(pending, /inactive vault or page/); assert.equal(f.tab.document, baseline);
  await f.tab.closeSettings(); f.tab.containerEl.isConnected = true;
  await assert.rejects(f.tab.setControlValue("showLineNumber", false), /inactive vault or page/);
});

test("malformed setting descriptions identify each fallback without changing imported values", () => {
  const f = settingsFixture(); Object.assign(f.tab.document.data, { tabSize: "4", useTab: null, lineWrap: 0 });
  const controls = f.tab.getSettingDefinitions().filter(item => item.control);
  for (const key of ["tabSize", "useTab", "lineWrap"]) { const row = controls.find(item => item.control.key === key); assert.match(row.desc, /saved value is invalid; the default is used/); assert.equal(f.tab.getControlValue(key), feature.EDITOR_PREFERENCE_DEFAULTS[key]); }
  assert.equal(f.tab.document.data.tabSize, "4"); assert.equal(f.tab.document.data.useTab, null);
});

test("the two folding controls use guarded queued Boolean writes and retain opaque configuration", async () => {
  const f = settingsFixture();
  await Promise.all([f.tab.setControlValue("foldHeading", false), f.tab.setControlValue("foldIndent", false)]);
  assert.deepEqual(f.calls.map(call => call.previous.version), ["v1", "v2"]);
  assert.equal(f.tab.document.data.foldHeading, false); assert.equal(f.tab.document.data.foldIndent, false);
  assert.deepEqual(f.tab.document.data.opaque, { keep: "中文" });
  for (const [key, value] of [["foldHeading", "false"], ["foldIndent", 0]]) await assert.rejects(f.tab.setControlValue(key, value), /Boolean/);
  assert.equal(f.calls.length, 2);
});

test("folding controls describe invalid imports and preserve the original values until an explicit choice", () => {
  const f = settingsFixture(); Object.assign(f.tab.document.data, { foldHeading: "false", foldIndent: null });
  const definitions = f.tab.getSettingDefinitions();
  for (const [key, name] of [["foldHeading", "Fold headings"], ["foldIndent", "Fold lists"]]) {
    const definition = definitions.find(row => row.control?.key === key);
    assert.equal(definition.name, name); assert.equal(definition.control.defaultValue, true); assert.match(definition.desc, /saved value is invalid; the default is used/);
    assert.equal(f.tab.getControlValue(key), true);
  }
  assert.equal(f.tab.document.data.foldHeading, "false"); assert.equal(f.tab.document.data.foldIndent, null);
});

test("typing settings use queued Boolean version guards while retaining unrelated data", async () => {
  const f = settingsFixture();
  await Promise.all([f.tab.setControlValue("autoPairBrackets", false), f.tab.setControlValue("smartIndentList", false)]);
  assert.deepEqual(f.calls.map(call => call.previous.version), ["v1", "v2"]); assert.deepEqual(f.tab.document.data.opaque, { keep: "中文" });
  assert.equal(f.tab.document.data.autoPairBrackets, false); assert.equal(f.tab.document.data.smartIndentList, false);
  await assert.rejects(f.tab.setControlValue("autoPairBrackets", "false"), /Boolean/); await assert.rejects(f.tab.setControlValue("smartIndentList", 0), /Boolean/);
  const baseline = f.tab.document; f.app.configuration.write = async () => { throw Error("External version changed"); };
  await assert.rejects(f.tab.setControlValue("autoPairBrackets", true), /External version/); assert.equal(f.tab.document, baseline);
});

test("typing descriptions expose invalid imported defaults without rewriting raw values", () => {
  const f = settingsFixture(); Object.assign(f.tab.document.data, { autoPairBrackets: null, smartIndentList: "true" });
  for (const [key, label] of [["autoPairBrackets", "Automatic bracket pairs"], ["smartIndentList", "Continue lists and quotes"]]) {
    const row = f.tab.getSettingDefinitions().find(row => row.control?.key === key); assert.equal(row.name, label); assert.equal(row.control.defaultValue, true);
    assert.match(row.desc, /saved value is invalid; the default is used/); assert.equal(f.tab.getControlValue(key), true);
  }
  assert.equal(f.tab.document.data.autoPairBrackets, null); assert.equal(f.tab.document.data.smartIndentList, "true");
});

test("Markdown pairing writes use the same queued version baseline and Boolean guards", async () => {
  const f = settingsFixture();
  await Promise.all([f.tab.setControlValue("autoPairMarkdown", false), f.tab.setControlValue("autoPairBrackets", false)]);
  assert.deepEqual(f.calls.map(call => call.previous.version), ["v1", "v2"]); assert.equal(f.tab.document.data.autoPairMarkdown, false); assert.equal(f.tab.document.data.autoPairBrackets, false);
  assert.deepEqual(f.tab.document.data.opaque, { keep: "中文" });
  for (const value of [null, 0, "false", []]) await assert.rejects(f.tab.setControlValue("autoPairMarkdown", value), /Boolean/);
  const baseline = f.tab.document; f.app.configuration.write = async () => { throw Error("Newer external version"); };
  await assert.rejects(f.tab.setControlValue("autoPairMarkdown", true), /Newer external version/); assert.equal(f.tab.document, baseline);
});

test("Automatic Markdown pairs defaults malformed imports visibly without rewriting them", () => {
  const f = settingsFixture(); f.tab.document.data.autoPairMarkdown = "false";
  const row = f.tab.getSettingDefinitions().find(row => row.control?.key === "autoPairMarkdown");
  assert.equal(row.name, "Automatic Markdown pairs"); assert.equal(row.control.defaultValue, true); assert.match(row.desc, /saved value is invalid; the default is used/);
  assert.equal(f.tab.getControlValue("autoPairMarkdown"), true); assert.equal(f.tab.document.data.autoPairMarkdown, "false");
});
