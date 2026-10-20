import type { App } from "./app";
import { EditorView } from "@codemirror/view";
import { outgoingMentionAuthority, sameOutgoingMentionAuthority, type OutgoingMentionAuthority } from "./outgoing-mention-authoring";
import { outgoingMentionIntentAuthority, sameOutgoingMentionIntentAuthority, type OutgoingMentionIntentAuthority } from "./outgoing-mention-intent";
import { MarkdownView, type WorkspaceLeaf } from "./workspace";

export type NewDestinationSource = OutgoingMentionAuthority | OutgoingMentionIntentAuthority;
const changed = (): never => { throw new Error("The source note or its visible owner changed. No destination or link was created by this review."); };
export function newDestinationInteractive(app: App, ownedMutation = false): boolean {
  return !app.vault.readOnly && !app.changingVault && !app.core.busy && app.core.isEnabled("outgoing-link")
    && !app.workspace.isChangingLayout && (ownedMutation || !app.workspace.isChangingFiles);
}
export function newDestinationSourceCurrent(source: OutgoingMentionAuthority, ownedMutation = false): boolean {
  const { app, view, session } = source, indexed = app.metadataCache.getDocument(source.path);
  return newDestinationInteractive(app, ownedMutation) && app.vault.rootPath === source.root && source.file.path === source.path
    && app.vault.getFileByPath(source.path) === source.file && view.isLoaded && view.leaf.view === view && view.file === source.file
    && view.editor === source.editor && source.editor.cm === source.cm && source.cm.state.doc === source.cmDocument && source.cm.dom.isConnected
    && !source.cm.composing && (ownedMutation || !source.cm.state.readOnly && source.cm.state.facet(EditorView.editable))
    && view.getMode() === source.mode && view.getEditingMode() === source.editingMode && source.editingMode === "source"
    && view.sourceEl.checkVisibility() && view.session === session && app.workspace.sessions.get(source.path) === session
    && session.originRoot === source.root && !session.isSaving && !session.isReloading && session.text === source.text && view.editor.getValue() === source.text
    && session.document === source.document && source.document.file.path === source.path && source.document.version === source.savedVersion
    && source.document.content === source.savedText && (source.document.hasBom === true) === source.savedBom
    && Boolean(indexed && !indexed.missing && !indexed.cache.errors.length && indexed.text === source.text && indexed.document.version === source.savedVersion
      && indexed.document.content === source.savedText && (indexed.document.hasBom === true) === source.savedBom)
    && source.preferences.every(([key, value]) => app.vault.getConfig(key) === value);
}

export function newDestinationSourceAvailable(app: App, file: NewDestinationSource["file"], text: string): NewDestinationSource | null {
  if (!newDestinationInteractive(app)) { return null; }
  const views = app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view);
  const view = views.find((view): view is MarkdownView => view instanceof MarkdownView && view.file === file && view.getMode() === "source") ?? null;
  return outgoingMentionAuthority(app, file, text, view) ?? outgoingMentionIntentAuthority(app, file, text);
}
export function newDestinationSourceUnchanged(source: NewDestinationSource): boolean {
  return "kind" in source
    ? sameOutgoingMentionIntentAuthority(source, outgoingMentionIntentAuthority(source.app, source.file, source.text))
    : sameOutgoingMentionAuthority(source, outgoingMentionAuthority(source.app, source.file, source.text, source.view));
}

/** Source-only transition: a missing destination is never represented by a forged TFile. */
export async function showNewDestinationSource(source: NewDestinationSource, owned: () => boolean, pane?: WorkspaceLeaf): Promise<OutgoingMentionAuthority> {
  const { app } = source, until = Date.now() + 5_000;
  const initial = (): boolean => owned() && Date.now() <= until && newDestinationSourceUnchanged(source);
  if (!initial()) { return changed(); }
  const disk = await app.vault.readDocument(source.path);
  if (!initial() || disk.file.path !== source.path || disk.version !== source.savedVersion || disk.content !== source.savedText || (disk.hasBom === true) !== source.savedBom) { return changed(); }
  let opened: MarkdownView | null = "kind" in source ? source.peers[0]?.view ?? null : source.view;
  let savedPeer = opened ? { view: opened, editor: opened.editor, cm: opened.editor.cm, doc: opened.editor.cm.state.doc, session: opened.session, saved: opened.savedDocument } : null;
  if (opened) {
    opened.setEditingMode("source", false); app.workspace.setActiveLeaf(opened.leaf, { focus: false });
  } else {
    const leaf = pane && pane.getRoot() === app.workspace.rootSplit ? app.workspace.createLeafBySplit(pane, "vertical") : app.workspace.getLeaf("tab");
    const observe = (): void => {
      if (!opened && leaf.view instanceof MarkdownView && leaf.view.file === source.file && leaf.view.isLoaded && leaf.view.session && leaf.view.getEditingMode() === "source") {
        opened = leaf.view; savedPeer = { view: opened, editor: opened.editor, cm: opened.editor.cm, doc: opened.editor.cm.state.doc, session: opened.session, saved: opened.savedDocument };
      }
    };
    const refs = ["layout-change", "active-leaf-change", "file-open", "editor-change"].map(name => app.workspace.on(name, observe));
    try { await leaf.setViewState({ type: "markdown", state: { file: source.path, mode: "source", source: true }, active: true }); observe(); }
    finally { refs.forEach(ref => ref.emitter.offref(ref)); }
    if (!opened || leaf.view !== opened || !savedPeer) { return changed(); }
  }
  const view = opened as MarkdownView;
  const sameOwner = (): boolean => Boolean(savedPeer && view === savedPeer.view && view.editor === savedPeer.editor && view.editor.cm === savedPeer.cm
    && view.editor.cm.state.doc === savedPeer.doc && view.session === savedPeer.session && view.savedDocument === savedPeer.saved);
  let live = outgoingMentionAuthority(app, source.file, source.text, view);
  while (!live && owned() && Date.now() < until && sameOwner()) {
    await new Promise(resolve => setTimeout(resolve, 25)); live = outgoingMentionAuthority(app, source.file, source.text, view);
  }
  if (!live || !owned() || Date.now() > until || app.workspace.activeLeaf !== view.leaf || !newDestinationSourceCurrent(live)
    || live.savedVersion !== source.savedVersion || live.savedText !== source.savedText || live.savedBom !== source.savedBom
    || !sameOwner()) { return changed(); }
  if ("kind" in source && source.peers.some(peer => peer.view !== view && (!peer.view.isLoaded || peer.view.leaf.view !== peer.view || peer.view.session !== source.session
    || peer.view.editor !== peer.editor || peer.editor.cm !== peer.cm || peer.cm.state.doc !== peer.cmDocument || peer.view.getEditingMode() !== peer.editingMode || peer.editor.getValue() !== source.text))) { return changed(); }
  const after = await app.vault.readDocument(source.path);
  if (!owned() || Date.now() > until || !newDestinationSourceCurrent(live) || after.file.path !== source.path || after.version !== source.savedVersion
    || after.content !== source.savedText || (after.hasBom === true) !== source.savedBom) { return changed(); }
  return live;
}
