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
  await mkdir(join(root, '.runtime'), {recursive: true}); temporary = await mkdtemp(join(root, '.runtime', 'bases-embeds-tests-'));
  const entry = join(temporary, 'embeds.mjs');
  await build({stdin: {contents: 'export * from "./client/base-embed";export * from "./client/base-embed-render";export {queryBase,BaseDocument} from "./client/bases-model";export {Events} from "./client/events";export {configureVaultSource} from "./client/contracts";', resolveDir: root}, outfile: entry, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent', plugins: [errorLogStub]});
  api = await import(pathToFileURL(entry).href);
});
after(async () => {if (temporary) {assert.ok(relative(root, temporary).startsWith('.runtime' + sep)); assert.ok(basename(temporary).startsWith('bases-embeds-tests-')); await rm(temporary, {recursive: true});}});

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
  const file = app.vault.getFileByPath('Catalog.base'), embed = new api.BaseEmbed({app, host, file, sourcePath, linktext, scope, owned, relink() {calls.relink++;}});
  t.after(() => embed.dispose());
  return {host, embed, app, calls, files: app.vault.getFiles(), file, scope, text};
}
const complete = async f => {await f.embed.ready; await tick();};

test('embedded Table uses the real worker query and containing-note this, while source bytes and parent ownership stay unchanged', async t => {
  const {Worker} = dom(t), f = fixture(t, {files: [entry('Other/Excluded.md', {amount: 999})]}); await complete(f);
  assert.equal(f.host.dataset.slopsidianEmbedState, 'ready'); assert.equal(matching(f.host, 'basesEmbedRow').length, 2); assert.equal(Worker.instances[0].request.context.path, 'Notes/Parent.md');
  assert.equal(find(f.host, 'basesEmbedSummary', 'note.amount').textContent.includes('4'), true); assert.equal(f.embed.text, f.text); assert.equal(f.calls.info, 2); assert.equal(f.embed.leaf, undefined); assert.equal(f.embed.editor, undefined); assert.equal(f.embed.commit, undefined); assert.equal(f.calls.mutation, 0);
  const table = nodes(f.host).find(node => node.tagName === 'TABLE'); assert.deepEqual(table.children[0].children[0].children.map(node => node.textContent), ['name', 'status', 'amount', 'Open']);
});

test('read-only named List and Cards are supported without property/settings/source/sort/summary mutation controls', async t => {
  dom(t); const f = fixture(t, {linktext: 'Catalog.base#List', readOnly: true}); await complete(f);
  assert.equal(find(f.host, 'basesEmbedResults').dataset.basesEmbedLayout, 'list'); assert.equal(find(f.host, 'basesEmbedView').value, 'List'); assert.ok(nodes(f.host).some(node => node.tagName === 'OL')); assert.ok(nodes(f.host).some(node => node.className === 'bases-list-separator' && node.textContent === ' · '));
  const select = find(f.host, 'basesEmbedView'); select.value = 'Cards'; select.emit('change'); await complete(f); assert.equal(find(f.host, 'basesEmbedResults').dataset.basesEmbedLayout, 'cards'); assert.equal(matching(f.host, 'basesEmbedRow')[0].tagName, 'ARTICLE');
  assert.equal(nodes(f.host).some(node => /bases-cell-edit|bases-summary-action|bases-summary-button/.test(node.className) || Object.hasOwn(node.dataset, 'basesAction') || Object.hasOwn(node.dataset, 'basesSort')), false); assert.equal(f.calls.mutation, 0); assert.equal(f.embed.text, f.text);
});

test('pagination remains 100 rows; full summaries and independent typed folds survive search and local named views', async t => {
  dom(t); const f = fixture(t, {count: 125}), other = fixture(t, {app: f.app}); await complete(f); await complete(other);
  assert.equal(matching(f.host, 'basesEmbedRow').length, 100); assert.ok(find(f.host, 'basesEmbedSummary', 'note.amount').textContent.includes('30'));
  const open = find(f.host, 'basesEmbedFold', 'open'); open.click(); assert.equal(open.getAttribute('aria-expanded'), 'false'); assert.equal(find(other.host, 'basesEmbedFold', 'open').getAttribute('aria-expanded'), 'true');
  find(f.host, 'basesEmbedPage', 'next').click(); await complete(f); assert.equal(matching(f.host, 'basesEmbedRow').length, 25); assert.equal(matching(f.host, 'basesEmbedRow').every(node => node.hidden), true);
  const search = find(f.host, 'basesEmbedSearch'); search.value = 'Row 124'; search.emit('input'); await wait(125); await complete(f); assert.equal(matching(f.host, 'basesEmbedRow').length, 1); assert.equal(find(f.host, 'basesEmbedFold', 'done').getAttribute('aria-expanded'), 'true');
  search.value = ''; search.emit('input'); await wait(125); await complete(f); assert.equal(find(f.host, 'basesEmbedFold', 'open').getAttribute('aria-expanded'), 'false'); assert.equal(f.calls.mutation, 0);
  assert.ok(f.host.textContent.includes('All rows · amount: Sum: 250'));
});

test('typed group folds do not merge boolean false, number zero and literal strings sharing labels', async t => {
  dom(t); const f = fixture(t, {count: 0, files: [entry('Notes/A.md', {status: false}), entry('Notes/B.md', {status: 'false'}), entry('Notes/C.md', {status: 0}), entry('Notes/D.md', {status: '0'})]}); await complete(f);
  const folds = matching(f.host, 'basesEmbedFold'); assert.equal(folds.length, 4); folds[0].click(); assert.equal(matching(f.host, 'basesEmbedRow').filter(row => row.hidden).length, 1); assert.equal(new Set(matching(f.host, 'basesEmbedGroup').map(node => node.dataset.basesEmbedGroup)).size, 4);
});

test('List honors nested/inline semantics and keeps zero/false while omitting empty values', async t => {
  dom(t); const text = baseSource('    indentProperties: true\n    markers: none\n', 'list');
  const f = fixture(t, {text, count: 0, files: [entry('Notes/A.md', {status: false, amount: 0}), entry('Notes/B.md')]}); await complete(f);
  assert.equal(matching(f.host, 'basesEmbedRow').length, 2); const nested = nodes(f.host).find(node => node.className === 'bases-list-nested'); assert.equal(nested.tagName, 'UL'); assert.deepEqual(nested.children.map(node => node.textContent), ['false', '0']); assert.equal(nodes(f.host).some(node => node.dataset.basesMarkers === 'none'), true);
});

test('link controls open existing destinations and headings but never create missing notes or open external URLs', async t => {
  dom(t); const f = fixture(t); await complete(f); find(f.host, 'basesEmbedFile').click(); find(f.host, 'basesEmbedOpen').click(); await tick(); assert.deepEqual(f.calls.opened.map(args => args[0]), ['Notes/Row 000.md', 'Catalog.base']);
  await f.embed.open('Notes/Row 000.md#Heading'); assert.equal(f.calls.opened.at(-1)[0], 'Notes/Row 000.md#Heading');
  for (const target of ['Missing.md', 'https://example.invalid/', 'javascript:alert(1)']) await assert.rejects(f.embed.open(target), /do not create/);
  const old = find(f.host, 'basesEmbedFile'); f.files.splice(f.files.findIndex(file => file.path === old.dataset.basesEmbedFile), 1); old.click(); await tick(); assert.equal(f.calls.opened.length, 3); assert.equal(f.host.dataset.slopsidianEmbedState, 'error');
});

test('invalid YAML, unsupported fragments/view types and missing containing notes fail explicitly without writes', async t => {
  dom(t);
  for (const options of [{text: 'views: ['}, {linktext: 'Catalog.base#Absent'}, {linktext: 'Catalog.base#^block'}, {text: baseSource('', 'map')}, {sourcePath: 'Missing.md'}]) {
    const f = fixture(t, options); await complete(f); assert.equal(f.host.dataset.slopsidianEmbedState, 'error', JSON.stringify(options)); assert.equal(matching(f.host, 'basesEmbedRow').length, 0); assert.equal(f.calls.mutation, 0);
  }
});

test('inert during restoration/disable, then current owner resumes on provider readiness', async t => {
  dom(t); const f = fixture(t); await complete(f); const old = find(f.host, 'basesEmbedFile');
  f.app.core.enabled = false; f.app.core.trigger('changed'); old.click(); assert.equal(f.calls.opened.length, 0); assert.equal(f.host.dataset.slopsidianEmbedState, 'error');
  const reads = f.calls.reads; f.app.core.busy = true; f.app.core.enabled = true; f.app.core.trigger('changed'); assert.equal(f.calls.reads, reads);
  f.app.core.busy = false; f.app.core.trigger('changed'); await complete(f); assert.equal(f.host.dataset.slopsidianEmbedState, 'ready');
  f.app.changingVault = true; const current = find(f.host, 'basesEmbedFile'); current.click(); assert.equal(f.calls.opened.length, 0); f.app.changingVault = false;
});

test('retained controls from an old render, root, containing file or detached host cannot act', async t => {
  dom(t); for (const transition of ['render', 'root', 'file', 'source', 'detached', 'owner']) {
    let current = true; const f = fixture(t, {owned: () => current}); await complete(f); const old = nodes(f.host).filter(node => node.tagName === 'BUTTON' && !Object.hasOwn(node.dataset, 'basesEmbedOpen')), before = JSON.stringify(f.embed.folds.serialize());
    if (transition === 'render') f.embed.query(); if (transition === 'root') f.app.vault.rootPath = 'replacement'; if (transition === 'file') f.file.path = 'Renamed.base'; if (transition === 'source') f.files.find(file => file.path === 'Notes/Parent.md').path = 'Renamed.md'; if (transition === 'detached') f.host.root = false; if (transition === 'owner') current = false;
    for (const button of old) button.click(); await complete(f); assert.equal(f.calls.opened.length, 0, transition); assert.equal(JSON.stringify(f.embed.folds.serialize()), before, transition);
  }
});

test('a metadata refresh cannot cancel a pending source reload into an old model', async t => {
  dom(t); const f = fixture(t); await complete(f); const changed = baseSource().replace('name: Main', 'name: Updated'), read = deferred();
  f.app.vault.readDocument = async path => {f.calls.reads++; return read.promise;}; f.app.vault.trigger('modify', f.file); await wait(110); f.app.metadataCache.trigger('changed');
  read.resolve({root: 'local', file: {path: 'Catalog.base'}, content: changed, version: 'v1'}); await wait(125); await complete(f); assert.equal(find(f.host, 'basesEmbedView').value, 'Updated'); assert.equal(f.embed.text, changed); assert.equal(f.host.dataset.slopsidianEmbedState, 'ready');
});

test('late source and worker responses cannot mutate a disposed or root-switched owner', async t => {
  const {Worker} = dom(t); Worker.hold = true; const f = fixture(t); await tick(); assert.equal(Worker.instances.length, 1); const worker = Worker.instances[0]; await f.embed.dispose(); worker.respond(); assert.equal(matching(f.host, 'basesEmbedRow').length, 0); assert.equal(worker.terminated, true); assert.equal(f.scope.budget.used, 0);
  Worker.hold = false; const read = deferred(), other = fixture(t); other.app.vault.readDocument = async () => read.promise; other.embed.ready = other.embed.reload(); await tick(); other.app.vault.rootPath = 'replacement'; const text = other.host.textContent; read.resolve({root: 'local', file: {path: 'Catalog.base'}, content: baseSource(), version: 'v1'}); await complete(other); assert.equal(other.host.textContent, text);
});

test('version disagreement rejects stale .base bytes even when the before/after versions match', async t => {
  dom(t); const f = fixture(t); await complete(f); f.app.vault.readDocument = async path => ({root: 'local', file: {path}, content: f.text, version: 'middle'}); await f.embed.reload(); assert.equal(f.host.dataset.slopsidianEmbedState, 'error'); assert.ok(f.host.textContent.includes('changed while loading'));
});

test('shared nesting and eight-base budgets release exactly once, including refused owners', async t => {
  dom(t); const scope = {depth: 0, chain: [], budget: {used: 0}}, owners = Array.from({length: 9}, () => fixture(t, {scope})); await Promise.all(owners.map(complete)); assert.equal(scope.budget.used, 8); assert.equal(owners[8].host.dataset.slopsidianEmbedState, 'error'); await owners[0].embed.dispose(); await owners[0].embed.dispose(); assert.equal(scope.budget.used, 7); const replacement = fixture(t, {scope}); await complete(replacement); assert.equal(replacement.host.dataset.slopsidianEmbedState, 'ready');
  const deep = fixture(t, {scope: {depth: 99, chain: [], budget: {used: 0}}}); await complete(deep); assert.equal(deep.calls.reads, 0); assert.equal(deep.host.dataset.slopsidianEmbedState, 'error');
});

test('target/source rename and delete request parent re-resolution; disposal unregisters every listener', async t => {
  dom(t); const f = fixture(t); await complete(f); f.app.vault.trigger('rename', f.file); f.app.vault.trigger('delete', f.files.find(file => file.path === 'Notes/Parent.md')); assert.equal(f.calls.relink, 2); await f.embed.dispose(); f.app.vault.trigger('rename', f.file); f.app.metadataCache.trigger('changed'); assert.equal(f.calls.relink, 2); assert.equal(f.scope.budget.used, 0);
});

test('Cards reuse immutable, deduplicated raster reads and revoke every URL on refresh/disposal', async t => {
  dom(t); const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwSmn4DwAEOAImk1RrTQAAAABJRU5ErkJggg==', 'base64'), created = [], revoked = [], oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL; URL.createObjectURL = () => {const url = 'blob:cover-' + created.length; created.push(url); return url;}; URL.revokeObjectURL = url => revoked.push(url); t.after(() => {URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke;});
  const f = fixture(t, {count: 0, linktext: 'Catalog.base#Cards', files: [entry('Notes/A.md', {cover: 'Pic.png'}), entry('Notes/B.md', {cover: 'Pic.png'}), entry('Pic.png', {}, png.length)]}); let requests = 0;
  api.configureVaultSource({async request(path, method) {requests++; assert.equal(method, 'GET'); assert.ok(path.startsWith('/api/binary?')); return {status: 200, value: {root: 'local', file: {path: 'Pic.png'}, version: 'v1', base64: png.toString('base64')}};}});
  await complete(f); await tick(); assert.equal(requests, 1); assert.equal(created.length, 1); const image = nodes(f.host).find(node => node.tagName === 'IMG'); image.emit('load'); assert.equal(find(f.host, 'basesEmbedCover').dataset.basesEmbedCover, 'ready'); assert.equal(image.style.objectFit, 'contain');
  f.embed.query(); await complete(f); await tick(); assert.equal(requests, 2); assert.deepEqual(revoked, [created[0]]); await f.embed.dispose(); assert.deepEqual(revoked, created);
});

test('a version-mismatched or late raster response cannot create a URL or decorate another owner', async t => {
  dom(t); const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwSmn4DwAEOAImk1RrTQAAAABJRU5ErkJggg==', 'base64'), old = URL.createObjectURL; let created = 0; URL.createObjectURL = () => {created++; return 'blob:unexpected';}; t.after(() => {URL.createObjectURL = old;});
  for (const late of [false, true]) {
    const response = deferred(), f = fixture(t, {count: 0, linktext: 'Catalog.base#Cards', files: [entry('Notes/A.md', {cover: 'Pic.png'}), entry('Pic.png', {}, bytes.length)]});
    api.configureVaultSource({async request() {return response.promise;}}); await complete(f); await tick(); if (late) await f.embed.dispose(); response.resolve({status: 200, value: {root: 'local', file: {path: 'Pic.png'}, version: late ? 'v1' : 'stale', base64: bytes.toString('base64')}}); await tick(); await tick(); if (!late) assert.equal(find(f.host, 'basesEmbedCover').dataset.basesEmbedCover, 'error'); assert.equal(created, 0);
  }
});

test('worker errors settle the owner and a new valid query can recover', async t => {
  const {Worker} = dom(t); Worker.error = 'Malformed query'; const f = fixture(t); await complete(f); assert.equal(f.host.dataset.slopsidianEmbedState, 'error'); assert.equal(f.embed.worker, null); Worker.error = null; f.embed.query(); await complete(f); assert.equal(f.host.dataset.slopsidianEmbedState, 'ready');
});

test('hidden retained Reading controls cannot navigate after Source or Live Preview hides their owner', async t => {
  dom(t); const f = fixture(t); await complete(f); const button = find(f.host, 'basesEmbedFile'); f.host.hidden = true; button.click(); await tick(); assert.deepEqual(f.calls.opened, []);
});

test('a held worker cannot publish while the selected vault is changing even without a core event', async t => {
  const {Worker} = dom(t); Worker.hold = true; const f = fixture(t); await tick(); const worker = Worker.instances[0]; f.app.changingVault = true; worker.respond(); await complete(f); assert.equal(matching(f.host, 'basesEmbedRow').length, 0); assert.equal(worker.terminated, true);
});

test('failed Cards navigation revokes created cover URLs and cancels still-pending cover reads', async t => {
  dom(t); const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwSmn4DwAEOAImk1RrTQAAAABJRU5ErkJggg==', 'base64'), created = [], revoked = [], oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL; URL.createObjectURL = () => {const url = 'blob:failed-' + created.length; created.push(url); return url;}; URL.revokeObjectURL = url => revoked.push(url); t.after(() => {URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke;});
  const held = deferred(), f = fixture(t, {count: 0, linktext: 'Catalog.base#Cards', files: [entry('Notes/A.md', {cover: 'Pic.png'}), entry('Notes/B.md', {cover: 'Held.png'}), entry('Pic.png', {}, bytes.length), entry('Held.png', {}, bytes.length)]});
  api.configureVaultSource({async request(path) {return path.includes('Held.png') ? held.promise : {status: 200, value: {root: 'local', file: {path: 'Pic.png'}, version: 'v1', base64: bytes.toString('base64')}};}}); await complete(f); await tick(); assert.equal(created.length, 1);
  const button = find(f.host, 'basesEmbedFile'); f.files.splice(f.files.findIndex(file => file.path === button.dataset.basesEmbedFile), 1); button.click(); await tick(); assert.equal(f.host.dataset.slopsidianEmbedState, 'error'); assert.deepEqual(revoked, created);
  held.resolve({status: 200, value: {root: 'local', file: {path: 'Held.png'}, version: 'v1', base64: bytes.toString('base64')}}); await tick(); await tick(); assert.equal(created.length, 1); assert.deepEqual(revoked, created);
});

test('actual VaultDocument without a root field loads through root-bound physical info and its own path/version', async t => {
  dom(t); const f = fixture(t); await complete(f); f.app.vault.readDocument = async path => ({file: {path}, content: f.text, version: 'v1', hasBom: true}); await f.embed.reload(); await complete(f); assert.equal(f.host.dataset.slopsidianEmbedState, 'ready');
});

test('the containing Reading mode can refuse an otherwise visible connected control without blocking passive rendering', async t => {
  dom(t); const f = fixture(t); await complete(f); f.embed.options.active = () => false; find(f.host, 'basesEmbedFile').click(); await tick(); assert.deepEqual(f.calls.opened, []); assert.equal(f.host.dataset.slopsidianEmbedState, 'ready');
});

test('root-switched worker completion settles and terminates without publishing into the old owner', async t => {
  const {Worker} = dom(t); Worker.hold = true; const f = fixture(t); await tick(); const worker = Worker.instances[0]; f.app.vault.rootPath = 'replacement'; worker.respond(); await complete(f); assert.equal(matching(f.host, 'basesEmbedRow').length, 0); assert.equal(worker.terminated, true);
});

test('current passive cover completion may settle a hidden group while its navigation remains inert', async t => {
  dom(t); const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwSmn4DwAEOAImk1RrTQAAAABJRU5ErkJggg==', 'base64'), held = deferred();
  const f = fixture(t, {count: 0, linktext: 'Catalog.base#Cards', files: [entry('Notes/A.md', {cover: 'Pic.png'}), entry('Pic.png', {}, bytes.length)]}); api.configureVaultSource({async request() {return held.promise;}}); await complete(f); const row = find(f.host, 'basesEmbedRow'); row.hidden = true;
  held.resolve({status: 200, value: {root: 'local', file: {path: 'Pic.png'}, version: 'v1', base64: bytes.toString('base64')}}); await tick(); await tick(); const image = nodes(row).find(node => node.tagName === 'IMG'); assert.ok(image); image.emit('load'); assert.equal(find(row, 'basesEmbedCover').dataset.basesEmbedCover, 'ready'); find(row, 'basesEmbedFile').click(); assert.deepEqual(f.calls.opened, []);
});

test('shared snapshot retains metadata limits and copies values independently of mutable index entries', t => {
  dom(t); const f = fixture(t, {count: 0, files: [entry('Notes/A.md', {amount: {nested: [0, false]}, huge: 'x'.repeat(65537)})]}); const snapshot = api.baseQueryFiles(f.app), row = snapshot.find(file => file.path === 'Notes/A.md'); assert.match(row.metadataError, /65,536/); assert.deepEqual(row.properties.amount, {nested: [0, false]}); f.files.find(file => file.path === row.path).properties.amount.nested[0] = 99; assert.equal(row.properties.amount.nested[0], 0);
  f.app.vault.getFiles = () => Array(10001).fill(entry('TooMany.md')); assert.throws(() => api.baseQueryFiles(f.app), /10,000/);
});
