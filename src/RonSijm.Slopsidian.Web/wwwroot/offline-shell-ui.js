import { OfflineShell, ShellError } from "./offline-shell.js";

const root = document.getElementById("offline-shell");
if (root) {
  const supported = Boolean(window.isSecureContext && "serviceWorker" in navigator && window.caches && window.crypto?.subtle && navigator.locks);
  const shell = new OfflineShell({
    base: document.baseURI, caches: supported ? window.caches : null, fetch: window.fetch.bind(window),
    serviceWorker: supported ? navigator.serviceWorker : null, subtle: window.crypto?.subtle, locks: supported ? navigator.locks : null, controlled: Boolean(navigator.serviceWorker?.controller),
  });
  const summary = root.querySelector("summary"), status = root.querySelector("[data-offline-status]"), counts = root.querySelector("[data-offline-counts]"), progress = root.querySelector("progress");
  const button = name => root.querySelector(`[data-offline-${name}]`);
  const prepare = button("prepare"), check = button("check"), verify = button("verify"), cancel = button("cancel"), remove = button("remove");
  let operation = null;
  const size = value => value < 1048576 ? `${(value / 1024).toFixed(0)} KiB` : `${(value / 1048576).toFixed(1)} MiB`;
  const set = (state, text) => { root.dataset.offlineState = state; status.textContent = text; summary.textContent = "Offline app · " + ({ ready: "ready", "not-prepared": "not saved", incomplete: "incomplete", corrupt: "damaged", unsupported: "unavailable", busy: "working…", error: "error" }[state] ?? state); };
  const busy = on => { for (const control of [prepare, check, verify, remove]) { control.disabled = on || control.dataset.offlineLocked === "true"; } cancel.hidden = !on; cancel.disabled = false; };
  const describe = async () => {
    const state = await shell.status();
    root.dataset.offlineVersion = state.version ?? ""; root.dataset.offlineBootVersion = state.bootVersion ?? "";
    progress.hidden = true; counts.textContent = "";
    if (state.state === "unsupported") { set("unsupported", state.reason); prepare.disabled = check.disabled = verify.disabled = remove.disabled = true; return state; }
    const boot = state.bootVersion ? ` This page is running from the offline copy (${state.bootVersion.slice(0, 8)}).` : " This page was loaded from the network.";
    if (state.state === "ready") { set("ready", `Offline copy ${state.version.slice(0, 8)} is saved: ${state.files} files, ${size(state.bytes)}.${boot}` + (state.reloadRequired ? " Reload to use the newer copy." : "")); prepare.textContent = "Update offline app"; }
    else if (state.state === "not-prepared") { set("not-prepared", "Nothing is saved yet. Preparing downloads the complete app once so it can start without a network. Vault secrets and GitHub data are never part of it."); prepare.textContent = "Prepare offline app"; }
    else { set(state.state, state.reason || "The offline copy needs attention."); prepare.textContent = "Repair offline app"; }
    return state;
  };
  const run = async (work) => {
    if (operation) { return; }
    const controller = operation = new AbortController(); busy(true);
    try { await work(controller.signal); } catch (error) {
      const code = error instanceof ShellError ? error.code : "error";
      await describe().catch(() => {});
      set(code === "cancelled" ? "incomplete" : "error", (error instanceof Error ? error.message : String(error)));
      root.dataset.offlineError = code;
    } finally { operation = null; busy(false); }
  };
  prepare.addEventListener("click", () => run(async signal => {
    delete root.dataset.offlineError; progress.hidden = false; set("busy", "Preparing the offline app…");
    const result = await shell.prepare({ signal, onProgress: update => {
      progress.max = update.totalFiles; progress.value = update.completedFiles;
      counts.textContent = `${update.completedFiles} of ${update.totalFiles} files · ${size(update.completedBytes)} of ${size(update.totalBytes)}${update.reusedFiles ? ` · ${update.reusedFiles} reused` : ""} · ${update.phase}`;
    } });
    await describe();
    if (result.reloadRequired) { status.textContent += " Reload this page to start from the new offline copy."; }
  }));
  check.addEventListener("click", () => run(async signal => {
    set("busy", "Checking the server for a newer version…");
    const result = await shell.check({ signal });
    await describe();
    status.textContent = (result.upToDate ? "The offline copy is current. " : `A different version (${result.available.slice(0, 8)}, ${result.files} files, ${size(result.bytes)}) is available. Press Update; nothing changes until it is complete. `) + status.textContent;
  }));
  verify.addEventListener("click", () => run(async signal => {
    set("busy", "Verifying every saved file…");
    const result = await shell.verify({ signal });
    await describe();
    if (!result.ok) { set("corrupt", `${result.corrupt.length} damaged and ${result.missing.length} missing files. Repair the offline app while online.`); }
    else { status.textContent = `All ${result.files} saved files match their published hashes. ` + status.textContent; }
  }));
  cancel.addEventListener("click", () => { operation?.abort(); cancel.disabled = true; });
  remove.addEventListener("click", () => run(async () => { await shell.remove(); await describe(); }));
  // Boot status: record the adopted version this page started under so the UI never claims a mixed state.
  shell.readPointer().then(pointer => { if (navigator.serviceWorker?.controller && pointer) { shell.bootVersion = pointer.version; } }).catch(() => {}).then(describe).then(() => { root.hidden = false; });
}
