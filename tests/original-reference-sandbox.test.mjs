import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildWsb, validateMappings, validateWsb, escapeXml } from '../tools/original-reference/sandbox-config.mjs';
import { runCapture, guestGuard, GuardError, validateManifest, createAppController } from '../tools/original-reference/guest-capture.mjs';
import { stageCapture } from '../tools/original-reference/stage-capture.mjs';
import { EventEmitter } from 'node:events';

const REPO = 'C:\\work\\repo';
const CAPTURE = `${REPO}\\.runtime\\original-reference-captures\\run1`;
const INPUT = `${CAPTURE}\\input`;
const OUTPUT = `${CAPTURE}\\output`;
const NONCE = 'a'.repeat(32);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function hostFs({ links = [], outputEntries = [] } = {}) {
  const dirs = new Set([REPO, `${REPO}\\.runtime`, `${REPO}\\.runtime\\original-reference-captures`, CAPTURE, INPUT, OUTPUT]);
  return {
    lstatSync(p) {
      if (!dirs.has(p)) throw new Error('ENOENT');
      return { isSymbolicLink: () => links.includes(p), isDirectory: () => true };
    },
    readdirSync: () => outputEntries,
  };
}

const ok = () => ({ repoRoot: REPO, inputDir: INPUT, outputDir: OUTPUT, fs: hostFs() });

test('wsb template has every required isolation flag and exactly two mappings', () => {
  const xml = buildWsb({ inputDir: INPUT, outputDir: OUTPUT, nonce: NONCE });
  for (const flag of ['VGpu', 'Networking', 'AudioInput', 'VideoInput', 'PrinterRedirection', 'ClipboardRedirection']) assert.match(xml, new RegExp(`<${flag}>Disable</${flag}>`));
  assert.match(xml, /<ProtectedClient>Enable<\/ProtectedClient>/);
  assert.equal(xml.match(/<MappedFolder>/g).length, 2);
  assert.ok(xml.includes(`${escapeXml(INPUT)}</HostFolder>\r\n      <SandboxFolder>C:\\ReferenceInput</SandboxFolder>\r\n      <ReadOnly>true`));
  assert.match(xml, /<ReadOnly>false<\/ReadOnly>/);
  assert.deepEqual(validateWsb(xml, { repoRoot: REPO, fs: hostFs() }), { inputDir: INPUT, outputDir: OUTPUT, nonce: NONCE });
});

test('mapping validation rejects unsafe paths, topology, links and non-empty output', () => {
  const base = ok();
  assert.doesNotThrow(() => validateMappings(base));
  const bad = [
    { inputDir: 'relative\\input' },
    { inputDir: '\\\\server\\share\\input' },
    { inputDir: 'C:\\' },
    { inputDir: REPO },
    { inputDir: `${CAPTURE}\\..\\run1\\input` },
    { inputDir: `${CAPTURE}\\input"><Evil/>` },
    { outputDir: INPUT },
    { outputDir: `${INPUT}\\nested` },
    { inputDir: 'C:\\Users\\Ron', outputDir: 'C:\\Users\\Ron\\output' },
    { outputDir: `${REPO}\\.runtime\\original-reference-captures\\other\\output` },
    { fs: hostFs({ links: [`${REPO}\\.runtime`] }) },
    { fs: hostFs({ links: [INPUT] }) },
    { fs: hostFs({ outputEntries: ['stale.txt'] }) },
  ];
  for (const override of bad) assert.throws(() => validateMappings({ ...base, ...override }), /./, JSON.stringify(override));
  assert.throws(() => validateMappings({ ...base, homeDir: INPUT }), /must not be/);
});

test('reviewer rejects widened, extra or flag-altered configurations', () => {
  const xml = buildWsb({ inputDir: INPUT, outputDir: OUTPUT, nonce: NONCE });
  const review = (text) => validateWsb(text, { repoRoot: REPO, fs: hostFs() });
  for (const mutated of [
    xml.replace('<Networking>Disable', '<Networking>Default'),
    xml.replace('<ProtectedClient>Enable', '<ProtectedClient>Disable'),
    xml.replace('<ReadOnly>true', '<ReadOnly>false'),
    xml.replace('<VGpu>Disable</VGpu>', '<VGpu>Enable</VGpu>'),
    xml.replace('</MappedFolders>', '<MappedFolder><HostFolder>C:\\</HostFolder><SandboxFolder>C:\\x</SandboxFolder></MappedFolder></MappedFolders>'),
    xml.replace('<Command>', '<Command>cmd /c calc & '),
    xml.replace('</Configuration>', '<MemoryInMB>1</MemoryInMB></Configuration>'),
  ]) assert.throws(() => review(mutated));
  assert.throws(() => buildWsb({ inputDir: INPUT, outputDir: OUTPUT, nonce: 'short' }), /nonce/);
  assert.equal(escapeXml('a&b<c>"\''), 'a&amp;b&lt;c&gt;&quot;&apos;');
});

// ---- guest ----

const APP_EXE = Buffer.from('app-exe');
const ASAR = Buffer.from('asar');
const NODE_EXE = Buffer.from('node-exe');
const manifestFor = (nonce = NONCE) => ({
  schema: 'original-reference-input/1',
  nonce,
  reference: { installerSha256: 'c'.repeat(64), asarSha256: sha(ASAR) },
  node: { sha256: sha(NODE_EXE), version: 'v25.0.0' },
  files: [
    { path: 'app\\Obsidian.exe', size: APP_EXE.length, sha256: sha(APP_EXE) },
    { path: 'app\\resources\\obsidian.asar', size: ASAR.length, sha256: sha(ASAR) },
  ],
});

function guestFs({ nonce = NONCE, outputEntries = {}, tamper = false } = {}) {
  const files = new Map(Object.entries({
    'c:\\referenceinput\\manifest.json': Buffer.from(JSON.stringify(manifestFor(nonce))),
    'c:\\referenceinput\\app\\obsidian.exe': tamper ? Buffer.from('bad') : APP_EXE,
    'c:\\referenceinput\\app\\resources\\obsidian.asar': ASAR,
    'c:\\referenceinput\\node\\node.exe': NODE_EXE,
    'c:\\referenceinput\\guest\\guest-capture.mjs': Buffer.from('script'),
    ...outputEntries,
  }));
  const key = (p) => p.toLowerCase();
  const writes = [];
  const fs = {
    writes,
    files,
    readFileSync: (p, enc) => { const b = files.get(key(p)); if (!b) throw new Error(`ENOENT ${p}`); return enc ? b.toString() : b; },
    existsSync: (p) => files.has(key(p)),
    readdirSync: (p) => {
      const prefix = `${key(p)}\\`;
      return [...files.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length).split('\\')[0]);
    },
    writeFileSync: (p, data) => { writes.push(p); files.set(key(p), Buffer.from(data)); },
    mkdirSync: (p) => writes.push(p),
    cpSync: (from, to) => { writes.push(to); for (const [k, v] of [...files]) if (k.startsWith(`${key(from)}\\`)) files.set(`${key(to)}${k.slice(key(from).length)}`, v); },
  };
  return fs;
}

const PROFILE = 'C:\\Users\\WDAGUtilityAccount';
const env = { USERNAME: 'WDAGUtilityAccount', APPDATA: `${PROFILE}\\AppData\\Roaming` };

function fakeController(fs, { userAgent = 'Mozilla/5.0 obsidian/1.12.7 Electron', closeResult = { method: 'Browser.close', forced: false, errors: [], exit: { code: 0, signal: null } }, closeThrows = false } = {}) {
  const calls = [];
  const workspace = JSON.stringify({ main: { type: 'split' }, floating: { type: 'floating', children: [{ type: 'window', x: 160 }] }, active: 'Popout note.md', unknownTop: 1 });
  return {
    calls,
    launch: (exe) => { calls.push(['launch', exe]); return 4242; },
    async evaluate(expression) {
      calls.push(['evaluate', expression.slice(0, 30)]);
      if (expression.includes('layoutReady')) return true;
      if (expression.includes('userAgent')) return userAgent;
      if (expression.includes('openPopoutLeaf')) return { isSeparateWindow: true, native: { outerWidth: 720 } };
      if (expression.includes('requestSaveLayout')) { fs.files.set(`${PROFILE}\\CaptureVault\\.obsidian\\workspace.json`.toLowerCase(), Buffer.from(workspace)); return undefined; }
      return undefined;
    },
    targets: async () => [{ type: 'page' }, { type: 'page' }],
    async close() { calls.push(['close']); if (closeThrows) throw new Error('cleanup exploded'); return closeResult; },
  };
}

const args = (fs, controller, extra = {}) => ({ fs, env, controller, argvNonce: NONCE, platform: 'win32', username: 'WDAGUtilityAccount', isVirtualMachine: () => true, sleepFn: async () => {}, ...extra });

test('guest guard fails before any write or launch for every unmet condition', async () => {
  const cases = [
    { name: 'not windows', extra: { platform: 'linux' } },
    { name: 'host user', extra: { username: 'Ron' } },
    { name: 'env user', extra: { env: { ...env, USERNAME: 'Ron' } } },
    { name: 'real profile appdata', extra: { env: { ...env, APPDATA: 'C:\\Users\\Ron\\AppData\\Roaming' } } },
    { name: 'appdata traversal', extra: { env: { ...env, APPDATA: `${PROFILE}\\..\\Ron\\AppData\\Roaming` } } },
    { name: 'appdata subdir', extra: { env: { ...env, APPDATA: `${PROFILE}\\AppData\\Roaming\\x` } } },
    { name: 'not a vm', extra: { isVirtualMachine: () => false } },
    { name: 'missing nonce', extra: { argvNonce: '' } },
    { name: 'nonce mismatch', extra: { argvNonce: 'b'.repeat(32) } },
  ];
  for (const { name, extra } of cases) {
    const fs = guestFs();
    const controller = fakeController(fs);
    await assert.rejects(runCapture(args(fs, controller, extra)), GuardError, name);
    assert.equal(fs.writes.length, 0, name);
    assert.equal(controller.calls.length, 0, name);
  }
  const dirty = guestFs({ outputEntries: { 'c:\\referenceoutput\\old.txt': Buffer.from('x') } });
  const controller = fakeController(dirty);
  await assert.rejects(runCapture(args(dirty, controller)), /not empty/);
  assert.equal(dirty.writes.length, 0);
  assert.equal(controller.calls.length, 0);
  assert.throws(() => guestGuard({ platform: 'win32', username: 'WDAGUtilityAccount', envUser: 'WDAGUtilityAccount', appData: env.APPDATA, isVirtualMachine: () => true, argvNonce: NONCE, fs: { readFileSync: () => { throw new Error('x'); }, readdirSync: () => [] } }), GuardError);
});

test('payload hash mismatch aborts before the app is launched', async () => {
  const fs = guestFs({ tamper: true });
  const controller = fakeController(fs);
  const result = await runCapture(args(fs, controller));
  assert.equal(result.ok, false);
  assert.match(result.error, /input hash mismatch/);
  assert.equal(controller.calls.some(([name]) => name === 'launch'), false);
});

test('capture copies workspace.json while the popout is open, then closes and records exits', async () => {
  const fs = guestFs();
  const controller = fakeController(fs);
  const result = await runCapture(args(fs, controller));
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(controller.calls.at(-1), ['close']);
  assert.ok(controller.calls.findIndex(([n]) => n === 'close') > controller.calls.findIndex(([, e]) => String(e).includes('requestSaveLayout')));
  const open = fs.files.get('c:\\referenceoutput\\workspace.floating-open.json');
  assert.equal(result.floatingOpen.sha256, sha(open));
  assert.deepEqual(result.floatingOpen.topLevelKeys, ['main', 'floating', 'active', 'unknownTop']);
  assert.deepEqual(result.floatingOpen.keysByNodeType.floating, ['children', 'type']);
  assert.equal(result.popout.native.outerWidth, 720);
  assert.ok(fs.files.has('c:\\referenceoutput\\result.json'));
  assert.ok(fs.writes.every((w) => /^C:\\(ReferenceOutput|ReferenceApp|Users\\WDAGUtilityAccount)/.test(w)));
});

test('unexpected app identity, forced kill or non-zero exit never report success', async () => {
  let fs = guestFs();
  let result = await runCapture(args(fs, fakeController(fs, { userAgent: 'obsidian/1.14.5' })));
  assert.equal(result.ok, false);
  assert.match(result.error, /unexpected app identity/);
  fs = guestFs();
  result = await runCapture(args(fs, fakeController(fs, { closeResult: { method: 'killed', forced: true, errors: [], exit: { code: 1, signal: null } } })));
  assert.equal(result.ok, false);
  for (const closeResult of [
    { method: 'Browser.close', forced: false, errors: [], exit: { code: null, signal: 'SIGTERM' } },
    { method: 'killed', forced: true, errors: [], exit: { code: 0, signal: null } },
    { method: 'Browser.close', forced: false, errors: [], exit: null },
  ]) {
    fs = guestFs();
    assert.equal((await runCapture(args(fs, fakeController(fs, { closeResult })))).ok, false);
  }
  fs = guestFs();
  fs.files.set(`${PROFILE}\\AppData\\Roaming\\obsidian\\obsidian-1.14.5.asar`.toLowerCase(), Buffer.from('x'));
  result = await runCapture(args(fs, fakeController(fs)));
  assert.match(result.error, /updater asar/);
});

test('manifest validation rejects escaping, absolute, malformed and incomplete entries', () => {
  const good = manifestFor();
  assert.doesNotThrow(() => validateManifest(good, NONCE));
  const mutate = (fn) => { const m = structuredClone(good); fn(m); return m; };
  for (const bad of [
    mutate((m) => { m.files[0].path = 'app\\..\\..\\evil.exe'; }),
    mutate((m) => { m.files[0].path = 'C:\\Windows\\x.exe'; }),
    mutate((m) => { m.files[0].path = 'app\\\\double'; }),
    mutate((m) => { m.files[0].path = 'node\\node.exe'; }),
    mutate((m) => { m.files[0].path = 'app/forward'; }),
    mutate((m) => { m.files[0].size = -1; }),
    mutate((m) => { m.files[0].sha256 = 'xyz'; }),
    mutate((m) => { m.files.push({ ...m.files[0] }); }),
    mutate((m) => { m.files.pop(); }),
    mutate((m) => { m.schema = 'other'; }),
    mutate((m) => { m.nonce = 'b'.repeat(32); }),
  ]) assert.throws(() => validateManifest(bad, NONCE), GuardError);
});

function writeCountingFs(overrides = {}) {
  const writes = [];
  const count = (name) => (...a) => { writes.push([name, a[0]]); };
  return {
    writes,
    mkdirSync: count('mkdir'), cpSync: count('cp'), copyFileSync: count('copy'), writeFileSync: count('write'),
    lstatSync: () => ({ isSymbolicLink: () => false, isDirectory: () => true, isFile: () => true }),
    statSync: () => ({ size: 1 }),
    readFileSync: () => { throw new Error('payload read must not be reached'); },
    readdirSync: () => [],
    ...overrides,
  };
}

test('stager refuses invalid inputs before any write or copy', () => {
  const ref = `${REPO}\\.runtime\\obsidian-1.12.7`;
  const base = { repoRoot: REPO, referenceDir: ref, nodeExe: 'C:\\node\\node.exe', nonce: NONCE, id: '20261102000000-aaaaaa' };
  const cases = [
    { id: '..\\..\\evil' }, { id: 'a\\b' }, { id: '' },
    { nonce: 'zz' },
    { repoRoot: 'relative' },
    { referenceDir: 'C:\\elsewhere\\obsidian-1.12.7' },
    { nodeExe: 'node.exe' },
    { fsOverride: { lstatSync: (p) => ({ isSymbolicLink: () => p === `${REPO}\\.runtime`, isDirectory: () => true, isFile: () => true }) } },
    { fsOverride: { lstatSync: () => { throw new Error('ENOENT'); } } },
  ];
  for (const { fsOverride, ...override } of cases) {
    const fs = writeCountingFs(fsOverride);
    assert.throws(() => stageCapture({ ...base, ...override, fs }), /./, JSON.stringify(override));
    assert.deepEqual(fs.writes, [], JSON.stringify(override));
  }
});

// ---- CDP transport ----

class FakeSocket {
  static mode = 'reply';
  static instances = [];
  constructor() {
    FakeSocket.instances.push(this);
    this.closeCalls = 0;
    queueMicrotask(() => {
      if (FakeSocket.mode === 'never-open') return;
      if (FakeSocket.mode === 'error-open') return this.onerror?.();
      this.onopen?.();
    });
  }
  send(text) {
    const { id } = JSON.parse(text);
    if (FakeSocket.mode === 'reply') setTimeout(() => this.onmessage({ data: JSON.stringify({ id, result: { result: { value: 7 } } }) }), 1);
    if (FakeSocket.mode === 'close-mid') setTimeout(() => this.onclose?.(), 1);
    if (FakeSocket.mode === 'socket-error') setTimeout(() => this.onerror?.(), 1);
    if (FakeSocket.mode === 'protocol-error') setTimeout(() => this.onmessage({ data: JSON.stringify({ id, error: { message: 'Browser.close refused' } }) }), 1);
  }
  close() { this.closeCalls++; }
}

const target = [{ type: 'page', url: 'app://obsidian.md/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/fake' }];
const jsonFetch = (body) => async () => ({ json: async () => body });

function transport(mode, extra = {}) {
  FakeSocket.mode = mode;
  const child = new EventEmitter();
  child.pid = extra.pid ?? 99;
  const controller = createAppController({
    spawnFn: () => child, fetchFn: extra.fetchFn ?? jsonFetch(target), WebSocketCtor: FakeSocket,
    killFn: extra.killFn ?? (() => child.emit('exit', null, 'SIGKILL')),
    openTimeoutMs: 30, commandTimeoutMs: 30, fetchTimeoutMs: 30, closeWaitMs: 40,
    killWaitMs: 40,
  });
  return { controller, child };
}

test('CDP evaluate is bounded for never-open, never-reply, close-mid-request and hung fetch', async () => {
  let t = transport('reply');
  t.controller.launch('x.exe', {});
  assert.equal(await t.controller.evaluate('1'), 7);
  t = transport('never-open');
  t.controller.launch('x.exe', {});
  await assert.rejects(t.controller.evaluate('1'), /cdp open timed out/);
  assert.equal(FakeSocket.instances.at(-1).closeCalls, 1, 'a timed-out handshake is closed');
  t = transport('error-open');
  t.controller.launch('x.exe', {});
  await assert.rejects(t.controller.evaluate('1'), /cdp connection error/);
  t = transport('never-reply');
  t.controller.launch('x.exe', {});
  await assert.rejects(t.controller.evaluate('1'), /timed out/);
  t = transport('close-mid');
  t.controller.launch('x.exe', {});
  await assert.rejects(t.controller.evaluate('1'), /closed before reply/);
  t = transport('reply', { fetchFn: () => new Promise(() => {}) });
  t.controller.launch('x.exe', {});
  await assert.rejects(t.controller.evaluate('1'), /fetch .* timed out/);
  let signal;
  t = transport('reply', { fetchFn: (_url, options) => { signal = options.signal; return new Promise(() => {}); } });
  t.controller.launch('x.exe', {});
  await assert.rejects(t.controller.evaluate('1'), /fetch .* timed out/);
  assert.equal(signal.aborted, true, 'a timed-out fetch is aborted');
  t = transport('reply', { fetchFn: jsonFetch([{ ...target[0], webSocketDebuggerUrl: 'ws://other:9222/devtools/page/fake' }]) });
  t.controller.launch('x.exe', {});
  await assert.rejects(t.controller.evaluate('1'), /owned loopback debugger/);
});

test('launch requires an owned positive pid; early exit and launch errors are fatal and retained', async () => {
  let t = transport('reply', { pid: 0 });
  assert.throws(() => t.controller.launch('x.exe', {}), /positive pid/);
  assert.equal((await t.controller.close()).method, 'not-launched');
  t = transport('reply');
  t.controller.launch('x.exe', {});
  t.child.emit('exit', 3, null);
  await assert.rejects(t.controller.evaluate('1'), (e) => e.fatal === true && /exited early/.test(e.message));
  assert.deepEqual(t.controller.status().exit, { code: 3, signal: null });
  t = transport('reply');
  t.controller.launch('x.exe', {});
  t.child.emit('error', new Error('spawn EPERM'));
  assert.match(t.controller.status().launchError, /EPERM/);
});

test('close always attempts bounded owned cleanup and reports every failure', async () => {
  // unreachable CDP: endpoint errors are recorded, then the owned pid is killed
  let t = transport('never-open', { fetchFn: () => Promise.reject(new Error('ECONNREFUSED')) });
  t.controller.launch('x.exe', {});
  let closed = await t.controller.close();
  assert.equal(closed.forced, true);
  assert.equal(closed.method, 'killed');
  assert.ok(closed.errors.some((e) => /ECONNREFUSED/.test(e)));
  assert.equal(closed.exit.signal, 'SIGKILL');
  // kill itself failing is retained and nothing hangs
  t = transport('never-open', { fetchFn: () => Promise.reject(new Error('down')), killFn: () => { throw new Error('EPERM kill'); } });
  t.controller.launch('x.exe', {});
  closed = await t.controller.close();
  assert.equal(closed.exit, null);
  assert.ok(closed.errors.some((e) => /EPERM kill/.test(e)));
  // graceful exit during Browser.close is not forced
  t = transport('reply', { fetchFn: jsonFetch({ webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/fake' }) });
  t.controller.launch('x.exe', {});
  setTimeout(() => t.child.emit('exit', 0, null), 10);
  closed = await t.controller.close();
  assert.deepEqual({ forced: closed.forced, code: closed.exit.code }, { forced: false, code: 0 });
  // no child: nothing to clean up
  assert.equal((await transport('reply').controller.close()).method, 'none');
});

test('capture failure keeps close outcome and cleanup errors; early exit surfaces instead of polling', async () => {
  let fs = guestFs();
  let controller = fakeController(fs, { closeThrows: true });
  controller.evaluate = async () => { throw new Error('cdp down'); };
  let result = await runCapture(args(fs, controller, { readyTimeoutMs: 20 }));
  assert.equal(result.ok, false);
  assert.match(result.error, /last error: cdp down/);
  assert.match(result.cleanupError, /cleanup exploded/);
  fs = guestFs();
  controller = fakeController(fs);
  controller.evaluate = async () => { throw Object.assign(new Error('app exited early: {"code":9}'), { fatal: true }); };
  result = await runCapture(args(fs, controller, { readyTimeoutMs: 60000 }));
  assert.match(result.error, /exited early/);
  assert.equal(result.close.exit.code, 0);
});

test('torn or unstable workspace.json is never captured and the wait is bounded', async () => {
  const fs = guestFs();
  const controller = fakeController(fs);
  let reads = 0;
  const original = fs.readFileSync;
  fs.readFileSync = (p, enc) => {
    if (String(p).toLowerCase().endsWith('workspace.json')) return Buffer.from(reads++ % 2 ? '{"floating":"Popout note.md","b":1}' : '{"floating":"Popout note.md"}');
    return original(p, enc);
  };
  const baseEvaluate = controller.evaluate.bind(controller);
  controller.evaluate = async (e) => (e.includes('requestSaveLayout') ? (fs.files.set(`${PROFILE}\\CaptureVault\\.obsidian\\workspace.json`.toLowerCase(), Buffer.from('x')), undefined) : baseEvaluate(e));
  const result = await runCapture(args(fs, controller, { layoutTimeoutMs: 20 }));
  assert.equal(result.ok, false);
  assert.match(result.error, /stable workspace\.json/);
  assert.equal(fs.files.has('c:\\referenceoutput\\workspace.floating-open.json'), false);
  assert.equal(typeof result.provenance.manifestSha256, 'string');
});

test('an existing guest app, vault or Obsidian profile refuses before any write or launch', async () => {
  for (const directory of ['C:\\ReferenceApp', `${PROFILE}\\CaptureVault`, `${PROFILE}\\AppData\\Roaming\\obsidian`]) {
    const fs = guestFs(), exists = fs.existsSync;
    fs.existsSync = path => path.toLowerCase() === directory.toLowerCase() || exists(path);
    const controller = fakeController(fs);
    await assert.rejects(runCapture(args(fs, controller)), /fresh guest/);
    assert.deepEqual(fs.writes, []);
    assert.deepEqual(controller.calls, []);
  }
});

test('a clean process exit does not hide a genuine cleanup error in a capture', async () => {
  const fs = guestFs();
  const result = await runCapture(args(fs, fakeController(fs, { closeResult: { method: 'Browser.close', forced: false, exit: { code: 0, signal: null }, errors: ['protocol refusal'] } })));
  assert.equal(result.ok, false);
  assert.match(result.error, /cleanup failed.*protocol refusal/);
});

test('Browser.close accepts owned successful exit before reply, including its socket disconnect', async () => {
  for (const mode of ['never-reply', 'close-mid', 'socket-error']) {
    const t = transport(mode, { fetchFn: jsonFetch({ webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/fake' }) });
    t.controller.launch('x.exe', {});
    setTimeout(() => t.child.emit('exit', 0, null), 10);
    const closed = await t.controller.close();
    assert.equal(closed.forced, false, mode);
    assert.deepEqual(closed.exit, { code: 0, signal: null }, mode);
    assert.deepEqual(closed.errors, [], mode);
  }
});

test('a protocol refusal remains a cleanup error even if the owned process then exits successfully', async () => {
  const t = transport('protocol-error', { fetchFn: jsonFetch({ webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/fake' }) });
  t.controller.launch('x.exe', {});
  setTimeout(() => t.child.emit('exit', 0, null), 10);
  const closed = await t.controller.close();
  assert.equal(closed.forced, false);
  assert.ok(closed.errors.some(error => error.includes('Browser.close refused')));
});
