import type { App } from "./app";
import type { DraftRecord } from "./persistent-draft-model";
import type { CaptureSession } from "./persistent-drafts";
import type { TextDraftSnapshot } from "./views";

/** Structural slice of TextFileView used by capture; keeps this module free of view/DOM imports at runtime. */
export interface DraftCapableView {
  draftRecoveryProvider: string | null;
  captureDraft(): TextDraftSnapshot | null;
}

const isDraftView = (view: unknown): view is DraftCapableView =>
  typeof view === "object" && view !== null && typeof (view as DraftCapableView).captureDraft === "function" && "draftRecoveryProvider" in view;

/**
 * Non-Markdown owners. Built-in Canvas/Bases serialise through their own models. An opted-in plugin view is never
 * serialised while the page is being torn down: its previous capture stays, and its owner is reported as deferred.
 */
export function textViewOwners(app: App, teardown = false): [string, CaptureSession][] {
  const owners: [string, CaptureSession][] = [];
  for (const leaf of app.workspace.leaves()) {
    const view: unknown = leaf.view;
    if (!isDraftView(view)) { continue; }
    const provider = view.draftRecoveryProvider;
    if (!provider) { continue; }
    const file = (view as unknown as { file: { path: string } | null }).file;
    if (teardown && provider.startsWith("view:") && file) {
      owners.push([file.path, { provider, originRoot: null, dirty: false, isSaving: false, text: "", deferred: true, document: { file: { path: file.path }, version: "" } }]);
      continue;
    }
    const snapshot = view.captureDraft();
    if (!snapshot) { continue; }
    owners.push([snapshot.path, {
      provider, originRoot: snapshot.root, dirty: snapshot.state === "dirty", isSaving: snapshot.saving, text: snapshot.text,
      busy: snapshot.state === "busy", ...(snapshot.error === undefined ? {} : { error: snapshot.error }),
      document: { file: { path: snapshot.path }, version: snapshot.version, hasBom: snapshot.hasBom },
    }]);
  }
  return owners;
}

/** A live view in this window that still holds unsaved text for the same note must not be overwritten underneath. */
export function liveDirtyOwner(app: App, record: DraftRecord): string | null {
  if (record.vaultRoot !== app.vault.rootPath) { return null; }
  for (const [path, owner] of textViewOwners(app)) {
    if (path !== record.path) { continue; }
    if (owner.error !== undefined || owner.deferred) { return "A view in this window could not confirm that it is clean (" + (owner.error ?? "deferred") + ")."; }
    if (owner.dirty || owner.isSaving || owner.busy) { return "A view in this window still holds unsaved changes for this file."; }
  }
  for (const [path, session] of app.workspace.sessions as unknown as Iterable<[string, { dirty: boolean; isSaving: boolean }]>) {
    if (path === record.path && (session.dirty || session.isSaving)) { return "A note editor in this window still holds unsaved changes for this file."; }
  }
  return null;
}
