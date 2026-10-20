// Boundary fixture: never hold unrelated vault/preview reads on the browser's
// shared File prototype. Native folder enumeration has its own IPC boundary.
function installAttachmentReadHold({ name, size, relativePath = "", nativeFolder = false }) {
  const original = File.prototype.arrayBuffer;
  const electron = nativeFolder && typeof require === "function" ? require("electron") : null;
  const invoke = electron?.ipcRenderer?.invoke;
  const restore = () => { File.prototype.arrayBuffer = original; if (invoke) { electron.ipcRenderer.invoke = invoke; } };
  const probe = globalThis.attachmentReadProbe = { held: false, source: null, restore };
  const hold = (read, source) => {
    restore();
    probe.held = true; probe.source = source;
    return new Promise(resolve => { probe.release = () => resolve(read()); });
  };
  File.prototype.arrayBuffer = function () {
    if (this.name !== name || this.size !== size || (this.webkitRelativePath || "") !== relativePath) { return original.call(this); }
    const file = this;
    return hold(() => original.call(file), { kind: "file", name: file.name, size: file.size, relativePath: file.webkitRelativePath || "" });
  };
  if (invoke) {
    electron.ipcRenderer.invoke = function (channel, ...args) {
      if (channel !== "vault:attachment-folder") { return invoke.call(this, channel, ...args); }
      return hold(() => invoke.call(this, channel, ...args), { kind: "native-folder", channel, args });
    };
  }
}

export function attachmentReadHoldScript(selection) {
  return `(${installAttachmentReadHold.toString()})(${JSON.stringify(selection)})`;
}
