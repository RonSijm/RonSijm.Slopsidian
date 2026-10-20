import type { Plugin } from "./plugin";
import type { View } from "./views";

// This adapter follows the unchanged 2.29.0 package's save-outcome contract.
// Other versions keep the ordinary API refusal rather than pretending a save succeeded.
function supported(plugin: Plugin): boolean {
  return plugin.manifest.id === "obsidian-excalidraw-plugin" && plugin.manifest.version === "2.29.0";
}

function constrainFlag(target: object, key: string, forced: boolean, readOnly: () => boolean): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor?.configurable || !descriptor.writable || typeof descriptor.value !== "boolean") {
    throw new Error(`The Excalidraw read-only adapter cannot constrain ${key}.`);
  }
  let requested = descriptor.value as boolean;
  Object.defineProperty(target, key, { configurable: true, enumerable: descriptor.enumerable,
    get: () => readOnly() ? forced : requested, set: (value: boolean) => { requested = value; } });
  return () => { Object.defineProperty(target, key, { ...descriptor, value: requested }); };
}

export function configureReadOnlyPlugin(plugin: Plugin): void {
  if (!plugin.app.vault.readOnly || !supported(plugin)) { return; }
  const readOnly = () => plugin.app.vault.readOnly;
  const restoreAutosave = constrainFlag(plugin, "autosaveEnabled", false, readOnly);
  try {
    const restoreViewMode = constrainFlag(plugin, "forceExcalidrawViewMode", true, readOnly);
    plugin.register(() => { restoreViewMode(); restoreAutosave(); });
  } catch (error) { restoreAutosave(); throw error; }
}

interface ExcalidrawView extends View {
  executeSaveRequest(...args: unknown[]): Promise<unknown>;
  updateScene(scene: { appState?: Record<string, unknown>; [key: string]: unknown }): unknown;
  onChange(elements: unknown, state: Record<string, unknown>, files: unknown): unknown;
}

export function configureReadOnlyPluginView(plugin: Plugin, candidate: View): View {
  if (!plugin.app.vault.readOnly || !supported(plugin) || candidate.getViewType() !== "excalidraw") { return candidate; }
  const view = candidate as ExcalidrawView;
  if (typeof view.executeSaveRequest !== "function" || typeof view.updateScene !== "function" || typeof view.onChange !== "function") {
    throw new Error("This Excalidraw view does not support the read-only save-outcome adapter.");
  }
  const save = view.executeSaveRequest, update = view.updateScene, change = view.onChange;
  Object.defineProperty(view, "isReadOnly", { configurable: true, get: () => view.app.vault.readOnly });
  view.executeSaveRequest = async function (...args) {
    // 'skipped' acknowledges no revision and triggers no backup/export/write handoff.
    return this.app.vault.readOnly ? { status: "skipped" } : save.apply(this, args);
  };
  view.updateScene = function (scene) {
    return update.call(this, this.app.vault.readOnly ? { ...scene, appState: { ...scene.appState, viewModeEnabled: true } } : scene);
  };
  view.onChange = function (elements, state, files) {
    if (this.app.vault.readOnly && state.viewModeEnabled === false) {
      this.updateScene({ appState: { viewModeEnabled: true }, captureUpdate: "NEVER" });
      return;
    }
    return change.call(this, elements, state, files);
  };
  return view;
}
