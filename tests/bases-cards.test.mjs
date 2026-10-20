import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {build} from 'esbuild';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {basename, join, relative, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {root} from './host.mjs';
import {errorLogStub} from './error-log-stub.mjs';

let temporary, api;
before(async () => {
  await mkdir(join(root, '.runtime'), {recursive: true}); temporary = await mkdtemp(join(root, '.runtime', 'bases-cards-tests-'));
  const entry = join(temporary, 'cards.mjs');
  const modalStub = {name: 'bases-cards-modal', setup(builder) {
    builder.onResolve({filter: /^\.\/ui$/}, args => args.importer.endsWith('bases.ts') ? {path: args.path, namespace: 'cards-modal'} : null);
    builder.onLoad({filter: /.*/, namespace: 'cards-modal'}, () => ({contents: `export class Modal {constructor(app){this.app=app;this.containerEl=document.createElement('div');this.modalEl=this.containerEl;this.contentEl=document.createElement('div');this.containerEl.append(this.contentEl)}setTitle(){return this}open(){this.containerEl.root=true}close(){this.containerEl.root=false;this.onClose?.()}}`, loader: 'js'}));
  }};
  await build({stdin: {contents: 'export * from "./client/bases-model";export * from "./client/bases-cards";export * from "./client/bases-group-state";export {BasesView} from "./client/bases";export {Events} from "./client/events";export {TFile} from "./client/vault";export {configureVaultSource} from "./client/contracts";', resolveDir: root}, outfile: entry, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent', plugins: [errorLogStub, modalStub]});
  api = await import(pathToFileURL(entry).href);
});
after(async () => {if (temporary) {assert.ok(relative(root, temporary).startsWith('.runtime' + sep)); assert.ok(basename(temporary).startsWith('bases-cards-tests-')); await rm(temporary, {recursive: true});}});
const file = (path, properties = {}, extra = {}) => ({path, name: path.split('/').at(-1), basename: path.split('/').at(-1).replace(/\.md$/, ''), extension: path.split('.').at(-1), stat: {size: 20, ctime: 0, mtime: 0}, properties, tags: [], links: [], ...extra});
const source = (extra = '', name = 'Cards') => 'filters: file.ext == "md"\nviews:\n  - type: cards\n    name: ' + name + '\n    order: [file.name, note.status, note.amount]\n' + extra;
const query = (files, text = source(), extra = {}) => api.queryBase({files, text, context: file('Catalog.base'), view: 'Cards', search: '', page: 0, ...extra});
const grouped = source('    groupBy: {property: note.status, direction: ASC}\n    summaries: {note.amount: Sum}\n');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('Cards is supported with pinned presentation defaults; unknown renderers remain explicit', () => {
  assert.equal(api.supportedBaseView('cards'), true); assert.deepEqual(new api.BaseDocument(source()).view('Cards').cards, {cardSize: 200, image: '', imageFit: '', imageAspectRatio: 1});
  for (const type of ['map', 'custom-cards', 'Cards']) {assert.equal(api.supportedBaseView(type), false); assert.throws(() => query([], source().replace('type: cards', 'type: ' + type)), /retained but not implemented/);}
});
test('Cards shares table query, formulas, typed groups, multi-sort, limits, summaries and displayed-value search', () => {
  const text = 'formulas:\n  doubled: amount * 2\nproperties:\n  formula.doubled: {displayName: Twice}\n' + grouped.replace('note.amount]', 'note.amount, formula.doubled]') + '    sort: [{property: note.amount, direction: DESC}]\n    limit: 120\n';
  const files = Array.from({length: 135}, (_, index) => file(`Row ${index}.md`, {status: index < 120 ? 'open' : 'done', amount: index})); files.push(file('Skip.png'));
  for (const page of [0, 1]) {const result = query(files, text, {page}); assert.deepEqual({...result, rows: result.rows.map(({cover, ...row}) => row)}, query(files, text.replace('type: cards', 'type: table'), {page})); assert.equal(result.total, 120); assert.equal(result.matched, 135); assert.equal(result.columns[3].label, 'Twice');}
  assert.equal(query(files, text, {page: 1}).rows.length, 20); assert.equal(query(files, text, {search: 'Row 134.md'}).rows[0].path, 'Row 134.md');
});
test('Cards native YAML options are bounded, invalid source settings stay retained with defaults and warnings', () => {
  const model = new api.BaseDocument(source('    cardSize: 280\n    image: note.cover\n    imageFit: contain\n    imageAspectRatio: 0.5\n'));
  assert.deepEqual(model.view('Cards').cards, {cardSize: 280, image: 'note.cover', imageFit: 'contain', imageAspectRatio: 0.5});
  const invalid = new api.BaseDocument(source('    cardSize: 9007199254740993\n    image: file.path\n    imageFit: cover\n    imageAspectRatio: .01\n    futureCover: {keep: true}\n'));
  assert.deepEqual(invalid.view('Cards').cards, {cardSize: 200, image: '', imageFit: '', imageAspectRatio: 1}); assert.equal(query([], invalid.source).warnings.length, 5); assert.ok(invalid.source.includes('9007199254740993'));
  for (const options of [{cardSize: 0}, {cardSize: Infinity}, {image: 'file.path'}, {image: []}, {imageFit: 'cover'}, {imageAspectRatio: NaN}, {imageAspectRatio: 2.51}]) assert.throws(() => model.setCardsOptions('Cards', {...model.view('Cards').cards, ...options}));
});
test('Cards settings preserve named views, opaque YAML, exact numbers, aliases, Unicode, BOM and CRLF', () => {
  const text = '\ufeff# cards λ\r\nfuture: &opaque {precise: 9007199254740993, decimal: 0.123456789012345678901}\r\ncopy: *opaque\r\n' + (source('    futureView: {keep: true}\n') + source('', 'Other').replace(/filters:[^\n]*\nviews:\n/, '')).replaceAll('\n', '\r\n');
  const changed = new api.BaseDocument(text).setCardsOptions('Cards', {cardSize: 320, image: 'formula.cover', imageFit: 'contain', imageAspectRatio: 1.5}), next = new api.BaseDocument(changed);
  assert.equal(next.view('Cards').cards.cardSize, 320); assert.equal(next.view('Other').cards.cardSize, 200); for (const fragment of ['# cards λ', '&opaque', '*opaque', '9007199254740993', '0.123456789012345678901', 'futureView: { keep: true }']) assert.ok(changed.includes(fragment), fragment); assert.ok(changed.startsWith('\ufeff')); assert.equal(/(?<!\r)\n/.test(changed), false);
  assert.throws(() => new api.BaseDocument(source().replace('type: cards', 'type: table')).setCardsOptions('Cards', next.view('Cards').cards), /Choose a Cards/);
});
test('editing existing Cards numeric settings replaces their old tokens and preserves every unrelated numeric lexeme', () => {
  const text = '\ufeff# Existing Cards settings λ\r\nopaque: &keep {precise: 9007199254740993, decimal: 0.123456789012345678901}\r\ncopy: *keep\r\n' + (source('    cardSize: 200 # Keep size comment\n    image: note.cover\n    imageFit: ""\n    imageAspectRatio: 0.5 # Keep ratio comment\n    futureView: {precise: 9007199254740995}\n') + '  - type: cards\n    name: Other\n    cardSize: 0xC8 # Keep other size spelling\n    imageAspectRatio: .50 # Keep other ratio spelling\n').replaceAll('\n', '\r\n');
  const changed = new api.BaseDocument(text).setCardsOptions('Cards', {cardSize: 280, image: 'note.cover', imageFit: 'contain', imageAspectRatio: 1.5}), next = new api.BaseDocument(changed);
  assert.deepEqual(next.view('Cards').cards, {cardSize: 280, image: 'note.cover', imageFit: 'contain', imageAspectRatio: 1.5}); assert.equal(next.view('Other').cards.cardSize, 200); assert.equal(next.view('Other').cards.imageAspectRatio, 0.5);
  for (const fragment of ['# Existing Cards settings λ', '# Keep size comment', '# Keep ratio comment', '&keep', '*keep', '9007199254740993', '0.123456789012345678901', '9007199254740995', 'cardSize: 0xC8', 'imageAspectRatio: .50']) assert.ok(changed.includes(fragment), fragment);
  assert.match(changed, /cardSize: 280\s+# Keep size comment/); assert.match(changed, /imageAspectRatio: 1\.5\s+# Keep ratio comment/); assert.ok(changed.startsWith('\ufeff')); assert.equal(/(?<!\r)\n/.test(changed), false);
  const same = new api.BaseDocument(changed).setCardsOptions('Other', {cardSize: 200, image: '', imageFit: 'contain', imageAspectRatio: 0.5}); assert.ok(same.includes('cardSize: 0xC8')); assert.ok(same.includes('imageAspectRatio: .50'));
});
test('cover query evaluates hidden image properties/formulas without changing displayed search or summaries', () => {
  const text = 'formulas:\n  cover: \'[note.poster, "ignored.png"]\'\n' + source('    image: formula.cover\n    summaries: {note.amount: Sum}\n');
  const result = query([file('A.md', {poster: '#A0b1C2', amount: 0}), file('B.md', {poster: '[[Pic.png|Picture]]', amount: 2}), file('C.md', {poster: 'https://example.invalid/image.png', amount: 3})], text);
  assert.deepEqual(result.rows.map(row => row.cover), [{kind: 'color', color: '#A0b1C2'}, {kind: 'path', path: 'Pic.png'}, {kind: 'error', message: 'Only vault raster images and #RRGGBB colors are supported as card covers. External and filesystem URLs are retained.'}]); assert.equal(result.summaries[2].text, '5'); assert.equal(query([file('A.md', {poster: 'Secret.png'})], text, {search: 'Secret'}).rows.length, 0);
  assert.deepEqual(query([file('A.md')], source('    image: file.file\n')).rows[0].cover, {kind: 'path', path: 'A.md'});
  const failed = query([file('A.md')], 'formulas:\n  cover: missingFunction()\n' + source('    image: formula.cover\n')); assert.equal(failed.rows[0].cover.kind, 'error'); assert.match(failed.errors[0], /cover/);
});
test('cover values use first list entry and reject URLs, active content, invalid scalar types and oversized paths', () => {
  for (const value of [null, '', [], [null, 'second.png']]) assert.equal(api.baseCardCover(value), null);
  assert.deepEqual(api.baseCardCover([[[{kind: 'base-link', path: 'Pictures/A.png', display: '<img>'}]]]), {kind: 'path', path: 'Pictures/A.png'});
  for (const value of ['https://example.invalid/a.png', 'file:///C:/a.png', '//example.invalid/a.png', '\\\\server\\a.png', 'data:image/png;base64,AA', 'javascript:alert(1)', 'x\0.png', 'x'.repeat(4097), true, 3, {}]) assert.equal(api.baseCardCover(value).kind, 'error', String(value));
});

class Node {
  constructor(tag) {this.tagName = tag.toUpperCase(); this.children = []; this.parent = null; this.dataset = {}; this.attributes = {}; this.listeners = new Map(); this.style = {setProperty(name, value) {this[name] = value;}}; this.disabled = false; this.hidden = false; this.value = ''; this.className = ''; this.classList = {add: value => {this.className += ' ' + value;}};}
  get isConnected() {return this.root || Boolean(this.parent?.isConnected);}
  get childElementCount() {return this.children.length;}
  get textContent() {return (this.text ?? '') + this.children.map(node => node.textContent).join('');}
  set textContent(text) {this.text = String(text); this.replaceChildren();}
  set innerHTML(_value) {throw Error('Cards rendering must not interpret HTML');}
  append(...nodes) {for (const node of nodes) {if (typeof node === 'string') {this.text = (this.text ?? '') + node; continue;} node.parent = this; this.children.push(node);}}
  add(node) {this.append(node);}
  replaceChildren(...nodes) {for (const child of this.children) child.parent = null; this.children = []; this.append(...nodes);}
  setAttribute(name, value) {this.attributes[name] = String(value);}
  addEventListener(type, listener) {const values = this.listeners.get(type) ?? []; values.push(listener); this.listeners.set(type, values);}
  removeEventListener(type, listener) {this.listeners.set(type, (this.listeners.get(type) ?? []).filter(value => value !== listener));}
  remove() {if (this.parent) {this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null;} this.root = false;}
  contains(node) {return node === this || this.children.some(child => child.contains(node));}
  closest(selector) {return selector.toUpperCase().split(',').includes(this.tagName) ? this : this.parent?.closest(selector) ?? null;}
  focus() {document.activeElement = this;}
  emit(type, extra = {}) {for (const listener of this.listeners.get(type) ?? []) listener({target: this, preventDefault() {}, ...extra});}
  click() {this.emit('click');}
}
const nodes = node => [node, ...node.children.flatMap(nodes)];
const find = (f, name, value) => nodes(f.current.table).find(node => Object.hasOwn(node.dataset, name) && (value === undefined || node.dataset[name] === value));
const matching = (f, name) => nodes(f.current.table).filter(node => Object.hasOwn(node.dataset, name));
function dom(t) {
  const previous = globalThis.document, option = globalThis.Option, win = globalThis.window; globalThis.document = {createElement: tag => new Node(tag)}; globalThis.Option = class extends Node {constructor(text, value) {super('option'); this.textContent = text; this.value = value;}}; globalThis.window = {getSelection: () => ({toString: () => ''})};
  t.after(() => {for (const [key, value] of [['document', previous], ['Option', option], ['window', win]]) {if (value === undefined) delete globalThis[key]; else globalThis[key] = value;}});
}
function fixture(text = source(), readOnly = false, files = []) {
  const calls = {plan: 0, save: 0, refresh: 0, layout: 0, property: 0, summary: 0, opened: [], reads: 0}, errors = [], app = {changingVault: false, vault: {readOnly, rootPath: 'local', getFiles: () => files, getFileByPath: path => files.find(file => file.path === path), async getFileInfo(file) {return {root: this.rootPath, file: {path: file.path}, version: 'v1'};}, assertWritable() {if (this.readOnly) {const issue = Error('This vault is read-only'); issue.code = 'VAULT_READ_ONLY'; throw issue;}}}, core: {isEnabled: () => true, busy: false}, metadataTypeManager: {getAllProperties: () => ({})}, workspace: {layoutChanged() {calls.layout++;}, async openLinkText(...args) {calls.opened.push(args);}}};
  const current = Object.create(api.BasesView.prototype), model = new api.BaseDocument(text), original = model.setView.bind(model); model.setView = (...args) => {calls.plan++; return original(...args);};
  Object.assign(current, {app, file: {path: 'Catalog.base'}, document: {file: {path: 'Catalog.base'}, content: text, version: '1', hasBom: false}, leaf: {workspace: {isChangingFiles: false}}, bodyEl: new Node('div'), table: new Node('div'), pagination: new Node('div'), status: new Node('output'), issues: new Node('details'), views: new Node('select'), grouping: new Node('select'), viewManagementButton: new Node('button'), viewConfigurationButton: new Node('button'), filtersButton: new Node('button'), formulasLabelsButton: new Node('button'), summaryAuthoringButton: new Node('button'), groupOrderButton: new Node('button'), tablePresentationButton: new Node('button'), text, model, selected: 'Cards', page: 0, search: '', serial: 1, groupFolds: new api.BaseGroupFolds(), requestSave() {calls.save++;}, refresh() {calls.refresh++;}, setError(error) {errors.push(error);}});
  current.leaf.view = current; current.bodyEl.root = true; current.bodyEl.append(current.table, current.pagination); Object.defineProperty(current, 'isLoaded', {value: true, configurable: true}); return {current, app, calls, errors, text};
}
const render = (f, files, extra = {}) => f.current.render(query(files, f.current.text, {view: f.current.selected, ...extra}));

test('Cards renders semantic paged grids with ordered labeled properties, editable blanks, zero/false and literal HTML-like data', t => {
  dom(t); const f = fixture(source('    image: note.cover\n')); render(f, [file('A.md', {status: '<img onerror=throw(1)>', amount: 0, cover: '#112233'}), file('B.md', {amount: false})]);
  assert.equal(f.current.table.dataset.basesLayout, 'cards'); assert.equal(find(f, 'basesCards').attributes.role, 'list'); assert.equal(matching(f, 'basesCard').length, 2); assert.equal(find(f, 'basesCard').tagName, 'ARTICLE');
  assert.equal(find(f, 'basesCard').children[1].children[0].className, 'bases-card-property bases-card-title'); assert.equal(find(f, 'basesCell', 'note.status').children[0].textContent, '<img onerror=throw(1)>'); assert.equal(find(f, 'basesCell', 'note.amount').children[0].textContent, '0'); assert.equal(matching(f, 'basesCell').at(-1).children[0].textContent, 'false'); assert.equal(matching(f, 'basesCardCover')[0].style.backgroundColor, '#112233'); assert.equal(matching(f, 'basesCardCover')[1].dataset.basesCardCoverStatus, 'empty');
});
test('Cards links, open button, card body and Enter navigate; note controls reuse existing typed editing', async t => {
  dom(t); const f = fixture(); f.current.editProperty = (path, property) => {f.calls.property++; assert.deepEqual([path, property], ['A.md', 'status']);}; render(f, [file('A.md', {status: 'open'})]);
  find(f, 'basesCell', 'note.status').children[0].click(); assert.equal(f.calls.property, 1); find(f, 'basesLink').click(); find(f, 'basesCardOpen').click(); find(f, 'basesCard').click(); find(f, 'basesCard').emit('keydown', {key: 'Enter'}); await tick(); assert.equal(f.calls.opened.length, 4); assert.ok(f.calls.opened.every(args => args[0] === 'A.md'));
});
test('Cards folds only members, preserves group/all-row summaries and typed identities across pages and earlier groups', t => {
  dom(t); const f = fixture(grouped); const files = Array.from({length: 135}, (_, index) => file(`Row ${index}.md`, {status: index < 120 ? 'open' : 'done', amount: 2})); render(f, files);
  const heading = matching(f, 'basesGroupLabel').find(node => node.dataset.basesGroupLabel === 'open'); heading.children[0].click(); assert.equal(heading.children[0].attributes['aria-expanded'], 'false'); assert.equal(matching(f, 'basesRow').filter(node => node.hidden).length, 85); assert.equal(find(f, 'basesSummaryValue').textContent, '30'); assert.equal(matching(f, 'basesSummaryValue').at(-1).textContent, '270'); assert.equal(f.calls.save, 0);
  render(f, [file('Earlier.md', {status: '!earlier', amount: 5}), ...files], {page: 1}); assert.equal(matching(f, 'basesRow').filter(node => node.hidden).length, 36); assert.equal(matching(f, 'basesGroupFold')[0].attributes['aria-expanded'], 'false');
});
test('read-only Cards exposes local folds/navigation but refuses forced settings/sort/summary/property handlers before planning', t => {
  dom(t); const f = fixture(grouped, true); render(f, [file('A.md', {status: 'open', amount: 2}), file('B.md', {status: 'done', amount: 3})]);
  const mutating = nodes(f.current.table).filter(node => node.dataset.basesAction === 'cards-settings' || Object.hasOwn(node.dataset, 'basesSort') || Object.hasOwn(node.dataset, 'basesSummarize') || node.className === 'bases-summary-button' || node.className === 'bases-cell-edit'); assert.ok(mutating.length > 10);
  for (const button of mutating) {assert.equal(button.disabled, true); button.disabled = false; button.click();} assert.equal(f.calls.plan, 0); assert.equal(f.calls.save, 0); assert.equal(f.current.text, f.text); assert.ok(f.errors.every(error => error.code === 'VAULT_READ_ONLY')); find(f, 'basesGroupFold').click(); assert.equal(f.calls.layout, 1);
});
test('detached, replaced, disabled, loading and vault-switched Cards controls cannot affect replacement owners', async t => {
  dom(t); for (const transition of ['render', 'serial', 'root', 'view', 'file', 'owner', 'provider', 'busy', 'unloaded']) {
    const f = fixture(grouped); render(f, [file('A.md', {status: 'open', amount: 2})]); const old = nodes(f.current.table); let settings = 0; f.current.cardsSettingsDialog = () => {settings++;};
    if (transition === 'render') render(f, []); else if (transition === 'serial') f.current.serial++; else if (transition === 'root') f.app.vault.rootPath = 'other'; else if (transition === 'view') f.current.selected = 'Other'; else if (transition === 'file') f.current.file = {...f.current.file}; else if (transition === 'owner') f.current.leaf.view = {}; else if (transition === 'provider') f.app.core.isEnabled = () => false; else if (transition === 'busy') f.app.core.busy = true; else Object.defineProperty(f.current, 'isLoaded', {value: false});
    for (const button of old.filter(node => node.tagName === 'BUTTON')) button.click(); await tick(); assert.equal(settings, 0, transition); assert.equal(f.calls.opened.length, 0, transition); assert.equal(f.calls.save, 0, transition); assert.equal(f.calls.layout, 0, transition);
  }
});
test('real Cards settings form saves native options and guarded stale forms cannot plan or dirty source', async t => {
  dom(t); const f = fixture(); f.current.save = async () => {}; f.app.core.run = async action => action(); f.current.cardsSettingsDialog(); const controls = nodes(f.current.modal.contentEl), form = controls.find(node => node.tagName === 'FORM');
  controls.find(node => Object.hasOwn(node.dataset, 'basesCardsSize')).value = '280'; controls.find(node => Object.hasOwn(node.dataset, 'basesCardsImage')).value = 'note.status'; controls.find(node => Object.hasOwn(node.dataset, 'basesCardsFit')).value = 'contain'; controls.find(node => Object.hasOwn(node.dataset, 'basesCardsRatio')).value = '0.5'; form.emit('submit'); await tick(); assert.deepEqual(new api.BaseDocument(f.current.text).view('Cards').cards, {cardSize: 280, image: 'note.status', imageFit: 'contain', imageAspectRatio: 0.5}); assert.equal(f.calls.save, 1);
  for (const transition of ['readonly', 'root', 'view', 'file', 'model', 'closed', 'provider']) {const f = fixture(); f.app.core.run = async action => action(); let plans = 0; const setter = f.current.model.setCardsOptions.bind(f.current.model); f.current.model.setCardsOptions = (...args) => {plans++; return setter(...args);}; f.current.cardsSettingsDialog(); const controls = nodes(f.current.modal.contentEl), form = controls.find(node => node.tagName === 'FORM'); if (transition === 'readonly') f.app.vault.readOnly = true; else if (transition === 'root') f.app.vault.rootPath = 'other'; else if (transition === 'view') f.current.selected = 'Other'; else if (transition === 'file') f.current.file = {...f.current.file}; else if (transition === 'model') f.current.model = new api.BaseDocument(f.text); else if (transition === 'closed') f.current.modal.close(); else f.app.core.isEnabled = () => false; form.emit('submit'); await tick(); assert.equal(plans, 0, transition); assert.equal(f.current.text, f.text); assert.equal(f.calls.save, 0); assert.ok(controls.some(node => node.dataset.basesDialogError === '' && node.textContent));}
});

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]).buffer;
const image = (path = 'A.png', size = png.byteLength) => ({path, extension: path.split('.').at(-1), stat: {size}});
test('cover lease shares one bounded read/URL for repeated covers and revokes every owned URL exactly once', async () => {
  const calls = {read: 0, create: 0, revoked: []}; const lease = new api.BaseCardCoverLease(async () => {calls.read++; return png;}, () => true, (_bytes, mime) => {assert.equal(mime, 'image/png'); return 'blob:cover-' + ++calls.create;}, url => calls.revoked.push(url));
  const [first, second] = await Promise.all([lease.load(image()), lease.load(image())]); assert.equal(first, second); assert.equal(calls.read, 1); assert.equal(calls.create, 1); lease.dispose(); lease.dispose(); assert.deepEqual(calls.revoked, [first]); assert.equal(await lease.load(image()), null);
});
test('late cover reads after disposal or owner changes create no URL and queued reads never start', async () => {
  for (const dispose of [true, false]) {let resolve, reads = 0, creates = 0, current = true; const lease = new api.BaseCardCoverLease(() => {reads++; return new Promise(done => {resolve = done;});}, () => current, () => {creates++; return 'blob:stale';}, () => {}); const first = lease.load(image()); await tick(); if (dispose) lease.dispose(); else current = false; resolve(png); assert.equal(await first, null); assert.equal(reads, 1); assert.equal(creates, 0); lease.dispose();}
  let reads = 0; const complete = []; const lease = new api.BaseCardCoverLease(() => {reads++; return new Promise(done => complete.push(done));}, () => true, () => 'blob:none', () => {}); const loads = Array.from({length: 8}, (_, index) => lease.load(image(index + '.png'))); await tick(); assert.equal(reads, 4); lease.dispose(); for (const done of complete) done(png); assert.deepEqual(await Promise.all(loads), Array(8).fill(null)); assert.equal(reads, 4);
});
test('cover leases reject oversized/page-budget data, stale sizes and disguised active media before URL creation', async () => {
  let reads = 0, creates = 0; const lease = new api.BaseCardCoverLease(async () => {reads++; return png;}, () => true, () => {creates++; return 'blob:bad';}, () => {});
  for (const entry of [image('A.svg'), image('B.png', 0), image('C.png', 4 * 1024 * 1024 + 1)]) await assert.rejects(lease.load(entry), /support|4 MiB/); assert.equal(reads, 0);
  await assert.rejects(lease.load(image('Changed.png', 10)), /changed/); assert.equal(creates, 0); lease.dispose();
  const bad = new TextEncoder().encode('<svg onload="throw(1)"></svg>').buffer; const active = new api.BaseCardCoverLease(async () => bad, () => true, () => {creates++; return 'blob:bad';}, () => {}); await assert.rejects(active.load(image('Active.png', bad.byteLength)), /raster/); assert.equal(creates, 0); active.dispose();
  const pending = [], bounded = new api.BaseCardCoverLease(() => new Promise(done => pending.push(done)), () => true, () => 'blob:bounded', () => {}); const loads = Array.from({length: 4}, (_, index) => bounded.load(image(index + '.png', 4 * 1024 * 1024))); await assert.rejects(bounded.load(image('Overflow.png', 1)), /16 MiB/); bounded.dispose(); for (const done of pending) done(png); await Promise.all(loads);
});
test('actual Cards cover rendering decodes a leased image, applies fit/ratio and releases it on replacement', async t => {
  dom(t); const create = URL.createObjectURL, revoke = URL.revokeObjectURL, made = [], released = []; URL.createObjectURL = blob => {assert.equal(blob.type, 'image/png'); made.push('blob:card-' + made.length); return made.at(-1);}; URL.revokeObjectURL = url => released.push(url); t.after(() => {URL.createObjectURL = create; URL.revokeObjectURL = revoke;});
  const poster = file('Pic.png', {}, {stat: {size: png.byteLength, mtime: 5, ctime: 0}}), files = [poster, file('A.md', {cover: '[[Pic.png]]'}), file('B.md', {cover: 'Pic.png'})], f = fixture(source('    image: note.cover\n    imageFit: contain\n    imageAspectRatio: .5\n'), false, files); api.configureVaultSource({async request(path) {assert.match(path, /^\/api\/binary\?path=Pic.png&root=local$/); f.calls.reads++; return {status: 200, value: {root: 'local', file: {path: 'Pic.png'}, version: 'v1', base64: Buffer.from(png).toString('base64')}};}}); t.after(() => api.configureVaultSource(null)); render(f, files); await tick();
  const covers = matching(f, 'basesCardCover'); assert.equal(f.calls.reads, 1); assert.equal(made.length, 1); for (const cover of covers) {assert.equal(cover.style.aspectRatio, '2'); const image = cover.children.find(node => node.tagName === 'IMG'); assert.equal(image.style.objectFit, 'contain'); image.emit('load'); assert.equal(cover.dataset.basesCardCoverStatus, 'ready');}
  f.current.stop(); assert.deepEqual(released, made); render(f, []); assert.equal(matching(f, 'basesCardCover').length, 0); f.current.stop(); assert.deepEqual(released, made);
});
test('actual Cards cover completion after a model refresh or file-stat change never allocates a stale URL', async t => {
  dom(t); const create = URL.createObjectURL, revoke = URL.revokeObjectURL; let made = 0; URL.createObjectURL = () => {made++; return 'blob:stale';}; URL.revokeObjectURL = () => {}; t.after(() => {URL.createObjectURL = create; URL.revokeObjectURL = revoke;});
  t.after(() => api.configureVaultSource(null));
  for (const transition of ['stop', 'base-rename', 'file-change']) {let finish; const poster = file('Pic.png', {}, {stat: {size: png.byteLength, mtime: 5, ctime: 0}}), files = [poster, file('A.md', {cover: 'Pic.png'})], f = fixture(source('    image: note.cover\n'), false, files); api.configureVaultSource({request: () => new Promise(resolve => {finish = () => resolve({status: 200, value: {root: 'local', file: {path: 'Pic.png'}, version: 'v1', base64: Buffer.from(png).toString('base64')}});})}); render(f, files); await tick(); if (transition === 'stop') f.current.stop(); else if (transition === 'base-rename') f.current.file.path = 'Renamed.base'; else poster.stat = {...poster.stat, mtime: 6}; finish(); await tick(); assert.equal(made, 0); const cover = find(f, 'basesCardCover'); assert.equal(cover.children.some(node => node.tagName === 'IMG'), false); if (transition === 'file-change') assert.equal(cover.dataset.basesCardCoverStatus, 'error'); f.current.stop();}
});
test('versioned cover reads bind their own bytes to physical observations, root and path on cache-safe transports', async () => {
  const info = {root: 'cache:repo', file: {path: 'A.png'}, version: 'git:abc'}, binary = {...info, base64: Buffer.from(png).toString('base64')}; let infos = 0, reads = 0;
  const result = await api.readBaseCardImage(image(), 'cache:repo', async () => {infos++; return info;}, async () => {reads++; return binary;}, () => true); assert.deepEqual(result, png); assert.equal(infos, 2); assert.equal(reads, 1);
});
test('same-size/restored-mtime cover replacements, A-to-B-to-A responses and missing provenance refuse before URL allocation', async () => {
  const info = {root: 'local', file: {path: 'A.png'}, version: 'A'}, binary = {...info, base64: Buffer.from(png).toString('base64')};
  for (const transition of ['after-version', 'binary-version', 'binary-missing-version', 'before-missing-version', 'after-missing-version', 'binary-root', 'binary-path', 'after-root', 'after-path']) {
    let observations = 0, made = 0; const before = transition === 'before-missing-version' ? {...info, version: undefined} : info;
    const after = transition === 'after-version' ? {...info, version: 'B'} : transition === 'after-missing-version' ? {...info, version: undefined} : transition === 'after-root' ? {...info, root: 'other'} : transition === 'after-path' ? {...info, file: {path: 'Other.png'}} : info;
    const response = transition === 'binary-version' ? {...binary, version: 'B'} : transition === 'binary-missing-version' ? {...binary, version: undefined} : transition === 'binary-root' ? {...binary, root: 'other'} : transition === 'binary-path' ? {...binary, file: {path: 'Other.png'}} : binary;
    const lease = new api.BaseCardCoverLease(entry => api.readBaseCardImage(entry, 'local', async () => ++observations === 1 ? before : after, async () => response, () => true), () => true, () => {made++; return 'blob:stale';}, () => {});
    await assert.rejects(lease.load(image()), /version changed/, transition); assert.equal(made, 0, transition); lease.dispose();
  }
});
test('a held same-stat cover response from a replaced version cannot publish into the actual Cards renderer', async t => {
  dom(t); let finish, observed = 0, made = 0; const create = URL.createObjectURL, revoke = URL.revokeObjectURL; URL.createObjectURL = () => {made++; return 'blob:stale';}; URL.revokeObjectURL = () => {}; t.after(() => {URL.createObjectURL = create; URL.revokeObjectURL = revoke; api.configureVaultSource(null);});
  const poster = file('Pic.png', {}, {stat: {size: png.byteLength, mtime: 5, ctime: 0}}), files = [poster, file('A.md', {cover: 'Pic.png'})], f = fixture(source('    image: note.cover\n'), false, files);
  f.app.vault.getFileInfo = async () => ({root: 'local', file: {path: 'Pic.png'}, version: ++observed === 1 ? 'A' : 'B'}); api.configureVaultSource({request: () => new Promise(resolve => {finish = () => resolve({status: 200, value: {root: 'local', file: {path: 'Pic.png'}, version: 'A', base64: Buffer.from(png).toString('base64')}});})});
  render(f, files); await tick(); const originalStat = {...poster.stat}; poster.stat = {...poster.stat}; finish(); await tick(); assert.deepEqual(poster.stat, originalStat); assert.equal(made, 0); assert.equal(find(f, 'basesCardCover').dataset.basesCardCoverStatus, 'error'); f.current.stop();
});

async function restoredCards(t, {enabled = false, changingVault = false, holdSecond = false} = {}) {
  dom(t); t.mock.timers.enable({apis: ['setTimeout']}); document.baseURI = 'http://cards-fixture/';
  const previousWorker = globalThis.Worker, create = URL.createObjectURL, revoke = URL.revokeObjectURL, made = [], released = [], files = [], leaves = [], state = {enabled, reads: 0, binaryReads: 0, release: null};
  const text = source('    image: note.cover\n'), vault = Object.assign(new api.Events(), {rootPath: 'cards-vault', readOnly: false, getFiles: () => files, getFileByPath: path => files.find(file => file.path === path), getAbstractFileByPath: path => files.find(file => file.path === path), assertWritable() {}, async getFileInfo(file) {return {root: this.rootPath, file: {path: file.path}, version: 'image-1'};}, async readDocument(path) {state.reads++; if (holdSecond && state.reads === 2) await new Promise(resolve => {state.release = resolve;}); return {root: this.rootPath, file: {path}, content: text, version: 'base-1', hasBom: false};}});
  const core = Object.assign(new api.Events(), {busy: !enabled, isEnabled: () => state.enabled}), metadataCache = Object.assign(new api.Events(), {getDocument: path => ({cache: {frontmatter: path.endsWith('.md') ? {cover: 'Pic.png'} : {}, tags: [], errors: []}, outgoing: []})});
  const app = {changingVault, vault, core, metadataCache, metadataTypeManager: Object.assign(new api.Events(), {getAllProperties: () => ({}), getAssignedWidget: () => undefined}), workspace: {layoutChanged() {}, notifyEditor() {}}};
  for (const path of ['Catalog.base', 'Pic.png', 'A.md', 'B.md']) files.push(new api.TFile(vault, {...file(path), stat: {size: path === 'Pic.png' ? png.byteLength : 20, mtime: 5, ctime: 0}}));
  globalThis.Worker = class {constructor() {this.listeners = new Map();} addEventListener(type, listener) {this.listeners.set(type, listener);} postMessage(request) {setImmediate(() => {if (!this.terminated) this.listeners.get('message')?.({data: {serial: request.serial, result: api.queryBase(request)}});});} terminate() {this.terminated = true;}};
  URL.createObjectURL = () => {const url = 'blob:restored-' + made.length; made.push(url); return url;}; URL.revokeObjectURL = url => released.push(url);
  api.configureVaultSource({async request(path) {assert.match(path, /^\/api\/binary\?path=Pic.png&root=cards-vault$/); state.binaryReads++; return {status: 200, value: {root: vault.rootPath, file: {path: 'Pic.png'}, version: 'image-1', base64: Buffer.from(png).toString('base64')}};}});
  for (const id of ['left', 'right']) {const leaf = {id, workspace: {app, isChangingFiles: false, notifyEditor() {}}, updateHeader() {}}, view = new api.BasesView(leaf, {app}); leaf.view = view; view.containerEl.root = true; leaves.push(leaf); await view.openView();}
  t.after(async () => {state.release?.(); for (const leaf of leaves) await leaf.original.closeView(); api.configureVaultSource(null); globalThis.Worker = previousWorker; URL.createObjectURL = create; URL.revokeObjectURL = revoke;});
  for (const leaf of leaves) leaf.original = leaf.view;
  const load = () => (async () => {for (const leaf of leaves) await leaf.view.setState({file: 'Catalog.base', view: 'Cards'}, {});})();
  const covers = index => nodes(leaves[index].original.table).filter(node => Object.hasOwn(node.dataset, 'basesCardCover'));
  const decode = () => {for (const leaf of leaves) for (const image of nodes(leaf.original.table).filter(node => node.tagName === 'IMG')) image.emit('load');};
  return {app, state, leaves, made, released, load, covers, decode, async settle() {await tick(); await tick(); decode();}, ready() {state.enabled = true; core.busy = false; app.changingVault = false; core.trigger('changed'); t.mock.timers.tick(100);}};
}

test('actual restored Cards panes recover raster covers after a second returned document holds provider activation', async t => {
  const f = await restoredCards(t, {holdSecond: true}), restoring = f.load(); await f.settle();
  assert.equal(typeof f.state.release, 'function'); assert.equal(f.leaves[0].view.contentEl.dataset.basesComplete, 'true'); assert.equal(f.app.core.isEnabled('bases'), false); assert.equal(f.covers(0).filter(node => node.dataset.basesCardCoverStatus === 'loading').length, 2); assert.equal(f.state.binaryReads, 0);
  f.state.release(); await restoring; f.ready(); await f.settle();
  for (const index of [0, 1]) {assert.equal(f.covers(index).length, 2); assert.ok(f.covers(index).every(node => node.dataset.basesCardCoverStatus === 'ready'), 'both current panes must publish their known raster covers'); assert.equal(f.leaves[index].view.serial, Number(f.leaves[index].view.table.dataset.basesRenderSerial));}
  assert.equal(f.made.length - f.released.length, 2, 'one owned URL per current pane');
  const serials = f.leaves.map(leaf => leaf.view.serial); f.app.core.trigger('changed'); t.mock.timers.tick(100); await f.settle(); assert.deepEqual(f.leaves.map(leaf => leaf.view.serial), serials, 'stable unrelated core notifications do not rerender');
  for (const leaf of f.leaves) await leaf.view.closeView(); assert.deepEqual(new Set(f.released), new Set(f.made));
});

test('saved Cards covers recover only after vault readiness and a current registered owner', async t => {
  const f = await restoredCards(t, {enabled: true, changingVault: true}); await f.load(); await f.settle(); assert.equal(f.state.binaryReads, 0); assert.ok(f.covers(0).every(node => node.dataset.basesCardCoverStatus === 'loading'));
  const stale = f.leaves[1].view; f.leaves[1].view = {}; f.app.vault.rootPath = 'other'; f.app.core.trigger('changed'); t.mock.timers.tick(100); await f.settle(); assert.equal(f.state.binaryReads, 0, 'leaving vault cannot allocate a cover URL');
  f.app.vault.rootPath = 'cards-vault'; f.ready(); await f.settle(); assert.ok(f.covers(0).every(node => node.dataset.basesCardCoverStatus === 'ready')); assert.ok(f.covers(1).every(node => node.dataset.basesCardCoverStatus === 'loading')); assert.equal(f.made.length, 1, 'replaced leaf owner cannot restart visual work');
  await stale.closeView(); await f.leaves[0].view.closeView(); const count = f.made.length; f.app.core.busy = true; f.app.core.trigger('changed'); f.app.core.busy = false; f.app.core.trigger('changed'); t.mock.timers.tick(100); await f.settle(); assert.equal(f.made.length, count, 'unloaded views cannot reacquire image ownership');
});
