import nodeFs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildWsb, validateMappings, validateMappingPaths, validateWsb, assertPlainDirectory, ConfigError, CAPTURE_ROOT_NAME } from './sandbox-config.mjs';
import { validateManifest } from './guest-capture.mjs';

export const OFFICIAL = {
  tag: 'v1.12.7',
  installerSha256: 'f35d2a35061098400a3fafc1bfd38d8bd33f1ad76df8b78b62ccdf20b0a30d26',
  asarSha256: '2b2483b2e1246772e0d25367ec055cbc5047ea2f0091b667c35656678f86d712',
};

const win = path.win32;
const fail = (message) => { throw new ConfigError(message); };
const ID = /^\d{14}-[0-9a-f]{6}$/;
const NONCE = /^[0-9a-f]{32}$/;

function sha256File(fs, file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function listFiles(fs, root, relative = '') {
  const out = [];
  for (const entry of fs.readdirSync(win.join(root, relative), { withFileTypes: true })) {
    const rel = relative ? `${relative}\\${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) fail(`reparse point in payload: ${rel}`);
    if (entry.isDirectory()) out.push(...listFiles(fs, root, rel));
    else if (entry.isFile()) out.push(rel);
    else fail(`unsupported entry in payload: ${rel}`);
  }
  return out;
}

function exists(fs, target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

// Read-only: validates every path, id and payload hash, and builds the manifest. Performs no writes.
export function preflight({ repoRoot, referenceDir, nodeExe, nonce, id, homeDir = '', fs = nodeFs }) {
  if (!ID.test(id ?? '')) fail('capture id must be <14 digits>-<6 hex>');
  if (!NONCE.test(nonce ?? '')) fail('nonce must be 32 lowercase hex characters');
  for (const [label, value] of [['repoRoot', repoRoot], ['referenceDir', referenceDir], ['nodeExe', nodeExe]]) {
    if (typeof value !== 'string' || !win.isAbsolute(value) || value.startsWith('\\\\') || win.normalize(value) !== value) fail(`${label} must be an absolute normalized local path`);
  }
  const runtimeRoot = win.join(repoRoot, '.runtime');
  if (referenceDir !== win.join(runtimeRoot, 'obsidian-1.12.7')) fail('referenceDir must be <repo>\\.runtime\\obsidian-1.12.7');
  const capturesRoot = win.join(runtimeRoot, CAPTURE_ROOT_NAME);
  const captureDir = win.join(capturesRoot, id);
  const inputDir = win.join(captureDir, 'input');
  const outputDir = win.join(captureDir, 'output');
  validateMappingPaths({ repoRoot, inputDir, outputDir, homeDir });

  const appDir = win.join(referenceDir, 'app');
  for (const dir of [repoRoot, runtimeRoot, referenceDir, appDir]) assertPlainDirectory(fs, dir);
  if (exists(fs, capturesRoot)) assertPlainDirectory(fs, capturesRoot);
  if (exists(fs, captureDir)) fail('capture directory already exists');
  const nodeStat = fs.lstatSync(nodeExe);
  if (nodeStat.isSymbolicLink() || !nodeStat.isFile()) fail('nodeExe must be a regular file');

  const installer = win.join(referenceDir, 'Obsidian-1.12.7.exe');
  if (sha256File(fs, installer) !== OFFICIAL.installerSha256) fail('installer hash mismatch');
  if (sha256File(fs, win.join(appDir, 'resources', 'obsidian.asar')) !== OFFICIAL.asarSha256) fail('inner asar hash mismatch');
  const metadata = JSON.parse(fs.readFileSync(win.join(referenceDir, 'release-metadata.json'), 'utf8').replace(/^\uFEFF/, ''));
  if (metadata.tagName !== OFFICIAL.tag) fail('release metadata tag mismatch');
  if (metadata.assets?.find((a) => a.name === 'Obsidian-1.12.7.exe')?.digest !== `sha256:${OFFICIAL.installerSha256}`) fail('release metadata installer digest mismatch');

  const files = listFiles(fs, appDir).map((rel) => ({ path: `app\\${rel}`, size: fs.statSync(win.join(appDir, rel)).size, sha256: sha256File(fs, win.join(appDir, rel)) }));
  const nodeSha = sha256File(fs, nodeExe);
  const manifest = { schema: 'original-reference-input/1', nonce, createdAt: new Date().toISOString(), reference: { ...OFFICIAL }, node: { sha256: nodeSha, version: process.version }, files };
  validateManifest(manifest, nonce);
  return { appDir, captureDir, inputDir, outputDir, manifest, nodeSha };
}

// Copies verified bytes into a fresh capture directory and writes the .wsb. Never executes anything.
export function stageCapture({ repoRoot, referenceDir, nodeExe, fs = nodeFs, nonce = crypto.randomBytes(16).toString('hex'), id = `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${nonce.slice(0, 6)}`, homeDir = '' }) {
  const plan = preflight({ repoRoot, referenceDir, nodeExe, nonce, id, homeDir, fs });
  const { appDir, captureDir, inputDir, outputDir, manifest, nodeSha } = plan;
  fs.mkdirSync(win.dirname(captureDir), { recursive: true });
  fs.mkdirSync(captureDir);
  fs.mkdirSync(inputDir);
  fs.mkdirSync(outputDir);
  fs.cpSync(appDir, win.join(inputDir, 'app'), { recursive: true });
  fs.mkdirSync(win.join(inputDir, 'node'));
  fs.copyFileSync(nodeExe, win.join(inputDir, 'node', 'node.exe'));
  fs.mkdirSync(win.join(inputDir, 'guest'));
  const guestSource = win.join(win.dirname(fileURLToPath(import.meta.url)), 'guest-capture.mjs');
  fs.copyFileSync(guestSource, win.join(inputDir, 'guest', 'guest-capture.mjs'));
  fs.writeFileSync(win.join(inputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  for (const file of manifest.files) {
    if (sha256File(fs, win.join(inputDir, file.path)) !== file.sha256) fail(`staged copy mismatch: ${file.path}`);
  }
  if (sha256File(fs, win.join(inputDir, 'node', 'node.exe')) !== nodeSha) fail('staged node mismatch');
  const guestSha = sha256File(fs, guestSource);
  if (sha256File(fs, win.join(inputDir, 'guest', 'guest-capture.mjs')) !== guestSha) fail('staged guest script mismatch');

  validateMappings({ repoRoot, inputDir, outputDir, homeDir, fs });
  const wsbPath = win.join(captureDir, 'capture.wsb');
  fs.writeFileSync(wsbPath, buildWsb({ inputDir, outputDir, nonce }));
  validateWsb(fs.readFileSync(wsbPath, 'utf8'), { repoRoot, fs, homeDir });
  const receipt = { captureDir, inputDir, outputDir, wsbPath, wsbSha256: sha256File(fs, wsbPath), manifestSha256: sha256File(fs, win.join(inputDir, 'manifest.json')), guestScriptSha256: guestSha, nodeSha256: nodeSha, appFileCount: manifest.files.length, ...OFFICIAL };
  fs.writeFileSync(win.join(captureDir, 'staging-receipt.json'), JSON.stringify(receipt, null, 2));
  return receipt;
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()) {
  const repoRoot = process.cwd();
  const referenceDir = win.join(repoRoot, '.runtime', 'obsidian-1.12.7');
  console.log(JSON.stringify(stageCapture({ repoRoot, referenceDir, nodeExe: process.execPath, homeDir: process.env.USERPROFILE }), null, 2));
}
