import { attachmentPath } from "./audio-paths";
import { MAX_BINARY_BYTES } from "./binary";

export const ATTACHMENT_IMPORT_LIMITS = Object.freeze({ files: 20, fileBytes: MAX_BINARY_BYTES, totalBytes: 32 * 1024 * 1024 });
export interface ImportSource { readonly name: string; readonly size: number; arrayBuffer(): Promise<ArrayBuffer>; }
export interface PreparedAttachment { name: string; bytes: ArrayBuffer; }
export interface AttachmentDestination { path: string; folder: boolean; }

function validName(name: string): void {
  if (typeof name !== "string" || name.includes("/") || name.includes("\\") || !/^(?:[^\uD800-\uDFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])*$/.test(name)) {
    throw new Error("Attachment names must be valid filenames without a folder path.");
  }
  attachmentPath(name);
}

export function validateImportSources(files: readonly ImportSource[]): void {
  if (!files.length || files.length > ATTACHMENT_IMPORT_LIMITS.files) { throw new Error("Choose between 1 and 20 files to attach."); }
  let total = 0;
  for (const file of files) {
    validName(file.name);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > ATTACHMENT_IMPORT_LIMITS.fileBytes) { throw new Error("Each attachment must be no larger than 16 MiB: " + file.name); }
    total += file.size;
  }
  if (total > ATTACHMENT_IMPORT_LIMITS.totalBytes) { throw new Error("An attachment import can contain at most 32 MiB in total."); }
}

/** Read and validate the entire selection before creating any destination files. */
export async function prepareAttachmentFiles(files: readonly ImportSource[]): Promise<PreparedAttachment[]> {
  validateImportSources(files);
  const result: PreparedAttachment[] = [];
  for (const file of files) {
    const bytes = await file.arrayBuffer();
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== file.size) { throw new Error("The selected file could not be read completely: " + file.name); }
    result.push({ name: file.name, bytes });
  }
  return result;
}

/** Avoid both existing files/folders and other names reserved by this selection. */
export function planAttachmentPaths(names: readonly string[], folder: string, existing: readonly AttachmentDestination[]): string[] {
  if (folder) { attachmentPath(folder); }
  const occupied = new Set(existing.map(entry => entry.path.toLowerCase()));
  const parts = folder.split("/").filter(Boolean);
  for (let end = 1; end <= parts.length; end++) {
    const parent = parts.slice(0, end).join("/").toLowerCase();
    if (existing.some(entry => !entry.folder && entry.path.toLowerCase() === parent)) { throw new Error("An attachment folder is occupied by a file: " + parts.slice(0, end).join("/")); }
  }
  return names.map(name => {
    validName(name);
    const dot = name.lastIndexOf("."), extension = dot > 0 ? name.slice(dot) : "", stem = dot > 0 ? name.slice(0, dot) : name;
    for (let index = 0; index < 10000; index++) {
      const suffix = index ? " " + index : "", length = 255 - suffix.length - extension.length;
      let prefix = stem.slice(0, length);
      if (/[\uD800-\uDBFF]$/.test(prefix)) { prefix = prefix.slice(0, -1); }
      if (!prefix) { throw new Error("This attachment name leaves no room for an available filename: " + name); }
      const path = attachmentPath((folder ? folder + "/" : "") + prefix + suffix + extension);
      if (!occupied.has(path.toLowerCase())) { occupied.add(path.toLowerCase()); return path; }
    }
    throw new Error("No available filename was found for " + name + ".");
  });
}

/** Explicit relative URLs retain spaces, punctuation and Unicode without wiki-link ambiguity. */
export function attachmentMarkdown(path: string, sourcePath: string): string {
  attachmentPath(path); attachmentPath(sourcePath);
  const target = path.split("/"), source = sourcePath.split("/").slice(0, -1);
  let common = 0;
  while (common < source.length && common < target.length && source[common] === target[common]) { common++; }
  const encode = (part: string): string => encodeURIComponent(part).replace(/[!'()*]/g, value => "%" + value.charCodeAt(0).toString(16).toUpperCase());
  const segments = [...source.slice(common).map(() => ".."), ...target.slice(common)].map(encode).join("/");
  const relative = segments.startsWith("../") ? segments : "./" + segments;
  const label = target.at(-1)!.replace(/([\\\[\]])/g, "\\$1");
  return (/\.(avif|gif|jpe?g|png|webp)$/i.test(path) ? "!" : "") + "[" + label + "](" + relative + ")";
}
