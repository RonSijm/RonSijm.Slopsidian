import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {build} from 'esbuild';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {basename, join, relative, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {errorLogStub} from './error-log-stub.mjs';

// Pure component/query tests: no host, native process, browser or listener starts.
const root = fileURLToPath(new URL('../', import.meta.url));
let temporary, api;
before(async () => {
  await mkdir(join(root, '.runtime'), {recursive: true}); temporary = await mkdtemp(join(root, '.runtime', 'bases-code-blocks-tests-'));
  const entry = join(temporary, 'embeds.mjs');
  await build({stdin: {contents: 'export * from "./client/base-code-blocks";export {BaseGroupFolds,readBaseGroupFoldState} from "./client/bases-group-state";export {livePreviewDecorations} from "./client/live-preview";export {EditorState} from "@codemirror/state";export {EditorView} from "@codemirror/view";export * from "./client/base-embed";export * from "./client/base-embed-render";export {queryBase,BaseDocument} from "./client/bases-model";export {Events} from "./client/events";export {configureVaultSource} from "./client/contracts";', resolveDir: root}, outfile: entry, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent', plugins: [errorLogStub, {name: 'inline-reading-stub', setup(build) {build.onResolve({filter: /^\.\/reading$/}, () => ({path: 'reading', namespace: 'inline-reading-stub'})); build.onLoad({filter: /.*/, namespace: 'inline-reading-stub'}, () => ({contents: 'export class ReadingView {} export function openMarkdownLink(){} export function openTagSearch(){}'}));}}]});
  api = await import(pathToFileURL(entry).href);
});
after(async () => {if (temporary) {assert.ok(relative(root, temporary).startsWith('.runtime' + sep)); assert.ok(basename(temporary).startsWith('bases-code-blocks-tests-')); await rm(temporary, {recursive: true});}});

class Node {
  constructor(tag, doc) {this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.parent = null; this.dataset = {}; this.attributes = {}; this.listeners = new Map(); this.style = {setProperty(name, value) {this[name] = value;}}; this.disabled = false; this.hidden = false; this.value = ''; this.className = ''; this.classList = {add: (...values) => {this.className += ' ' + values.join(' ');}};}
  get isConnected() {return this.root || Boolean(this.parent?.isConnected);}
  checkVisibility() {for (let node = this; node; node = node.parent) if (node.hidden) return false; return this.isConnected;}
  get childElementCount() {return this.children.length;}
  get firstElementChild() {return this.children[0] ?? null;}
  get textContent() {return (this.text ?? '') + this.children.map(node => node.textContent).join('');}
  set textContent(text) {this.text = String(text); this.replaceChildren();}
  set innerHTML(_value) {throw Error('Embedded values must remain literal text');}
  append(...nodes) {for (const node of nodes) {if (typeof node === 'string') {this.text = (this.text ?? '') + node; continue;} if (node.parent) node.remove(); node.parent = this; this.children.push(node);}}
  replaceChildren(...nodes) {for (const child of this.children) child.parent = null; this.children = []; this.append(...nodes);}
  setAttribute(name, value) {this.attributes[name] = String(value);}
  getAttribute(name) {return this.attributes[name] ?? null;}
  addEventListener(type, listener) {const values = this.listeners.get(type) ?? []; values.push(listener); this.listeners.set(type, values);}
  removeEventListener(type, listener) {this.listeners.set(type, (this.listeners.get(type) ?? []).filter(value => value !== listener));}
  remove() {if (this.parent) {this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null;} this.root = false;}
  contains(node) {return node === this || this.children.some(child => child.contains(node));}
  querySelectorAll(selector) {const match = /^\[data-([a-z-]+)\]$/.exec(selector); assert.ok(match, selector); const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); return nodes(this).slice(1).filter(node => Object.hasOwn(node.dataset, key));}
  emit(type, extra = {}) {for (const listener of this.listeners.get(type) ?? []) listener({target: this, preventDefault() {}, ...extra});}
  click() {this.emit('click');}
}
const nodes = node => [node, ...node.children.flatMap(nodes)];
const find = (host, name, value) => nodes(host).find(node => Object.hasOwn(node.dataset, name) && (value === undefined || node.dataset[name] === value));
const matching = (host, name) => nodes(host).filter(node => Object.hasOwn(node.dataset, name));
const tick = () => new Promise(resolve => setImmediate(resolve));
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
function dom(t) {
  const previous = globalThis.document, previousWorker = globalThis.Worker;
  const doc = {baseURI: 'http://localhost/', createElement: tag => new Node(tag, doc)};
  globalThis.document = doc;
  class Worker {
    static instances = []; static hold = false; static error = null;
    constructor() {this.listeners = new Map(); this.terminated = false; Worker.instances.push(this);}
    addEventListener(type, listener) {this.listeners.set(type, listener);}
    postMessage(request) {this.request = structuredClone(request); if (!Worker.hold) queueMicrotask(() => this.respond());}
    respond() {let response; try {if (Worker.error) throw Error(Worker.error); response = {serial: this.request.serial, result: api.queryBase(this.request)};} catch (error) {response = {serial: this.request.serial, error: error.message};} this.listeners.get('message')?.({data: response});}
    terminate() {this.terminated = true;}
  }
  globalThis.Worker = Worker;
  t.after(() => {api.configureVaultSource(null); for (const [key, value] of [['document', previous], ['Worker', previousWorker]]) {if (value === undefined) delete globalThis[key]; else globalThis[key] = value;}});
  return {doc, Worker};
}
const baseSource = (extra = '', type = 'table') => '\ufeff# Preserve opaque λ\r\nopaque: &keep {number: 9007199254740993}\r\ncopy: *keep\r\nfilters: file.ext == "md" && file.name != "Parent.md" && file.folder == this.file.folder\r\nviews:\r\n  - type: ' + type + '\r\n    name: Main\r\n    order: [file.name, note.status, note.amount]\r\n    groupBy: {property: note.status, direction: ASC}\r\n    summaries: {note.amount: Sum}\r\n' + extra.replaceAll('\n', '\r\n') + '  - type: list\r\n    name: List\r\n    order: [file.name, note.status, note.amount]\r\n    markers: number\r\n    separator: " · "\r\n  - type: cards\r\n    name: Cards\r\n    order: [file.name, note.status, note.amount]\r\n    image: note.cover\r\n    imageFit: contain\r\n    imageAspectRatio: 0.5\r\n';
const entry = (path, properties = {}, size = 20) => ({path, name: path.split('/').at(-1), basename: path.split('/').at(-1).replace(/\.[^.]+$/, ''), extension: path.split('.').at(-1), stat: {size, ctime: 1, mtime: 2}, properties});
function fixture(t, {text = baseSource(), count = 2, scope = {depth: 0, chain: ['Notes/Parent.md'], budget: {used: 0}}, linktext = 'Catalog.base', readOnly = false, sourcePath = 'Notes/Parent.md', owned = () => true, files: extraFiles = [], app: suppliedApp} = {}) {
  const host = document.createElement('div'); host.root = true;
  const calls = {reads: 0, info: 0, opened: [], relink: 0, mutation: 0}, files = [entry('Catalog.base'), entry('Notes/Parent.md', {owner: 'parent'}), ...Array.from({length: count}, (_, index) => entry('Notes/Row ' + String(index).padStart(3, '0') + '.md', {status: index < 110 ? 'open' : 'done', amount: 2})), ...extraFiles];
  const events = () => new api.Events();
  const app = suppliedApp ?? {changingVault: false, vault: Object.assign(events(), {rootPath: 'local', readOnly, getFiles: () => files, getFileByPath: path => files.find(file => file.path === path) ?? null, async getFileInfo(file) {calls.info++; return {root: this.rootPath, file: {path: file.path}, version: 'v1'};}, async readDocument(path) {calls.reads++; return {root: this.rootPath, file: {path}, content: text, version: 'v1', hasBom: true};}, assertWritable() {calls.mutation++; throw Error('No embedded write is authorized');}}), core: Object.assign(events(), {busy: false, enabled: true, isEnabled() {return this.enabled;}}), metadataCache: Object.assign(events(), {getDocument(path) {const file = files.find(file => file.path === path); return file && {cache: {frontmatter: file.properties, errors: [], tags: []}, outgoing: []};}}), metadataTypeManager: Object.assign(events(), {getAssignedWidget: () => undefined}), workspace: {async openLinkText(...args) {calls.opened.push(args);}, getLeaf() {throw Error('An embed cannot allocate a workspace leaf');}}};
  const file = app.vault.getFileByPath(sourcePath), state = {current: true, revealed: 0}, inline = {text, from: 12, to: 12 + text.length + 12, source: '```base\n' + text + '```', current: () => state.current, reveal: () => state.revealed++}, embed = new api.BaseEmbed({app, host, inline, sourcePath, scope, owned, relink() {calls.relink++;}});
  t.after(() => embed.dispose());
  return {host, embed, app, calls, files: app.vault.getFiles(), file, scope, text, state, inline};
}
const complete = async f => {await f.embed.ready; await tick();};

test('closed top-level base fences retain exact LF/CRLF/BOM ranges and configuration', () => {
  for (const eol of ['\n', '\r\n']) {
    const source = '\ufeff# Parent λ 😀' + eol + eol + '```base' + eol + 'views:' + eol + '  - type: table' + eol + '```' + eol + eol + '~~~BASE' + eol + 'views: []' + eol + '~~~~' + eol;
    const blocks = api.baseCodeBlocks(source); assert.equal(blocks.length, 2);
    assert.deepEqual(blocks.map(block => block.line), [2, 7]);
    for (const block of blocks) {assert.equal(source.slice(block.from, block.to), block.source); assert.ok(!block.configuration.includes('```'));}
    assert.equal(blocks[0].configuration, ['views:', '  - type: table', ''].join(eol));
    assert.equal(blocks[1].configuration, 'views: []' + eol);
  }
});

test('nested, indented, unclosed, decorated language and non-base fences remain ordinary source', () => {
  for (const source of ['> ```base\n> views: []\n> ```', '- ```base\n  views: []\n  ```', '    ```base\n    views: []\n    ```', '```base\nviews: []', '```base title\nviews: []\n```', '```yaml\nviews: []\n```', '```base\nviews: []\n~~~', '`base`']) assert.equal(api.baseCodeBlocks(source).length, 0, source);
  const indented = api.baseCodeBlocks('  ```base\n  views:\n    - type: table\n  ```'); assert.equal(indented.length, 1); assert.equal(indented[0].configuration, 'views:\n  - type: table\n');
});

test('inline query snapshots use the containing note without any persisted reads or synthetic base file', async t => {
  const {Worker} = dom(t), f = fixture(t, {files: [entry('Other/Excluded.md', {amount: 999})]}); await complete(f);
  assert.equal(f.host.dataset.slopsidianEmbedState, 'ready'); assert.equal(matching(f.host, 'basesEmbedRow').length, 2);
  assert.equal(Worker.instances[0].request.context.path, 'Notes/Parent.md'); assert.equal(Worker.instances[0].request.text, f.text);
  assert.equal(f.calls.reads, 0); assert.equal(f.calls.info, 0); assert.equal(f.calls.mutation, 0);
  assert.equal(f.host.dataset.basesInlineFrom, '12'); assert.equal(find(f.host, 'basesEmbedOpen'), undefined);
  assert.equal(f.embed.leaf, undefined); assert.equal(f.embed.editor, undefined); assert.equal(f.embed.commit, undefined);
  find(f.host, 'basesInlineSource').click(); assert.equal(f.state.revealed, 1); assert.equal(f.calls.opened.length, 0);
});

test('independent inline instances share typed local views, pages, folds and summaries without altering YAML', async t => {
  dom(t); const f = fixture(t, {count: 125}), other = fixture(t, {app: f.app}); await Promise.all([complete(f), complete(other)]);
  assert.equal(matching(f.host, 'basesEmbedRow').length, 100); assert.ok(f.host.textContent.includes('All rows · amount: Sum: 250'));
  find(f.host, 'basesEmbedFold', 'open').click(); assert.equal(find(f.host, 'basesEmbedFold', 'open').getAttribute('aria-expanded'), 'false'); assert.equal(find(other.host, 'basesEmbedFold', 'open').getAttribute('aria-expanded'), 'true');
  find(f.host, 'basesEmbedPage', 'next').click(); await complete(f); assert.equal(matching(f.host, 'basesEmbedRow').length, 25);
  for (const name of ['List', 'Cards', 'Main']) {const select = find(f.host, 'basesEmbedView'); select.value = name; select.emit('change'); await complete(f); assert.equal(find(f.host, 'basesEmbedResults').dataset.basesEmbedLayout, name === 'Main' ? 'table' : name.toLowerCase());}
  const search = find(f.host, 'basesEmbedSearch'); search.value = 'Row 124'; search.emit('input'); await wait(125); await complete(f); assert.equal(matching(f.host, 'basesEmbedRow').length, 1);
  assert.equal(f.inline.text, f.text); assert.equal(f.embed.text, f.text); assert.equal(f.calls.mutation, 0);
});

test('invalid inline YAML and unsupported views fail explicitly; provider readiness recovers the exact current owner', async t => {
  dom(t); for (const text of ['views: [', baseSource('', 'map')]) {const f = fixture(t, {text}); await complete(f); assert.equal(f.host.dataset.slopsidianEmbedState, 'error'); assert.equal(f.calls.reads, 0);}
  const f = fixture(t); await complete(f); const old = find(f.host, 'basesEmbedFile'); f.app.core.enabled = false; f.app.core.trigger('changed'); old.click(); assert.equal(f.calls.opened.length, 0); assert.equal(f.host.dataset.slopsidianEmbedState, 'error');
  f.app.core.enabled = true; f.app.core.busy = true; f.app.core.trigger('changed'); assert.equal(f.host.dataset.slopsidianEmbedState, 'error'); f.app.core.busy = false; f.app.core.trigger('changed'); await complete(f); assert.equal(f.host.dataset.slopsidianEmbedState, 'ready'); assert.equal(f.calls.reads, 0);
});

test('range/session, root, file, hidden owner and stale render fences block retained inline actions', async t => {
  dom(t); for (const transition of ['range', 'root', 'file', 'hidden', 'render', 'owner']) {
    let current = true; const f = fixture(t, {owned: () => current}); await complete(f); const source = find(f.host, 'basesInlineSource'), file = find(f.host, 'basesEmbedFile'), fold = find(f.host, 'basesEmbedFold', 'open'), before = JSON.stringify(f.embed.folds.serialize());
    if (transition === 'range') f.state.current = false; if (transition === 'root') f.app.vault.rootPath = 'replacement'; if (transition === 'file') f.file.path = 'Renamed.md'; if (transition === 'hidden') f.host.hidden = true; if (transition === 'render') f.embed.query(); if (transition === 'owner') current = false;
    source.click(); file.click(); fold.click(); await complete(f); assert.equal(f.calls.opened.length, 0, transition); assert.equal(f.state.revealed, transition === 'render' ? 1 : 0, transition); assert.equal(JSON.stringify(f.embed.folds.serialize()), before, transition);
  }
});

test('parent modification delegates reconciliation without reading saved YAML over an inline draft', async t => {
  dom(t); const f = fixture(t); await complete(f); const workerCount = globalThis.Worker.instances.length; f.app.vault.trigger('modify', f.file); assert.equal(f.calls.relink, 1); assert.equal(f.calls.reads, 0); assert.equal(globalThis.Worker.instances.length, workerCount); assert.equal(f.embed.text, f.text);
  f.app.vault.trigger('rename', f.file); f.app.vault.trigger('delete', f.file); assert.equal(f.calls.relink, 3); await f.embed.dispose(); f.app.vault.trigger('modify', f.file); assert.equal(f.calls.relink, 3);
});

test('late inline worker publication requires the same parent configuration and available provider', async t => {
  const {Worker} = dom(t); Worker.hold = true;
  for (const transition of ['session', 'provider', 'vault', 'dispose']) {
    const f = fixture(t); await tick(); const worker = Worker.instances.at(-1); if (transition === 'session') f.state.current = false; if (transition === 'provider') f.app.core.enabled = false; if (transition === 'vault') f.app.changingVault = true; if (transition === 'dispose') await f.embed.dispose(); worker.respond(); await complete(f); assert.equal(matching(f.host, 'basesEmbedRow').length, 0); assert.equal(worker.terminated, true);
  }
});

test('inline and standalone embeds consume one shared eight-base/total/depth budget and release once', async t => {
  dom(t); const scope = {depth: 0, chain: [], budget: {used: 0}}, owners = Array.from({length: 7}, () => fixture(t, {scope})), linkedHost = document.createElement('div'); linkedHost.root = true;
  const app = owners[0].app, linked = new api.BaseEmbed({app, host: linkedHost, file: app.vault.getFileByPath('Catalog.base'), sourcePath: 'Notes/Parent.md', linktext: 'Catalog.base', scope, owned: () => true, relink() {}}); t.after(() => linked.dispose()); const refused = fixture(t, {scope});
  await Promise.all([...owners.map(complete), linked.ready, complete(refused)]); assert.equal(scope.budget.used, 8); assert.equal(linkedHost.dataset.slopsidianEmbedState, 'ready'); assert.equal(refused.host.dataset.slopsidianEmbedState, 'error'); await owners[0].embed.dispose(); await owners[0].embed.dispose(); assert.equal(scope.budget.used, 7);
  const replacement = fixture(t, {scope}); await complete(replacement); assert.equal(replacement.host.dataset.slopsidianEmbedState, 'ready');
  const deep = fixture(t, {scope: {depth: 99, chain: [], budget: {used: 0}}}), total = fixture(t, {scope: {depth: 0, chain: [], budget: {used: 64}}}); for (const f of [deep, total]) {await complete(f); assert.equal(f.host.dataset.slopsidianEmbedState, 'error'); assert.equal(f.calls.reads, 0);}
});

test('explicit inline fold mode accepts its actual Markdown owner while persisted standalone .md scopes remain refused', () => {
  const scope = {file: 'Notes/Parent.md', view: 'Main', property: 'note.status'}, identity = 'g1:["boolean",false]', local = new api.BaseGroupFolds(undefined, true);
  local.toggle(scope, identity); assert.equal(local.has(scope, identity), true); const state = local.serialize(); assert.equal(state.contexts[0].file, 'Notes/Parent.md');
  assert.throws(() => api.readBaseGroupFoldState(state), /fold file/); assert.throws(() => new api.BaseGroupFolds(state), /fold file/); assert.throws(() => new api.BaseGroupFolds().toggle(scope, identity), /fold file/);
  assert.throws(() => local.toggle({...scope, file: '../Parent.md'}, identity), /fold file/); assert.equal(local.has(scope, identity), true);
});

const liveWidgets = (state, context) => {const widgets = []; api.livePreviewDecorations(state, context).between(0, state.doc.length, (from, to, value) => {if (value.spec.widget?.fence) widgets.push({from, to, widget: value.spec.widget});}); return widgets;};
function liveFixture(t, source, {editable = true} = {}) {
  const f = fixture(t), state = api.EditorState.create({doc: source, selection: {anchor: source.length}, extensions: [api.EditorView.editable.of(editable)]}), dispatches = [];
  const cm = {state, dispatch(spec) {dispatches.push(spec); this.state = this.state.update(spec).state;}, focus() {}}, session = {text: source, originRoot: 'local', isReloading: false}, view = {file: f.file, session, isLoaded: true, editor: {cm, getValue: () => cm.state.sliceDoc()}}, leaf = {view, app: f.app, workspace: {isChangingFiles: false}};
  const context = {leaf, path: f.file.path, root: 'local', isCurrent: () => true}; return {...f, cm, session, view, leaf, context, dispatches};
}
test('Live Preview replaces only unfocused closed fences at their exact actual CM ranges', async t => {
  dom(t); const source = '# Parent\n\n```base\n' + baseSource().replaceAll('\r\n', '\n') + '```\n\nTail', f = liveFixture(t, source), widgets = liveWidgets(f.cm.state, f.context); assert.equal(widgets.length, 1);
  assert.equal(source.slice(widgets[0].from, widgets[0].to), widgets[0].widget.source);
  const editing = f.cm.state.update({selection: {anchor: widgets[0].from + 9}}).state; assert.equal(liveWidgets(editing, f.context).length, 0);
  for (const text of ['```yaml\nviews: []\n```\n\nTail', '```base\nviews: []']) {const state = api.EditorState.create({doc: text, selection: {anchor: text.length}}); assert.equal(liveWidgets(state, f.context).length, 0);}
});

test('Live Preview mounts after actual attachment, stays bound to the parent session/doc and reveals source only explicitly', async t => {
  dom(t); const source = '```base\n' + baseSource().replaceAll('\r\n', '\n') + '```\n\nTail', f = liveFixture(t, source), {widget} = liveWidgets(f.cm.state, f.context)[0], host = widget.toDOM(f.cm); host.root = true; await tick(); await tick();
  assert.equal(find(host, 'basesInline').dataset.slopsidianEmbedState, 'ready'); assert.equal(matching(host, 'basesEmbedRow').length, 2); const selection = f.cm.state.selection.toJSON(); find(host, 'basesEmbedFold', 'open').click(); assert.deepEqual(f.cm.state.selection.toJSON(), selection); assert.equal(f.dispatches.length, 0);
  find(host, 'basesInlineSource').click(); assert.equal(f.dispatches.length, 1); assert.ok(f.dispatches[0].selection); assert.equal(f.dispatches[0].changes, undefined); assert.equal(f.cm.state.sliceDoc(), source);
  const old = find(host, 'basesEmbedFile'); f.view.session = {...f.session}; old.click(); await tick(); assert.equal(f.calls.opened.length, 0); widget.destroy(host); await tick();
});

test('Live Preview never mounts a retired pre-attachment widget, and read-only inline previews omit source-edit action', async t => {
  dom(t); const source = '```base\n' + baseSource().replaceAll('\r\n', '\n') + '```\n\nTail', f = liveFixture(t, source, {editable: false}), {widget} = liveWidgets(f.cm.state, f.context)[0], retired = widget.toDOM(f.cm); retired.root = true; widget.destroy(retired); await tick(); assert.equal(matching(retired, 'basesInline').length, 0);
  const host = widget.toDOM(f.cm); host.root = true; await tick(); await tick(); assert.equal(find(host, 'basesInline').dataset.slopsidianEmbedState, 'ready'); assert.equal(find(host, 'basesInlineSource').hidden, true); assert.equal(f.dispatches.length, 0); widget.destroy(host);
});

test('an unchanged inline fence remounts for edits elsewhere in its parent rather than retaining an inert old document owner', async t => {
  dom(t); const source = '```base\n' + baseSource().replaceAll('\r\n', '\n') + '```\n\nTail', f = liveFixture(t, source), first = liveWidgets(f.cm.state, f.context)[0].widget, host = first.toDOM(f.cm); host.root = true; await tick(); await tick();
  const old = find(host, 'basesEmbedFile'), oldSource = find(host, 'basesInlineSource'); f.cm.state = f.cm.state.update({changes: {from: source.length, insert: ' changed'}}).state; f.session.text = f.cm.state.sliceDoc();
  const next = liveWidgets(f.cm.state, f.context)[0].widget; assert.equal(first.eq(next), false); old.click(); oldSource.click(); await tick(); assert.equal(f.calls.opened.length, 0); assert.equal(f.dispatches.length, 0);
  first.destroy(host); const replacement = next.toDOM(f.cm); replacement.root = true; await tick(); await tick(); assert.equal(find(replacement, 'basesInline').dataset.slopsidianEmbedState, 'ready'); assert.equal(matching(replacement, 'basesEmbedRow').length, 2); assert.equal(f.cm.state.sliceDoc(), source + ' changed'); next.destroy(replacement);
});

test('deferred Live Preview owners never acquire a slot or subscriptions when root/doc changes before their mounting microtask', async t => {
  const {Worker} = dom(t), source = '```base\n' + baseSource().replaceAll('\r\n', '\n') + '```\n\nTail';
  for (const transition of ['root', 'doc', 'file', 'session']) {
    const f = liveFixture(t, source), {widget} = liveWidgets(f.cm.state, f.context)[0], host = widget.toDOM(f.cm), before = Worker.instances.length; host.root = true;
    if (transition === 'root') f.app.vault.rootPath = 'replacement'; if (transition === 'doc') {f.cm.state = f.cm.state.update({changes: {from: source.length, insert: ' changed'}}).state; f.session.text = f.cm.state.sliceDoc();} if (transition === 'file') f.view.file = {...f.file}; if (transition === 'session') f.view.session = {...f.session};
    await tick(); assert.equal(matching(host, 'basesInline').length, 0, transition); assert.equal(Worker.instances.length, before, transition); widget.destroy(host);
  }
});

