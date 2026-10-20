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
  await mkdir(join(root, '.runtime'), {recursive: true}); temporary = await mkdtemp(join(root, '.runtime', 'bases-list-tests-'));
  const entry = join(temporary, 'list.mjs');
  const modalStub = {name: 'bases-list-modal', setup(builder) {
    builder.onResolve({filter: /^\.\/ui$/}, args => args.importer.endsWith('bases.ts') ? {path: args.path, namespace: 'list-modal'} : null);
    builder.onLoad({filter: /.*/, namespace: 'list-modal'}, () => ({contents: `export class Modal {constructor(app){this.app=app;this.containerEl=document.createElement('div');this.modalEl=this.containerEl;this.contentEl=document.createElement('div');this.containerEl.append(this.contentEl)}setTitle(){return this}open(){this.containerEl.root=true}close(){this.containerEl.root=false;this.onClose?.()}}`, loader: 'js'}));
  }};
  await build({stdin: {contents: 'export * from "./client/bases-model";export * from "./client/bases-group-state";export {BasesView} from "./client/bases";', resolveDir: root}, outfile: entry, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent', plugins: [errorLogStub, modalStub]});
  api = await import(pathToFileURL(entry).href);
});
after(async () => {if (temporary) {assert.ok(relative(root, temporary).startsWith('.runtime' + sep)); assert.ok(basename(temporary).startsWith('bases-list-tests-')); await rm(temporary, {recursive: true});}});
const file = (path, properties = {}, extra = {}) => ({path, name: path.split('/').at(-1), basename: path.split('/').at(-1).replace(/\.md$/, ''), extension: path.split('.').at(-1), stat: {size: 20, ctime: 0, mtime: 0}, properties, tags: [], links: [], ...extra});
const source = (extra = '', type = 'list', name = 'List') => 'views:\n  - type: ' + type + '\n    name: ' + name + '\n    order: [file.name, note.status, note.amount]\n' + extra;
const query = (files, text = source(), extra = {}) => api.queryBase({files, text, context: file('Catalog.base'), view: 'List', search: '', page: 0, ...extra});

test('Table, List and Cards are supported views; custom and map remain explicit unsupported views', () => {
  for (const type of ['table', 'list']) assert.equal(api.supportedBaseView(type), true);
  assert.equal(api.supportedBaseView('cards'), true);
  for (const type of ['map', 'custom-list', 'LIST']) {assert.equal(api.supportedBaseView(type), false); const text = source('', type); assert.equal(new api.BaseDocument(text).source, text); assert.throws(() => query([], text), /retained but not implemented/);}
});
test('a genuine List query uses the ordered public property schema and defaults to file.name', () => {
  const result = query([file('B.md', {status: 'open', amount: 2}), file('A.md', {status: 'done', amount: 0})]);
  assert.deepEqual(result.columns.map(column => column.key), ['file.name', 'note.status', 'note.amount']); assert.deepEqual(result.rows.map(row => row.path), ['A.md', 'B.md']);
  assert.equal(query([file('B.md')], 'views:\n  - type: list\n    name: List\n').rows[0].cells[0].link, 'B.md');
});
test('List shares table filter, formula, typed group, multi-sort, limit and summary semantics exactly', () => {
  const text = 'filters: file.ext == "md"\nformulas:\n  doubled: amount * 2\nproperties:\n  formula.doubled:\n    displayName: Twice\n' + source('    filters: status != "archived"\n    sort: [{property: note.amount, direction: DESC}]\n    groupBy: {property: note.status, direction: ASC}\n    limit: 120\n    summaries: {note.amount: Sum}\n').replace('note.amount]', 'note.amount, formula.doubled]');
  const files = Array.from({length: 135}, (_, index) => file(`Row ${index}.md`, {status: index < 100 ? 'open' : 'done', amount: index})); files.push(file('Skip.png'), file('Archive.md', {status: 'archived'}));
  const result = query(files, text); assert.deepEqual({...result, rows: result.rows.map(({listNumber, ...row}) => row)}, query(files, text.replace('type: list', 'type: table'))); const next = query(files, text, {page: 1}); assert.equal(next.rows.length, 20); assert.equal(next.total, 120); assert.equal(next.matched, 135); assert.equal(next.columns[3].label, 'Twice');
  assert.equal(query(files, text, {search: 'Row 134.md'}).rows[0].path, 'Row 134.md');
});
test('List preserves unsupported presentation settings, aliases, precise numbers, comments and BOM/CRLF during actual sort and summary edits', () => {
  const text = '\ufeff# list source λ\r\nfuture: &opaque {number: 9007199254740993, decimal: 0.123456789012345678901}\r\ncopy: *opaque\r\n' + source('    nativePresentation: {keep: true}\n    futureSetting: nested\n').replaceAll('\n', '\r\n');
  const model = new api.BaseDocument(text); assert.equal(model.source, text); const result = query([file('A.md')], text); assert.ok(result.warnings.some(message => /nativePresentation.*futureSetting.*retained|retained.*nativePresentation.*futureSetting/.test(message)));
  let changed = model.setView('List', 'sort', [{property: 'note.amount', direction: 'DESC'}]); changed = new api.BaseDocument(changed).setSummary('List', 'note.amount', 'Sum');
  for (const fragment of ['# list source λ', '&opaque', '*opaque', '9007199254740993', '0.123456789012345678901', 'nativePresentation: { keep: true }', 'futureSetting: nested']) assert.ok(changed.includes(fragment), fragment);
  assert.ok(changed.startsWith('\ufeff')); assert.equal(/(?<!\r)\n/.test(changed), false); assert.equal(new api.BaseDocument(changed).view('List').type, 'list');
});
test('unknown List settings warn in a bounded way without interpreting unverified native YAML keys', () => {
  const text = source(Array.from({length: 30}, (_, index) => `    future${index}: true\n`).join('')); const warnings = query([], text).warnings;
  assert.equal(warnings.length, 1); assert.match(warnings[0], /retained but not implemented/); assert.ok(warnings[0].length < 700); assert.match(warnings[0], /…/);
  assert.deepEqual(query([], source()).warnings, []); assert.equal(query([], source('    groupOrder: []\n')).warnings.length, 1);
});
test('List retains the existing property count, duplicate property and structured grouping bounds', () => {
  assert.throws(() => new api.BaseDocument('views:\n  - type: list\n    name: List\n    order: [amount, note.amount]\n'), /duplicate/);
  assert.throws(() => new api.BaseDocument('views:\n  - type: list\n    name: List\n    order: []\n'), /1 and 64/);
  assert.throws(() => query([file('A.md', {status: ['one']})], source('    groupBy: {property: note.status}\n')), /Grouping structured/);
});

class Node {
  constructor(tag) {this.tagName = tag.toUpperCase(); this.children = []; this.parent = null; this.dataset = {}; this.attributes = {}; this.listeners = new Map(); this.disabled = false; this.hidden = false; this.value = ''; this.className = ''; this.style = {setProperty(key, value) {this[key] = value;}}; this.classList = {add: value => {this.className += ' ' + value;}};}
  get isConnected() {return this.root || Boolean(this.parent?.isConnected);}
  get childElementCount() {return this.children.length;}
  set innerHTML(_value) {throw Error('List rendering must not interpret HTML');}
  append(...nodes) {for (const node of nodes) {if (typeof node === 'string') continue; node.parent = this; this.children.push(node);}}
  add(node) {this.append(node);}
  replaceChildren(...nodes) {for (const child of this.children) child.parent = null; this.children = []; this.append(...nodes);}
  setAttribute(name, value) {this.attributes[name] = String(value);}
  addEventListener(type, listener) {const values = this.listeners.get(type) ?? []; values.push(listener); this.listeners.set(type, values);}
  contains(node) {return node === this || this.children.some(child => child.contains(node));}
  focus() {document.activeElement = this;}
  click() {for (const listener of this.listeners.get('click') ?? []) listener({target: this});}
}
const nodes = node => [node, ...node.children.flatMap(nodes)];
const find = (f, name, value) => nodes(f.current.table).find(node => Object.hasOwn(node.dataset, name) && (value === undefined || node.dataset[name] === value));
const matching = (f, name) => nodes(f.current.table).filter(node => Object.hasOwn(node.dataset, name));
function dom(t) {
  const previous = globalThis.document, option = globalThis.Option; globalThis.document = {createElement: tag => new Node(tag)}; globalThis.Option = class extends Node {constructor(text, value) {super('option'); this.textContent = text; this.value = value;}};
  t.after(() => {if (previous === undefined) delete globalThis.document; else globalThis.document = previous; if (option === undefined) delete globalThis.Option; else globalThis.Option = option;});
}
function fixture(text = source(), readOnly = false) {
  const calls = {plan: 0, save: 0, refresh: 0, layout: 0, property: 0, summary: 0, opened: []}, errors = [], app = {changingVault: false, vault: {readOnly, rootPath: 'local', assertWritable() {if (this.readOnly) {const issue = Error('This vault is read-only'); issue.code = 'VAULT_READ_ONLY'; throw issue;}}}, core: {isEnabled: () => true, busy: false}, workspace: {layoutChanged() {calls.layout++;}, async openLinkText(...args) {calls.opened.push(args);}}};
  const current = Object.create(api.BasesView.prototype), model = new api.BaseDocument(text), original = model.setView.bind(model); model.setView = (...args) => {calls.plan++; return original(...args);};
  Object.assign(current, {app, file: {path: 'Catalog.base'}, document: {file: {path: 'Catalog.base'}, content: text, version: '1', hasBom: false}, leaf: {workspace: {isChangingFiles: false}}, bodyEl: new Node('div'), table: new Node('div'), pagination: new Node('div'), status: new Node('output'), issues: new Node('details'), views: new Node('select'), grouping: new Node('select'), viewManagementButton: new Node('button'), viewConfigurationButton: new Node('button'), filtersButton: new Node('button'), formulasLabelsButton: new Node('button'), summaryAuthoringButton: new Node('button'), groupOrderButton: new Node('button'), tablePresentationButton: new Node('button'), text, model, selected: 'List', page: 0, search: '', serial: 1, groupFolds: new api.BaseGroupFolds(), requestSave() {calls.save++;}, refresh() {calls.refresh++;}, setError(error) {errors.push(error);}});
  current.leaf.view = current; current.bodyEl.root = true; current.bodyEl.append(current.table, current.pagination); Object.defineProperty(current, 'isLoaded', {value: true, configurable: true});
  return {current, app, calls, errors, text};
}
const grouped = source('    groupBy: {property: note.status, direction: ASC}\n    summaries: {note.amount: Sum}\n');
const render = (f, files, extra = {}) => f.current.render(query(files, f.current.text, {view: f.current.selected, ...extra}));

test('List renderer creates semantic lists and ordered values, never a replacement table or HTML content', t => {
  dom(t); const f = fixture(); render(f, [file('A.md', {status: '<img onerror=throw(1)>', amount: 0})]);
  assert.equal(nodes(f.current.table).some(node => node.tagName === 'TABLE'), false); assert.equal(matching(f, 'basesList').length, 1); assert.equal(find(f, 'basesRow').tagName, 'LI');
  assert.deepEqual(matching(f, 'basesCell').map(node => node.dataset.basesCell), ['file.name', 'note.status', 'note.amount']); assert.match(matching(f, 'basesCell')[0].className, /bases-list-primary/);
  const status = find(f, 'basesCell', 'note.status'); assert.equal(status.children[0].textContent, '<img onerror=throw(1)>'); assert.equal(find(f, 'basesCell', 'note.amount').children[0].textContent, '0');
});
test('an empty List explains the absence of matching files and offers no fabricated row', t => {
  dom(t); const f = fixture(); render(f, []); assert.equal(matching(f, 'basesRow').length, 0); assert.ok(nodes(f.current.table).some(node => node.textContent === 'No files match this view.'));
});
test('List omits missing values and cell errors while keeping visible query diagnostics and real links', t => {
  dom(t); const text = 'formulas:\n  broken: amount / 0\n' + source().replace('note.amount]', 'note.amount, formula.broken]'); const f = fixture(text); render(f, [file('A.md', {amount: 2})]);
  assert.equal(find(f, 'basesCell', 'note.status'), undefined); assert.equal(find(f, 'basesCell', 'formula.broken'), undefined); assert.equal(f.current.issues.hidden, false); assert.equal(find(f, 'basesLink', 'A.md').textContent, 'A.md');
});
test('current List links navigate with the actual base as source, including read-only views', async t => {
  dom(t); const f = fixture(source(), true); render(f, [file('A.md')]); find(f, 'basesLink', 'A.md').click(); await Promise.resolve(); assert.deepEqual(f.calls.opened, [['A.md', 'Catalog.base', true]]);
});
test('List sorting commits the selected named view through writable guards and preserves opaque source', t => {
  dom(t); const f = fixture(source('    future: {keep: true}\n')); f.current.populateControls = () => {}; render(f, [file('A.md')]); find(f, 'basesSort', 'note.amount').click(); assert.equal(f.calls.plan, 1); assert.equal(f.calls.save, 1); assert.equal(new api.BaseDocument(f.current.text).view('List').sort[0].property, 'note.amount'); assert.match(f.current.text, /future: \{ keep: true \}/);
});
test('readonly List mutation controls refuse even forced handlers before planning, dialogs or note reads', t => {
  dom(t); const f = fixture(grouped, true); f.app.vault.getFileByPath = () => {throw Error('Read-only property lookup must not run');}; render(f, [file('A.md', {status: 'open', amount: 2}), file('B.md', {status: 'done', amount: 3})]);
  const mutation = nodes(f.current.table).filter(node => node.dataset.basesAction === 'list-settings' || Object.hasOwn(node.dataset, 'basesSort') || Object.hasOwn(node.dataset, 'basesSummarize') || node.className === 'bases-summary-button' || node.className === 'bases-cell-edit'); assert.ok(mutation.length > 10);
  for (const button of mutation) {assert.equal(button.disabled, true); button.disabled = false; button.click();} assert.equal(f.calls.plan, 0); assert.equal(f.calls.save, 0); assert.equal(f.current.text, f.text); assert.ok(f.errors.every(error => error.code === 'VAULT_READ_ONLY'));
  const fold = find(f, 'basesGroupFold'); assert.equal(fold.disabled, false); fold.click(); assert.equal(fold.attributes['aria-expanded'], 'false'); assert.equal(f.calls.layout, 1);
});
test('List primary/secondary note values reuse guarded property edits and summary configuration', t => {
  dom(t); const f = fixture(); f.current.editProperty = (path, property) => {f.calls.property++; assert.deepEqual([path, property], ['A.md', 'status']);}; f.current.summaryDialog = column => {f.calls.summary++; assert.equal(column.key, 'note.amount');}; render(f, [file('A.md', {status: 'open', amount: 2})]);
  find(f, 'basesCell', 'note.status').children[0].click(); find(f, 'basesSummarize', 'note.amount').click(); assert.equal(f.calls.property, 1); assert.equal(f.calls.summary, 1);
});
test('List group folding hides only member items and retains whole-group and all-row summaries', t => {
  dom(t); const f = fixture(grouped); render(f, [file('A.md', {status: 'open', amount: 2}), file('B.md', {status: 'open', amount: 3}), file('C.md', {status: 'done', amount: 7})]);
  const heading = matching(f, 'basesGroupLabel').find(node => node.dataset.basesGroupLabel === 'open'), button = heading.children[0]; button.click(); assert.equal(button.attributes['aria-expanded'], 'false');
  assert.equal(matching(f, 'basesRow').filter(node => node.hidden).length, 2); const summaries = matching(f, 'basesSummaryValue'); assert.ok(summaries.some(node => node.textContent === '5')); assert.ok(summaries.some(node => node.textContent === '12')); assert.ok(summaries.every(node => !node.hidden && !node.parent.hidden));
  assert.match(button.attributes['aria-controls'], /bases-list-group-row/); assert.equal(f.current.text, f.text); assert.equal(f.calls.save, 0);
});
test('List folding survives page changes and the canonical typed identity distinguishes display collisions', t => {
  dom(t); const f = fixture(grouped), files = Array.from({length: 130}, (_, index) => file(`Row ${index}.md`, {status: 'open', amount: 2})); render(f, files); find(f, 'basesGroupFold').click(); render(f, files, {page: 1}); assert.equal(matching(f, 'basesRow').length, 30); assert.ok(matching(f, 'basesRow').every(node => node.hidden));
  const g = fixture(grouped); render(g, [file('A.md', {status: 1}), file('B.md', {status: '1'})]); const folds = matching(g, 'basesGroupFold'); assert.equal(folds.length, 2); folds[0].click(); assert.equal(folds[0].attributes['aria-expanded'], 'false'); assert.equal(folds[1].attributes['aria-expanded'], 'true');
});
test('List and table named views plus separate panes retain independent local fold scopes', t => {
  dom(t); const text = grouped + source('    groupBy: {property: note.status}\n', 'table', 'Table').replace('views:\n', ''); const f = fixture(text), other = fixture(text), files = [file('A.md', {status: 'open'})]; render(f, files); find(f, 'basesGroupFold').click(); render(other, files); assert.equal(find(other, 'basesGroupFold').attributes['aria-expanded'], 'true');
  f.current.selected = 'Table'; render(f, files); assert.equal(find(f, 'basesGroupFold').attributes['aria-expanded'], 'true'); f.current.selected = 'List'; render(f, files); assert.equal(find(f, 'basesGroupFold').attributes['aria-expanded'], 'false');
});
test('List stale controls cannot fold, navigate, sort, edit, summarize or page after a refreshed render', async t => {
  dom(t); const f = fixture(grouped), files = Array.from({length: 105}, (_, index) => file(`Row ${index}.md`, {status: 'open', amount: 2})); f.current.editProperty = () => {f.calls.property++;}; f.current.summaryDialog = () => {f.calls.summary++;}; render(f, files);
  const retained = [...nodes(f.current.table), ...nodes(f.current.pagination)].filter(node => node.tagName === 'BUTTON'); f.current.serial++; render(f, files); const before = JSON.stringify(f.current.getState()); for (const button of retained) button.click(); await Promise.resolve(); assert.equal(JSON.stringify(f.current.getState()), before); assert.equal(f.calls.plan + f.calls.save + f.calls.property + f.calls.summary + f.calls.refresh + f.calls.layout + f.calls.opened.length, 0);
});
test('still-connected List controls refuse root, selection, file, leaf, provider, busy and unload transitions', async t => {
  dom(t); for (const transition of ['root', 'view', 'file', 'path', 'leaf', 'provider', 'busy', 'vault', 'unloaded']) {
    const f = fixture(grouped); f.current.editProperty = () => {f.calls.property++;}; f.current.summaryDialog = () => {f.calls.summary++;}; render(f, [file('A.md', {status: 'open', amount: 2})]); const buttons = nodes(f.current.table).filter(node => node.tagName === 'BUTTON');
    if (transition === 'root') f.app.vault.rootPath = 'other'; else if (transition === 'view') f.current.selected = 'other'; else if (transition === 'file') f.current.file = {path: 'Catalog.base'}; else if (transition === 'path') f.current.file.path = 'Other.base'; else if (transition === 'leaf') f.current.leaf.view = {}; else if (transition === 'provider') f.app.core.isEnabled = () => false; else if (transition === 'busy') f.app.core.busy = true; else if (transition === 'vault') f.app.changingVault = true; else Object.defineProperty(f.current, 'isLoaded', {value: false});
    for (const button of buttons) button.click(); await Promise.resolve(); assert.equal(f.calls.plan + f.calls.save + f.calls.property + f.calls.summary + f.calls.layout + f.calls.opened.length, 0, transition);
  }
});
test('List pagination remains presentation-only and rejects disabled or detached callbacks', t => {
  dom(t); const f = fixture(), files = Array.from({length: 105}, (_, index) => file(`A${index}.md`)); render(f, files); const buttons = nodes(f.current.pagination).filter(node => node.tagName === 'BUTTON'); buttons[0].click(); assert.equal(f.calls.refresh, 0); buttons[1].click(); assert.equal(f.current.page, 1); assert.equal(f.calls.refresh, 1); assert.equal(f.calls.layout, 1); assert.equal(f.calls.save, 0); assert.equal(f.current.text, f.text);
  render(f, files, {page: 1}); buttons[1].click(); assert.equal(f.calls.refresh, 1);
});
test('List selected view and search/page controls retain unsupported view labels and readonly grouping restrictions', t => {
  dom(t); const text = source() + source('', 'map', 'Map').replace('views:\n', ''); const f = fixture(text); f.current.populateControls(); assert.equal(f.current.views.children[0].textContent, 'List'); assert.match(f.current.views.children[1].textContent, /unsupported map/); assert.equal(f.current.grouping.disabled, false); f.app.vault.readOnly = true; f.current.populateControls(); assert.equal(f.current.grouping.disabled, true);
});

test('verified native List options parse with bullet/inline/comma defaults and preserve exact source until edited', () => {
  const text = source(); assert.deepEqual(new api.BaseDocument(text).view('List').list, {markers: 'bullet', indentProperties: false, separator: ', '});
  const configured = source('    markers: none\n    indentProperties: true\n    separator: " | "\n'); assert.deepEqual(new api.BaseDocument(configured).view('List').list, {markers: 'none', indentProperties: true, separator: ' | '}); assert.equal(new api.BaseDocument(configured).source, configured);
});
test('List invalid native option values and oversized separators remain preserved and explain bounded fallbacks', () => {
  const text = source('    markers: unknown\n    indentProperties: "yes"\n    separator: '+JSON.stringify('λ'.repeat(257))+'\n'); const model = new api.BaseDocument(text); assert.equal(model.source, text); assert.equal(model.view('List').warnings.length, 3); assert.deepEqual(model.view('List').list, {markers: 'bullet', indentProperties: false, separator: ', '});
  for (const separator of ['\0', 'x'.repeat(257), false, 1, {}]) assert.throws(() => model.setListOptions('List', {markers: 'bullet', indentProperties: false, separator}));
  for (const markers of ['unknown', [], 1]) assert.throws(() => model.setListOptions('List', {markers, indentProperties: false, separator: ', '}));
  assert.equal(new api.BaseDocument(source('    separator: ""\n')).view('List').list.separator, ', ');
});
test('List settings edits target only the named view, retaining unknown nodes, precise numeric lexemes and BOM/CRLF', () => {
  const text = '\ufeff# presentation\r\nopaque: &keep {precise: 9007199254740993}\r\ncopy: *keep\r\n' + (source('    future: {untouched: true}\n') + source('', 'list', 'Other').replace('views:\n', '')).replaceAll('\n', '\r\n'); const model = new api.BaseDocument(text);
  const changed = model.setListOptions('List', {markers: 'number', indentProperties: true, separator: ' / '}), next = new api.BaseDocument(changed); assert.equal(next.view('List').list.markers, 'number'); assert.equal(next.view('Other').list.markers, 'bullet'); for (const fragment of ['# presentation', '&keep', '*keep', '9007199254740993', 'future: { untouched: true }']) assert.ok(changed.includes(fragment), fragment); assert.ok(changed.startsWith('\ufeff')); assert.equal(/(?<!\r)\n/.test(changed), false);
  assert.throws(() => new api.BaseDocument(source('', 'table')).setListOptions('List', {markers: 'none', indentProperties: false, separator: ' '}), /Choose a List/);
});
test('numbered List markers use semantic ordered lists and retain full-group numbering across pages', t => {
  dom(t); const f = fixture(source('    markers: number\n    groupBy: {property: note.status}\n')); const files = Array.from({length: 135}, (_, index) => file(`Row ${index}.md`, {status: index < 120 ? 'open' : 'done'})); render(f, files); const lists = matching(f, 'basesList'); assert.ok(lists.every(node => node.tagName === 'OL' && node.dataset.basesMarkers === 'number')); assert.equal(find(f, 'basesRow', 'Row 120.md').value, 1);
  render(f, files, {page: 1}); assert.equal(matching(f, 'basesRow')[0].value, 86); assert.equal(matching(f, 'basesRow').at(-1).value, 120);
});
test('none markers and a custom separator are explicit safe presentation without interpreting HTML', t => {
  dom(t); const f = fixture(source('    markers: none\n    separator: "<svg onload=throw(1)>"\n')); render(f, [file('A.md', {status: 'open', amount: false})]); assert.equal(find(f, 'basesList').dataset.basesMarkers, 'none'); const separators = nodes(f.current.table).filter(node => node.className === 'bases-list-separator'); assert.equal(separators.length, 2); assert.ok(separators.every(node => node.textContent === '<svg onload=throw(1)>')); assert.equal(find(f, 'basesCell', 'note.amount').children[0].textContent, 'false');
});
test('indented List properties are semantic children of the primary item and do not render separators', t => {
  dom(t); const f = fixture(source('    indentProperties: true\n    separator: "never display"\n')); render(f, [file('A.md', {status: 'open', amount: 0})]); const item = find(f, 'basesRow'), nested = item.children.find(node => node.className === 'bases-list-nested'); assert.equal(nested.tagName, 'UL'); assert.equal(nested.children.length, 2); assert.ok(nested.children.every(node => node.tagName === 'LI')); assert.equal(item.children[0].dataset.basesCell, 'file.name'); assert.equal(nodes(item).some(node => node.className === 'bases-list-separator'), false);
});
test('inline List omits empty cells but numbers the first remaining property and retains zero and false', t => {
  dom(t); const text = source('    markers: number\n').replace('[file.name, note.status, note.amount]', '[note.status, note.amount]'), f = fixture(text); render(f, [file('Empty.md', {status: '', amount: []}), file('False.md', {status: null, amount: false}), file('Zero.md', {status: [], amount: 0})]);
  assert.deepEqual(matching(f, 'basesRow').map(node => node.dataset.basesRow), ['False.md', 'Zero.md']); assert.deepEqual(matching(f, 'basesRow').map(node => node.value), [1, 2]); assert.ok(matching(f, 'basesCell').every(node => node.dataset.basesCell === 'note.amount' && node.className.includes('bases-list-primary'))); assert.match(f.current.status.textContent, /3 rows.*1 rows without displayable/);
});
test('indented List requires the first configured property, retains totals/summaries, and explains hidden rows', t => {
  dom(t); const text = source('    indentProperties: true\n    summaries: {note.amount: Sum}\n').replace('[file.name, note.status, note.amount]', '[note.status, note.amount]'), f = fixture(text); render(f, [file('Empty.md', {status: null, amount: 7}), file('Present.md', {status: 'open', amount: 3})]); assert.deepEqual(matching(f, 'basesRow').map(node => node.dataset.basesRow), ['Present.md']); assert.equal(find(f, 'basesSummaryValue').textContent, '10'); assert.match(f.current.status.textContent, /2 rows.*1 rows without displayable/);
  const g = fixture(text); render(g, [file('Empty.md', {amount: 4})]); assert.ok(nodes(g.current.table).some(node => node.textContent === 'No list items have displayable properties on this page.'));
});
test('an actual List settings form commits bounded native YAML options through current writable ownership', async t => {
  dom(t); const f = fixture(); f.current.save = async () => {}; f.app.core.run = async action => action(); f.current.listSettingsDialog(); const controls = nodes(f.current.modal.contentEl), form = controls.find(node => node.tagName === 'FORM'); controls.find(node => Object.hasOwn(node.dataset, 'basesListMarkers')).value = 'none'; controls.find(node => Object.hasOwn(node.dataset, 'basesListIndent')).checked = true; controls.find(node => Object.hasOwn(node.dataset, 'basesListSeparator')).value = ' · ';
  for (const listener of form.listeners.get('submit')) listener({preventDefault() {}}); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(new api.BaseDocument(f.current.text).view('List').list, {markers: 'none', indentProperties: true, separator: ' · '}); assert.equal(f.calls.save, 1);
});
test('retained List settings forms refuse read-only, root, named-view, file, model and closed-dialog transitions before planning', async t => {
  dom(t); for (const transition of ['readonly', 'root', 'view', 'file', 'model', 'closed', 'provider']) {
    const f = fixture(); f.app.core.run = async action => action(); let plans = 0; const setter = f.current.model.setListOptions.bind(f.current.model); f.current.model.setListOptions = (...args) => {plans++; return setter(...args);}; f.current.listSettingsDialog(); const modal = f.current.modal, controls = nodes(modal.contentEl), form = controls.find(node => node.tagName === 'FORM');
    if (transition === 'readonly') f.app.vault.readOnly = true; else if (transition === 'root') f.app.vault.rootPath = 'other'; else if (transition === 'view') f.current.selected = 'Other'; else if (transition === 'file') f.current.file = {...f.current.file}; else if (transition === 'model') f.current.model = new api.BaseDocument(f.text); else if (transition === 'closed') modal.close(); else f.app.core.isEnabled = () => false;
    for (const listener of form.listeners.get('submit')) listener({preventDefault() {}}); await new Promise(resolve => setImmediate(resolve)); assert.equal(plans, 0, transition); assert.equal(f.current.text, f.text, transition); assert.equal(f.calls.save, 0, transition); assert.ok(controls.some(node => node.dataset.basesDialogError === '' && node.textContent), transition);
  }
});

test('worker completion can precede a queued metadata refresh; stale controls refuse and the final current render remains usable', async t => {
  dom(t); const previousWorker = globalThis.Worker, workers = []; globalThis.document.baseURI = 'https://list.test/';
  class Worker {
    constructor() {this.listeners = new Map(); workers.push(this);}
    addEventListener(type, action) {this.listeners.set(type, action);}
    postMessage(request) {this.request = request;}
    terminate() {this.terminated = true;}
    complete(result) {this.listeners.get('message')({data: {serial: this.request.serial, result}});}
  }
  globalThis.Worker = Worker; t.after(() => {if (previousWorker === undefined) delete globalThis.Worker; else globalThis.Worker = previousWorker;});
  const f = fixture(), files = [file('Catalog.base'), file('A.md', {status: 'open', amount: 2})], result = query(files);
  f.current.contentEl = f.current.bodyEl; f.current.snapshot = () => files; f.current.refresh = api.BasesView.prototype.refresh;
  let dialogs = 0; f.current.listSettingsDialog = () => {dialogs++;}; f.current.refresh(); f.current.schedule();
  workers[0].complete(result); const first = nodes(f.current.table).find(node => node.dataset.basesAction === 'list-settings');
  assert.equal(f.current.contentEl.dataset.basesComplete, 'true'); assert.notEqual(f.current.debounce, null, 'An earlier complete marker alone does not mean pending metadata work settled'); assert.equal(Number(f.current.table.dataset.basesRenderSerial), f.current.serial);
  await new Promise(resolve => setTimeout(resolve, 120)); assert.equal(workers.length, 2); assert.equal(f.current.contentEl.dataset.basesComplete, 'false'); assert.notEqual(Number(f.current.table.dataset.basesRenderSerial), f.current.serial);
  first.click(); assert.equal(dialogs, 0, 'The connected earlier render refuses while replacement query is pending');
  workers[1].complete(result); const fresh = nodes(f.current.table).find(node => node.dataset.basesAction === 'list-settings');
  assert.notEqual(fresh, first); assert.equal(f.current.debounce, null); assert.equal(f.current.worker, null); assert.equal(Number(f.current.table.dataset.basesRenderSerial), f.current.serial); fresh.click(); assert.equal(dialogs, 1); first.click(); assert.equal(dialogs, 1); f.current.stop();
});
