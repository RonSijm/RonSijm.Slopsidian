import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EditorState, EditorSelection } from "@codemirror/state";
import { history, undo, redo } from "@codemirror/commands";
import { errorLogStub } from "./error-log-stub.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let temporary, feature, decorateReadingTaskLabel;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  temporary = await mkdtemp(join(root, ".runtime", "reading-tasks-tests-"));
  const output = join(temporary, "tasks.mjs");
  await build({ stdin: { contents: 'export * from "./client/reading-tasks"; export {parseMarkdown} from "./client/markdown"; export {Editor} from "./client/editor";', resolveDir: root, loader: "ts" }, outfile: output, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent", plugins: [errorLogStub] });
  feature = await import(pathToFileURL(output).href);
  const labels = join(temporary, "labels.mjs");
  await build({ stdin: { contents: 'export {decorateReadingTaskLabel} from "./client/reading";', resolveDir: root }, outfile: labels, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent", plugins: [errorLogStub, { name: "reading-label-dom", setup(builder) {
    builder.onResolve({ filter: /^(?:dompurify|\.\/(?:dom|icons|callout-styles|mermaid-renderer|note-embed|plugin))$/ }, args => ({ path: args.path, namespace: "reading-label-dom" }));
    builder.onLoad({ filter: /.*/, namespace: "reading-label-dom" }, args => ({ contents: {
      dompurify: "export default {};", "./dom": "export const reportError=error=>{throw error};", "./icons": "export const icon=()=>null;",
      "./callout-styles": "export const observeCalloutStyles=()=>()=>{};", "./mermaid-renderer": "export const mountMermaid=()=>()=>{};",
      "./note-embed": "export class NoteEmbed{};export const newEmbedScope=()=>({depth:0,chain:[],budget:{used:0}});",
      "./plugin": "export class Component{};export class MarkdownRenderChild extends Component{};",
    }[args.path] }));
  } }] });
  ({ decorateReadingTaskLabel } = await import(pathToFileURL(labels).href));
});
after(async () => {
  if (temporary) { assert.match(relative(root, temporary).replaceAll("\\", "/"), /^\.runtime\/reading-tasks-tests-[^/]+$/); await rm(temporary, { recursive: true }); }
});

const original = '- [ ] Parent λ\r\n  - [x] Child 😀\r\n- [X] Other\r\n1. [ ] Ordered\r\n\r\n> - [ ] Quoted\r\n\r\n```md\r\n- [ ] Literal\r\n```\r\n';
function fixture(source = original) {
  const observers = [], document = { activeElement: null, defaultView: { MutationObserver: class {
    constructor(callback) { this.callback = callback; this.targets = new Map(); observers.push(this); }
    observe(target, options) { this.targets.set(target, options); }
    disconnect() { this.disconnected = true; }
  } } };
  const element = (tag, line, classes = []) => ({
    tagName: tag.toUpperCase(), ownerDocument: document, parentElement: null, children: [], dataset: line === undefined ? {} : { sourceLine: String(line) }, attributes: {}, listeners: new Map(), classes: new Set(classes),
    get isConnected() { return this.isRoot || Boolean(this.parentElement?.isConnected); }, get firstElementChild() { return this.children[0] ?? null; }, get childElementCount() { return this.children.length; },
    get classList() { return { contains: value => this.classes.has(value), add: value => this.classes.add(value), remove: value => this.classes.delete(value) }; },
    matches(selector) { return selector === "button.reading-list-fold-toggle" && this.tagName === "BUTTON" && this.classes.has("reading-list-fold-toggle"); },
    contains(node) { for (let item = node; item; item = item.parentElement) { if (item === this) { return true; } } return false; },
    checkVisibility() { for (let item = this; item; item = item.parentElement) { if (Object.hasOwn(item.attributes, "hidden") || item.cssHidden) { return false; } } return this.isConnected; },
    getBoundingClientRect() { return { width: this.zeroSize ? 0 : 20, height: this.zeroSize ? 0 : 20 }; },
    append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); } },
    prepend(child) { child.remove(); child.parentElement = this; this.children.unshift(child); },
    remove() { if (this.parentElement) { const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this), 1); this.parentElement = null; } },
    getElementsByTagName(tag) { const found = [], wanted = tag.toUpperCase(); const visit = node => { for (const child of node.children) { if (child.tagName === wanted) { found.push(child); } visit(child); } }; visit(this); return found; },
    getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }, setAttribute(name, value) { this.attributes[name] = String(value); }, removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(name, callback) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]); }, removeEventListener(name, callback) { this.listeners.set(name, (this.listeners.get(name) ?? []).filter(value => value !== callback)); },
    change() { for (const callback of [...(this.listeners.get("change") ?? [])]) { callback({ type: "change", target: this }); } },
    focus() { if (this.isConnected && !this.disabled) { document.activeElement = this; } },
  });
  const root = element("div"), section = element("div"); root.isRoot = true; root.append(section);
  const input = checked => Object.assign(element("input"), { type: "checkbox", disabled: true, checked, indeterminate: false });
  const task = (list, line, checked, loose = false) => { const item = element("li", line, ["task-list-item"]), box = input(checked), p = loose ? element("p", line) : item; if (loose) { item.append(p); } p.append(box); list.append(item); return { item, input: box, container: p }; };
  const list = element("ul", 0); section.append(list);
  const parent = task(list, 0, false), nested = element("ul", 1); parent.item.append(nested);
  const child = task(nested, 1, true), other = task(list, 2, true), orderedList = element("ol", 3); section.append(orderedList);
  const ordered = task(orderedList, 3, false, true), quote = element("blockquote", 5), quotedList = element("ul", 5); section.append(quote); quote.append(quotedList);
  const quoted = task(quotedList, 5, false);
  const metadata = feature.parseMarkdown(source).listItems;
  const capture = () => feature.captureReadingTasks(section, source, metadata);
  let current = true, writable = true, value = source, commits = [], controller;
  const context = { current: () => current && value === source, writable: () => writable, commit: plan => { commits.push(plan); value = plan.source.slice(0, plan.from) + plan.insert + plan.source.slice(plan.to); return true; } };
  const mount = (inventory = capture(), custom = context) => controller = new feature.ReadingTasks(root, section, inventory, custom);
  return { document, root, section, element, input, list, nested, parent, child, other, ordered, orderedList, quote, quoted, metadata, source, capture, context, mount, observers,
    current(value) { current = value; }, writable(value) { writable = value; }, value: () => value, replaceSource(text) { value = text; }, commits: () => commits, controller: () => controller };
}

test("original tight/nested/ordered/loose tasks get exact source ownership while quoted and literal tasks are excluded", () => {
  const f = fixture(), inventory = f.capture();
  assert.equal(inventory.message, null); assert.deepEqual(inventory.tasks.map(value => [value.line, value.checked]), [[0, false], [1, true], [2, true], [3, false]]);
  for (const task of inventory.tasks) { assert.equal(original.slice(task.from - 1, task.from + 2), task.checked ? task.line === 2 ? "[X]" : "[x]" : "[ ]"); }
  const view = f.mount(inventory); for (const task of [f.parent, f.child, f.other, f.ordered]) { assert.equal(task.input.disabled, false); assert.ok(task.input.getAttribute("aria-label")); }
  assert.equal(f.quoted.input.disabled, true); assert.equal(f.quoted.input.dataset.readingTaskLine, undefined); view.dispose();
});

test("one source marker changes and all surrounding CRLF/Unicode text plus uppercase Undo source stay exact", () => {
  const f = fixture(), inventory = f.capture();
  for (const task of inventory.tasks) {
    const plan = feature.planReadingTaskToggle(original, task, !task.checked, true); assert.equal(plan.from, task.from); assert.equal(plan.to, task.from + 1); assert.equal(plan.line, task.line); assert.equal(plan.focus, true);
    const next = original.slice(0, plan.from) + plan.insert + original.slice(plan.to);
    assert.equal(next.length, original.length); assert.equal(next.slice(0, task.from), original.slice(0, task.from)); assert.equal(next.slice(task.from + 1), original.slice(task.from + 1));
  }
  const view = f.mount(inventory); f.parent.input.focus(); f.parent.input.checked = true; f.parent.input.change();
  assert.equal(f.commits().length, 1); assert.equal(f.commits()[0].focus, true); assert.equal(f.value(), original.replace("- [ ] Parent λ", "- [x] Parent λ")); assert.equal(view.isDisposed, true);
  assert.equal(view.setChecked(0, false), false); assert.equal(f.commits().length, 1);
});

test("newline forms retain exact raw marker offsets, plans preserve a BOM, and bounded labels do not split Unicode pairs", () => {
  for (const separator of ["\n", "\r\n"]) {
    const source = original.replaceAll("\r\n", separator), f = fixture(source), inventory = f.capture();
    assert.equal(inventory.tasks.length, 4, JSON.stringify(separator));
    for (const task of inventory.tasks) { const plan = feature.planReadingTaskToggle(source, task, !task.checked); assert.ok(plan); assert.equal(source[plan.from - 1], "["); assert.equal(source[plan.to], "]"); }
  }
  const classic = fixture(original.replaceAll("\r\n", "\r")).capture(); assert.ok(classic.message); assert.equal(classic.tasks.length, 0);
  const first = fixture().capture().tasks[0], withBom = "\ufeff" + original, plan = feature.planReadingTaskToggle(withBom, { ...first, from: first.from + 1 }, true);
  assert.equal(plan.source[0], "\ufeff"); assert.equal(withBom.slice(0, plan.from) + plan.insert + withBom.slice(plan.to), "\ufeff" + original.replace("- [ ] Parent λ", "- [x] Parent λ"));
  const source = original.replace("Parent λ", "a".repeat(159) + "😀" + "z".repeat(100)), inventory = fixture(source).capture(), task = inventory.tasks.find(value => value.line === 0);
  assert.equal(Array.from(task.label).length, 160); assert.ok(task.label.endsWith("😀")); assert.equal(/[\uD800-\uDFFF]/u.test(task.label), false);
});

test("real Editor.replaceExpected isolates each task change in CodeMirror history and preserves every selection and CRLF", () => {
  const f = fixture(), state = EditorState.create({ doc: original, selection: EditorSelection.create([EditorSelection.range(0, 1), EditorSelection.cursor(12)]), extensions: [history(), EditorState.allowMultipleSelections.of(true), EditorState.lineSeparator.of("\r\n")] });
  const cm = { state, dispatch(spec) { this.state = (spec.startState ? spec : this.state.update(spec)).state; } }; cm.dispatch = cm.dispatch.bind(cm);
  const editor = Object.assign(Object.create(feature.Editor.prototype), { cm }), before = cm.state.selection;
  const task = f.capture().tasks.find(value => value.line === 2), plan = feature.planReadingTaskToggle(original, task, false);
  editor.replaceExpected(plan.source, plan.from, plan.to, plan.insert, "input.reading-task");
  assert.equal(editor.getValue(), original.replace("- [X] Other", "- [ ] Other")); assert.equal(cm.state.selection.eq(before), true);
  assert.equal(undo(cm), true); assert.equal(editor.getValue(), original); assert.equal(redo(cm), true); assert.equal(editor.getValue(), original.replace("- [X] Other", "- [ ] Other"));
  assert.throws(() => editor.replaceExpected(original, plan.from, plan.to, "x", "input.reading-task"), /changed/);
});

test("read-only, inactive, changed-source and composing/locked context refusals restore native checked state without dispatch", () => {
  for (const invalidate of [f => f.writable(false), f => f.current(false), f => f.replaceSource(original + "new"), f => { f.context.writable = () => false; }]) {
    const f = fixture(), view = f.mount(); invalidate(f); f.parent.input.checked = true; f.parent.input.change();
    assert.equal(f.parent.input.checked, false); assert.equal(f.commits().length, 0); assert.equal(view.setChecked(0, true), false);
  }
  const f = fixture(); f.writable(false); const view = f.mount(); assert.equal(f.parent.input.disabled, true);
  f.parent.input.disabled = false; f.parent.input.checked = true; f.parent.input.change(); assert.equal(f.parent.input.checked, false); assert.equal(f.value(), original); view.dispose();
});

test("startup refresh enables a current loaded pane without reconstructing any task nodes", () => {
  const f = fixture(); f.current(false); const view = f.mount(), originalInput = f.parent.input;
  assert.equal(originalInput.disabled, true); f.current(true); view.refresh(); assert.equal(originalInput.disabled, false); assert.equal(f.parent.input, originalInput);
  f.writable(false); view.refresh(); assert.equal(originalInput.disabled, true); f.writable(true); view.refresh(); assert.equal(view.focusTask(0), true); assert.equal(f.document.activeElement, originalInput);
  f.current(false); assert.equal(view.focusTask(1), false); view.dispose();
});

test("folded/hidden/background and zero-size inputs refuse synthetic actions but become usable after visibility returns", () => {
  for (const hide of [f => f.list.setAttribute("hidden", ""), f => { f.root.cssHidden = true; }, f => { f.parent.input.zeroSize = true; }]) {
    const f = fixture(), view = f.mount(); hide(f); f.parent.input.checked = true; f.parent.input.change();
    assert.equal(f.parent.input.checked, false); assert.equal(f.commits().length, 0); assert.equal(view.focusTask(0), false); assert.equal(view.isDisposed, false);
    f.list.removeAttribute("hidden"); f.root.cssHidden = false; f.parent.input.zeroSize = false;
    assert.equal(view.focusTask(0), true); f.parent.input.checked = true; f.parent.input.change(); assert.equal(f.commits().length, 1);
  }
});

test("pre-install reorder and later source-map, document, or owner topology changes retire task editing", () => {
  const pre = fixture(), inventory = pre.capture(); pre.list.children.reverse(); const refused = pre.mount(inventory); assert.equal(refused.isDisposed, true); assert.equal(pre.parent.input.disabled, true);
  for (const mutate of [f => f.list.children.reverse(), f => { f.parent.item.dataset.sourceLine = "1"; }, f => { f.root.ownerDocument = {}; }, f => f.section.remove(), f => f.parent.input.remove()]) {
    const f = fixture(), view = f.mount(); mutate(f); f.observers[0].callback(); assert.equal(view.isDisposed, true); assert.equal(f.parent.input.disabled, true); assert.equal(f.commits().length, 0);
  }
});

test("independent original top-level list roots retain their capture order and source mapping before installation and held actions", () => {
  for (const mutate of [f => f.section.children.reverse(), f => { f.orderedList.dataset.sourceLine = "999"; }, f => f.orderedList.remove()]) {
    const f = fixture(), inventory = f.capture(); mutate(f); const view = f.mount(inventory); assert.equal(view.isDisposed, true); assert.equal(f.parent.input.disabled, true); assert.equal(f.commits().length, 0);
    const g = fixture(), active = g.mount(); mutate(g); assert.equal(active.setChecked(0, true), false); assert.equal(active.isDisposed, true); assert.equal(g.parent.input.disabled, true); assert.equal(g.commits().length, 0);
  }
});

test("action checks reject changes before observer delivery and never acquire a replacement/plugin-created input", () => {
  const f = fixture(), inventory = f.capture(), replacement = f.input(false); f.parent.input.remove(); f.parent.container.prepend(replacement);
  const view = f.mount(inventory); assert.equal(replacement.disabled, true); assert.equal(view.setChecked(0, true), false); assert.equal(f.commits().length, 0);
  const second = fixture(), active = second.mount(); second.parent.input.type = "text"; assert.equal(active.setChecked(0, true), false); assert.equal(active.isDisposed, true); assert.equal(second.commits().length, 0);
});

test("owned list-fold buttons and harmless trailing plugin adornments preserve original task identity", () => {
  const f = fixture(), inventory = f.capture(), toggle = f.element("button", undefined, ["reading-list-fold-toggle"]), plugin = f.element("span");
  f.parent.item.prepend(toggle); f.parent.item.append(plugin); const view = f.mount(inventory), input = f.parent.input;
  assert.equal(view.isDisposed, false); assert.equal(input.disabled, false); assert.equal(view.focusTask(0), true); f.observers[0].callback(); assert.equal(view.isDisposed, false);
  assert.equal(f.parent.item.children.includes(toggle), true); assert.equal(f.parent.item.children.includes(plugin), true); view.dispose(); assert.equal(f.parent.item.children.includes(toggle), true); assert.equal(f.parent.item.children.includes(plugin), true);
});

test("unknown leading adornments and duplicate raw/HTML checkboxes cannot borrow a task's source proof", () => {
  for (const mutate of [f => f.parent.item.prepend(f.element("button")), f => f.parent.item.append(f.input(false)), f => { f.parent.input.checked = true; }, f => { f.parent.input.indeterminate = true; }]) {
    const f = fixture(); mutate(f); const inventory = f.capture(); assert.equal(inventory.tasks.some(task => task.line === 0), false); const view = f.mount(inventory); assert.equal(f.parent.input.disabled, true); view.dispose();
  }
});

test("malformed task syntax and mismatched cached task states cannot enable a plausible DOM checkbox", () => {
  for (const replacement of ["- [ ]No space", "- [y] Parent λ", "- [] Parent λ", "- [  ] Parent λ"]) {
    const f = fixture(original.replace("- [ ] Parent λ", replacement));
    assert.equal(f.capture().tasks.some(task => task.line === 0), false);
  }
  const f = fixture(); f.metadata[0].task = "x"; assert.equal(f.capture().tasks.some(task => task.line === 0), false);
  const view = fixture().mount(); assert.equal(view.setChecked(0, false), false); assert.equal(view.setChecked(-1, true), false); view.dispose();
});

test("failed commits and reentrant change handlers cannot manufacture duplicate edits or lose native checkbox state", () => {
  const f = fixture(); let attempts = 0, view;
  view = f.mount(f.capture(), { ...f.context, commit(plan) { attempts++; assert.equal(view.setChecked(plan.line, plan.checked), false); return false; } });
  f.parent.input.checked = true; f.parent.input.change(); assert.equal(attempts, 1); assert.equal(f.parent.input.checked, false); assert.equal(view.isDisposed, false); assert.equal(f.parent.input.disabled, false);
  const errors = [], g = fixture(), error = new Error("dispatch refused"); const failed = g.mount(g.capture(), { ...g.context, commit() { throw error; }, onError(value) { errors.push(value); } });
  g.parent.input.checked = true; g.parent.input.change(); assert.deepEqual(errors, [error]); assert.equal(g.parent.input.checked, false); assert.equal(failed.isDisposed, false);
});

test("dispose removes only owned labels/data/listeners and makes held native controls disabled", () => {
  const f = fixture(); f.parent.input.setAttribute("aria-label", "Original accessible text"); const view = f.mount();
  f.child.input.setAttribute("aria-label", "Plugin replacement label"); view.dispose(); view.dispose();
  assert.equal(f.parent.input.getAttribute("aria-label"), "Original accessible text"); assert.equal(f.child.input.getAttribute("aria-label"), "Plugin replacement label");
  assert.equal(f.parent.input.dataset.readingTaskLine, undefined); assert.equal(f.parent.input.disabled, true); assert.equal(f.parent.input.listeners.get("change").length, 0); assert.equal(view.focusTask(0), false);
});

test("malformed/duplicate metadata, oversized raw source/lines/items and excessive depth decline before control installation", () => {
  const f = fixture();
  assert.ok(feature.captureReadingTasks(f.section, "x".repeat(feature.MAX_READING_TASK_SOURCE + 1), []).message);
  assert.ok(feature.captureReadingTasks(f.section, "\n".repeat(feature.MAX_READING_TASK_LINES), []).message);
  assert.ok(feature.captureReadingTasks(f.section, original, new Array(feature.MAX_READING_TASK_ITEMS + 1)).message);
  const duplicate = feature.captureReadingTasks(f.section, original, [...f.metadata, f.metadata[0]]); assert.equal(duplicate.tasks.some(task => task.line === 0), false);
  const bad = f.metadata.map(item => ({ ...item, position: { start: { ...item.position.start, offset: -1 }, end: item.position.end } })); assert.equal(feature.captureReadingTasks(f.section, original, bad).tasks.length, 0);
  let parent = f.parent.item; for (let depth = 0; depth < 40; depth++) { const list = f.element("ul"), item = f.element("li", 0); parent.append(list); list.append(item); parent = item; } const input = f.input(false); parent.append(input);
  assert.equal(feature.captureReadingTasks(f.section, original, f.metadata).tasks.some(task => task.input === input), false);
  assert.equal(feature.planReadingTaskToggle(original, { from: 0, line: 0, checked: false }, true), null); assert.equal(feature.planReadingTaskToggle(original, { from: original.indexOf("[ ]") + 1, line: 0, checked: true }, false), null);
});

function labelDom() {
  const document = {};
  const sibling = node => node.parentElement?.childNodes[node.parentElement.childNodes.indexOf(node) + 1] ?? null;
  const text = value => ({ nodeType: 3, textContent: value, parentElement: null, get nextSibling() { return sibling(this); }, remove() { if (this.parentElement) { this.parentElement.childNodes.splice(this.parentElement.childNodes.indexOf(this), 1); this.parentElement = null; } } });
  const element = (tag, line) => ({ nodeType: 1, tagName: tag.toUpperCase(), ownerDocument: document, parentElement: null, childNodes: [], dataset: line === undefined ? {} : { sourceLine: String(line) }, classes: new Set(),
    get children() { return this.childNodes.filter(child => child.nodeType === 1); }, get childElementCount() { return this.children.length; }, get firstElementChild() { return this.children[0] ?? null; },
    get nextSibling() { return sibling(this); }, get textContent() { return this.childNodes.map(child => child.textContent).join(""); },
    get classList() { return { contains: name => this.classes.has(name) }; }, set className(value) { this.classes = new Set(value.split(" ")); },
    matches(selector) { return selector === "button.reading-list-fold-toggle" && this.tagName === "BUTTON" && this.classes.has("reading-list-fold-toggle"); },
    getElementsByTagName(tag) { const result = []; for (const child of this.children) { if (child.tagName === tag.toUpperCase()) result.push(child); result.push(...child.getElementsByTagName(tag)); } return result; },
    querySelector(selector) { const selectors = selector.split(","); for (const child of this.children) { if (selectors.some(part => part[0] === "." ? child.classes.has(part.slice(1)) : part === "img[data-slopsidian-src]" ? child.tagName === "IMG" && child.dataset.slopsidianSrc !== undefined : child.tagName === part.toUpperCase())) return child; const found = child.querySelector(selector); if (found) return found; } return null; },
    insertBefore(node, before) { node.remove(); const index = this.childNodes.indexOf(before); assert.ok(index >= 0); this.childNodes.splice(index, 0, node); node.parentElement = this; },
    appendChild(node) { node.remove(); this.childNodes.push(node); node.parentElement = this; return node; }, append(...nodes) { for (const node of nodes) this.appendChild(node); },
    remove() { if (this.parentElement) { this.parentElement.childNodes.splice(this.parentElement.childNodes.indexOf(this), 1); this.parentElement = null; } },
  });
  document.createElement = tag => element(tag); document.createTextNode = text;
  const inline = (tag, value) => { const node = element(tag); node.append(text(value)); return node; };
  const checkbox = checked => Object.assign(element("input"), { type: "checkbox", checked, disabled: true, indeterminate: false });
  return { document, element, text, inline, checkbox };
}

test("own Reading label styling retains original tight/loose inline, checkbox/list/prose identities and raw task offsets", () => {
  for (const separator of ["\n", "\r\n"]) {
    const d = labelDom(), source = ['- [x] Parent **bold λ** *em 😀* `code Ω` [[Other]]', '  - [ ] Child plain', '    1. [X] Ordered checked', '  - Ordinary **prose**', '- [ ] Loose *parent*', '', '  Continuation prose.', ''].join(separator);
    const section = d.element("div"), list = d.element("ul", 0), parent = d.element("li", 0), input = d.checkbox(true), childList = d.element("ul", 1), child = d.element("li", 1), childInput = d.checkbox(false), ordered = d.element("ol", 2), grand = d.element("li", 2), grandInput = d.checkbox(true), ordinary = d.element("li", 3), loose = d.element("li", 4), p = d.element("p", 4), looseInput = d.checkbox(false), continuation = d.element("p", 6);
    const bold = d.inline("strong", "bold λ"), em = d.inline("em", "em 😀"), code = d.inline("code", "code Ω"), link = d.inline("a", "Other"), looseEm = d.inline("em", "parent");
    parent.append(input, d.text(" Parent "), bold, d.text(" "), em, d.text(" "), code, d.text(" "), link, childList); childList.append(child, ordinary); child.append(childInput, d.text(" Child plain"), ordered); ordered.append(grand); grand.append(grandInput, d.text(" Ordered checked")); ordinary.append(d.text("Ordinary "), d.inline("strong", "prose"));
    p.append(looseInput, d.text(" Loose "), looseEm); continuation.append(d.text("Continuation prose.")); loose.append(p, continuation); list.append(parent, loose); section.append(list);
    const metadata = feature.parseMarkdown(source).listItems, before = feature.captureReadingTasks(section, source, metadata), originalText = section.textContent;
    assert.equal(before.tasks.length, 4);
    for (const [box, item] of [[input, parent], [childInput, child], [grandInput, grand], [looseInput, loose]]) decorateReadingTaskLabel(box, item);
    const label = parent.children.find(node => node.classes.has("reading-task-label")), looseLabel = p.children.find(node => node.classes.has("reading-task-label"));
    assert.ok(label && looseLabel); assert.equal(input.parentElement, parent); assert.equal(parent.firstElementChild, input); assert.equal(looseInput.parentElement, p); assert.equal(p.firstElementChild, looseInput);
    assert.equal(childList.parentElement, parent); assert.equal(ordered.parentElement, child); assert.equal(continuation.parentElement, loose); assert.equal(continuation.firstElementChild, null);
    for (const node of [bold, em, code, link]) assert.equal(node.parentElement, label); assert.equal(looseEm.parentElement, looseLabel);
    assert.equal(ordinary.children.some(node => node.classes.has("reading-task-label")), false); assert.equal(section.textContent, originalText); assert.equal(label.textContent, " Parent bold λ em 😀 code Ω Other");
    const after = feature.captureReadingTasks(section, source, metadata); assert.deepEqual(after.tasks.map(task => [task.input, task.item, task.container, task.line, task.from, task.checked]), before.tasks.map(task => [task.input, task.item, task.container, task.line, task.from, task.checked]));
    for (const task of after.tasks) { const plan = feature.planReadingTaskToggle(source, task, !task.checked); assert.ok(plan); assert.equal(source.slice(plan.from - 1, plan.to + 1), task.checked ? task.line === 2 ? "[X]" : "[x]" : "[ ]"); assert.equal(task.input.disabled, true); }
    const originalNodes = [...parent.childNodes], labelNodes = [...label.childNodes]; decorateReadingTaskLabel(input, parent); assert.deepEqual(parent.childNodes, originalNodes); assert.deepEqual(label.childNodes, labelNodes);
  }
});

test("task labels do not own inline note embeds, foreign nested blocks or continuation prose", () => {
  const d = labelDom(), item = d.element("li"), input = d.checkbox(true), embed = d.element("span"), nestedList = d.element("ul"), embeddedTask = d.element("li"), embeddedInput = d.checkbox(false), foreign = d.element("span"), foreignList = d.element("ol"), continuation = d.element("p"), explicit = d.inline("del", "explicit deletion");
  embed.className = "internal-embed"; embeddedTask.append(embeddedInput, d.text(" Independent embedded task")); nestedList.append(embeddedTask); embed.append(nestedList); foreign.append(foreignList); continuation.append(d.text("Parent continuation stays ordinary."));
  item.append(input, d.text(" Before "), explicit, embed, d.text(" After embed "), foreign, d.text(" After foreign "), continuation); const original = item.textContent;
  decorateReadingTaskLabel(input, item); decorateReadingTaskLabel(embeddedInput, embeddedTask);
  assert.equal(embed.parentElement, item); assert.equal(foreign.parentElement, item); assert.equal(nestedList.parentElement, embed); assert.equal(foreignList.parentElement, foreign); assert.equal(continuation.parentElement, item);
  assert.equal(explicit.parentElement.classes.has("reading-task-label"), true); assert.equal(embeddedTask.children.find(node => node.classes.has("reading-task-label")).textContent, " Independent embedded task");
  assert.equal(item.children.filter(node => node.classes.has("reading-task-label")).length, 3); assert.equal(item.textContent, original); assert.equal(input.disabled, true); assert.equal(embeddedInput.disabled, true);
  const unmapped = d.element("li"), first = d.inline("em", "prefix"), lateInput = d.checkbox(true); unmapped.append(first, lateInput, d.text(" suffix")); decorateReadingTaskLabel(lateInput, unmapped); assert.equal(unmapped.children.some(node => node.classes.has("reading-task-label")), false);
});

test("direct/nested/unresolved Markdown URI images retain their original ownership and future embed hosts outside completion labels", () => {
  for (const href of ["Embedded.md", "Embedded.md#Part", "Missing.md"]) for (const wrapper of [null, "a", "span"]) {
    const d = labelDom(), item = d.element("li"), input = d.checkbox(true), image = d.element("img"), inline = wrapper ? d.element(wrapper) : image;
    image.dataset.slopsidianSrc = href; if (wrapper) inline.append(image);
    item.append(input, d.text("Before URI "), inline, d.text(" After URI")); const text = item.textContent, originalImageParent = image.parentElement;
    const withinLabel = node => { for (let parent = node.parentElement; parent; parent = parent.parentElement) if (parent.classes.has("reading-task-label")) return true; return false; };
    decorateReadingTaskLabel(input, item);
    assert.equal(inline.parentElement, item); assert.equal(image.parentElement, wrapper ? originalImageParent : item); assert.equal(withinLabel(image), false); assert.equal(item.textContent, text);
    assert.equal(item.firstElementChild, input); assert.equal(item.children.filter(node => node.classes.has("reading-task-label")).length, 2);
    // Reading later resolves this original IMG to a note or unresolved host in
    // place. No wrapper created above may become a completion-style ancestor.
    const host = d.element("div"); host.className = href === "Missing.md" ? "markdown-embed is-unresolved" : "markdown-embed";
    image.parentElement.insertBefore(host, image); image.remove();
    assert.equal(host.parentElement, wrapper ? inline : item); assert.equal(withinLabel(host), false); assert.equal(input.disabled, true);
  }
});
