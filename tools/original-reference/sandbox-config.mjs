import nodeFs from 'node:fs';
import path from 'node:path';

export const GUEST_INPUT = 'C:\\ReferenceInput';
export const GUEST_OUTPUT = 'C:\\ReferenceOutput';
export const GUEST_NODE = `${GUEST_INPUT}\\node\\node.exe`;
export const GUEST_SCRIPT = `${GUEST_INPUT}\\guest\\guest-capture.mjs`;
export const CAPTURE_ROOT_NAME = 'original-reference-captures';

const win = path.win32;
const NONCE = /^[0-9a-f]{32}$/;
const UNSAFE_CHARS = /[<>"|?*\u0000-\u001f]/;

export class ConfigError extends Error {}

export function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function unescapeXml(value) {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function fail(message) {
  throw new ConfigError(message);
}

function isInside(parent, child) {
  const rel = win.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !win.isAbsolute(rel);
}

export function assertPlainDirectory(fs, target) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    fail(`path component does not exist: ${target}`);
  }
  if (stat.isSymbolicLink()) fail(`path component is a symlink/junction: ${target}`);
  if (!stat.isDirectory()) fail(`path component is not a directory: ${target}`);
}

// Pure path rules: both mapped host folders must be fresh, ordinary, owned directories.
export function validateMappingPaths({ repoRoot, inputDir, outputDir, homeDir = '' }) {
  for (const [label, value] of [['repoRoot', repoRoot], ['inputDir', inputDir], ['outputDir', outputDir]]) {
    if (typeof value !== 'string' || !win.isAbsolute(value)) fail(`${label} must be an absolute path`);
    if (value.startsWith('\\\\')) fail(`${label} must not be UNC or a device path`);
    if (UNSAFE_CHARS.test(value)) fail(`${label} contains unsafe characters`);
    if (win.normalize(value) !== value || value.split(/[\\/]/).includes('..')) fail(`${label} must be normalized`);
    if (value.endsWith('\\')) fail(`${label} must not end with a separator or be a drive root`);
  }
  if (inputDir === outputDir || isInside(inputDir, outputDir) || isInside(outputDir, inputDir)) {
    fail('input and output mappings must be separate, non-nested directories');
  }
  const runtimeRoot = win.join(repoRoot, '.runtime');
  const capturesRoot = win.join(runtimeRoot, CAPTURE_ROOT_NAME);
  const captureDir = win.dirname(inputDir);
  if (win.dirname(outputDir) !== captureDir || win.basename(inputDir) !== 'input' || win.basename(outputDir) !== 'output') {
    fail('mappings must be <capture>\\input and <capture>\\output');
  }
  if (win.dirname(captureDir) !== capturesRoot) fail(`capture directory must be directly under ${capturesRoot}`);
  for (const forbidden of [repoRoot, runtimeRoot, capturesRoot, homeDir].filter(Boolean)) {
    if (inputDir === forbidden || outputDir === forbidden) fail(`mapping must not be ${forbidden}`);
  }
  return { captureDir, runtimeRoot, capturesRoot };
}

// Physical checks: every existing component must be a plain directory (no symlink/junction).
export function validateMappings({ repoRoot, inputDir, outputDir, homeDir = '', fs = nodeFs }) {
  const roots = validateMappingPaths({ repoRoot, inputDir, outputDir, homeDir });
  for (const chain of [repoRoot, roots.runtimeRoot, roots.capturesRoot, roots.captureDir, inputDir, outputDir]) assertPlainDirectory(fs, chain);
  if (fs.readdirSync(outputDir).length !== 0) fail('output directory must be empty');
  return roots;
}

export function buildWsb({ inputDir, outputDir, nonce }) {
  if (!NONCE.test(nonce)) fail('nonce must be 32 lowercase hex characters');
  const command = `${GUEST_NODE} ${GUEST_SCRIPT} --nonce ${nonce}`;
  return [
    '<Configuration>',
    '  <VGpu>Disable</VGpu>',
    '  <Networking>Disable</Networking>',
    '  <AudioInput>Disable</AudioInput>',
    '  <VideoInput>Disable</VideoInput>',
    '  <PrinterRedirection>Disable</PrinterRedirection>',
    '  <ClipboardRedirection>Disable</ClipboardRedirection>',
    '  <ProtectedClient>Enable</ProtectedClient>',
    '  <MappedFolders>',
    '    <MappedFolder>',
    `      <HostFolder>${escapeXml(inputDir)}</HostFolder>`,
    `      <SandboxFolder>${GUEST_INPUT}</SandboxFolder>`,
    '      <ReadOnly>true</ReadOnly>',
    '    </MappedFolder>',
    '    <MappedFolder>',
    `      <HostFolder>${escapeXml(outputDir)}</HostFolder>`,
    `      <SandboxFolder>${GUEST_OUTPUT}</SandboxFolder>`,
    '      <ReadOnly>false</ReadOnly>',
    '    </MappedFolder>',
    '  </MappedFolders>',
    '  <LogonCommand>',
    `    <Command>${escapeXml(command)}</Command>`,
    '  </LogonCommand>',
    '</Configuration>',
    '',
  ].join('\r\n');
}

// Strict reviewer: re-derives the only permitted document from the embedded values and requires byte equality.
export function validateWsb(xml, { repoRoot, fs = nodeFs, homeDir = '' }) {
  const folders = [...xml.matchAll(/<HostFolder>([^<]*)<\/HostFolder>/g)].map((m) => unescapeXml(m[1]));
  const nonce = /--nonce ([0-9a-f]{32})</.exec(xml)?.[1];
  if (folders.length !== 2 || !nonce) fail('expected exactly two mapped folders and a nonce');
  const [inputDir, outputDir] = folders;
  validateMappings({ repoRoot, inputDir, outputDir, homeDir, fs });
  if (xml !== buildWsb({ inputDir, outputDir, nonce })) fail('configuration deviates from the permitted template');
  return { inputDir, outputDir, nonce };
}
