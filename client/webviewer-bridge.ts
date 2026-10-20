import type { IpcRenderer } from "electron";
import { getBrowserHost } from "./contracts";

export function webViewerIpc(): IpcRenderer | null {
  if (getBrowserHost()) { return null; }
  try {
    // A bundled require shim can exist in a normal browser; check the actual bridge.
    const ipc = typeof require === "function" ? require("electron").ipcRenderer as IpcRenderer | undefined : undefined;
    return ipc && typeof ipc.invoke === "function" ? ipc : null;
  } catch { return null; }
}
