import nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Runs only inside Windows Sandbox. Self-contained so it can be copied alone next to the reference payload.
const INPUT = 'C:\\ReferenceInput';
const OUTPUT = 'C:\\ReferenceOutput';
const APP = 'C:\\ReferenceApp';
const GUEST_USER = 'WDAGUtilityAccount';
const PROFILE = `C:\\Users\\${GUEST_USER}`;
const ROAMING = `${PROFILE}\\AppData\\Roaming`;
const VAULT = `${PROFILE}\\CaptureVault`;
const DEBUG_PORT = 9222;
const EXPECTED_VERSION = '1.12.7';

export class GuardError extends Error {}

const w = path.win32;
const sha256Bytes = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const sha256File = (fs, file) => sha256Bytes(fs.readFileSync(file));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const HEX64 = /^[0-9a-f]{64}$/;

// Rejects anything that could escape the staged app directory or carry unvalidated fields.
export function validateManifest(manifest, nonce) {
  const fail = (message) => { throw new GuardError(`invalid manifest: ${message}`); };
  if (!manifest || manifest.schema !== 'original-reference-input/1') fail('schema');
  if (!/^[0-9a-f]{32}$/.test(manifest.nonce ?? '') || (nonce && manifest.nonce !== nonce)) fail('nonce');
  if (!HEX64.test(manifest.node?.sha256 ?? '')) fail('node hash');
  if (!HEX64.test(manifest.reference?.installerSha256 ?? '') || !HEX64.test(manifest.reference?.asarSha256 ?? '')) fail('reference hashes');
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) fail('files');
  const seen = new Set();
  for (const file of manifest.files) {
    const p = file?.path;
    if (typeof p !== 'string' || !p.startsWith('app\\') || /[:<>"|?*\u0000-\u001f/]/.test(p)) fail(`path ${p}`);
    if (w.isAbsolute(p) || w.normalize(p) !== p || p.split('\\').some((s) => s === '' || s === '.' || s === '..')) fail(`path ${p}`);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || !HEX64.test(file.sha256 ?? '')) fail(`size/hash ${p}`);
    if (seen.has(p.toLowerCase())) fail(`duplicate ${p}`);
    seen.add(p.toLowerCase());
  }
  if (!seen.has('app\\resources\\obsidian.asar') || !seen.has('app\\obsidian.exe')) fail('required payload files missing');
  return manifest;
}

// Performs only reads; throws before any write or launch.
export function guestGuard({ platform, username, envUser, appData, isVirtualMachine, argvNonce, fs = nodeFs }) {
  const fail = (message) => { throw new GuardError(message); };
  if (platform !== 'win32') fail('not Windows');
  if (String(username).toLowerCase() !== GUEST_USER.toLowerCase() || String(envUser).toLowerCase() !== GUEST_USER.toLowerCase()) fail('not WDAGUtilityAccount');
  if (typeof appData !== 'string' || w.normalize(appData) !== appData || appData.toLowerCase() !== ROAMING.toLowerCase()) fail('APPDATA is not the exact disposable guest Roaming directory');
  if (!isVirtualMachine()) fail('not a virtual machine');
  if (!/^[0-9a-f]{32}$/.test(argvNonce ?? '')) fail('missing nonce argument');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(`${INPUT}\\manifest.json`, 'utf8'));
  } catch {
    fail('input manifest unreadable');
  }
  validateManifest(manifest, argvNonce);
  if (fs.readdirSync(OUTPUT).length !== 0) fail('output mapping is not empty');
  return manifest;
}

export function defaultIsVirtualMachine() {
  const query = (name) => execFileSync('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\SystemInformation', '/v', name], { encoding: 'utf8' });
  try {
    return /Microsoft Corporation/i.test(query('SystemManufacturer')) && /Virtual Machine/i.test(query('SystemProductName'));
  } catch {
    return false;
  }
}

function summarizeJson(value) {
  const typeKeys = {};
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    const type = typeof node.type === 'string' ? node.type : '(untyped)';
    typeKeys[type] = [...new Set([...(typeKeys[type] ?? []), ...Object.keys(node)])].sort();
    Object.values(node).forEach(walk);
  };
  walk(value);
  return { topLevelKeys: Object.keys(value), keysByNodeType: typeKeys };
}

async function waitFor(check, { timeoutMs, intervalMs = 500, label, sleepFn = sleep }) {
  const end = Date.now() + timeoutMs;
  let lastError = null;
  for (;;) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      if (error?.fatal) throw error;
      lastError = error;
    }
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}${lastError ? `; last error: ${lastError.message}` : ''}`);
    await sleepFn(intervalMs);
  }
}

function withDeadline(promise, ms, label, cancel) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} timed out after ${ms}ms`);
      try { cancel?.(); } catch (cause) { error.cause = cause; }
      reject(error);
    }, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// Drives the unmodified app through its remote-debugging endpoint; control only, no app code is touched.
export function createAppController({ spawnFn = spawn, fetchFn = globalThis.fetch, WebSocketCtor = globalThis.WebSocket, killFn = (pid) => process.kill(pid), openTimeoutMs = 10000, commandTimeoutMs = 15000, fetchTimeoutMs = 5000, closeWaitMs = 20000 } = {}) {
  let child;
  let pid = 0;
  let exit = null;
  let launchError = null;
  const getJson = (url) => {
    const abort = new AbortController();
    return withDeadline(Promise.resolve().then(() => fetchFn(url, { signal: abort.signal })).then((r) => r.json()), fetchTimeoutMs, `fetch ${url}`, () => abort.abort());
  };

  const connect = (url) => {
    let socket;
    return withDeadline(new Promise((resolve, reject) => {
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || endpoint.port !== String(DEBUG_PORT) || !endpoint.pathname.startsWith('/devtools/')) {
      throw new Error('CDP endpoint must be the owned loopback debugger');
    }
    const ws = socket = new WebSocketCtor(url);
    let id = 0;
    let closedReason = null;
    const pending = new Map();
    const rejectAll = (reason) => {
      closedReason = reason;
      for (const entry of pending.values()) entry.reject(new Error(reason));
      pending.clear();
    };
    ws.onmessage = (event) => {
      let message;
      try { message = JSON.parse(event.data); }
      catch (error) {
        reject(error);
        rejectAll(`invalid CDP message: ${error.message}`);
        ws.close();
        return;
      }
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    };
    ws.onerror = () => { reject(new Error('cdp connection error')); rejectAll('cdp socket error'); };
    ws.onclose = () => { reject(new Error('cdp socket closed')); rejectAll('cdp socket closed before reply'); };
    ws.onopen = () => resolve({
      send: (method, params = {}) => {
        let key = 0;
        return withDeadline(new Promise((res, rej) => {
          if (closedReason) return rej(new Error(closedReason));
          key = ++id;
          pending.set(key, { resolve: res, reject: rej });
          try { ws.send(JSON.stringify({ id: key, method, params })); } catch (error) { pending.delete(key); rej(error); }
        }), commandTimeoutMs, `cdp ${method}`).catch((error) => { pending.delete(key); throw error; });
      },
      close: () => { try { ws.close(); } catch { /* already closed */ } },
    });
    }), openTimeoutMs, 'cdp open', () => socket?.close());
  };

  const self = {
    launch(exe, env) {
      child = spawnFn(exe, [`--remote-debugging-port=${DEBUG_PORT}`, '--remote-allow-origins=*'], { env, stdio: 'ignore', windowsHide: false });
      child.on('error', (error) => { launchError = error; });
      child.on('exit', (code, signal) => { exit = { code, signal }; });
      pid = child.pid;
      if (!Number.isInteger(pid) || pid <= 0) throw Object.assign(new Error('app did not start with an owned positive pid'), { fatal: true });
      return pid;
    },
    status: () => ({ pid, exit, launchError: launchError ? String(launchError) : null }),
    async evaluate(expression) {
      if (exit || launchError) throw Object.assign(new Error(`app exited early: ${JSON.stringify(exit ?? String(launchError))}`), { fatal: true });
      const targets = await getJson(`http://127.0.0.1:${DEBUG_PORT}/json`);
      const target = targets.find((t) => t.type === 'page' && /index\.html/.test(t.url));
      if (!target) throw new Error('main window target not ready');
      const cdp = await connect(target.webSocketDebuggerUrl);
      try {
        const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
      } finally {
        cdp.close();
      }
    },
    async targets() {
      return (await getJson(`http://127.0.0.1:${DEBUG_PORT}/json`)).map((t) => ({ type: t.type, url: t.url, title: t.title }));
    },
    // Always attempts bounded cleanup of the owned process; every failure is retained.
    async close() {
      if (!child) return { method: 'none', forced: false, exit: null, errors: [] };
      if (!Number.isInteger(pid) || pid <= 0) {
        return { method: 'not-launched', forced: false, exit, errors: [launchError ? String(launchError) : 'no owned positive PID'] };
      }
      const errors = [];
      const record = (label, error) => errors.push(`${label}: ${String(error?.message ?? error)}`);
      const waitExit = async (ms) => { const end = Date.now() + ms; while (!exit && Date.now() < end) await sleep(20); return exit; };
      let method = 'already-exited';
      if (!exit) {
        method = 'Browser.close';
        try {
          const version = await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
          const cdp = await connect(version.webSocketDebuggerUrl);
          await cdp.send('Browser.close').catch((error) => record('Browser.close', error));
          cdp.close();
        } catch (error) { record('browser endpoint', error); }
        await waitExit(closeWaitMs);
      }
      if (!exit) {
        method = 'window.close';
        await self.evaluate('window.close()').catch((error) => record('window.close', error));
        await waitExit(closeWaitMs);
      }
      let forced = false;
      if (!exit) {
        method = 'killed';
        forced = true;
        try { killFn(pid); } catch (error) { record('kill', error); }
        await waitExit(5000);
      }
      return { method, forced, exit, errors };
    },
  };
  return self;
}

const NOTE_A = '# Floating capture A\n\nFirst note.\n';
const NOTE_B = '# Floating capture B\n\nPopout note.\n';

export async function runCapture(deps) {
  const { fs, env, controller, argvNonce, now = () => new Date().toISOString(), sleepFn = sleep, platform = process.platform, username = os.userInfo().username, isVirtualMachine = defaultIsVirtualMachine, readyTimeoutMs = 180000, layoutTimeoutMs = 30000 } = deps;
  const manifest = guestGuard({ platform, username, envUser: env.USERNAME, appData: env.APPDATA, isVirtualMachine, argvNonce, fs });
  const result = { schema: 'original-reference-capture/1', nonce: argvNonce, startedAt: now(), steps: [], ok: false };
  const step = (name, detail) => result.steps.push({ name, at: now(), ...(detail ? { detail } : {}) });
  const finish = () => {
    result.finishedAt = now();
    fs.writeFileSync(`${OUTPUT}\\result.json`, JSON.stringify(result, null, 2));
    return result;
  };
  try {
    result.provenance = {
      manifestSha256: sha256File(fs, `${INPUT}\\manifest.json`),
      guestScriptSha256: sha256File(fs, `${INPUT}\\guest\\guest-capture.mjs`),
      nodeSha256: manifest.node.sha256,
      nodeVersion: manifest.node.version,
      reference: manifest.reference,
      appFileCount: manifest.files.length,
      asarSha256: manifest.files.find((f) => f.path.toLowerCase() === 'app\\resources\\obsidian.asar').sha256,
      capturedBy: 'tools/original-reference/guest-capture.mjs',
    };
    for (const file of manifest.files) {
      if (sha256File(fs, `${INPUT}\\${file.path}`) !== file.sha256) throw new Error(`input hash mismatch: ${file.path}`);
    }
    if (sha256File(fs, `${INPUT}\\node\\node.exe`) !== manifest.node.sha256) throw new Error('node.exe hash mismatch');
    step('input-verified', { files: manifest.files.length });
    fs.cpSync(`${INPUT}\\app`, APP, { recursive: true });
    for (const file of manifest.files) {
      if (sha256File(fs, `${APP}\\${file.path.slice('app\\'.length)}`) !== file.sha256) throw new Error(`copied hash mismatch: ${file.path}`);
    }
    step('payload-copied-and-reverified', { to: APP });

    fs.mkdirSync(`${VAULT}\\.obsidian`, { recursive: true });
    fs.writeFileSync(`${VAULT}\\Capture A.md`, NOTE_A);
    fs.writeFileSync(`${VAULT}\\Popout note.md`, NOTE_B);
    const appDataDir = `${env.APPDATA}\\obsidian`;
    fs.mkdirSync(appDataDir, { recursive: true });
    fs.writeFileSync(`${appDataDir}\\obsidian.json`, JSON.stringify({ vaults: { capture0000000001: { path: VAULT, ts: Date.now(), open: true } } }));
    step('disposable-vault-created', { vault: VAULT });

    result.pid = controller.launch(`${APP}\\Obsidian.exe`, { ...env });
    step('launched', { pid: result.pid });
    await waitFor(() => controller.evaluate("typeof app !== 'undefined' && !!app.workspace && app.workspace.layoutReady === true"), { timeoutMs: readyTimeoutMs, label: 'workspace ready', sleepFn });
    result.userAgent = await controller.evaluate('navigator.userAgent');
    if (!new RegExp(`obsidian/${EXPECTED_VERSION.replace(/\./g, '\\.')}(?=\\s|$|[;)])`, 'i').test(result.userAgent)) throw new Error(`unexpected app identity: ${result.userAgent}`);
    const updaterAsars = fs.readdirSync(appDataDir).filter((n) => /^obsidian-.*\.asar$/i.test(n));
    if (updaterAsars.length) throw new Error(`updater asar present in guest profile: ${updaterAsars.join(',')}`);
    step('identity-verified', { userAgent: result.userAgent });

    result.popout = await controller.evaluate(`(async () => {
      const file = app.vault.getAbstractFileByPath('Popout note.md');
      const leaf = app.workspace.openPopoutLeaf({ x: 160, y: 120, size: { width: 720, height: 520 } });
      await leaf.openFile(file);
      app.workspace.setActiveLeaf(leaf, { focus: true });
      const win = leaf.view.containerEl.ownerDocument.defaultView;
      return { isSeparateWindow: win !== window, viewState: leaf.getViewState(), requested: { x: 160, y: 120, width: 720, height: 520 },
        native: { screenX: win.screenX, screenY: win.screenY, outerWidth: win.outerWidth, outerHeight: win.outerHeight, innerWidth: win.innerWidth, innerHeight: win.innerHeight, devicePixelRatio: win.devicePixelRatio } };
    })()`);
    if (result.popout?.isSeparateWindow !== true) throw new Error('popout leaf is not owned by a separate window');
    step('popout-created-through-supported-api');

    await controller.evaluate('app.workspace.requestSaveLayout()');
    const layoutFile = `${VAULT}\\.obsidian\\workspace.json`;
    // Two identical parseable reads apart prove the debounced write finished.
    const stable = await waitFor(async () => {
      if (!fs.existsSync(layoutFile)) return null;
      const first = fs.readFileSync(layoutFile);
      let parsed;
      try { parsed = JSON.parse(first.toString('utf8')); } catch { return null; }
      if (!first.includes('Popout note.md') || !/"floating"/.test(first.toString('utf8'))) return null;
      await sleepFn(700);
      const second = fs.readFileSync(layoutFile);
      return Buffer.compare(first, second) === 0 ? { bytes: first, parsed } : null;
    }, { timeoutMs: layoutTimeoutMs, label: 'stable workspace.json containing the open popout', sleepFn });
    result.targetsWhileOpen = await controller.targets();
    fs.writeFileSync(`${OUTPUT}\\workspace.floating-open.json`, stable.bytes);
    result.floatingOpen = { sha256: sha256Bytes(stable.bytes), bytes: stable.bytes.length, ...summarizeJson(stable.parsed) };
    step('workspace-captured-while-popout-open');

    result.close = await controller.close();
    step('app-closed', result.close);
    if (fs.existsSync(layoutFile)) {
      const after = fs.readFileSync(layoutFile);
      fs.writeFileSync(`${OUTPUT}\\workspace.after-close.json`, after);
      result.afterClose = { sha256: sha256Bytes(after), bytes: after.length };
    }
    const exit = result.close.exit;
    result.ok = exit?.code === 0 && exit.signal === null && result.close.forced === false;
  } catch (error) {
    result.error = String(error?.stack ?? error);
    try {
      result.close = await controller.close();
    } catch (cleanupError) {
      result.cleanupError = String(cleanupError?.stack ?? cleanupError);
    }
    result.ok = false;
  }
  return finish();
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()) {
  const index = process.argv.indexOf('--nonce');
  runCapture({ fs: nodeFs, env: process.env, controller: createAppController(), argvNonce: index > 0 ? process.argv[index + 1] : '' })
    .then((r) => { process.exitCode = r.ok ? 0 : 1; })
    .catch((error) => { console.error(String(error)); process.exitCode = 2; });
}
