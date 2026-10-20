"use strict";

function assertBackendExitedCleanly(code, signal) {
  if (code !== 0 || signal) {
    throw new Error(`The .NET host exited abnormally: code=${code}, signal=${signal}`);
  }
}

/** Close the prepared owner through Electron's normal close path, preserving native/unload vetoes. */
function closePreparedWindow(owner, { timeoutMs = 10000 } = {}) {
  if (!owner || owner.isDestroyed()) { return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const contents = owner.webContents;
    let settled = false, timer;
    const finish = error => {
      if (settled) { return; }
      settled = true;
      clearTimeout(timer);
      owner.removeListener("closed", closed);
      owner.removeListener("close", closing);
      contents.removeListener("will-prevent-unload", unloadVeto);
      if (error) { reject(error); } else { resolve(); }
    };
    const veto = () => {
      const error = new Error("The editor window refused to close. The local host was kept running.");
      error.code = "WINDOW_CLOSE_VETOED";
      finish(error);
    };
    const closed = () => finish();
    const closing = event => queueMicrotask(() => { if (event.defaultPrevented && !owner.isDestroyed()) { veto(); } });
    // Do not preventDefault here: that would override the page's request to remain open.
    const unloadVeto = () => veto();
    owner.once("closed", closed);
    owner.on("close", closing);
    contents.on("will-prevent-unload", unloadVeto);
    timer = setTimeout(() => {
      const error = new Error("The editor window did not confirm closing. The local host was kept running.");
      error.code = "WINDOW_CLOSE_UNCONFIRMED";
      finish(error);
    }, timeoutMs);
    try { owner.close(); } catch (error) { finish(error); }
  });
}

/** The renderer has already saved and checkpointed. Disconnect it before draining the server's live circuits. */
async function finishPreparedShutdown({ owner, allowWindowClose, cancelWindowClose, resumeAfterVeto, stopBackend, quit, timeoutMs }) {
  allowWindowClose();
  try { await closePreparedWindow(owner, { timeoutMs }); }
  catch (error) {
    cancelWindowClose();
    if (error.code === "WINDOW_CLOSE_VETOED") {
      try { await resumeAfterVeto(); }
      catch (resumeError) {
        const failure = new AggregateError([error, resumeError], "The window stayed open, but editing could not be fully resumed.");
        failure.closeNotCommitted = true;
        throw failure;
      }
    }
    error.closeNotCommitted = true;
    throw error;
  }
  await stopBackend();
  quit();
}

module.exports = { assertBackendExitedCleanly, closePreparedWindow, finishPreparedShutdown };
