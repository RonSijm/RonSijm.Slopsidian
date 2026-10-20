import { EditorView } from "@codemirror/view";
import { isAlias, isMap, isNode, isScalar, parseDocument, visit } from "yaml";
import type { App } from "./app";
import type { VaultDocument } from "./contracts";
import { parseMarkdown, sameValue, updateFrontmatter } from "./markdown";
import { inferPropertyType, parsePropertyValue, propertyName, propertyTypes } from "./property-types";
import { numericLexemes } from "./properties-lexemes";
import type { TFile } from "./vault";
import { MarkdownView } from "./workspace";

export const MAX_BASE_PROPERTY_SOURCE = 262_144;
export const MAX_BASE_PROPERTY_TEXT = 65_536;
type Session = NonNullable<MarkdownView["session"]>;
type Indexed = NonNullable<ReturnType<App["metadataCache"]["getDocument"]>>;
interface Peer { view: MarkdownView; editor: MarkdownView["editor"]; cm: MarkdownView["editor"]["cm"]; doc: MarkdownView["editor"]["cm"]["state"]["doc"]; mode: ReturnType<MarkdownView["getEditingMode"]> }
interface SavedWitness { readonly path: string; readonly version: string; readonly text: string; readonly bom: boolean }
interface Parent extends Peer { file: TFile; path: string; text: string; saved: VaultDocument; witness: SavedWitness; session: Session }
export interface EmbeddedPropertyOwner {
  app: App; host: HTMLElement; sourcePath: string;
  /** Exact complete query and its containing render remain current. No disk reads. */
  current(): boolean;
  /** Recheck the exact saved .base bytes/version, or the owned inline fence. */
  physical(): Promise<boolean>;
}
export interface EmbeddedPropertyReview {
  readonly app: App; readonly root: string; readonly owner: EmbeddedPropertyOwner; readonly parent: Parent;
  readonly file: TFile; readonly path: string; readonly key: string; readonly text: string; readonly saved: VaultDocument;
  readonly witness: SavedWitness;
  readonly indexed: Indexed; readonly prior: unknown; readonly existed: boolean; readonly kind: string; readonly assigned: string | null;
  readonly registry: unknown; readonly session: Session | null; readonly peers: readonly Peer[];
}
interface ReviewState { cancelled: boolean; applied: boolean; outcome: { changed: boolean; path: string; key: string } | null; source: Peer | null; session: Session | null; saved: VaultDocument | null }
const states = new WeakMap<EmbeddedPropertyReview, ReviewState>();
const changed = (): never => { throw new Error("The embedded query, containing note, target Source or property changed. Cancel and review its current value; this review did not apply a property."); };
const viewsFor = (app: App, file: TFile): MarkdownView[] => app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view).filter((view): view is MarkdownView => view instanceof MarkdownView && view.file === file);
const peer = (view: MarkdownView): Peer => ({ view, editor: view.editor, cm: view.editor.cm, doc: view.editor.cm.state.doc, mode: view.getEditingMode() });
const witness = (document: VaultDocument): SavedWitness => Object.freeze({ path: document.file.path, version: document.version, text: document.content, bom: document.hasBom === true });
const matches = (document: VaultDocument, saved: SavedWitness): boolean => document.file.path === saved.path && document.version === saved.version
  && document.content === saved.text && (document.hasBom === true) === saved.bom;
const interactive = (app: App): boolean => Boolean(app.vault.rootPath) && !app.vault.readOnly && !app.changingVault && !app.core.busy
  && app.core.isEnabled("bases") && !app.workspace.isChangingFiles && !app.workspace.isChangingLayout;
const supported = (value: unknown): boolean => value == null || typeof value === "string" && value.length <= MAX_BASE_PROPERTY_TEXT
  || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))
  || Array.isArray(value) && value.length <= 256 && value.every(item => typeof item === "string" && item.length <= MAX_BASE_PROPERTY_TEXT)
    && value.reduce((size, item) => size + item.length + 1, 0) <= MAX_BASE_PROPERTY_TEXT;
function freezeSnapshot(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value && typeof value === "object" && !seen.has(value)) { seen.add(value); Object.values(value).forEach(child => freezeSnapshot(child, seen)); Object.freeze(value); } return value;
}

function header(source: string) {
  if (source.length > MAX_BASE_PROPERTY_SOURCE) { throw new Error("Embedded property editing supports notes up to 262,144 characters. Use normal Source for this note."); }
  const start = /^\uFEFF?---[ \t]*\r?\n/.exec(source), close = /^---[ \t]*(?:\r?\n|$)/gm;
  if (!start) { return null; }
  close.lastIndex = start[0].length; const end = close.exec(source);
  if (!end) { throw new Error("Resolve the target note's YAML before editing its properties."); }
  const body = source.slice(start[0].length, end.index), doc = parseDocument(body, { uniqueKeys: true, keepSourceTokens: true });
  if (doc.errors.length || !isMap(doc.contents)) { throw new Error("Embedded editing needs ordinary top-level mapping frontmatter."); }
  return { doc, mapping: doc.contents, from: start[0].length, to: end.index, body };
}

/** Only the edited top-level pair/value is spliced; other YAML spelling and body bytes stay exact. */
export function planEmbeddedPropertyEdit(source: string, key: string, prior: unknown, next: unknown): { source: string; from: number; to: number; insert: string } {
  propertyName(key);
  if (source.length > MAX_BASE_PROPERTY_SOURCE) { throw new Error("Embedded property editing supports notes up to 262,144 characters. Use normal Source for this note."); }
  if (!supported(prior) || !supported(next)) { throw new Error("Use Source for structured, over-budget or imprecise property values."); }
  if (typeof next === "string" && /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(next)
    || Array.isArray(next) && next.some(item => /[\r\n\x00-\x1f\x7f]/.test(item))) { throw new Error("This value contains unsupported control characters or multiline list items. Use Source."); }
  const parsed = parseMarkdown(source); if (parsed.errors.length || !sameValue(parsed.frontmatter?.[key], prior)) { return changed(); }
  const original = header(source), existed = Object.hasOwn(parsed.frontmatter ?? {}, key);
  if (!existed && original?.mapping.flow) { throw new Error("Add a missing property to this flow mapping in normal Source."); }
  let edited: { from: number; to: number } | null = null;
  if (existed) {
    const before = original?.mapping.items.find(pair => isScalar(pair.key) && pair.key.value === key);
    if (!original || !before || !isNode(before.value) || !before.value.range) { throw new Error("Use Source for this YAML property layout."); }
    let unsafe = false;
    visit(before.value, (_key, node) => { if (isAlias(node) || isNode(node) && (node.anchor || node.tag)) { unsafe = true; } });
    if (unsafe || before.value.range[0] === before.value.range[1]) { throw new Error("Use Source for aliased, tagged or implicit-empty YAML values."); }
    edited = { from: original.from + before.value.range[0], to: original.from + before.value.range[1] };
  }
  if (sameValue(prior, next)) { return { source, from: 0, to: 0, insert: "" }; }
  const updated = updateFrontmatter(source, values => { Object.defineProperty(values, key, { value: next, enumerable: true, configurable: true, writable: true }); });
  if (updated === source) { return { source, from: 0, to: 0, insert: "" }; }
  const after = header(updated); if (!after) { throw new Error("The edited frontmatter could not be reviewed."); }
  const pair = after.mapping.items.find(pair => isScalar(pair.key) && pair.key.value === key);
  if (!pair || !isNode(pair.value) || !pair.value.range || !isScalar(pair.key) || !pair.key.range) { throw new Error("Use Source for this YAML property layout."); }
  let from: number, to: number, insert: string;
  if (!original) {
    from = source.charCodeAt(0) === 0xFEFF ? 1 : 0; to = from;
    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    insert = "---" + newline + updated.slice(after.from, after.to) + "---" + newline;
  } else if (!existed) {
    from = to = original.to;
    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    insert = updated.slice(after.from + pair.key.range[0], after.from + pair.value.range[2]);
    if (!insert.endsWith(newline)) { insert += newline; }
    if (original.body && !original.body.endsWith("\n")) { insert = newline + insert; }
  } else {
    if (!edited) { throw new Error("The reviewed property token is unavailable."); }
    ({ from, to } = edited);
    const serialized = JSON.stringify(next); if (typeof serialized !== "string") { throw new Error("The property value cannot be represented safely."); }
    insert = typeof next === "number" && Object.is(next, -0) ? "-0" : serialized;
    // A block collection's final newline belongs to the replaced node. A scalar's
    // following comment/newline remains in the original source instead.
    if (source.slice(from, to).endsWith("\n")) { insert += source.includes("\r\n") ? "\r\n" : "\n"; }
  }
  const result = source.slice(0, from) + insert + source.slice(to), actual = parseMarkdown(result), expected = parseMarkdown(updated);
  if (actual.errors.length || !sameValue(actual.frontmatter, expected.frontmatter)) { throw new Error("This YAML layout cannot preserve its other values exactly. Edit it in Source."); }
  return { source: result, from, to, insert };
}

export function embeddedPropertySurfaceAvailable(app: App, host: HTMLElement, path: string): boolean {
  return !app.vault.readOnly && typeof app.workspace.getLeavesOfType === "function" && app.workspace.getLeavesOfType("markdown")
    .some(leaf => leaf.view instanceof MarkdownView && leaf.view.file?.path === path && leaf.view.containerEl.contains(host));
}

/** Cached authority only: read-only and stale controls cannot cause IO or allocate a Source. */
export function embeddedPropertyReview(owner: EmbeddedPropertyOwner, path: string, key: string): EmbeddedPropertyReview | null {
  const { app } = owner;
  try {
    if (!interactive(app) || !owner.current() || !owner.host.isConnected || !owner.host.checkVisibility()) { return null; }
    propertyName(key);
    const file = app.vault.getFileByPath(path), parent = app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view)
      .find((view): view is MarkdownView => view instanceof MarkdownView && view.file?.path === owner.sourcePath && view.containerEl.contains(owner.host));
    if (!file || file.extension.toLowerCase() !== "md" || !parent?.file || !parent.session || file === parent.file) { return null; }
    const indexed = app.metadataCache.getDocument(path), session = app.workspace.sessions.get(path) ?? null, saved = session?.document ?? indexed?.document;
    if (!indexed || indexed.missing || indexed.cache.errors.length || !saved?.version || indexed.text !== (session?.text ?? saved.content)
      || !matches(indexed.document, witness(saved)) || !parent.session.document.version || parent.session.isSaving || parent.session.isReloading) { return null; }
    const values = indexed.cache.frontmatter ?? {}, prior = structuredClone(values[key]), assigned = app.metadataTypeManager.getAssignedWidget(key), kind = assigned ?? inferPropertyType(prior);
    if (!supported(prior) || !propertyTypes.some(type => type === kind)) { return null; }
    if (typeof prior === "number") { const literal = numericLexemes(indexed.text).get(key); if (literal === undefined || !Object.is(parsePropertyValue("number", literal), prior)) { return null; } }
    // A no-op round trip also checks the source budget and unambiguous YAML.
    planEmbeddedPropertyEdit(indexed.text, key, prior, prior);
    const peers = viewsFor(app, file).map(peer);
    const review: EmbeddedPropertyReview = Object.freeze({ app, root: app.vault.rootPath!, owner,
      parent: Object.freeze({ ...peer(parent), file: parent.file, path: parent.file.path, text: parent.session.text, saved: parent.session.document, witness: witness(parent.session.document), session: parent.session }),
      file, path, key, text: indexed.text, saved, witness: witness(saved), indexed, prior: freezeSnapshot(prior), existed: Object.hasOwn(values, key), assigned, kind,
      registry: freezeSnapshot(structuredClone(app.configuration.get("types", "types"))), session, peers: Object.freeze(peers.map(value => Object.freeze(value))) });
    states.set(review, { cancelled: false, applied: false, outcome: null, source: null, session, saved: session?.document ?? null });
    if (!embeddedPropertyCurrent(review)) { states.delete(review); return null; } return review;
  } catch { return null; }
}

export function embeddedPropertyCurrent(review: EmbeddedPropertyReview): boolean {
  try {
    const state = states.get(review); if (!state || state.cancelled || state.applied) { return false; }
    const { app, parent, file, path } = review, { view } = parent;
    if (!interactive(app) || app.vault.rootPath !== review.root || !review.owner.current() || !review.owner.host.isConnected || !review.owner.host.checkVisibility()
      || app.vault.getFileByPath(parent.path) !== parent.file || parent.file.path !== parent.path || !view.isLoaded || view.leaf.view !== view || view.file !== parent.file
      || view.editor !== parent.editor || parent.editor.cm !== parent.cm || parent.cm.state.doc !== parent.doc || !parent.cm.dom.isConnected || parent.cm.composing
      || view.getEditingMode() !== parent.mode || view.session !== parent.session || parent.session.originRoot !== review.root || app.workspace.sessions.get(parent.path) !== parent.session
      || parent.session.text !== parent.text || parent.editor.getValue() !== parent.text || parent.session.document !== parent.saved || !matches(parent.saved, parent.witness) || parent.session.isSaving || parent.session.isReloading
      || file.path !== path || app.vault.getFileByPath(path) !== file || app.metadataTypeManager.getAssignedWidget(review.key) !== review.assigned
      || !sameValue(app.configuration.get("types", "types"), review.registry)) { return false; }
    const indexed = app.metadataCache.getDocument(path), session = app.workspace.sessions.get(path) ?? null;
    if (!indexed || indexed.missing || indexed.cache.errors.length || indexed.text !== review.text || !matches(review.saved, review.witness) || !matches(indexed.document, review.witness)
      || Object.hasOwn(indexed.cache.frontmatter ?? {}, review.key) !== review.existed || !sameValue(indexed.cache.frontmatter?.[review.key], review.prior)
      || session !== state.session || session && (session.originRoot !== review.root || session.text !== review.text || session.isSaving || session.isReloading
        || session.document !== state.saved || !matches(session.document, review.witness))) { return false; }
    const peers = viewsFor(app, file), added = state.source && !review.peers.some(peer => peer.view === state.source!.view) ? 1 : 0;
    if (peers.length !== review.peers.length + added) { return false; }
    for (const saved of [...review.peers, ...(added ? [state.source!] : [])]) {
      const source = state.source?.view === saved.view, candidate = saved.view;
      if (!peers.includes(candidate) || !candidate.isLoaded || candidate.leaf.view !== candidate || candidate.file !== file || candidate.session !== session
        || candidate.editor !== saved.editor || saved.editor.cm !== saved.cm || saved.cm.state.doc !== saved.doc || !saved.cm.dom.isConnected || saved.cm.composing
        || saved.editor.getValue() !== review.text || candidate.getEditingMode() !== (source ? "source" : saved.mode)) { return false; }
    }
    if (state.source && (state.source.cm.state.readOnly || !state.source.cm.state.facet(EditorView.editable) || !state.source.view.sourceEl.checkVisibility())) { return false; }
    return true;
  } catch { return false; }
}

async function physical(review: EmbeddedPropertyReview): Promise<void> {
  if (!embeddedPropertyCurrent(review)) { return changed(); }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const [target, parent, base] = await Promise.race([
      Promise.all([review.app.vault.readDocument(review.path), review.app.vault.readDocument(review.parent.path), review.owner.physical()]),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Property review timed out. No property was applied; any opened Source was kept.")), 5000); }),
    ]);
    if (!embeddedPropertyCurrent(review) || !matches(target, review.witness) || !matches(parent, review.parent.witness) || !base) { return changed(); }
  } finally { if (timer !== undefined) { clearTimeout(timer); } }
}

/** Explicitly reveals a normal Source beside the containing note, preserving live CM/history. */
export async function showEmbeddedPropertySource(review: EmbeddedPropertyReview): Promise<void> {
  await physical(review); const { app, parent } = review, state = states.get(review)!;
  let view = review.peers.find(peer => peer.view.sourceEl.checkVisibility())?.view ?? review.peers[0]?.view ?? null;
  if (view) {
    state.source = peer(view);
    if (view.leaf.parent === parent.view.leaf.parent) { app.workspace.dockLeaf(view.leaf, parent.view.leaf.parent, "right"); }
    view.setEditingMode("source", false); app.workspace.setActiveLeaf(view.leaf, { focus: false });
  } else {
    const leaf = app.workspace.createLeafBySplit(parent.view.leaf, "vertical");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([leaf.setViewState({ type: "markdown", state: { file: review.path, mode: "source", source: true }, active: true }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Opening Source timed out. Any opened Source was kept; no property was applied.")), 5000); })]); }
    finally { if (timer !== undefined) { clearTimeout(timer); } }
    if (!(leaf.view instanceof MarkdownView) || leaf.view.file !== review.file) { return changed(); }
    const opened = leaf.view, session = opened.session; if (!session) { return changed(); }
    view = opened; state.source = peer(opened); state.session = session; state.saved = session.document;
  }
  if (!embeddedPropertyCurrent(review) || !view.sourceEl.checkVisibility()) { return changed(); }
  await physical(review);
}

export function embeddedPropertyHasSource(review: EmbeddedPropertyReview): boolean { return Boolean(states.get(review)?.source) && embeddedPropertyCurrent(review); }
export function embeddedPropertyOutcome(review: EmbeddedPropertyReview): Readonly<{ changed: boolean; path: string; key: string }> | null { return states.get(review)?.outcome ?? null; }
export function cancelEmbeddedPropertyReview(review: EmbeddedPropertyReview): void { const state = states.get(review); if (state) { state.cancelled = true; } }

/** The preview and Apply share exact no-op/type/precision semantics. */
export function embeddedPropertyDraft(review: EmbeddedPropertyReview, type: string, text: string, checked = false): unknown {
  if (text.length > MAX_BASE_PROPERTY_TEXT || review.assigned !== null && review.assigned !== type) { throw new Error("The draft's type or value is outside this property's current bounds."); }
  const initial = Array.isArray(review.prior) ? review.prior.join("\n") : review.prior == null ? "" : Object.is(review.prior, -0) ? "-0" : String(review.prior);
  return type === review.kind && text === initial && checked === (review.prior === true) ? review.prior : parsePropertyValue(type, text, checked);
}

/** Only an actual visible Source owns the one-step transaction. Normal note saving remains separate. */
export async function applyEmbeddedProperty(review: EmbeddedPropertyReview, type: string, text: string, checked = false): Promise<{ changed: boolean; path: string; key: string }> {
  if (!embeddedPropertyHasSource(review) || review.assigned !== null && review.assigned !== type || text.length > MAX_BASE_PROPERTY_TEXT) { return changed(); }
  const next = embeddedPropertyDraft(review, type, text, checked);
  const plan = planEmbeddedPropertyEdit(review.text, review.key, review.prior, next);
  await physical(review);
  if (!embeddedPropertyHasSource(review)) { return changed(); }
  const state = states.get(review)!;
  if (plan.source !== review.text) { state.source!.editor.replaceExpectedChanges(review.text, [{ from: plan.from, to: plan.to, insert: plan.insert }], "input.bases-property"); }
  if (state.source!.editor.getValue() !== plan.source) { throw new Error("Source did not accept the complete property edit. Inspect its current value and Undo history."); }
  state.applied = true; state.outcome = Object.freeze({ changed: plan.source !== review.text, path: review.path, key: review.key });
  review.app.metadataCache.updateOpenDocuments(); return state.outcome;
}
