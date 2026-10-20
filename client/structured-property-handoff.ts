import type { App } from "./app";
import { EditorView } from "@codemirror/view";
import type { VaultDocument } from "./contracts";
import { sameValue } from "./markdown";
import { checkedStructuredPropertySnapshot, structuredPropertyModel, structuredScalarLeafEditable, type StructuredPropertyReviewTarget } from "./structured-properties";
import { structuredPropertyOperationTargets } from "./structured-property-operations";
import { isStructuredPropertyTransferKind, structuredPropertyTransferTargets } from "./structured-property-transfers";
import { isStructuredPropertyCrossTransferKind, structuredPropertyCrossTransferTargets } from "./structured-property-cross-transfers";
import { isStructuredPropertyRestructureKind, structuredPropertyRestructureTargets } from "./structured-property-restructure";
import type { TFile } from "./vault";
import { MarkdownView, type WorkspaceLeaf } from "./workspace";

type Indexed = NonNullable<ReturnType<App["metadataCache"]["getDocument"]>>;
type Session = NonNullable<MarkdownView["session"]>;
type Peer = { view: MarkdownView; editor: MarkdownView["editor"]; cm: MarkdownView["editor"]["cm"]; doc: MarkdownView["editor"]["cm"]["state"]["doc"]; mode: ReturnType<MarkdownView["getEditingMode"]> };
export interface StructuredPropertyHandoff {
  readonly app: App; readonly root: string; readonly file: TFile; readonly path: string; readonly name: string;
  readonly value: unknown; readonly text: string; readonly saved: VaultDocument; readonly indexed: Indexed;
  readonly savedText: string; readonly savedVersion: string; readonly savedBom: boolean;
  readonly session: Session | null; readonly peers: readonly Peer[]; readonly target: StructuredPropertyReviewTarget;
  readonly widget: string | null; readonly typeRegistry: unknown; readonly preferences: readonly (readonly [string, unknown])[];
}
const used = new WeakSet<StructuredPropertyHandoff>();
const issued = new WeakSet<StructuredPropertyHandoff>();
const unavailable = (): never => { throw new Error("The note, nested value or Properties pane changed. Choose Review in Source again; no property was changed."); };
const interactive = (app: App): boolean => !app.vault.readOnly && Boolean(app.vault.rootPath) && !app.changingVault && !app.core.busy
  && app.core.isEnabled("properties") && !app.workspace.isChangingFiles && !app.workspace.isChangingLayout;
const peersFor = (app: App, file: TFile): MarkdownView[] => app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view)
  .filter((view): view is MarkdownView => view instanceof MarkdownView && view.file === file);
const savedMatches = (value: VaultDocument, handoff: StructuredPropertyHandoff): boolean => value.file.path === handoff.path && value.version === handoff.savedVersion
  && value.content === handoff.savedText && (value.hasBom === true) === handoff.savedBom;
const freeze = <T>(value: T): T => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const preference = (value: unknown): unknown => value && typeof value === "object" ? freeze(checkedStructuredPropertySnapshot(value)) : value;
const targetSupported = (value: unknown, text: string, name: string, target: StructuredPropertyReviewTarget): boolean => {
  const model = structuredPropertyModel(value, text, name), key = JSON.stringify(target.path);
  if (!model) { return false; }
  if (target.kind === "edit") { return model.leaves.some(leaf => JSON.stringify(leaf.path) === key && structuredScalarLeafEditable(leaf)); }
  if (isStructuredPropertyTransferKind(target.kind)) { return structuredPropertyTransferTargets(text, name, value)[target.kind].has(key); }
  if (isStructuredPropertyCrossTransferKind(target.kind)) { return structuredPropertyCrossTransferTargets(text, name, value)[target.kind].has(key); }
  if (isStructuredPropertyRestructureKind(target.kind)) { return structuredPropertyRestructureTargets(text, name, value)[target.kind].has(key); }
  return structuredPropertyOperationTargets(text, name, value)[target.kind].has(key);
};

/** Cached UI authority only. It never reads disk, allocates a Source leaf or changes YAML. */
export function structuredPropertyHandoff(app: App, file: TFile, name: string, value: unknown, requested: StructuredPropertyReviewTarget): StructuredPropertyHandoff | null {
  try {
    if (!interactive(app) || app.vault.getFileByPath(file.path) !== file || file.extension.toLowerCase() !== "md") { return null; }
    // Descriptor validation precedes reading the caller's path/kind/value getters.
    const checkedValue = checkedStructuredPropertySnapshot(value);
    const { target } = checkedStructuredPropertySnapshot({ target: requested }) as { target: StructuredPropertyReviewTarget };
    if (!target || !["edit", "add", "remove", "rename", "move-up", "move-down", "move-to", "duplicate", "copy-to", "move-into", "copy-to-property", "move-to-property", "wrap-map", "wrap-list", "unwrap-value", "promote-entries"].includes(target.kind) || Object.keys(target).sort().join(",") !== "kind,path" || !Array.isArray(target.path)) { return null; }
    const indexed = app.metadataCache.getDocument(file.path), session = app.workspace.sessions.get(file.path) ?? null;
    if (!indexed || indexed.missing || indexed.cache.errors.length || indexed.document.file.path !== file.path
      || !targetSupported(checkedValue, indexed.text, name, target)) { return null; }
    const saved = session?.document ?? indexed.document, views = peersFor(app, file);
    if (!sameValue(indexed.cache.frontmatter?.[name], checkedValue) || !saved.version || saved.file.path !== file.path
      || indexed.document.version !== saved.version || indexed.document.content !== saved.content || Boolean(indexed.document.hasBom) !== Boolean(saved.hasBom)
      || session && (session.originRoot !== app.vault.rootPath || session.text !== indexed.text || session.isReloading || session.isSaving)
      || !session && (views.length > 0 || indexed.text !== indexed.document.content)
      || views.some(view => !view.isLoaded || view.leaf.view !== view || view.session !== session || !view.editor.cm.dom.isConnected
        || view.editor.cm.composing || view.editor.cm.state.readOnly || view.editor.getValue() !== indexed.text)) { return null; }
    const handoff: StructuredPropertyHandoff = Object.freeze({ app, root: app.vault.rootPath!, file, path: file.path, name, value: freeze(checkedValue), text: indexed.text, saved, indexed, session, target: freeze(target),
      savedText: saved.content, savedVersion: saved.version, savedBom: saved.hasBom === true,
      peers: Object.freeze(views.map(view => Object.freeze({ view, editor: view.editor, cm: view.editor.cm, doc: view.editor.cm.state.doc, mode: view.getEditingMode() }))),
      widget: app.metadataTypeManager.getAssignedWidget(name), typeRegistry: preference(app.configuration.get("types", "types")), preferences: Object.freeze(["newLinkFormat", "useMarkdownLinks", "propertiesInDocument"].map(key => Object.freeze([key, preference(app.vault.getConfig(key))] as const))) });
    issued.add(handoff); return handoff;
  } catch { return null; }
}

/** One explicit visible transition. The existing editor owns all later review/Apply/Undo work. */
export async function openStructuredPropertyInSource(handoff: StructuredPropertyHandoff, pane: WorkspaceLeaf, owned: () => boolean, report?: (phase: string, guards: Readonly<Record<string, boolean>>) => void): Promise<MarkdownView> {
  const { app } = handoff, until = Date.now() + 5000;
  let opened: Peer | null = null, session: Session | null = handoff.session, saved: VaultDocument | null = handoff.session?.document ?? null, revoked = false, phase = "cached authority";
  const typesCurrent = (): boolean => { try { return handoff.widget === app.metadataTypeManager.getAssignedWidget(handoff.name) && sameValue(app.configuration.get("types", "types"), handoff.typeRegistry); } catch { return false; } };
  const preferencesCurrent = (): boolean => { try { return handoff.preferences.every(([key, value]) => sameValue(app.vault.getConfig(key), value)); } catch { return false; } };
  const current = (opening = false): boolean => {
    const authority = { notRevoked: !revoked, withinDeadline: Date.now() <= until, paneOwned: owned(), interactive: interactive(app), rootExact: app.vault.rootPath === handoff.root,
      filePathExact: handoff.file.path === handoff.path, fileIdentityExact: app.vault.getFileByPath(handoff.path) === handoff.file, savedAuthorityExact: savedMatches(handoff.saved, handoff),
      typesExact: typesCurrent(), preferencesExact: preferencesCurrent() };
    if (Object.values(authority).some(value => !value)) { report?.(phase, authority); return false; }
    const entry = app.metadataCache.getDocument(handoff.path), activeSession = app.workspace.sessions.get(handoff.path) ?? null;
    if (!entry || entry.missing || entry.cache.errors.length || entry.text !== handoff.text || !savedMatches(entry.document, handoff)
      || !sameValue(entry.cache.frontmatter?.[handoff.name], handoff.value) || entry.cache !== handoff.indexed.cache
      || (!opening && !opened && entry.document !== handoff.indexed.document)
      || activeSession !== session || session && (session.originRoot !== handoff.root || session.text !== handoff.text || session.isSaving || session.isReloading
        || session.document !== saved || !savedMatches(session.document, handoff))) { report?.(phase, { ...authority, cacheAndSessionExact: false,
          cacheIdentityExact: entry?.cache === handoff.indexed.cache, cachedTextExact: entry?.text === handoff.text, activeSessionExact: activeSession === session,
          sessionSavedIdentityExact: !session || session.document === saved }); return false; }
    const views = peersFor(app, handoff.file);
    if (views.length !== handoff.peers.length + (opened && !handoff.peers.some(peer => peer.view === opened!.view) ? 1 : 0)) { report?.(phase, { ...authority, peerCountExact: false }); return false; }
    const owners = handoff.peers.every(peer => views.includes(peer.view) && peer.view.isLoaded && peer.view.leaf.view === peer.view && peer.view.session === handoff.session
      && peer.view.editor === peer.editor && peer.editor.cm === peer.cm && peer.cm.state.doc === peer.doc && peer.cm.dom.isConnected && !peer.cm.composing && !peer.cm.state.readOnly
      && peer.editor.getValue() === handoff.text && peer.view.getEditingMode() === (opened?.view === peer.view ? "source" : peer.mode))
      && (!opened || opened.view.isLoaded && opened.view.leaf.view === opened.view && opened.view.session === session && opened.view.file === handoff.file
        && opened.view.editor === opened.editor && opened.editor.cm === opened.cm && opened.cm.state.doc === opened.doc && opened.editor.getValue() === handoff.text && opened.view.getEditingMode() === "source");
    report?.(phase, { ...authority, cacheAndSessionExact: true, peerCountExact: true, editorOwnersExact: owners }); return owners;
  };
  if (!issued.has(handoff) || used.has(handoff) || !current()) { return unavailable(); } used.add(handoff);
  let timer: ReturnType<typeof setTimeout> | null = null, stopType = (): void => {}, stopConfig = (): void => {}, stopTypeConfig = (): void => {};
  try {
    // The manager also relays inventory-finished events. Only an actual registry/
    // assigned-type difference retires that event; physical configuration changes
    // have their own sticky watcher, including same-value changes and reversions.
    const typeEvent = app.metadataTypeManager.on("changed", () => { try { if (!typesCurrent()) { revoked = true; } } catch { revoked = true; } }); stopType = () => typeEvent.emitter.offref(typeEvent);
    stopConfig = app.configuration.watch("app", () => { revoked = true; }, () => { revoked = true; });
    stopTypeConfig = app.configuration.watch("types", () => { revoked = true; }, () => { revoked = true; });
    const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Source review opening timed out. Any opened Source tab was kept; no property was changed.")), 5000); });
    const bounded = <T>(value: Promise<T>): Promise<T> => Promise.race([value, deadline]);
    if (!current()) { return unavailable(); }
    phase = "before physical source read";
    const disk = await bounded(app.vault.readDocument(handoff.path));
    if (!current() || !savedMatches(disk, handoff)) { return unavailable(); }
    const chosen = handoff.peers.find(peer => peer.view === app.workspace.getActiveViewOfType(MarkdownView)) ?? handoff.peers[0];
    if (chosen) {
      phase = "existing Source activation";
      opened = chosen;
      // Reuse the actual live CM/Undo owner; normal activateLeaf/openFile saves.
      if (pane.parent === chosen.view.leaf.parent) { app.workspace.dockLeaf(chosen.view.leaf, pane.parent, "right"); }
      chosen.view.setEditingMode("source", false); app.workspace.setActiveLeaf(chosen.view.leaf, { focus: false });
    } else {
      phase = "new Source allocation";
      const leaf = pane.getRoot() === app.workspace.rootSplit ? app.workspace.createLeafBySplit(pane, "vertical") : app.workspace.getLeaf("tab");
      const observe = (): void => {
        const view = leaf.view;
        if (!opened && view instanceof MarkdownView && view.isLoaded && view.file === handoff.file && view.session && view.getEditingMode() === "source") {
          session = view.session; saved = view.session.document;
          opened = { view, editor: view.editor, cm: view.editor.cm, doc: view.editor.cm.state.doc, mode: "source" };
        }
      };
      const events = ["layout-change", "active-leaf-change", "file-open", "editor-change"].map(event => app.workspace.on(event, observe));
      try { await bounded(leaf.setViewState({ type: "markdown", state: { file: handoff.path, mode: "source", source: true }, active: true })); }
      finally { events.forEach(event => event.emitter.offref(event)); }
      if (!opened || leaf.view !== (opened as Peer).view) { report?.(phase, { SourceOwnerAcknowledged: false }); return unavailable(); }
    }
    phase = "Source acknowledgement";
    if (!current(true) || !opened) { return unavailable(); }
    const view = (opened as Peer).view;
    phase = "after physical Source read";
    const after = await bounded(app.vault.readDocument(handoff.path));
    if (!current(true)) { return unavailable(); }
    const visible = { physicalSourceExact: savedMatches(after, handoff), sourceActive: app.workspace.activeLeaf === view.leaf,
      sourceVisible: view.sourceEl.checkVisibility(), sourceContentEditable: view.editor.cm.contentDOM.isContentEditable, sourceEditorEditable: view.editor.cm.state.facet(EditorView.editable) };
    report?.(phase, visible);
    if (Object.values(visible).some(value => !value)) { return unavailable(); }
    return view;
  } finally { if (timer !== null) { clearTimeout(timer); } stopTypeConfig(); stopConfig(); stopType(); }
}
