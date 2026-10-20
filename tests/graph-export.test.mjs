import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {join, relative, sep} from 'node:path';

// No host helpers are imported: these tests bundle only models and real GraphPane
// with inert view/DOM boundaries. No application, filesystem provider or browser starts.
const root = fileURLToPath(new URL('../', import.meta.url));
const stubs = {name: 'graph-export-boundaries', setup(builder) {
  const modules = {
    './views': 'export class ItemView{}; export class FileView{};',
    './vault': 'export class TFile{};',
    './dom': 'export function element(){throw Error("Unexpected host DOM lookup")} export function reportError(error){throw error}',
    './icons': 'export function iconButton(_icon,title,action){const node=document.createElement("button");node.textContent=title;node.addEventListener("click",action);return node}',
    './ui': 'export class Modal{constructor(app){this.app=app;this.containerEl=document.createElement("div");this.modalEl=document.createElement("div");this.contentEl=document.createElement("div");this.modalEl.append(this.contentEl);this.containerEl.append(this.modalEl);this.isOpen=false}setTitle(title){this.title=title;return this}open(){this.isOpen=true;this.containerEl.root=true;this.onOpen?.()}close(){if(!this.isOpen)return;this.isOpen=false;this.onClose?.();this.containerEl.root=false}}',
  };
  builder.onResolve({filter: /^\.\/(?:views|vault|dom|icons|ui)$/}, args => {
    if (/(?:graph|graph-export-modal)\.ts$/.test(args.importer)) return {path: args.path, namespace: 'graph-test'};
  });
  builder.onLoad({filter: /.*/, namespace: 'graph-test'}, args => ({contents: modules[args.path], loader: 'js'}));
}};
const bundled = await build({stdin: {contents: 'export * from "./client/graph-export";export * from "./client/graph-model";export {GraphPane} from "./client/graph";export {GraphExportModal} from "./client/graph-export-modal";', resolveDir: root, loader: 'ts'}, bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false, logLevel: 'silent', plugins: [stubs]});
await mkdir(join(root, '.runtime'), {recursive: true}); const temporary = await mkdtemp(join(root, '.runtime', 'graph-export-tests-')); let api;
try {const entry = join(temporary, 'graph.mjs'); await writeFile(entry, bundled.outputFiles[0].text); api = await import(pathToFileURL(entry).href);}
finally {assert.ok(relative(root, temporary).startsWith('.runtime' + sep)); await rm(temporary, {recursive: true});}
const {captureGraphExport, serializeGraphExport, readGraphExportSettings, graphExportFilename, rasterizeGraphExport, readGraphOptions, resetGraphOptions, buildGraph, GraphPane, GraphExportModal} = api;
const settings = {scope: 'camera', background: 'white', width: 1000, height: 700};
const node = (extra = {}) => ({id: 'file:A.md', path: 'A.md', label: 'A', kind: 'file', degree: 1, x: 10, y: 20, color: null, ...extra});
const input = (extra = {}) => ({data: {nodes: [node(), node({id: 'file:B.md', path: 'B.md', label: 'B', x: 80, y: -30, color: 'rgba(12,34,56,0.25)'})], edges: [{source: 'file:A.md', target: 'file:B.md', weight: 2}], warnings: []}, options: {showArrow: true}, camera: {x: 480, y: 350, scale: 1.2}, title: 'Graph λ 🗺', capturedAt: '2026-11-20T02:00:00.000Z', ...extra});

test('captured scene is detached and deeply immutable; current camera and complete link multiplicity survive', () => {
  const source = input(), frame = captureGraphExport(source), svg = serializeGraphExport(frame, settings);
  source.data.nodes[0].x = 999; source.data.nodes[0].label = 'Changed'; source.camera.x = 0; source.options.showArrow = false;
  assert.equal(frame.nodes[0].x, 10); assert.equal(frame.nodes[0].label, 'A'); assert.equal(frame.camera.x, 480);
  assert.throws(() => {frame.nodes[0].x = 5;}, TypeError); assert.throws(() => {frame.nodes.push(node());}, TypeError);
  assert.equal(svg.bytes, Buffer.byteLength(svg.text)); assert.deepEqual(svg.camera, {x: 480, y: 350, scale: 1.2});
  assert.match(svg.text, /rgba\(12,34,56,0\.25\)/); assert.match(svg.text, /A\.md → B\.md \(2\)/); assert.match(svg.text, /marker-end="url\(#graph-arrow\)"/);
  assert.equal(frame.capturedAt, source.capturedAt); assert.equal(frame.edges.length, 1);
});

test('XML-looking labels, titles, filters and paths stay literal inert text, with no source CSS, URL or event attributes', () => {
  const hostile = '<script onload="x">&\' λ 🗺 </text><image href="https://example.invalid"/>', data = {nodes: [node({id: 'literal', path: hostile, label: hostile})], edges: [], warnings: [hostile]};
  const svg = serializeGraphExport(captureGraphExport(input({data, title: hostile, center: hostile, options: {search: hostile, future: '<foreignObject/>'}})), settings);
  assert.match(svg.text, /&lt;script onload=&quot;x&quot;&gt;&amp;&apos; λ 🗺/);
  const markup = svg.text.match(/<[^>]*>/g).join('');
  assert.equal(/<(?:script|image|foreignObject|a|style)\b|\shref=|\sonload=|@import|<!DOCTYPE|<!ENTITY/.test(markup), false);
  assert.equal(svg.text.includes('<foreignObject/>'), false); assert.ok(svg.text.includes('Local center:'));
  const references = [...svg.text.matchAll(/url\(([^)]+)\)/g)].map(match => match[1]); assert.deepEqual(references, ['#graph-clip']);
});

test('whole graph fits frozen node circles and captured label widths without changing the captured camera', () => {
  const frame = captureGraphExport(input({data: {nodes: [node({x: -1000, y: -300}), node({id: 'tag:#large', path: '#large', label: 'Long label', kind: 'tag', x: 2000, y: 500, degree: 64})], edges: [], warnings: []}, labelWidths: new Map([['file:A.md', 1200], ['tag:#large', 950]])}));
  const svg = serializeGraphExport(frame, {...settings, scope: 'whole'});
  assert.notDeepEqual(svg.camera, frame.camera); assert.deepEqual(frame.camera, {x: 480, y: 350, scale: 1.2});
  for (const n of frame.nodes) {const x = n.x * svg.camera.scale + svg.camera.x, y = n.y * svg.camera.scale + svg.camera.y; assert.ok(x >= 30 && x <= 970 && y >= 30 && y <= 670); assert.ok(x - n.labelWidth / 2 * svg.camera.scale >= 29.999); assert.ok(x + n.labelWidth / 2 * svg.camera.scale <= 970.001);}
  assert.match(svg.text, /textLength="1200"/); assert.match(svg.text, /Whole matching graph/);
});

test('empty graphs export honestly; solid/dark/transparent backgrounds and unresolved/center states are self-contained', () => {
  const empty = captureGraphExport(input({data: {nodes: [], edges: [], warnings: []}}));
  assert.match(serializeGraphExport(empty, {...settings, scope: 'whole'}).text, /0 matching nodes, 0 links/);
  const frame = captureGraphExport(input({center: 'Missing.md', data: {nodes: [node({path: 'Missing.md', kind: 'unresolved'})], edges: [], warnings: ['Ambiguous targets omitted.']}}));
  const dark = serializeGraphExport(frame, {...settings, background: 'dark'}).text;
  assert.match(dark, /background-color:#1e1e2e/); assert.match(dark, /stroke-width="3" stroke-dasharray/); assert.match(dark, /Warnings: Ambiguous targets omitted/);
  const transparent = serializeGraphExport(frame, {...settings, background: 'transparent'}).text;
  assert.equal(transparent.includes('background-color:'), false); assert.match(transparent, /fill="none"/); assert.equal(/<rect[^>]+fill=/.test(transparent), false);
});
test('valid tiny group opacity and carriage returns survive the independent XML capture contract', () => {
  const svg = serializeGraphExport(captureGraphExport(input({data:{nodes:[node({color:'rgba(1,2,3,1e-7)',label:'First\rSecond'})],edges:[],warnings:[]}})), settings);
  assert.match(svg.text, /rgba\(1,2,3,1e-7\)/); assert.match(svg.text, /First&#13;Second/);
});

for (const [label, change] of [
  ['duplicate IDs', value => value.data.nodes.push(node())], ['invalid edge target', value => value.data.edges[0].target = 'absent'],
  ['self edge', value => value.data.edges[0].target = value.data.edges[0].source], ['invalid weight', value => value.data.edges[0].weight = 0],
  ['infinite position', value => value.data.nodes[0].x = Infinity], ['extreme position', value => value.data.nodes[0].y = 1e8],
  ['fractional degree', value => value.data.nodes[0].degree = .5], ['unknown kind', value => value.data.nodes[0].kind = 'active-html'],
  ['CSS URL', value => value.data.nodes[0].color = 'url(https://example.invalid/a.svg)'], ['invalid RGB', value => value.data.nodes[0].color = 'rgba(999,0,0,1)'],
  ['invalid alpha', value => value.data.nodes[0].color = 'rgba(0,0,0,1.5)'], ['invalid XML', value => value.data.nodes[0].label = '\u0000'],
  ['unpaired surrogate', value => value.title = '\ud800'], ['oversized label', value => value.data.nodes[0].label = 'a'.repeat(4097)],
  ['missing camera', value => value.camera = undefined], ['bad capture time', value => value.capturedAt = 'yesterday'],
  ['invalid options', value => value.options.nodeSizeMultiplier = -1], ['oversized label width', value => value.labelWidths = new Map([['file:A.md', 1e8]])],
]) test('invalid captured ' + label + ' refuses instead of embedding it', () => {const value = input(); change(value); assert.throws(() => captureGraphExport(value));});

for (const [label, extra] of [['fractional width', {width: 64.5}], ['blank width', {width: NaN}], ['small height', {height: 63}], ['long side', {width: 4097}], ['too many pixels', {width: 4096, height: 4096}], ['unknown scope', {scope: 'hidden-data'}], ['CSS background', {background: 'url(x)'}]]) {
  test('image limit: ' + label, () => assert.throws(() => readGraphExportSettings({...settings, ...extra})));
}
test('image dimensions accept both numerical bounds and exact pixel limit', () => {assert.equal(readGraphExportSettings({...settings, width: 4000, height: 4000}).width, 4000); assert.equal(readGraphExportSettings({...settings, width: 64, height: 64}).height, 64);});
test('serialized byte cap applies to escaped UTF-8 output independently of captured text; oversized scenes are never truncated', () => {
  const nodes = Array.from({length: 2300}, (_, index) => node({id: String(index), label: '&'.repeat(800), path: String(index)}));
  const frame = captureGraphExport(input({data: {nodes, edges: [], warnings: []}})); assert.throws(() => serializeGraphExport(frame, settings), /Prepared SVG exceeds 8 MiB/);
  assert.throws(() => captureGraphExport(input({data: {nodes: Array.from({length: 10_001}, (_, i) => node({id: String(i)})), edges: [], warnings: []}})), /10,000 nodes/);
  assert.throws(() => captureGraphExport(input({data: {nodes: [node()], edges: Array(100_001).fill({source: 'file:A.md', target: 'x', weight: 1}), warnings: []}})), /100,000 links/);
});
test('image preparation cannot be forged with a structurally similar frame or active SVG', async () => {
  assert.throws(() => serializeGraphExport({...captureGraphExport(input())}, settings), /validated graph frame/);
  await assert.rejects(rasterizeGraphExport({text: '<svg><image href="https://example.invalid"/></svg>', settings}, {current: () => true, signal: new AbortController().signal}), /validated graph SVG/);
});
test('download names keep Unicode while excluding filesystem punctuation and Windows device basenames', () => {
  assert.equal(graphExportFilename('Graph λ 🗺', 'svg'), 'Graph λ 🗺.svg'); assert.equal(graphExportFilename('../Graph:?*', 'png'), '.._Graph___.png');
  assert.equal(graphExportFilename('CON', 'svg'), 'Graph CON.svg'); assert.equal(graphExportFilename('', 'png'), 'Graph.png'); assert.throws(() => graphExportFilename('Graph', 'html'));
});

test('scoped defaults retain opaque fields/groups and every untouched section without mutating any original', () => {
  const value = readGraphOptions({search: 'path:Work', showTags: true, localJumps: 4, showArrow: true, nodeSizeMultiplier: 3, linkDistance: 400, future: {retained: [null, false]}, 'collapse-display': false, colorGroups: [{query: 'x', futureGroup: 'keep', color: {a: .25, rgb: 0x112233, futureColor: [1]}}]}), original = structuredClone(value);
  const filters = resetGraphOptions(value, 'filters'); assert.equal(filters.search, ''); assert.equal(filters.localJumps, 4); assert.equal(filters.showArrow, true); assert.equal(filters.linkDistance, 400);
  assert.equal(resetGraphOptions(value, 'filters', true).localJumps, 1);
  const display = resetGraphOptions(value, 'display'); assert.equal(display.nodeSizeMultiplier, 1); assert.equal(display.search, value.search); assert.equal(display.linkDistance, 400);
  const forces = resetGraphOptions(value, 'forces'); assert.equal(forces.linkDistance, 250); assert.equal(forces.search, value.search); assert.equal(forces.nodeSizeMultiplier, 3);
  for (const result of [filters, display, forces]) {assert.deepEqual(result.colorGroups, value.colorGroups); assert.deepEqual(result.future, value.future); assert.equal(result['collapse-display'], false); result.colorGroups[0].color.futureColor.push(2); assert.deepEqual(value, original);}
  assert.throws(() => resetGraphOptions(value, '__proto__'), /Choose Filters/);
});

class Element {
  constructor(tag, ownerDocument) {this.tagName = tag; this.ownerDocument = ownerDocument; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.style = {removeProperty() {}}; this.className = ''; this.value = ''; this.hidden = false; this.clientWidth = 800; this.namespaceURI = 'http://www.w3.org/2000/svg';}
  get isConnected() {return this.root || this.parent?.isConnected || false;}
  get classList() {return {contains: value => this.className.split(' ').includes(value), add: (...values) => {this.className += ' ' + values.join(' ');}, remove: value => {this.className = this.className.split(' ').filter(x => x !== value).join(' ');}, toggle: (value, on) => {const present = this.className.split(' ').includes(value); if (on === undefined) on = !present; if (on && !present) this.className += ' ' + value; if (!on) this.className = this.className.split(' ').filter(x => x !== value).join(' ');}};}
  set textContent(value) {this.text = String(value); this.children = [];}
  get textContent() {return (this.text ?? '') + this.children.map(child => child.textContent).join('');}
  set innerHTML(_value) {throw Error('Graph must never interpret untrusted markup');}
  append(...items) {for (const child of items) {if (typeof child === 'string') {this.text = (this.text ?? '') + child; continue;} child.parent = this; this.children.push(child); if (this.tagName === 'select' && !this.value) this.value = child.value;}}
  replaceChildren(...items) {for (const child of this.children) child.parent = null; this.children = []; this.append(...items);}
  setAttribute(key, value) {this.attributes[key] = String(value);}
  getAttribute(key) {return this.attributes[key] ?? null;}
  removeAttribute(key) {delete this.attributes[key]; if (key === 'src') delete this.src;}
  addEventListener(type, listener) {(this.listeners[type] ??= []).push(listener);}
  removeEventListener(type, listener) {this.listeners[type] = (this.listeners[type] ?? []).filter(x => x !== listener);}
  emit(type, event = {}) {for (const listener of this.listeners[type] ?? []) listener({target: this, preventDefault() {}, ...event});}
  click() {this.emit('click');}
  checkVisibility() {return this.isConnected && !this.hidden;}
  matches(selector) {if (selector === ':popover-open') return false; const match = /^\[data-([\w-]+)(?:="([^"]*)")?\]$/.exec(selector); return match ? Object.hasOwn(this.dataset, match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())) && (match[2] === undefined || this.dataset[match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] === match[2]) : this.tagName === selector;}
  querySelectorAll(selector) {return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);}
  querySelector(selector) {return this.querySelectorAll(selector)[0] ?? null;}
  contains(node) {return node === this || this.children.some(child => child.contains(node));}
  getComputedTextLength() {return this.textContent.length * 8;}
}
function dom(t) {
  const original = {document: globalThis.document, ResizeObserver: globalThis.ResizeObserver, Worker: globalThis.Worker, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout};
  const document = {baseURI: 'https://graph-fixture.invalid/', createElement: tag => new Element(tag, document), createElementNS: (_ns, tag) => new Element(tag, document)};
  const callbacks = [], workers = [];
  globalThis.document = document; globalThis.ResizeObserver = class {observe() {} disconnect() {}};
  globalThis.setTimeout = (callback, delay) => {const item = {callback, delay, cancelled: false}; callbacks.push(item); return item;}; globalThis.clearTimeout = handle => {handle.cancelled = true;};
  globalThis.Worker = class {constructor() {workers.push(this);} postMessage(request) {this.request = request;} terminate() {this.terminated = true;}};
  t.after(() => Object.assign(globalThis, original)); return {document, callbacks, workers};
}
function pane(t, extra = {}) {
  const d = dom(t), file = {path: 'A.md', extension: 'md', stat: {size: 1, mtime: 1}}, indexed = {document: {file, version: 'one'}, text: 'A', dirty: false, cache: {}}, cleanups = [], events = new Map();
  const app = {vault: {rootPath: '/graph-fixture', readOnly: false, getFiles: () => [file], getFileByPath: path => path === file.path ? file : null, on: (name, handler) => {events.set('vault:' + name, handler); return {}; }}, metadataCache: {getDocuments: () => [indexed], getDocument: path => path === file.path ? indexed : null, getIssues: () => [], on: (name, handler) => {events.set('cache:' + name, handler); return {}; }}, core: {busy: false, isEnabled: () => true, on: (name, handler) => {events.set('core:' + name, handler); return {}; }}, workspace: {sessions: new Map(), isChangingFiles: false, isChangingLayout: false, requestSaveLayout: () => Promise.resolve()}, changingVault: false};
  const view = {app, contentEl: d.document.createElement('div'), leaf: {id: 'graph-test'}, register: cleanup => cleanups.push(cleanup), registerEvent() {}, registerDomEvent: (element, type, listener) => element.addEventListener(type, listener)}; view.leaf.view = view; view.contentEl.root = true;
  const graphs = {app, id: 'graph', generation: 1, options: {}, saveOptions: async () => {throw Error('No graph preference writes were authorized in this fixture');}, ...extra};
  const current = new GraphPane(view, graphs); return {...d, current, view, app, graphs, indexed, file, events, cleanups, start() {d.callbacks.find(call => call.delay === 25 && !call.cancelled).callback(); return d.workers.at(-1);}};
}
test('real GraphPane ignores both error and deadline callbacks from retired workers while a new scene owns the pane', t => {
  const f = pane(t), old = f.start(), oldDeadline = f.callbacks.find(call => call.delay === 3000); f.current.refresh();
  const newest = f.start(); const before = f.current.status.textContent; let prevented = false;
  old.onerror({preventDefault() {prevented = true;}, message: 'retired failure'}); oldDeadline.callback();
  assert.equal(prevented, true); assert.equal(f.current.worker, newest); assert.equal(f.current.status.textContent, before); assert.equal(newest.terminated, undefined);
  newest.onmessage({data: {id: newest.request.id, data: {nodes: [node()], edges: [], warnings: []}}});
  const text = f.current.status.textContent; old.onerror({preventDefault() {}, message: 'late old failure'}); oldDeadline.callback();
  assert.equal(f.current.status.textContent, text); assert.equal(f.current.status.classList.contains('is-error'), false); assert.equal(f.current.data.nodes.length, 1);
});
for (const condition of ['root', 'disposed', 'disabled', 'view']) test('real GraphPane rejects retired callbacks after ' + condition + ' ownership changes', t => {
  const f = pane(t), worker = f.start(), deadline = f.callbacks.find(call => call.delay === 3000); const before = f.current.status.textContent;
  if (condition === 'root') f.app.vault.rootPath = '/other'; if (condition === 'disposed') f.current.disposed = true; if (condition === 'disabled') f.app.core.isEnabled = () => false; if (condition === 'view') f.view.leaf.view = {};
  worker.onerror({preventDefault() {}, message: 'obsolete'}); deadline.callback(); worker.onmessage({data: {id: worker.request.id, data: {nodes: [], edges: [], warnings: []}}}); assert.equal(f.current.status.textContent, before);
});
test('current worker errors retain an explicit failed scene and export refuses graphComplete=true error state', t => {
  const f = pane(t), worker = f.start(); worker.onerror({preventDefault() {}, message: 'owned failure'});
  assert.equal(f.current.status.dataset.graphComplete, 'true'); assert.equal(f.current.status.classList.contains('is-error'), true);
  f.current.openExport(); assert.equal(f.current.exportReview, null); assert.match(f.current.error.textContent, /completed, current graph/);
});
test('the current worker deadline still fails at the unchanged three-second bound', t => {
  const f = pane(t); f.start(); const deadline = f.callbacks.find(call => call.delay === 3000); deadline.callback(); assert.match(f.current.status.textContent, /three-second limit/); assert.equal(f.current.status.classList.contains('is-error'), true); assert.equal(f.current.worker, null);
});
test('retained reset and opacity controls cannot alter a rebuilt, unloaded or different-root pane', t => {
  const f = pane(t, {options:{colorGroups:[{query:'A',color:{a:.5,rgb:0x345678}}]}}), button = f.current.controls.querySelector('[data-graph-defaults="display"]'), opacity = f.current.controls.querySelector('[data-graph-group-opacity]');
  f.current.buildControls(); const before = JSON.stringify(f.current.options); button.click(); opacity.value = '.2'; opacity.emit('change'); assert.equal(JSON.stringify(f.current.options), before);
  const currentButton = f.current.controls.querySelector('[data-graph-defaults="display"]'); f.current.disposed = true; currentButton.click(); assert.equal(JSON.stringify(f.current.options), before);
  f.current.disposed = false; f.app.vault.rootPath = '/other'; currentButton.click(); assert.equal(JSON.stringify(f.current.options), before);
});
test('actual Reset display recovers its own invalid draft, retains valid other drafts/unknown fields, and refuses an invalid other section', async t => {
  const saved=[], f=pane(t,{options:{nodeSizeMultiplier:3,future:{retained:true},colorGroups:[{query:'A',color:{a:.25,rgb:0x345678,opaque:'keep'},opaque:'group'}]},saveOptions:async options=>saved.push(structuredClone(options))});
  f.current.controls.querySelector('[data-graph-option="nodeSizeMultiplier"]').value=''; f.current.controls.querySelector('[data-graph-option="linkDistance"]').value='400';
  f.current.controls.querySelector('[data-graph-defaults="display"]').click(); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.current.options.nodeSizeMultiplier,1);assert.equal(f.current.options.linkDistance,400);assert.deepEqual(f.current.options.future,{retained:true});assert.equal(f.current.options.colorGroups[0].color.opaque,'keep');assert.equal(saved.length,1);
  const before=structuredClone(f.current.options); f.current.controls.querySelector('[data-graph-option="nodeSizeMultiplier"]').value=''; f.current.controls.querySelector('[data-graph-option="linkDistance"]').value=''; f.current.controls.querySelector('[data-graph-defaults="display"]').click();
  assert.deepEqual(f.current.options,before);assert.equal(saved.length,1);assert.match(f.current.status.textContent,/Link distance needs a number/);
});
test('read-only complete cached scene exports with no configuration/provider calls and retires on actual pan or metadata changes', t => {
  const f = pane(t); f.app.vault.readOnly = true; const worker = f.start(); worker.onmessage({data: {id: worker.request.id, data: {nodes: [node()], edges: [], warnings: []}}});
  f.current.openExport(); const review = f.current.exportReview; assert.ok(review?.isOpen); assert.equal(review.prepared.format, 'svg'); assert.equal(review.action.disabled, false);
  f.current.camera.x++; f.current.updatePositions(); assert.equal(review.action.disabled, true); assert.match(review.error.textContent, /graph changed/); assert.equal(review.prepared, null); assert.equal(review.previewUrl, null);
  review.close(); f.current.openExport(); const fresh = f.current.exportReview; assert.equal(fresh.action.disabled, false);
  f.indexed.text = 'Changed'; fresh.download(); assert.equal(fresh.action.disabled, true); assert.equal(fresh.prepared, null); fresh.close();
});
test('cached graph refuses unindexed Markdown and dirty sessions not yet reflected in the actual index without fetching or saving', t => {
  const f = pane(t); f.app.metadataCache.getDocuments = () => []; const worker = f.start(); worker.onmessage({data: {id: worker.request.id, data: {nodes: [], edges: [], warnings: []}}}); f.current.openExport(); assert.equal(f.current.exportReview, null);
  f.app.metadataCache.getDocuments = () => [f.indexed]; f.current.refresh(); const next = f.start(); next.onmessage({data: {id: next.request.id, data: {nodes: [node()], edges: [], warnings: []}}});
  f.app.workspace.sessions.set('A.md', {text: 'Unsaved', document: f.indexed.document, dirty: true}); f.current.openExport(); assert.equal(f.current.exportReview, null); assert.match(f.current.error.textContent, /No missing files will be fetched/);
});
test('real review rejects uncommitted changed dimensions at download and releases every owned URL on close', t => {
  const d = dom(t), app = {}, frame = captureGraphExport(input()), review = new GraphExportModal(app, frame, {current: () => true, closed() {}}); review.open(); assert.equal(review.action.disabled, false);
  review.width.value = '1200'; review.download(); assert.equal(review.stale, true); assert.equal(review.previewUrl, null); assert.equal(review.prepared, null); assert.match(review.error.textContent, /Image choices changed/); review.close(); assert.equal(review.isOpen, false); assert.ok(d.document);
});

function raster(t, behavior) {
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL, urls = [], released = [], images = [], canvases = [];
  URL.createObjectURL = blob => {assert.equal(blob.type, 'image/svg+xml;charset=utf-8'); const value = 'blob:synthetic/' + urls.length; urls.push(value); return value;}; URL.revokeObjectURL = value => released.push(value); t.after(() => {URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke;});
  const doc = {createElement(tag) {if (tag === 'img') {const image = {removeAttribute() {this.cleared = true;}, set src(value) {this.source = value; behavior.load?.(this);}}; images.push(image); return image;} const canvas = {getContext() {return {drawImage(...args) {canvas.drawn = args;}};}, toBlob(callback, type) {assert.equal(type, 'image/png'); canvas.complete = callback; behavior.blob?.(canvas, callback);}}; canvases.push(canvas); return canvas;}};
  return {doc, urls, released, images, canvases};
}
test('PNG preparation passes exact dimensions to canvas, uses only its generated local SVG and releases URL/image/canvas', async t => {
  const f = raster(t, {load: image => queueMicrotask(() => image.onload()), blob: (_canvas, callback) => callback(new Blob(['known synthetic PNG'], {type: 'image/png'}))}), svg = serializeGraphExport(captureGraphExport(input()), {...settings, width: 640, height: 480});
  const blob = await rasterizeGraphExport(svg, {document: f.doc, current: () => true, signal: new AbortController().signal}); assert.equal(blob.type, 'image/png'); assert.deepEqual(f.canvases[0].drawn.slice(1), [0, 0, 640, 480]); assert.deepEqual(f.urls, f.released); assert.equal(f.images[0].cleared, true); assert.equal(f.canvases[0].width, 0); assert.equal(f.canvases[0].height, 0);
});
for (const phase of ['before-load', 'after-load', 'abort']) test('held PNG preparation refuses stale authority at ' + phase + ' and releases resources', async t => {
  const f = raster(t, {}), svg = serializeGraphExport(captureGraphExport(input()), settings), controller = new AbortController(); let current = true;
  const pending = rasterizeGraphExport(svg, {document: f.doc, current: () => current, signal: controller.signal}); const rejection = assert.rejects(pending, /review changed/);
  if (phase === 'after-load') f.images[0].onload(); current = false;
  if (phase === 'abort') controller.abort(); else if (phase === 'before-load') f.images[0].onload(); else f.canvases[0].complete(new Blob(['later'], {type: 'image/png'}));
  await rejection; assert.deepEqual(f.urls, f.released); assert.equal(f.canvases[0].width, 0); assert.equal(f.images[0].cleared, true);
});
for (const result of [null, new Blob(['wrong'], {type: 'image/jpeg'}), new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], {type: 'image/png'})]) test('PNG preparation refuses unavailable, wrong format and oversized encoded output', async t => {
  const f = raster(t, {load: image => queueMicrotask(() => image.onload()), blob: (_canvas, callback) => callback(result)});
  await assert.rejects(rasterizeGraphExport(serializeGraphExport(captureGraphExport(input()), settings), {document: f.doc, current: () => true, signal: new AbortController().signal}), /exceeds 8 MiB/); assert.deepEqual(f.urls, f.released);
});
test('PNG deadline clears its pending load and every allocated resource instead of extending preparation indefinitely', async t => {
  t.mock.timers.enable({apis:['setTimeout']}); const f = raster(t, {}), svg = serializeGraphExport(captureGraphExport(input()), settings);
  const pending = rasterizeGraphExport(svg,{document:f.doc,current:()=>true,signal:new AbortController().signal}), refusal = assert.rejects(pending,/exceeded five seconds/);
  t.mock.timers.tick(5000); await refusal; assert.deepEqual(f.urls,f.released); assert.equal(f.images[0].cleared,true); assert.equal(f.canvases[0].width,0);
});
test('a stale or already-aborted PNG review refuses before creating image/canvas or a Blob URL', async t => {
  const f=raster(t,{}), svg=serializeGraphExport(captureGraphExport(input()),settings),controller=new AbortController();controller.abort();
  await assert.rejects(rasterizeGraphExport(svg,{document:f.doc,current:()=>false,signal:controller.signal}),/review is stale/); assert.equal(f.urls.length,0);assert.equal(f.images.length,0);assert.equal(f.canvases.length,0);
});
