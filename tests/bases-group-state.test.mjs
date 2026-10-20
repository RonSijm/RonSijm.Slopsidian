import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";
import { errorLogStub } from "./error-log-stub.mjs";

let temporary, api, queryBase;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  temporary = await mkdtemp(join(root, ".runtime", "bases-group-state-tests-"));
  const entry = join(temporary, "groups.mjs");
  const modalStub = { name: 'bases-test-modal', setup(builder) {
    builder.onResolve({ filter: /^\.\/ui$/ }, args => args.importer.endsWith('bases.ts') ? { path: args.path, namespace: 'base-modal-stub' } : null);
    builder.onLoad({ filter: /.*/, namespace: 'base-modal-stub' }, () => ({ contents: `export class Modal { constructor(app){this.app=app;this.containerEl=document.createElement('div');this.modalEl=this.containerEl;this.contentEl=document.createElement('div');this.containerEl.append(this.contentEl);}setTitle(){return this}open(){this.containerEl.root=true}close(){this.containerEl.root=false;this.onClose?.()}}`, loader: 'js' }));
  } };
  await build({ stdin: { contents: 'export * from "./client/bases-group-state";export {BaseDocument,queryBase} from "./client/bases-model";export {Bases,BasesView} from "./client/bases";', resolveDir: root }, outfile: entry, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent", plugins: [errorLogStub, modalStub] });
  api = await import(pathToFileURL(entry).href); ({ queryBase } = api);
});
after(async () => {
  if (temporary) {
    assert.ok(relative(root, temporary).startsWith(".runtime" + sep));
    assert.ok(basename(temporary).startsWith("bases-group-state-tests-"));
    await rm(temporary, { recursive: true });
  }
});
const scope = (extra = {}) => ({ file: "Folder/Catalog.base", view: "Table", property: "note.status", ...extra });
const file = (path, properties = {}, extra = {}) => ({ path, name: path.split("/").at(-1), basename: path.split("/").at(-1).replace(/\.md$/, ""), extension: path.split(".").at(-1), stat: { size: 20, ctime: 0, mtime: 0 }, properties, tags: [], links: [], ...extra });
const config = (extra = "", property = "note.status") => 'views:\n  - type: table\n    name: Table\n    order: [file.name, note.status, note.amount]\n    groupBy:\n      property: ' + property + '\n      direction: ASC\n' + extra;
const query = (files, extra = {}, source = config()) => queryBase({ text: source, files, context: file("Folder/Catalog.base"), view: "Table", search: "", page: 0, ...extra });

test("fold identities distinguish scalar types and missing, empty, false and literal labels", () => {
  const { baseGroupIdentity: identity } = api;
  const values = [null, "", "No value", "0", 0, "false", false, true, "true", "λ 😀 \" \\ \n"];
  assert.equal(new Set(values.map(identity)).size, values.length);
  assert.equal(identity(undefined), identity(null)); assert.equal(identity(-0), identity(0));
  assert.notEqual(identity("1"), identity(1));
});

test("date identity uses exact milliseconds and link identity uses path independently of label", () => {
  const id = api.baseGroupIdentity;
  assert.equal(id({ kind: "base-date", milliseconds: 1234 }), id({ milliseconds: 1234, kind: "base-date", display: "different" }));
  assert.notEqual(id({ kind: "base-date", milliseconds: 1234 }), id(1234));
  assert.equal(id({ kind: "base-link", path: "Folder/Target.md", display: "A" }), id({ kind: "base-link", path: "Folder/Target.md", display: "B" }));
  assert.notEqual(id({ kind: "base-link", path: "Folder/Target.md", display: "A" }), id("Folder/Target.md"));
});

test("unsupported and unsafe values acquire no fold identity without executing getters", () => {
  const id = api.baseGroupIdentity;
  for (const value of [[], [1], {}, Infinity, NaN, 1n, 9007199254740992, new Date(), new Map(), () => 1]) { assert.equal(id(value), null); }
  let accesses = 0;
  const value = { kind: "base-date", get milliseconds() { accesses++; return 100; } };
  assert.equal(id(value), null); assert.equal(accesses, 0);
});

test("long group values remain queryable and expanded instead of creating oversized persisted identifiers", () => {
  const text = "λ".repeat(api.MAX_BASE_GROUP_IDENTITY);
  assert.equal(api.baseGroupIdentity(text), null);
  const result = query([file("A.md", { status: text })]);
  assert.equal(result.total, 1); assert.equal(result.rows.length, 1); assert.equal(result.groups[0].identity, null); assert.deepEqual(result.errors, []);
});

test("stable worker identity survives insertion, direction, filtering and changed ordinal group keys", () => {
  const original = query([file("B.md", { status: "beta" }), file("C.md", { status: "charlie" })]);
  const next = query([file("A.md", { status: "alpha" }), file("B.md", { status: "beta" }), file("C.md", { status: "charlie" })]);
  const beta = original.groups.find(group => group.label === "beta"), betaNext = next.groups.find(group => group.label === "beta");
  assert.notEqual(beta.key, betaNext.key); assert.equal(beta.identity, betaNext.identity);
  const filtered = query([file("B.md", { status: "beta" }), file("C.md", { status: "charlie" })], { search: "B.md" });
  assert.equal(filtered.groups[0].identity, beta.identity);
  const descending = query([file("B.md", { status: "beta" }), file("C.md", { status: "charlie" })], {}, config().replace("direction: ASC", "direction: DESC"));
  assert.equal(descending.groups.find(group => group.label === "beta").identity, beta.identity);
});

test("worker identity separates display collisions and exposes canonical grouping property", () => {
  const result = query([file("A.md", { status: 1 }), file("B.md", { status: "1" }), file("C.md", { status: 1 }), file("D.md", { status: null }), file("E.md", { status: "" }), file("F.md", { status: "No value" })], {}, config("", "status"));
  assert.equal(result.groupProperty, "note.status");
  const byPath = Object.fromEntries(result.rows.map(row => [row.path, result.groups.find(group => group.key === row.groupKey).identity]));
  assert.equal(byPath["A.md"], byPath["C.md"]); assert.notEqual(byPath["A.md"], byPath["B.md"]);
  assert.notEqual(byPath["D.md"], byPath["E.md"]); assert.notEqual(byPath["D.md"], byPath["F.md"]);
});

test("groups spanning 100-row pages retain identity, all-row counts and summaries", () => {
  const files = Array.from({ length: 135 }, (_, index) => file(`Row ${index}.md`, { status: index < 120 ? "open" : "done", amount: 2 }));
  const source = config("    summaries:\n      note.amount: Sum\n");
  const first = query(files, {}, source), second = query(files, { page: 1 }, source);
  assert.equal(first.total, 135); assert.equal(first.rows.length, 100); assert.equal(second.rows.length, 35); assert.equal(first.pages, 2);
  const open = first.groups.find(group => group.label === "open"), after = second.groups.find(group => group.label === "open");
  assert.equal(open.identity, after.identity); assert.equal(open.count, 120); assert.equal(after.count, 120);
  assert.equal(first.summaries[2].text, "270"); assert.equal(second.summaries[2].text, "270");
  assert.equal(after.summaries[2].text, "240");
});

test("ungrouped queries and unsupported structured grouping retain their existing contracts", () => {
  const result = query([file("A.md")], {}, 'views:\n  - type: table\n    name: Table\n    order: [file.name]\n');
  assert.equal(result.groupProperty, null); assert.deepEqual(result.groups, []); assert.equal(result.rows[0].groupKey, "");
  for (const status of [[1], { value: "x" }]) { assert.throws(() => query([file("A.md", { status })]), /Grouping structured\/list/); }
});

test("fold stores remain independent across panes, files, named views and grouping properties", () => {
  const id = api.baseGroupIdentity("open"), left = new api.BaseGroupFolds(), right = new api.BaseGroupFolds();
  assert.equal(left.toggle(scope(), id), true); assert.equal(left.has(scope(), id), true); assert.equal(right.has(scope(), id), false);
  for (const other of [scope({ file: "Other.base" }), scope({ view: "Other" }), scope({ property: "file.name" })]) { assert.equal(left.has(other, id), false); }
  const restored = new api.BaseGroupFolds(JSON.parse(JSON.stringify(left.serialize())));
  assert.equal(restored.has(scope(), id), true); assert.equal(restored.toggle(scope(), id), false); assert.equal(restored.has(scope(), id), false);
  assert.deepEqual(restored.serialize(), { version: 1, contexts: [] });
});

test("fold serialization owns its input and output without pruning absent filtered groups", () => {
  const id = api.baseGroupIdentity("open"), source = { version: 1, contexts: [{ ...scope(), values: [id] }] };
  const store = new api.BaseGroupFolds(source);
  source.contexts[0].values.length = 0;
  const output = store.serialize(); output.contexts[0].file = "Other.base"; output.contexts[0].values.length = 0;
  assert.equal(store.has(scope(), id), true);
  assert.deepEqual(new api.BaseGroupFolds(store.serialize()).serialize(), { version: 1, contexts: [{ ...scope(), values: [id] }] });
});

test("JSON-looking scope text cannot merge distinct contexts or prototype properties", () => {
  const store = new api.BaseGroupFolds(), id = api.baseGroupIdentity("__proto__");
  const first = scope({ view: 'a\",\"property\":\"note.x' }), second = scope({ view: "a", property: "note.x" });
  store.toggle(first, id); store.toggle(second, id);
  assert.equal(store.serialize().contexts.length, 2); assert.equal(store.has(first, id), true); assert.equal(store.has(second, id), true);
});

test("malformed, duplicate, noncanonical and path-escaping saved fold payloads fail completely", () => {
  const id = api.baseGroupIdentity("open"), good = { ...scope(), values: [id] };
  const values = [null, [], {}, { version: 2, contexts: [] }, { version: 1 },
    { version: 1, contexts: [{ ...good, file: "../Catalog.base" }] }, { version: 1, contexts: [{ ...good, property: "status" }] },
    { version: 1, contexts: [{ ...good, values: [] }] }, { version: 1, contexts: [good, good] }, { version: 1, contexts: [{ ...good, values: [id, id] }] },
    ...['group-0', 'g1:["number",1.0]', 'g1:["none",null]', 'g1:["string",0]', 'g1:["unknown",1]'].map(value => ({ version: 1, contexts: [{ ...good, values: [value] }] }))];
  for (const value of values) { assert.throws(() => api.readBaseGroupFoldState(value)); }
  assert.deepEqual(api.readBaseGroupFoldState(undefined), { version: 1, contexts: [] });
});

test("saved arrays with holes or getters refuse without invoking accessors", () => {
  let calls = 0;
  const values = []; Object.defineProperty(values, 0, { get() { calls++; return api.baseGroupIdentity("open"); } });
  for (const invalid of [values, new Array(1)]) { assert.throws(() => api.readBaseGroupFoldState({ version: 1, contexts: [{ ...scope(), values: invalid }] })); }
  const state = { get version() { calls++; return 1; }, contexts: [] };
  assert.throws(() => api.readBaseGroupFoldState(state)); assert.equal(calls, 0);
});

test("group count limits reject changes atomically and expanding frees capacity", () => {
  const store = new api.BaseGroupFolds();
  for (let index = 0; index < api.MAX_BASE_GROUP_FOLDS; index++) { store.toggle(scope(), api.baseGroupIdentity(index)); }
  const before = store.serialize();
  assert.throws(() => store.toggle(scope(), api.baseGroupIdentity("new"))); assert.deepEqual(store.serialize(), before);
  store.toggle(scope(), api.baseGroupIdentity(0)); assert.equal(store.toggle(scope(), api.baseGroupIdentity("new")), true);
  assert.equal(store.serialize().contexts[0].values.length, api.MAX_BASE_GROUP_FOLDS);
});

test("context and total-character limits reject changes without altering prior intent", () => {
  const store = new api.BaseGroupFolds(), id = api.baseGroupIdentity("open");
  for (let index = 0; index < api.MAX_BASE_GROUP_SCOPES; index++) { store.toggle(scope({ view: "View " + index }), id); }
  const before = store.serialize(); assert.throws(() => store.toggle(scope({ view: "extra" }), id)); assert.deepEqual(store.serialize(), before);
  const large = new api.BaseGroupFolds();
  let accepted = 0;
  while (true) { const previous = large.serialize(); try { large.toggle(scope(), api.baseGroupIdentity("x".repeat(3900) + accepted)); accepted++; } catch { assert.deepEqual(large.serialize(), previous); break; } }
  assert.ok(accepted > 1 && accepted < api.MAX_BASE_GROUP_FOLDS);
  assert.ok(JSON.stringify(large.serialize()).length <= api.MAX_BASE_GROUP_STATE_CHARACTERS);
});

function readonlyView() {
  const source = config('    summaries:\n      note.amount: Sum\n'), calls = { plan: 0, save: 0, refresh: 0, propertyRead: 0, mutation: 0 };
  const app = { changingVault: false, vault: { readOnly: true, rootPath: 'github-vault:readonly', assertWritable() { if (this.readOnly) { const error = new Error('The vault is read-only'); error.code = 'VAULT_READ_ONLY'; throw error; } }, getFileByPath() { calls.propertyRead++; throw Error('Property read must not run'); } }, core: { isEnabled: () => true, busy: false }, workspace: { layoutChanged() { calls.mutation++; } } };
  const current = Object.create(api.BasesView.prototype), model = new api.BaseDocument(source), set = model.setView.bind(model);
  model.setView = (...args) => { calls.plan++; return set(...args); };
  Object.assign(current, { app, file: { path: 'Folder/Catalog.base' }, document: { file: { path: 'Folder/Catalog.base' }, content: source, version: 'git:readonly', hasBom: false }, leaf: { workspace: { isChangingFiles: false } }, text: source, selected: 'Table', page: 0, search: '', model, serial: 1, groupFolds: new api.BaseGroupFolds(), populateControls() {}, setError() {}, requestSave() { calls.save++; }, refresh() { calls.refresh++; } });
  current.leaf.view = current; Object.defineProperty(current, 'isLoaded', { value: true });
  return { current, app, calls, source };
}
const readonlyError = error => error?.code === 'VAULT_READ_ONLY';

test('read-only Bases direct create and commit refuse before planning, scanning, dirtying or saving', async () => {
  const f = readonlyView(); let scanned = 0, created = 0, opened = 0;
  f.app.vault.getAbstractFileByPath = () => { scanned++; return null; }; f.app.vault.create = async () => { created++; return {}; }; f.app.workspace.getLeaf = () => ({ openFile() { opened++; } });
  await assert.rejects(new api.Bases(f.app).create(), readonlyError);
  assert.deepEqual({ scanned, created, opened }, { scanned: 0, created: 0, opened: 0 });
  assert.throws(() => f.current.commit(f.source + '# Do not commit\n'), readonlyError);
  assert.equal(f.current.getViewData(), f.source); assert.equal(f.current.model.source, f.source);
  assert.deepEqual(f.calls, { plan: 0, save: 0, refresh: 0, propertyRead: 0, mutation: 0 });
});

test('read-only Bases source, summary and property entry points refuse before models, dialogs or callbacks', () => {
  const f = readonlyView();
  f.current.grouping = { value: 'file.name' }; f.current.changeGrouping();
  f.current.model.summary = () => { f.calls.plan++; throw Error('Summary planning must not run'); };
  for (const action of [() => f.current.sourceDialog(), () => f.current.summaryDialog({ key: 'note.amount', label: 'Amount' }), () => f.current.editProperty('Row.md', 'amount')]) assert.throws(action, readonlyError);
  assert.equal(f.current.getViewData(), f.source); assert.deepEqual(f.calls, { plan: 0, save: 0, refresh: 0, propertyRead: 0, mutation: 0 });
  assert.equal(f.current.isReadOnly, true, 'Shared text-view close/unload must not save a read-only base');
});

class ControlNode {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parent = null; this.dataset = {}; this.attributes = {}; this.listeners = new Map(); this.style = { setProperty(name, value) { this[name] = value; } }; this.disabled = false; this.hidden = false; this.value = ''; this.classList = { add() {} }; }
  get isConnected() { return this.root || Boolean(this.parent?.isConnected); }
  append(...nodes) { for (const node of nodes) { if (typeof node === 'string') continue; node.parent = this; this.children.push(node); } }
  add(node) { this.append(node); }
  replaceChildren(...nodes) { for (const child of this.children) child.parent = null; this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, listener) { const list = this.listeners.get(type) ?? []; list.push(listener); this.listeners.set(type, list); }
  focus() { globalThis.document.activeElement = this; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  click() { for (const listener of this.listeners.get('click') ?? []) listener({ target: this }); }
}
const descendants = node => [node, ...node.children.flatMap(descendants)];

test('read-only Bases render disabled mutation controls whose forced handlers stay inert while group folds remain local', async t => {
  const oldDocument = globalThis.document; globalThis.document = { createElement: tag => new ControlNode(tag) }; t.after(() => { if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; });
  const f = readonlyView(), current = f.current; Object.assign(current, { bodyEl: new ControlNode('div'), table: new ControlNode('div'), pagination: new ControlNode('div'), status: new ControlNode('output'), error: new ControlNode('p'), issues: new ControlNode('details') }); current.bodyEl.root = true; current.bodyEl.append(current.table);
  const result = query([file('Row.md', { status: 'open', amount: 2 })], {}, f.source);
  current.render(result);
  const nodes = descendants(current.table), mutations = nodes.filter(node => node.dataset.basesSort || node.dataset.basesSummarize || node.className === 'bases-summary-button' || node.className === 'bases-cell-edit');
  assert.ok(mutations.length > 3); for (const control of mutations) { assert.equal(control.disabled, true); control.disabled = false; control.click(); }
  const groupButton = nodes.find(node => node.dataset.basesGroupFold); assert.ok(groupButton); assert.equal(groupButton.disabled, false); groupButton.click(); assert.equal(groupButton.attributes['aria-expanded'], 'false'); assert.equal(f.calls.mutation, 1);
  assert.equal(current.getViewData(), f.source); assert.deepEqual({ plan: f.calls.plan, save: f.calls.save, propertyRead: f.calls.propertyRead }, { plan: 0, save: 0, propertyRead: 0 });
});

test('a read-only transition refuses retained source, summary and property submits before dirtying models or invoking note callbacks', async t => {
  const oldDocument = globalThis.document, oldOption = globalThis.Option;
  globalThis.document = { createElement: tag => new ControlNode(tag) }; globalThis.Option = class extends ControlNode { constructor(text, value) { super('option'); this.textContent = text; this.value = value; } };
  t.after(() => { if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; if (oldOption === undefined) delete globalThis.Option; else globalThis.Option = oldOption; });
  for (const action of ['source', 'summary', 'property']) {
    const f = readonlyView(); f.app.vault.readOnly = false; f.app.core.run = async action => action(); let processed = 0;
    f.app.vault.getFileByPath = () => ({ path: 'Row.md', name: 'Row.md' });
    f.app.metadataCache = { getDocument: () => ({ cache: { errors: [], frontmatter: { amount: 2 } } }) };
    f.app.metadataTypeManager = { getAssignedWidget: () => 'number' }; f.app.fileManager = { async processFrontMatter() { processed++; } };
    const summary = f.current.model.setSummary.bind(f.current.model); f.current.model.setSummary = (...args) => { f.calls.plan++; return summary(...args); };
    if (action === 'source') f.current.sourceDialog(); else if (action === 'summary') f.current.summaryDialog({ key: 'note.amount', label: 'Amount', summaryKind: 'number' }); else f.current.editProperty('Row.md', 'amount');
    const nodes = descendants(f.current.modal.contentEl), form = nodes.find(node => node.tagName === 'FORM'); assert.ok(form);
    if (action === 'source') nodes.find(node => Object.hasOwn(node.dataset, 'basesSource')).value = f.source + '# Never apply\n';
    if (action === 'property') nodes.find(node => Object.hasOwn(node.dataset, 'basesPropertyValue')).value = '3';
    f.app.vault.readOnly = true;
    for (const listener of form.listeners.get('submit') ?? []) listener({ preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.current.getViewData(), f.source, action + ' must not dirty a cached base'); assert.equal(f.current.isDirty, false); assert.equal(f.calls.plan, 0); assert.equal(f.calls.save, 0); assert.equal(processed, 0, 'A readonly property handler must stop before FileManager');
    assert.ok(nodes.some(node => node.className?.includes('plugin-error') && /read-only/i.test(node.textContent ?? '')), 'The held dialog explains refusal');
    f.current.modal.close();
  }
});

test('queued frontmatter edits recheck current writable dialog, root, note and provider before their callback', async t => {
  const oldDocument = globalThis.document, oldOption = globalThis.Option;
  globalThis.document = { createElement: tag => new ControlNode(tag) }; globalThis.Option = class extends ControlNode { constructor(text, value) { super('option'); this.textContent = text; this.value = value; } };
  t.after(() => { if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; if (oldOption === undefined) delete globalThis.Option; else globalThis.Option = oldOption; });
  for (const transition of ['readonly', 'root', 'note', 'provider', 'closed']) {
    const f = readonlyView(), note = { path: 'Row.md', name: 'Row.md' }, properties = { amount: 2 }; f.app.vault.readOnly = false;
    let selected = note, enabled = true, entered = 0, callbacks = 0, release;
    const gate = new Promise(resolve => { release = resolve; });
    f.app.vault.getFileByPath = () => selected; f.app.core.isEnabled = () => enabled; f.app.core.run = async action => action();
    f.app.metadataCache = { getDocument: () => ({ cache: { errors: [], frontmatter: { ...properties } } }) }; f.app.metadataTypeManager = { getAssignedWidget: () => 'number' };
    f.app.fileManager = { async processFrontMatter(_file, change, _options, guard) { assert.equal(typeof guard, 'function'); entered++; await gate; guard('---\namount: 2\n---\n'); callbacks++; change(properties); } };
    f.current.editProperty('Row.md', 'amount'); const modal = f.current.modal, nodes = descendants(modal.contentEl), form = nodes.find(node => node.tagName === 'FORM');
    nodes.find(node => Object.hasOwn(node.dataset, 'basesPropertyValue')).value = '3';
    for (const listener of form.listeners.get('submit') ?? []) listener({ preventDefault() {} });
    assert.equal(entered, 1);
    if (transition === 'readonly') f.app.vault.readOnly = true; else if (transition === 'root') f.app.vault.rootPath = 'other'; else if (transition === 'note') selected = { ...note }; else if (transition === 'provider') enabled = false; else modal.close();
    release(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(callbacks, 0, transition); assert.deepEqual(properties, { amount: 2 }, transition); assert.equal(f.current.getViewData(), f.source); assert.equal(f.current.isDirty, false); assert.equal(f.calls.save, 0);
    modal.close();
  }
});
