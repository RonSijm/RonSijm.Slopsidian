import { requestJson, type VaultConfigurationDocument, type WorkspaceLayout } from "./contracts";
import { importObsidianWorkspace } from "./workspace-import";
import { RecentFiles } from "./recent-files";

export interface StartupWorkspace {
  layout: WorkspaceLayout | null;
  source: "local" | "obsidian" | "empty";
  warnings: string[];
  error?: Error;
}

interface StartupWorkspaceIO {
  saved(root: string): Promise<WorkspaceLayout | null>;
  original(root: string): Promise<VaultConfigurationDocument>;
  validate(root: string, layout: WorkspaceLayout): Promise<WorkspaceLayout>;
}

export function readOriginalWorkspace(root: string): Promise<VaultConfigurationDocument> {
  return requestJson(`/api/workspace/original?root=${encodeURIComponent(root)}`);
}

export function prepareOriginalWorkspace(root: string, document: VaultConfigurationDocument): StartupWorkspace {
  if (document.root !== root || document.id !== "workspace") { throw new Error("The original workspace belongs to a different vault."); }
  if (document.version === null) { return { layout: null, source: "empty", warnings: [] }; }
  const imported = importObsidianWorkspace(document.data);
  imported.layout.views = { "workspace-startup": { source: ".obsidian/workspace.json", version: document.version, warnings: imported.warnings } };
  if (document.data.lastOpenFiles !== undefined) {
    const recent = new RecentFiles();
    recent.load(document.data.lastOpenFiles);
    imported.layout.views["workspace-recent-files"] = { paths: recent.serialize() };
  }
  return { layout: imported.layout, source: "obsidian", warnings: imported.warnings };
}

const transport: StartupWorkspaceIO = {
  saved: root => requestJson(`/api/workspace?root=${encodeURIComponent(root)}`),
  original: readOriginalWorkspace,
  validate: (root, layout) => requestJson(`/api/workspace/validate?root=${encodeURIComponent(root)}`, "POST", layout),
};

/** A broken local layout retains the existing recovery guard; only original-import failures fall back. */
export async function startupWorkspace(root: string, io: StartupWorkspaceIO = transport): Promise<StartupWorkspace> {
  const local = await io.saved(root);
  if (local !== null) { return { layout: local, source: "local", warnings: [] }; }
  try {
    const selected = prepareOriginalWorkspace(root, await io.original(root));
    if (selected.layout) { selected.layout = await io.validate(root, selected.layout); }
    return selected;
  } catch (cause) {
    return { layout: null, source: "empty", warnings: [], error: new Error(
      "Could not import .obsidian/workspace.json. Its bytes were retained; notes remain available. Use 'Import Obsidian active workspace' to retry after fixing the source.", { cause }),
    };
  }
}
