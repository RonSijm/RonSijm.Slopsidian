import type { App } from "./app";
import { EditorView } from "@codemirror/view";
import type { SourceRange } from "./markdown";
import { linkOutgoingMention, outgoingMentionAuthority, outgoingMentionEnvironmentFor, outgoingMentionProseRanges, outgoingMentionRangeSupported, outgoingMentionReview, OutgoingMentionError, type OutgoingMentionReview } from "./outgoing-mention-authoring";
import type { TFile } from "./vault";
import { MarkdownView } from "./workspace";

type IndexedDocument = NonNullable<ReturnType<App["metadataCache"]["getDocument"]>>;
type Session = NonNullable<MarkdownView["session"]>;
interface ReadingWitness {
  view: MarkdownView; editor: MarkdownView["editor"]; cm: MarkdownView["editor"]["cm"];
  cmDocument: MarkdownView["editor"]["cm"]["state"]["doc"]; editingMode: string;
}
export interface OutgoingMentionIntentAuthority {
  kind: "visible-source"; app: App; root: string; file: TFile; path: string; text: string;
  document: IndexedDocument["document"]; metadataDocument: IndexedDocument["document"]; cache: IndexedDocument["cache"];
  savedText: string; savedVersion: string; savedBom: boolean;
  session: Session | null; peers: readonly ReadingWitness[]; preferences: readonly (readonly [string, unknown])[];
}
interface IntentEnvironment extends OutgoingMentionIntentAuthority { blocked: readonly SourceRange[] }
export interface OutgoingMentionIntentReview extends IntentEnvironment {
  target: TFile; targetPath: string; targetText: string; targetDocument: IndexedDocument["document"]; targetCache: IndexedDocument["cache"];
  targetSavedText: string; targetVersion: string; targetBom: boolean; range: SourceRange;
}

const unavailable = (): never => { throw new OutgoingMentionError("The note, mention, destination or view changed. No link was inserted. Choose the current mention again."); };
const consumed = new WeakSet<OutgoingMentionIntentReview>();
const peersFor = (app: App, file: TFile): MarkdownView[] => app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view)
  .filter((view): view is MarkdownView => view instanceof MarkdownView && view.file === file);
const interactive = (app: App): boolean => !app.vault.readOnly && !app.changingVault && !app.core.busy && app.core.isEnabled("outgoing-link")
  && !app.workspace.isChangingFiles && !app.workspace.isChangingLayout;
const documentMatches = (entry: IndexedDocument | null, text: string, version: string, content: string, bom: boolean): boolean => Boolean(entry && !entry.missing
  && entry.text === text && entry.document.version === version && entry.document.content === content && (entry.document.hasBom === true) === bom && !entry.cache.errors.length);
const savedMatches = (document: IndexedDocument["document"], path: string, version: string, content: string, bom: boolean): boolean => document.file.path === path
  && document.version === version && document.content === content && (document.hasBom === true) === bom;

/** A render witness only. It cannot itself authorize a hidden editor or a disk write. */
export function outgoingMentionIntentAuthority(app: App, file: TFile, text: string): OutgoingMentionIntentAuthority | null {
  try {
    const root = app.vault.rootPath, entry = app.metadataCache.getDocument(file.path);
    if (!root || !interactive(app) || file.vault !== app.vault || app.vault.getFileByPath(file.path) !== file || file.extension.toLowerCase() !== "md"
      || text.length > 1_000_000 || !entry || entry.missing || entry.text !== text || entry.cache.errors.length) { return null; }
    const preferences = ["newLinkFormat", "useMarkdownLinks"].map(key => [key, app.vault.getConfig(key)] as const);
    const format = app.vault.getConfig("newLinkFormat"), markdown = app.vault.getConfig("useMarkdownLinks");
    if (markdown !== undefined && typeof markdown !== "boolean" || format !== undefined && (typeof format !== "string" || !["shortest", "relative", "absolute"].includes(format))) { return null; }
    const session = app.workspace.sessions.get(file.path) ?? null, views = peersFor(app, file);
    // A busy or locked Source editor must settle through the existing live-owner
    // path. Opening another editor must never bypass its authoring guards.
    if (views.some(view => !view.isLoaded || view.leaf.view !== view || view.getMode() !== "preview" || !view.editor.cm.dom.isConnected
      || view.editor.cm.composing || view.editor.cm.state.readOnly || view.session !== session || view.editor.getValue() !== text)) { return null; }
    if (entry.document.file.path !== file.path || session && (session.originRoot !== root || session.text !== text || session.isSaving || session.isReloading
      || !savedMatches(session.document, file.path, entry.document.version, entry.document.content, entry.document.hasBom === true))
      || !session && (views.length || text !== entry.document.content)) { return null; }
    // Cache refresh and same-version reload independently own VaultDocument
    // instances. Capture both actual references; equal values do not merge their
    // lifetimes, and either owner changing after this review retires the intent.
    return { kind: "visible-source", app, root, file, path: file.path, text, document: session?.document ?? entry.document, metadataDocument: entry.document, cache: entry.cache,
      savedText: entry.document.content, savedVersion: entry.document.version, savedBom: entry.document.hasBom === true, session,
      peers: views.map(view => ({ view, editor: view.editor, cm: view.editor.cm, cmDocument: view.editor.cm.state.doc, editingMode: view.getEditingMode() })), preferences };
  } catch { return null; }
}

export function sameOutgoingMentionIntentAuthority(left: OutgoingMentionIntentAuthority | null | undefined, right: OutgoingMentionIntentAuthority | null): boolean {
  if (!left || !right) { return (left ?? null) === right; }
  return left.app === right.app && left.root === right.root && left.file === right.file && left.path === right.path && left.text === right.text && left.document === right.document && left.metadataDocument === right.metadataDocument
    && left.cache === right.cache && left.savedText === right.savedText && left.savedVersion === right.savedVersion && left.savedBom === right.savedBom && left.session === right.session
    && left.preferences.every(([key, value], index) => right.preferences[index]?.[0] === key && right.preferences[index]?.[1] === value)
    && left.peers.length === right.peers.length && left.peers.every((peer, index) => {
      const next = right.peers[index]; return peer.view === next.view && peer.editor === next.editor && peer.cm === next.cm && peer.cmDocument === next.cmDocument && peer.editingMode === next.editingMode;
    });
}
export function outgoingMentionIntentEnvironmentFor(authority: OutgoingMentionIntentAuthority | null): IntentEnvironment | null {
  if (!authority) { return null; }
  const ranges = outgoingMentionProseRanges(authority.text, authority.cache); return ranges ? { ...authority, blocked: ranges } : null;
}
export function outgoingMentionIntentReview(environment: IntentEnvironment | null, target: TFile | null, range: SourceRange): OutgoingMentionIntentReview | null {
  if (!environment || !target || target === environment.file || target.extension.toLowerCase() !== "md" || target.vault !== environment.app.vault
    || environment.app.vault.getFileByPath(target.path) !== target || !outgoingMentionRangeSupported(environment.text, environment.blocked, range)) { return null; }
  const entry = environment.app.metadataCache.getDocument(target.path);
  if (!entry || entry.missing || entry.cache.errors.length) { return null; }
  return { ...environment, target, targetPath: target.path, targetText: entry.text, targetDocument: entry.document, targetCache: entry.cache,
    targetSavedText: entry.document.content, targetVersion: entry.document.version, targetBom: entry.document.hasBom === true, range: { ...range } };
}

export interface OutgoingMentionSourceHandoff {
  readonly view: MarkdownView;
  readonly choice: OutgoingMentionReview;
  /** The original bounded handoff, used by the existing immediate single action. */
  readonly current: () => boolean;
  /** The same original ownership witness without a timeout on a subsequent literal review. */
  readonly lease: () => boolean;
}

/** Explicitly show Source without editing or saving; ownership cannot be renewed by the transition. */
export async function openOutgoingMentionInSource(review: OutgoingMentionIntentReview, owned: () => boolean): Promise<OutgoingMentionSourceHandoff> {
  const { app } = review, until = Date.now() + 5_000;
  let opened: MarkdownView | null = null, openedSession: Session | null = null, openedDocument: IndexedDocument["document"] | null = null;
  let openedWitness: ReadingWitness | null = null;
  const lease = (): boolean => {
    if (!owned() || !interactive(app) || app.vault.rootPath !== review.root || review.file.path !== review.path
      || app.vault.getFileByPath(review.path) !== review.file || review.target.path !== review.targetPath || app.vault.getFileByPath(review.targetPath) !== review.target
      || review.preferences.some(([key, value]) => app.vault.getConfig(key) !== value)
      || !savedMatches(review.document, review.path, review.savedVersion, review.savedText, review.savedBom)
      || !savedMatches(review.metadataDocument, review.path, review.savedVersion, review.savedText, review.savedBom)) { return false; }
    const source = app.metadataCache.getDocument(review.path), target = app.metadataCache.getDocument(review.targetPath);
    if (!documentMatches(source, review.text, review.savedVersion, review.savedText, review.savedBom) || source!.cache !== review.cache
      || !savedMatches(source!.document, review.path, review.savedVersion, review.savedText, review.savedBom)
      || source!.document !== review.metadataDocument && (!opened || source!.document !== (review.session ? review.document : openedDocument))
      || !documentMatches(target, review.targetText, review.targetVersion, review.targetSavedText, review.targetBom)
      || !savedMatches(target!.document, review.targetPath, review.targetVersion, review.targetSavedText, review.targetBom)
      || target!.document !== review.targetDocument || target!.cache !== review.targetCache) { return false; }
    const session = app.workspace.sessions.get(review.path) ?? null;
    if (review.session ? session !== review.session : openedSession ? session !== openedSession : session !== null) { return false; }
    if (session && (session.originRoot !== review.root || session.isSaving || session.isReloading || session.text !== review.text
      || session.document !== (review.session ? review.document : openedDocument)
      || !savedMatches(session.document, review.path, review.savedVersion, review.savedText, review.savedBom))) { return false; }
    const views = peersFor(app, review.file);
    if (views.length !== review.peers.length + (opened && !review.peers.some(peer => peer.view === opened) ? 1 : 0)) { return false; }
    return review.peers.every(peer => {
      const view = peer.view; return views.includes(view) && view.isLoaded && view.leaf.view === view && view.session === review.session
        && view.editor === peer.editor && view.editor.cm === peer.cm && view.editor.cm.state.doc === peer.cmDocument && view.editor.cm.dom.isConnected
        && !view.editor.cm.composing && !view.editor.cm.state.readOnly && view.editor.getValue() === review.text
        && (view === opened ? view.getEditingMode() === "source" : view.getEditingMode() === peer.editingMode);
    }) && (!opened || opened.isLoaded && opened.leaf.view === opened && opened.file === review.file && opened.session === session && opened.getEditingMode() === "source"
      && (!openedWitness || opened.editor === openedWitness.editor && opened.editor.cm === openedWitness.cm && opened.editor.cm.state.doc === openedWitness.cmDocument));
  };
  const current = (): boolean => Date.now() <= until && lease();
  if (consumed.has(review) || !current()) { return unavailable(); }
  consumed.add(review);
  // Refuse stale closed metadata before allocating a tab. These reads also
  // preserve dirty Reading sessions: disk must match their saved base, not draft.
  const [sourceDisk, targetDisk] = await Promise.all([app.vault.readDocument(review.path), app.vault.readDocument(review.targetPath)]);
  if (!current() || sourceDisk.file.path !== review.path || sourceDisk.version !== review.savedVersion || sourceDisk.content !== review.savedText || (sourceDisk.hasBom === true) !== review.savedBom
    || targetDisk.file.path !== review.targetPath || targetDisk.version !== review.targetVersion || targetDisk.content !== review.targetSavedText || (targetDisk.hasBom === true) !== review.targetBom) { return unavailable(); }
  if (review.peers.length) {
    const active = app.workspace.getActiveViewOfType(MarkdownView), peer = review.peers.find(item => item.view === active) ?? review.peers[0];
    opened = peer.view;
    // Neither method saves. Activating the tab through activateLeaf/openFile
    // would save the current session, collapsing the user's dirty-history base.
    opened.setEditingMode("source", false); app.workspace.setActiveLeaf(opened.leaf, { focus: false });
  } else {
    const leaf = app.workspace.getLeaf("tab");
    // Pin the first ready owner as it becomes visible, before the asynchronous
    // view/plugin callbacks finish. A same-text owner reset during those callbacks
    // must not become the newly authorized editor when setViewState resolves.
    const observe = (): void => {
      const view = leaf.view;
      if (!opened && view instanceof MarkdownView && view.isLoaded && view.file === review.file && view.session && view.getEditingMode() === "source") {
        opened = view; openedSession = view.session; openedDocument = view.savedDocument;
        openedWitness = { view, editor: view.editor, cm: view.editor.cm, cmDocument: view.editor.cm.state.doc, editingMode: "source" };
      }
    };
    const events = ["layout-change", "active-leaf-change", "file-open", "editor-change"].map(event => app.workspace.on(event, observe));
    try { await leaf.setViewState({ type: "markdown", state: { file: review.path, mode: "source", source: true }, active: true }); }
    finally { events.forEach(event => event.emitter.offref(event)); }
    if (!opened || leaf.view !== opened) { return unavailable(); }
  }
  if (!current() || !opened || app.workspace.activeLeaf !== opened.leaf) { return unavailable(); }
  // Facets may settle asynchronously after the visible transition, but no text,
  // document, owner, target, preference or pane lease may be renewed by waiting.
  let authority = outgoingMentionAuthority(app, review.file, review.text, opened);
  while (!authority && Date.now() < until && current()) {
    await new Promise(resolve => setTimeout(resolve, 25)); authority = outgoingMentionAuthority(app, review.file, review.text, opened);
  }
  if (!current() || !authority || authority.savedText !== review.savedText || authority.savedVersion !== review.savedVersion || authority.savedBom !== review.savedBom) { return unavailable(); }
  const choice = outgoingMentionReview(outgoingMentionEnvironmentFor(authority), review.target, review.range);
  if (!choice || choice.targetVersion !== review.targetVersion || choice.targetText !== review.targetText || choice.targetSavedText !== review.targetSavedText || choice.targetBom !== review.targetBom
    || !opened.editor.cm.state.facet(EditorView.editable)) { return unavailable(); }
  return { view: opened, choice, current: () => current() && app.workspace.activeLeaf === opened!.leaf, lease };
}

/** The single action keeps its original bounded transition and isolated shared Undo transaction. */
export async function linkOutgoingMentionInSource(review: OutgoingMentionIntentReview, owned: () => boolean): Promise<void> {
  const handoff = await openOutgoingMentionInSource(review, owned);
  await linkOutgoingMention(handoff.choice, handoff.current);
  handoff.view.focus();
}
