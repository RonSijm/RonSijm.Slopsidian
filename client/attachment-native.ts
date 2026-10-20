import type { DirectorySource } from "./attachment-directory";

interface NativeFolder { root: string; files: { name: string; size: number; bytes: Uint8Array }[]; }
interface ElectronLike { webUtils?: { getPathForFile(file: File): string }; ipcRenderer?: { invoke(channel: string, ...args: unknown[]): Promise<unknown> }; }
interface Environment { require?: (name: string) => unknown; electronVersion?: string }

/**
 * Only the real runtime marks the desktop shell: `process.versions.electron`. The bundled `require` identifier is an
 * esbuild shim in browser builds, so it is never a signal. A standalone browser has no Electron runtime and uses
 * browser enumeration; a desktop shell with a missing or broken native bridge is an error, never a silent downgrade.
 */
export function nativeFolderSourcesAvailable(environment: Environment = {
  require: (name: string) => require(name),
  electronVersion: (globalThis as { process?: { versions?: { electron?: string } } }).process?.versions?.electron
}): boolean {
  if (!environment.electronVersion) { return false; }
  let host: ElectronLike | undefined;
  try { host = environment.require?.("electron") as ElectronLike | undefined; } catch { host = undefined; }
  if (!host?.webUtils || !host.ipcRenderer) { throw new Error("The desktop native folder-source bridge is unavailable, so the folder was not imported."); }
  return true;
}

function electron(): ElectronLike { return require("electron") as ElectronLike; }

async function read(root: string, expected: string[]): Promise<DirectorySource[]> {
  const host = electron();
  const folder = await host.ipcRenderer!.invoke("vault:attachment-folder", root, expected) as NativeFolder;
  return folder.files.map(file => {
    const bytes = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer;
    return { name: file.name, size: file.size, arrayBuffer: async () => bytes };
  });
}

/** A webkitdirectory selection: derive the one selected root from each file's real path and relative path. */
export async function nativePickedFolder(files: readonly File[]): Promise<DirectorySource[]> {
  const host = electron(), paths = files.map(file => host.webUtils!.getPathForFile(file));
  let root = "";
  files.forEach((file, index) => {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "", actual = paths[index].replace(/\\/g, "/");
    if (!paths[index] || !relative || !actual.endsWith("/" + relative)) { throw new Error("The selected folder file has no verifiable local path: " + file.name); }
    const derived = actual.slice(0, actual.length - relative.length) + relative.split("/")[0];
    if (root && root.toLowerCase() !== derived.toLowerCase()) { throw new Error("Import one folder at a time."); }
    root = derived;
  });
  return read(root, paths);
}

/** A dropped folder: its own File carries the selected root path. */
export function nativeDroppedFolder(rootFile: File): Promise<DirectorySource[]> {
  const path = electron().webUtils!.getPathForFile(rootFile);
  if (!path) { throw new Error("The dropped folder has no verifiable local path."); }
  return read(path, []);
}
