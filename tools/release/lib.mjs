import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { listFiles } from "./zip.mjs";

const run = promisify(execFile);

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

const forbiddenSegments = new Set([".git", ".github", ".runtime", ".obsidian", ".vs", "node_modules", "compatibility", "example", "examples", "demovault", "profile", "smoke-profile", "obj", "tests", "docs", "reference", "private", "vendor-compat"]);
const forbiddenNames = [/^\.env(\..*)?$/i, /\.(pfx|p12|pem|key|snk|pdb|user|suo|log)$/i, /^id_(rsa|ed25519|ecdsa)$/i, /^(credentials?|secrets?)(\..*)?$/i, /^workspaces?\.json$/i, /^data\.json$/i, /^(npm-debug|\.npmrc|\.netrc)/i, /^obsidian(?:-\d+(?:\.\d+)*)?\.asar$/i];
const secretPatterns = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, /\bgithub_pat_[A-Za-z0-9_]{50,}\b/, /\bAKIA[0-9A-Z]{16}\b/];
const textExtensions = new Set([".js", ".cjs", ".mjs", ".json", ".html", ".css", ".txt", ".md", ".svg", ".map", ".config", ".ps1", ".cmd", ".xml", ".manifest", ".flag"]);

// Exact, deliberate exceptions to the segment rules: files the desktop host resolves relative to its own folder.
const allowedExceptions = new Set(["resources/app/.runtime/web-adblock/engine.cjs", "resources/app/.runtime/web-adblock/engine.cjs.LEGAL.txt", "resources/app/.runtime/web-adblock/licenses.txt"]);

export function classifyPath(relativePath) {
  relativePath = relativePath.replaceAll("\\", "/");
  if (allowedExceptions.has(relativePath)) { return null; }
  const parts = relativePath.split("/");
  const segment = parts.slice(0, -1).find(part => forbiddenSegments.has(part.toLowerCase()));
  if (segment) { return `forbidden directory segment '${segment}'`; }
  const name = parts.at(-1);
  const pattern = forbiddenNames.find(candidate => candidate.test(name));
  return pattern ? `forbidden file name pattern ${pattern}` : null;
}

export async function scanPackageTree(directory, { forbiddenText = [] } = {}) {
  const files = await listFiles(directory);
  const violations = [];
  const needles = forbiddenText.filter(Boolean).map(value => value.toLowerCase());
  // Keep enough preceding text for a path or the minimum credential-shaped match to cross a read boundary.
  const overlap = Math.max(128, ...needles.map(value => value.length));
  for (const file of files) {
    const reason = classifyPath(file);
    if (reason) { violations.push({ file, reason }); continue; }
    const extension = file.includes(".") ? file.slice(file.lastIndexOf(".")).toLowerCase() : "";
    if (!textExtensions.has(extension)) { continue; }
    const absolute = join(directory, ...file.split("/"));
    const reasons = new Set();
    let tail = "";
    // Stream every text file, including large bundles/maps; large files must not silently bypass the content policy.
    for await (const chunk of createReadStream(absolute, { encoding: "utf8", highWaterMark: 64 * 1024 })) {
      const text = tail + chunk;
      const lowered = text.toLowerCase();
      if (needles.some(needle => lowered.includes(needle))) { reasons.add("contains a source-checkout or user path"); }
      if (secretPatterns.some(pattern => pattern.test(text))) { reasons.add("contains credential-shaped content"); }
      tail = text.slice(-overlap);
    }
    for (const reason of reasons) { violations.push({ file, reason }); }
  }
  return { files: files.length, violations };
}

// Hash of HEAD plus every tracked/untracked-but-not-ignored file's bytes; changes whenever the built source changes.
export async function sourceFingerprint(root = repositoryRoot) {
  const git = (...args) => run("git", args, { cwd: root, maxBuffer: 256 * 1024 * 1024, encoding: "buffer" }).then(result => result.stdout);
  const head = (await git("rev-parse", "HEAD")).toString("utf8").trim();
  const listing = (await git("ls-files", "-z", "-c", "-o", "--exclude-standard")).toString("utf8").split("\0").filter(Boolean).sort();
  const hash = createHash("sha256");
  let count = 0;
  for (const file of new Set(listing)) {
    let bytes;
    try { bytes = await readFile(join(root, file)); } catch (error) { if (error.code === "ENOENT" || error.code === "EISDIR") { continue; } throw error; }
    hash.update(file + "\0" + createHash("sha256").update(bytes).digest("hex") + "\n");
    count++;
  }
  const { coreVerificationInputs } = await import("../core-verification-inputs.mjs");
  const core = (await coreVerificationInputs(root)).sourceFingerprint;
  return { head, files: count, sha256: hash.digest("hex"), coreVerificationInputs: core, algorithm: "sha256 over sorted 'path NUL sha256(content)' of git ls-files -c -o --exclude-standard; coreVerificationInputs is the repository-standard tools/core-verification-inputs.mjs fingerprint" };
}

export function formatBytes(bytes) {
  if (bytes < 1024) { return bytes + " B"; }
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return value.toFixed(value < 10 ? 2 : 1) + " " + units[unit];
}

export function parseArguments(argv, spec) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const [name, inline] = argument.startsWith("--") ? argument.slice(2).split(/=(.*)/s, 2) : [null];
    const kind = spec[name];
    if (!kind) { throw new Error("Unknown argument: " + argument); }
    if (kind === "flag") { result[name] = true; continue; }
    const value = inline ?? argv[++index];
    if (value === undefined || value === "") { throw new Error("Missing value for --" + name); }
    result[name] = kind === "number" ? Number(value) : value;
    if (kind === "number" && !Number.isFinite(result[name])) { throw new Error("--" + name + " requires a number."); }
  }
  return result;
}

export async function isRepositoryPath(path, root = repositoryRoot) {
  const { resolve, relative, isAbsolute } = await import("node:path");
  const relation = relative(resolve(root), resolve(path));
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

export const packageWork = join(repositoryRoot, ".runtime", "package");
export const outputMarker = ".slopsidian-owned-output";
const reservedOutputNames = new Set(["stage", "host", "evidence", "web-measure", "installer", "measure", "benchmark", "install-test"]);

// Resolves an output directory that must be a direct child of the package work directory, is not an input/scratch
// directory, is not a link, and (if it already exists) carries this tool's ownership marker. Nothing is deleted here.
export async function resolveOwnedOutput(requested, work = packageWork, { inspect } = {}) {
  const { resolve, relative, sep, basename } = await import("node:path");
  const lstat = inspect ?? (await import("node:fs/promises")).lstat;
  const target = resolve(requested);
  const relation = relative(resolve(work), target);
  if (!relation || relation.startsWith("..") || relation.includes(sep) || /^[a-zA-Z]:/.test(relation)) { throw new Error(`Package output must be a direct subdirectory of ${work}: ${requested}`); }
  const name = basename(target);
  if (!/^[A-Za-z0-9._-]+$/.test(name) || /^\.+$/.test(name) || reservedOutputNames.has(name.toLowerCase())) { throw new Error(`Refusing reserved or unsafe package output name '${name}'.`); }
  const lstatIfPresent = async path => {
    try { return await lstat(path); } catch (error) {
      if (error.code === "ENOENT") { return null; }
      throw new Error(`Cannot inspect package output path '${path}' (${error.code ?? "error"}); refusing to continue: ${error.message}`);
    }
  };
  for (const link of [resolve(work, ".."), resolve(work), target]) {
    const info = await lstatIfPresent(link);
    if (info && (info.isSymbolicLink() || (!info.isDirectory() && link === target))) { throw new Error(`Refusing a link or non-directory in the package output path: ${link}`); }
  }
  const existing = await lstatIfPresent(target);
  const marker = existing ? await lstatIfPresent(join(target, outputMarker)) : null;
  if (marker && !marker.isFile()) { throw new Error(`Refusing '${target}': ${outputMarker} is not a regular file.`); }
  if (existing && !marker) {
    const { readdir } = await import("node:fs/promises");
    if ((await readdir(target)).length) { throw new Error(`Refusing to clear '${target}': it is not a directory previously created by this packaging tool (missing ${outputMarker}).`); }
  }
  return target;
}

export async function prepareOwnedOutput(requested, work = packageWork) {
  const { rm, mkdir, writeFile } = await import("node:fs/promises");
  const target = await resolveOwnedOutput(requested, work);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await writeFile(join(target, outputMarker), "Created by tools/package-desktop.mjs; safe to clear on the next packaging run.\n");
  return target;
}
