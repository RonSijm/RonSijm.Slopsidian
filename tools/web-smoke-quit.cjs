// Acknowledged quit channel between the smoke harness and the fixture host: the harness asks over the renderer console,
// the host accepts only the exact per-run nonce from its own main frame and answers on stdout before exiting.
const REQUEST = "SLOPSIDIAN_QUIT ";
const ACK = "WEB_QUIT_ACK ";
const REJECTED = "WEB_QUIT_REJECTED ";

const request = nonce => REQUEST + nonce;
const ack = nonce => ACK + nonce;

function assertCleanExit({ exitCode, signal, forced }, label = "Browser fixture") {
  if (exitCode !== 0 || signal != null || forced !== false) {
    throw new Error(`${label} did not exit cleanly: ${JSON.stringify({ exitCode, signal, forced })}`);
  }
}

function fixtureDrainScript() {
  return `(${async function drainFixture() {
    const result = { app: typeof app !== "undefined" && Boolean(app?.workspace), lifecycle: [] };
    const within = async (promise, name) => {
      let timer;
      try {
        const idle = await Promise.race([Promise.resolve(promise).then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 5000); })]);
        result.lifecycle.push({ name, idle });
      } finally { clearTimeout(timer); }
    };
    if (result.app) {
      await within(app.workspace.whenIdle(), "workspace");
      if (app.configuration?.whenIdle) await within(app.configuration.whenIdle(), "configuration");
      if (result.lifecycle.some(item => !item.idle)) { result.drained = false; return result; }
    }
    for (let i = 0; i < 50; i++) {
      const state = await navigator.locks.query();
      const open = [...state.held, ...state.pending].filter(lock => lock.name.startsWith("slopsidian-shell-mutation:"));
      if (!open.length) { result.polls = i; result.drained = true; return result; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    result.drained = false;
    return result;
  }.toString()})()`;
}

/** Returns { ignore } for unrelated console output, { ok:false, reason } for a bad request, or { ok:true }. */
function acceptQuit({ nonce, message, frame, mainFrame, frameUrl, origin }) {
  if (typeof message !== "string" || !message.startsWith(REQUEST)) return { ignore: true };
  if (!nonce) return { ok: false, reason: "no-nonce-configured" };
  if (message !== request(nonce)) return { ok: false, reason: "wrong-nonce" };
  if (!frame || frame !== mainFrame) return { ok: false, reason: "not-main-frame" };
  if (!URL.canParse(frameUrl ?? "") || new URL(frameUrl).origin !== origin) return { ok: false, reason: "wrong-origin" };
  return { ok: true };
}

/**
 * Drains, then commits the quit only after a successful drain. One absolute deadline covers ack and exit.
 * `acked` resolves true only on the real nonce acknowledgement; `exited` resolves when the process ends.
 */
async function acknowledgedQuit({ drain, sendRequest, acked, exited, kill, deadlineMs = 10000 }) {
  const drained = await drain();
  if (!drained?.drained) {
    // The normal quit request is never committed after a failed drain; the owned process is stopped explicitly instead.
    await kill();
    return { drain: drained, committed: false, acknowledged: false, exited: false, forced: true, cleanup: "killed-after-failed-drain" };
  }
  let timer;
  const deadline = new Promise(resolve => { timer = setTimeout(() => resolve("deadline"), deadlineMs); });
  try {
    const request = Promise.resolve(sendRequest()).then(() => null, error => String(error?.message ?? error));
    const confirmedAck = acked.then(value => value === true ? "ack" : new Promise(() => {}));
    const first = await Promise.race([confirmedAck, exited.then(() => "exit"), deadline]);
    const acknowledged = first === "ack";
    const stopped = first === "exit" || (acknowledged && await Promise.race([exited.then(() => true), deadline.then(() => false)]));
    let forced = false;
    if (!stopped) { forced = true; await kill(); }
    return { drain: drained, committed: true, acknowledged, exited: Boolean(stopped), forced, early: first === "exit", deadlineHit: first === "deadline" || (acknowledged && !stopped), requestError: await Promise.race([request, Promise.resolve(undefined)]) ?? null };
  } finally { clearTimeout(timer); }
}

module.exports = { ACK, REJECTED, REQUEST, ack, acceptQuit, acknowledgedQuit, assertCleanExit, fixtureDrainScript, request };
