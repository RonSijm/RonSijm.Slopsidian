import type { App } from "./app";
import { BaseDocument } from "./bases-model";
import { parseCanvas } from "./canvas-model";
import { draftExtension, type DraftRecord, type RecoveryOptions } from "./persistent-draft-model";
import { liveDirtyOwner } from "./persistent-draft-owners";

/** Format checks used before a destructive replacement. Plugin views are accepted only while a view for the file type is registered. */
export function validateDraftForReplace(app: App, record: DraftRecord): string | null {
  const provider = record.provider;
  if (provider === undefined) { return null; }
  try {
    if (provider === "core:canvas") { parseCanvas(record.content); return null; }
    if (provider === "core:bases") { new BaseDocument(record.content); return null; }
  } catch (error) { return String((error as Error)?.message ?? error); }
  const viewType = provider.slice("view:".length), extension = draftExtension(provider, record.path).slice(1).toLowerCase();
  return app.workspace.viewTypeForExtension(extension) === viewType ? null : "the plugin view \"" + viewType + "\" is not registered for ." + extension + " files in this session";
}

export const recoveryOptions = (app: App): RecoveryOptions => ({ validate: record => validateDraftForReplace(app, record), liveOwner: record => liveDirtyOwner(app, record) });
