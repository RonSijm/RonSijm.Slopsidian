import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { build } from "esbuild";

// Only the supplied document/event/clock boundary is modelled. The actual module
// supplies placement, delegation, ownership and disposal; no app is launched.
const bundle = await build({ entryPoints: ["client/tooltips.ts"], bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent" });
const { tooltipPosition, installTooltips } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const installed = new Set();
const install = doc => { const api = installTooltips(doc); installed.add(api); return api; };
afterEach(() => { for (const api of installed) api.dispose(); installed.clear(); });

class Surface {
  listeners = new Map();
  addEventListener(name, callback, options = {}) {
    const entry = { callback, signal: options.signal, once: options.once };
    const list = this.listeners.get(name) ?? []; list.push(entry); this.listeners.set(name, list);
  }
  fire(name, event = {}) {
    event.target ??= this;
    for (const entry of [...this.listeners.get(name) ?? []]) {
      if (entry.signal?.aborted) continue;
      if (entry.once) this.listeners.set(name, this.listeners.get(name).filter(candidate => candidate !== entry));
      entry.callback(event);
    }
  }
  activeListeners() { return [...this.listeners.values()].flat().filter(entry => !entry.signal?.aborted).length; }
}
class ModelNode {}
class Element extends ModelNode {
  parentElement = null; children = []; attributes = new Map(); style = {}; className = ""; textContent = ""; focusCalls = 0;
  constructor(tag, doc) { super(); this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.rect = { left: 40, right: 80, top: 50, bottom: 70, width: 40, height: 20 }; }
  get isConnected() { return this === this.ownerDocument.body || Boolean(this.parentElement?.isConnected); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  adopt(doc) { this.ownerDocument = doc; for (const child of this.children) child.adopt(doc); }
  append(...children) { for (const child of children) { child.remove(); child.parentElement = this; child.adopt(this.ownerDocument); this.children.push(child); this.ownerDocument.queueMutation(); } }
  remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.ownerDocument.queueMutation(); } this.parentElement = null; }
  matches(selector) {
    return selector.split(",").some(part => {
      const tag = /^\s*([a-z]+)/i.exec(part)?.[1]; if (tag && this.tagName !== tag.toUpperCase()) return false;
      const cls = /\.([\w-]+)/.exec(part)?.[1]; if (cls && !this.className.split(/\s+/).includes(cls)) return false;
      const attribute = /\[([\w-]+)\]/.exec(part)?.[1]; if (attribute && !this.hasAttribute(attribute)) return false;
      return true;
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  getBoundingClientRect() { return this.className === "tooltip" ? { left: 0, top: 0, ...this.ownerDocument.tipSize } : this.rect; }
  focus() { this.focusCalls++; this.ownerDocument.activeElement = this; }
}
class HTMLElement extends Element {}
class PointerEvent {
  constructor(target, type = "mouse") { this.target = target; this.pointerType = type; }
}
function fixture() {
  const doc = Object.assign(new Surface(), {
    hidden: false, tipSize: { width: 160, height: 32 }, observers: new Set(), pendingMutations: new Set(),
    createElement(tag) { return new HTMLElement(tag, this); },
    queueMutation() { for (const observer of this.observers) this.pendingMutations.add(observer); },
    flushMutations() { while (this.pendingMutations.size) { const pending = [...this.pendingMutations]; this.pendingMutations.clear(); for (const observer of pending) if (this.observers.has(observer)) observer.callback(); } },
  });
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.document = null; this.disconnects = 0; }
    observe(document, options) { this.document = document; this.options = options; document.observers.add(this); }
    disconnect() { this.disconnects++; this.document?.observers.delete(this); this.document?.pendingMutations.delete(this); }
  }
  const timers = new Map(); let now = 0, sequence = 0;
  const win = Object.assign(new Surface(), {
    document: doc, HTMLElement, Element, Node: ModelNode, PointerEvent, MutationObserver, innerWidth: 800, innerHeight: 600, timers,
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    tick(ms) {
      const end = now + ms;
      for (;;) { const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; now = next[1].at; timers.delete(next[0]); next[1].callback(); }
      now = end;
    },
  });
  doc.defaultView = win; doc.body = doc.createElement("body"); doc.activeElement = doc.body;
  const all = node => node.children.flatMap(child => [child, ...all(child)]);
  const tips = () => all(doc.body).filter(node => node.getAttribute("role") === "tooltip");
  const control = (label, attributes = {}) => {
    const node = doc.createElement("button"); if (label !== null) node.setAttribute("title", label);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    doc.body.append(node); return node;
  };
  return { doc, win, control, tips, over: target => doc.fire("pointerover", new PointerEvent(target)), focus: target => { target.focus(); doc.fire("focusin", { target }); } };
}

test("tooltip geometry centers below, flips above and keeps fitting boxes inside both viewport edges", () => {
  assert.deepEqual(tooltipPosition({ left: 100, right: 140, top: 40, bottom: 60 }, 80, 30, 800, 600), { left: 80, top: 68 });
  assert.deepEqual(tooltipPosition({ left: 2, right: 18, top: 20, bottom: 40 }, 160, 32, 800, 600), { left: 8, top: 48 });
  assert.deepEqual(tooltipPosition({ left: 750, right: 790, top: 550, bottom: 580 }, 120, 60, 800, 600), { left: 672, top: 482 });
  for (const anchor of [{ left: 0, right: 20, top: 0, bottom: 20 }, { left: 350, right: 360, top: 180, bottom: 200 }]) {
    const result = tooltipPosition(anchor, 200, 40, 360, 200); assert.ok(result.left >= 8 && result.left + 200 <= 352); assert.ok(result.top >= 8 && result.top + 40 <= 192);
  }
});

test("delegated hover shows after 500ms, suppresses/restores native title and never moves focus", () => {
  const f = fixture(), target = f.control("Open <literal> & note"), api = install(f.doc);
  assert.equal(install(f.doc), api); f.over(target); assert.equal(target.hasAttribute("title"), false); f.win.tick(499); assert.equal(f.tips().length, 0);
  f.win.tick(1); const tip = f.tips()[0]; assert.equal(tip.textContent, "Open <literal> & note"); assert.equal(tip.children.length, 0); assert.equal(f.doc.activeElement, f.doc.body); assert.equal(target.focusCalls, 0);
  assert.deepEqual(tip.style, { left: "8px", top: "78px" }); assert.ok(target.getAttribute("aria-describedby").includes(tip.id));
  api.hide(); assert.equal(f.tips().length, 0); assert.equal(target.getAttribute("title"), "Open <literal> & note"); assert.equal(target.getAttribute("aria-describedby"), null);
});

test("focus shows immediately and tooltip data/ARIA labels remain literal with explicit empty suppression", () => {
  const f = fixture(); install(f.doc);
  const target = f.control("Native title", { "data-tooltip": "<script>literal</script>" }); f.focus(target);
  assert.equal(f.tips()[0].textContent, "<script>literal</script>"); assert.equal(f.win.timers.size, 0); assert.equal(f.doc.activeElement, target); assert.equal(target.focusCalls, 1);
  f.doc.fire("keydown", { target, key: "Escape" }); assert.equal(target.getAttribute("title"), "Native title");
  const aria = f.control(null, { "aria-label": "Icon action" }); aria.className = "clickable-icon"; f.focus(aria); assert.equal(f.tips()[0].textContent, "Icon action");
  const empty = f.control("Keep native title", { "data-tooltip": "" }); f.focus(empty); assert.equal(f.tips().length, 0); assert.equal(empty.getAttribute("title"), "Keep native title");
});

test("SVG descendants delegate to their control while internal pointer transitions keep one owner", () => {
  const f = fixture(), target = f.control("Owner"), svg = new Element("svg", f.doc), path = new Element("path", f.doc); svg.append(path); target.append(svg); install(f.doc);
  f.over(path); f.win.tick(500); const first = f.tips()[0]; assert.equal(first.textContent, "Owner");
  f.doc.fire("pointerout", { target: path, relatedTarget: svg }); f.over(svg); assert.equal(f.tips()[0], first); assert.equal(f.win.timers.size, 0);
  f.doc.fire("pointerout", { target: svg, relatedTarget: f.doc.body }); assert.equal(f.tips().length, 0); assert.equal(target.getAttribute("title"), "Owner");
});

test("switching targets retires the old hover delay; touch input does not schedule a hover", () => {
  const f = fixture(), first = f.control("First"), second = f.control("Second"); install(f.doc);
  f.over(first); f.win.tick(200); f.over(second); assert.equal(first.getAttribute("title"), "First"); assert.equal(f.win.timers.size, 1);
  f.win.tick(300); assert.equal(f.tips().length, 0); f.win.tick(200); assert.equal(f.tips()[0].textContent, "Second");
  f.doc.fire("pointerdown", { target: second }); f.doc.fire("pointerover", new PointerEvent(first, "touch")); assert.equal(f.win.timers.size, 0); assert.equal(f.tips().length, 0);
});

test("all declared cancellation paths retire pending and visible tooltip state", () => {
  const cancellations = [f => f.doc.fire("pointerout", { relatedTarget: null }), f => f.doc.fire("focusout", { relatedTarget: f.doc.body }), ...["pointerdown", "keydown", "scroll", "visibilitychange", "close"].map(name => f => f.doc.fire(name)), f => f.win.fire("blur"), f => f.win.fire("resize")];
  for (const show of [false, true]) for (const cancel of cancellations) {
    const f = fixture(), target = f.control("Temporary"); install(f.doc); f.over(target); if (show) f.win.tick(500); cancel(f); f.win.tick(1000);
    assert.equal(f.tips().length, 0); assert.equal(f.win.timers.size, 0); assert.equal(target.getAttribute("title"), "Temporary"); assert.equal(target.getAttribute("aria-describedby"), null);
  }
});

test("newer host titles and live description tokens survive tooltip cleanup", () => {
  const f = fixture(), target = f.control("Initial", { "aria-describedby": "help details" }), api = install(f.doc); f.focus(target);
  const id = f.tips()[0].id; target.setAttribute("title", "New host title"); target.setAttribute("aria-describedby", "new-help " + id + " plugin-description");
  api.hide(); assert.equal(target.getAttribute("title"), "New host title"); assert.equal(target.getAttribute("aria-describedby"), "new-help plugin-description");
  f.over(target); target.setAttribute("title", "Changed while pending"); f.win.tick(500); assert.equal(f.tips()[0].textContent, "Changed while pending"); api.hide(); assert.equal(target.getAttribute("title"), "Changed while pending");
  f.focus(target); target.removeAttribute("aria-describedby"); api.hide(); assert.equal(target.getAttribute("aria-describedby"), null);
});

test("detached, hidden and offscreen controls cannot publish a delayed tooltip", () => {
  for (const retire of [target => target.remove(), (_target, f) => { f.doc.hidden = true; }, target => { target.rect.width = 0; }, target => { target.rect.left = 900; target.rect.right = 940; }]) {
    const f = fixture(), target = f.control("Unavailable"); install(f.doc); f.over(target); retire(target, f); f.win.tick(500);
    assert.equal(f.tips().length, 0); assert.equal(target.getAttribute("title"), "Unavailable"); assert.equal(f.win.timers.size, 0);
  }
});

test("a control adopted out of the owning document cannot receive that document's delayed tooltip", () => {
  const f = fixture(), foreign = fixture(), target = f.control("Adopted"); install(f.doc); f.over(target); foreign.doc.body.append(target); assert.equal(target.isConnected, true); f.win.tick(500);
  assert.equal(f.tips().length, 0); assert.equal(foreign.tips().length, 0); assert.equal(target.getAttribute("aria-describedby"), null); assert.equal(target.getAttribute("title"), "Adopted");
});

test("mutation ownership cancels pending and shown targets immediately and disconnects exactly once", () => {
  for (const visible of [false, true]) for (const adopt of [false, true]) {
    const f = fixture(), foreign = fixture(), target = f.control("Observed"), api = install(f.doc);
    const observer = [...f.doc.observers][0]; assert.deepEqual(observer.options, { childList: true, subtree: true });
    f.over(target); if (visible) f.win.tick(500);
    if (adopt) foreign.doc.body.append(target); else target.remove();
    f.doc.flushMutations(); assert.equal(f.tips().length, 0); assert.equal(f.win.timers.size, 0); assert.equal(target.getAttribute("title"), "Observed"); assert.equal(target.getAttribute("aria-describedby"), null);
    api.dispose(); api.dispose(); assert.equal(observer.disconnects, 1); assert.equal(f.doc.observers.size, 0);
    const control = f.control("After disposal"); f.doc.flushMutations(); f.over(control); assert.equal(f.win.timers.size, 0); assert.equal(f.tips().length, 0);
  }
});

test("dialog tooltips stay in their top-layer owner and separate document clocks do not interact", () => {
  const f = fixture(), foreign = fixture(), dialog = f.doc.createElement("dialog"), target = f.control("Dialog action"), remote = foreign.control("Remote action"); dialog.setAttribute("open", ""); f.doc.body.append(dialog); dialog.append(target);
  const mainOwner = install(f.doc), secondaryOwner = install(foreign.doc);
  assert.equal(install(f.doc), mainOwner); assert.equal(install(foreign.doc), secondaryOwner); assert.notEqual(mainOwner, secondaryOwner);
  assert.equal(f.doc.observers.size, 1); assert.equal(foreign.doc.observers.size, 1);
  f.focus(target); assert.equal(f.tips()[0].parentElement, dialog);
  foreign.over(remote); f.win.tick(1000); assert.equal(foreign.tips().length, 0); foreign.win.tick(500); assert.equal(foreign.tips()[0].textContent, "Remote action");
  f.win.fire("blur"); assert.equal(f.tips().length, 0); assert.equal(foreign.tips().length, 1);
});

test("disposal and pagehide clear timers, title/description state and all delegated handlers", () => {
  for (const pending of [false, true]) {
    const f = fixture(), target = f.control("Disposed"), api = install(f.doc); f.over(target); if (!pending) f.win.tick(500);
    f.win.fire("pagehide"); f.win.tick(1000); assert.equal(f.tips().length, 0); assert.equal(target.getAttribute("title"), "Disposed"); assert.equal(target.getAttribute("aria-describedby"), null);
    assert.equal(f.doc.activeListeners(), 0); assert.equal(f.win.activeListeners(), 0); assert.equal(f.doc.observers.size, 0); f.over(target); assert.equal(f.win.timers.size, 0);
    api.dispose(); const reopened = install(f.doc); assert.notEqual(reopened, api); f.focus(target); assert.equal(f.tips().length, 1); reopened.dispose();
  }
});

test("a retained old disposer cannot unregister a later document owner", () => {
  const f = fixture(), first = install(f.doc); first.dispose(); const second = install(f.doc); first.dispose();
  assert.equal(install(f.doc), second, "Idempotent old disposal must not evict a newer installation.");
  const target = f.control("Exactly one owner"); f.focus(target); assert.equal(f.tips().length, 1); assert.equal(target.getAttribute("aria-describedby"), f.tips()[0].id);
});

test("a document without a live window exposes a harmless disposable no-op", () => {
  const doc = { defaultView: null }; const api = install(doc); assert.doesNotThrow(() => { api.hide(); api.dispose(); api.dispose(); });
});
