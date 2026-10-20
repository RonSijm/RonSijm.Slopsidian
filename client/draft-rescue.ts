import type { App } from "./app";

/** Local, synchronous capture; never saves, unloads views or calls the host. */
export function captureMarkdownDrafts(app: App): unknown {
  const drafts = [];
  for (const [path, session] of app.workspace.sessions) {
    if (!session.dirty && !session.isSaving) { continue; }
    if (typeof session.originRoot !== "string" || !session.originRoot || path !== session.document.file.path) {
      throw new Error("A Markdown draft's original vault could not be identified. Keep this window open.");
    }
    drafts.push({
      sourceRoot: session.originRoot,
      sourcePath: path,
      sourceVersion: session.document.version,
      hasBom: session.document.hasBom ?? false,
      content: session.text,
    });
  }
  return { schemaVersion: 1, capturedAt: new Date().toISOString(), drafts };
}
