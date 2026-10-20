import type { App } from "./app";
import type { VaultDocument, VaultFileInfo } from "./contracts";
import { getCachedVaultSource, requestJson } from "./contracts";
import type { TFile } from "./vault";
import { createLinkResolver } from "./links";
import { embeddedMarkdown } from "./note-embed-section";
import { parseMarkdown } from "./markdown";
import { readBaseCardImage, type BaseCardBinaryImage } from "./bases-cards";
import { encodeBinary } from "./binary";
import { sniffMime } from "./media-policy";
import { canvasRasterDimensions } from "./canvas-export-raster";
export { canvasRasterDimensions } from "./canvas-export-raster";
import { captureCanvasExportLocalContent, canvasGroupBackgroundLimits, readCanvasExportSettings, type CanvasExportFrame, type CanvasExportSettings, type CanvasExportLocalContent, type CanvasExportLocalEntry } from "./canvas-export";

export const canvasLocalExportLimits = Object.freeze({ cards: 64, sources: 32, noteCharacters: 262_144, totalNoteCharacters: 524_288, noteBytes: 1024 * 1024, imageBytes: 2 * 1024 * 1024, totalImageBytes: 4 * 1024 * 1024, imageDimension: 4096, imagePixels: 16_000_000, milliseconds: 5000 });
export interface CanvasExportSource { readonly root: string; readonly path: string; readonly version: string; readonly content: string; readonly hasBom: boolean }
export interface CanvasLocalContentReview { readonly content: CanvasExportLocalContent; readonly rows: readonly string[]; verify(): Promise<void>; dispose(): void }

function deadline(signal: AbortSignal, current: () => boolean): { check(): void; wait<T>(work: Promise<T>): Promise<T>; dispose(): void } {
  const end = Date.now() + canvasLocalExportLimits.milliseconds;
  const check = (): void => { if (signal.aborted || !current()) { throw new Error("The Canvas local-content review changed or was cancelled."); } if (Date.now() > end) { throw new Error("Local file-content preparation exceeded five seconds. Export fewer selected cards or use literal export."); } };
  return { check, async wait<T>(work: Promise<T>): Promise<T> {
    check(); let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
    try { const result = await Promise.race([work, new Promise<never>((_, reject) => { abort = () => reject(new Error("The Canvas local-content review was cancelled.")); signal.addEventListener("abort", abort, { once: true }); timer = setTimeout(() => reject(new Error("Local file-content preparation exceeded five seconds. Use literal export or fewer selected cards.")), Math.max(0, end - Date.now())); })]); check(); return result; }
    finally { if (timer !== undefined) { clearTimeout(timer); } if (abort) { signal.removeEventListener("abort", abort); } }
  }, dispose() {} };
}

export async function prepareCanvasLocalContent(app: App, frame: CanvasExportFrame, value: CanvasExportSettings, source: CanvasExportSource, options: { current(): boolean; signal: AbortSignal; decode?: (blob: Blob) => Promise<{ width: number; height: number; close(): void }> }): Promise<CanvasLocalContentReview> {
  const settings = readCanvasExportSettings(value), root = source.root, sourceFile = app.vault.getFileByPath(source.path);
  if ((!settings.localContent && !settings.groupBackgrounds) || !root || !sourceFile || app.vault.rootPath !== root) { throw new Error("Choose local content or group backgrounds for a current Canvas before preparing them."); }
  // Ask the real selected first-party transport for a no-network capability.
  // Unknown read-only providers and online mounts never gain a raw fallback.
  const readOnly = app.vault.readOnly, cached = readOnly ? getCachedVaultSource(root) : null;
  if (readOnly && !cached) { throw new Error("Local content in a read-only vault requires a genuine cache-only mount. Literal export is still available."); }
  let disposed = false, totalText = 0, totalImages = 0, totalTiles = 0;
  const alive = (): boolean => !disposed && !app.changingVault && app.vault.rootPath === root && app.vault.getFileByPath(source.path) === sourceFile && app.vault.readOnly === readOnly && (!readOnly || getCachedVaultSource(root) !== null) && options.current();
  const task = deadline(options.signal, alive), selected = new Set(frame.selection), nodes = frame.nodes.filter(node => (node.type === "file" && settings.localContent || node.type === "group" && node.background && settings.groupBackgrounds) && (settings.scope === "whole" || selected.has(node.id)));
  if (nodes.length > canvasLocalExportLimits.cards) { throw new Error("Local export includes at most 64 file cards and group backgrounds combined. Export fewer selected cards."); }
  const witnesses = new Map<string, { file: TFile; version: string; physical?: VaultDocument; raster?: { size: number; base64: string }; session: ReturnType<App["workspace"]["sessions"]["get"]>; sessionText?: string; sessionDirty?: boolean; sessionDocument?: VaultDocument }>();
  const resolutions: { link: string; identity: string }[] = [], entries: CanvasExportLocalEntry[] = [], rows: string[] = [];
  const resolution = (link: string): { file: TFile | null; identity: string; ambiguous: boolean } => { const d = createLinkResolver(app.vault.getFiles())(link, source.path); return { file: d?.file ?? null, ambiguous: d?.ambiguous ?? false, identity: JSON.stringify(d ? { path: d.file.path, ambiguous: d.ambiguous, candidates: d.candidates.map(f => f.path).sort() } : null) }; };
  const info = async (file: TFile, work = task): Promise<VaultFileInfo> => { work.check(); const result = await work.wait(app.vault.getFileInfo(file)); if (result.root !== root || result.file.path !== file.path || !result.version || app.vault.getFileByPath(file.path) !== file) { throw new Error("A local export file or version changed. Close this review and prepare again."); } return result; };
  const readDocument = async (path: string, work = task): Promise<VaultDocument> => {
    if (!cached) { return work.wait(app.vault.readDocument(path)); }
    const result = await work.wait(cached.readFile(path, options.signal));
    if (result.root !== root || result.file.path !== path) { throw new Error("The cached note source changed."); }
    const bytes = new Uint8Array(result.bytes), hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    return { file: result.file, version: result.version, content: new TextDecoder("utf-8", { fatal: true }).decode(bytes), hasBom };
  };
  const readBinary = async (file: TFile, work = task): Promise<BaseCardBinaryImage> => {
    if (!cached) { return work.wait(requestJson<BaseCardBinaryImage>(`/api/binary?path=${encodeURIComponent(file.path)}&root=${encodeURIComponent(root)}`)); }
    const result = await work.wait(cached.readFile(file.path, options.signal));
    return { root: result.root, file: result.file, version: result.version, base64: encodeBinary(result.bytes) };
  };
  const board = async (work = task): Promise<void> => {
    const physical = await info(sourceFile, work);
    if (physical.version !== source.version || physical.file.stat.size > 8 * 1024 * 1024) { throw new Error("The saved Canvas changed or exceeds 8 MiB. Reload its current source or use literal export."); }
    const document = await readDocument(source.path, work);
    if (document.file.path !== source.path || document.version !== source.version || document.content !== source.content || (document.hasBom === true) !== source.hasBom) { throw new Error("The saved Canvas bytes or BOM changed. Close this review and prepare again."); }
  };
  const verifySources = async (work = task): Promise<void> => {
    work.check(); await board(work);
    for (const r of resolutions) { if (resolution(r.link).identity !== r.identity) { throw new Error("A file-card destination became missing or ambiguous. Prepare a fresh local-content review."); } }
    for (const [path, w] of witnesses) {
      work.check(); const physical = await work.wait(app.vault.getFileInfo(w.file));
      if (physical.root !== root || physical.file.path !== path || physical.version !== w.version || app.vault.getFileByPath(path) !== w.file) { throw new Error("Referenced file changed on disk: " + path + ". Prepare a fresh local-content review."); }
      if (w.physical) {
        const document = await readDocument(path, work);
        if (document.file.path !== path || document.version !== w.version || document.content !== w.physical.content || (document.hasBom === true) !== (w.physical.hasBom === true)) { throw new Error("Referenced note bytes or BOM changed: " + path + ". Prepare again."); }
      }
      if (w.raster) {
        const rasterInfo = async (): Promise<VaultFileInfo> => { const value = await info(w.file, work); if (value.version !== w.version) { throw new Error("The reviewed raster version changed: " + path); } return value; };
        const bytes = await work.wait(readBaseCardImage({ path, extension: w.file.extension.toLowerCase(), stat: { size: w.raster.size } }, root, rasterInfo, () => readBinary(w.file, work), alive));
        if (bytes.byteLength !== w.raster.size || encodeBinary(bytes) !== w.raster.base64) { throw new Error("Referenced raster bytes changed: " + path + ". Prepare a fresh local-content review."); }
      }
      const session = app.workspace.sessions.get(path);
      if (session !== w.session || session && (session.text !== w.sessionText || session.dirty !== w.sessionDirty || session.document !== w.sessionDocument)) { throw new Error("The live note buffer changed: " + path + ". Prepare a fresh local-content review."); }
    }
    work.check();
  };
  const omitted = (id: string, label: string, reason: string): void => { const text = "Omitted: " + reason; entries.push({ id, kind: "omitted", content: text, summary: label + " — " + text }); rows.push(label + " — " + text); };
  try {
    task.check(); await board();
    const reads = new Map<string, { kind: "text" | "raster"; text: string; dataUrl?: string; width?: number; height?: number; live?: boolean }>();
    for (const node of nodes) {
      task.check(); const group = node.type === "group", path = (group ? node.background : node.file) ?? "", subpath = group ? "" : node.subpath ?? "", label = group ? "Group " + node.label.slice(0, 512) + " (" + path.slice(0, 4096) + ")" : path + subpath;
      if (group && !["cover", "ratio", "repeat"].includes(node.backgroundStyle ?? "cover")) { omitted(node.id, label, "Unsupported native background style: " + node.backgroundStyle?.slice(0, 512) + ". Choose cover, ratio or repeat in the Canvas source."); continue; }
      if (!path || path.length > 4096 || /[\x00-\x1f\x7f]/.test(path) || /^(?:[a-z][a-z\d+.-]*:|\/\/|\\\\)/i.test(path.trim()) || subpath && !subpath.startsWith("#")) { omitted(node.id, label, "Only existing local vault file paths and heading/block subpaths are supported."); continue; }
      const link = path.replace(/[\\|#\]]/g, "\\$&") + subpath, target = resolution(link); resolutions.push({ link, identity: target.identity });
      if (!target.file || target.ambiguous) { omitted(node.id, label, target.ambiguous ? "The file destination is ambiguous." : "The local file does not exist."); continue; }
      const file = target.file, extension = file.extension.toLowerCase();
      if (group ? !/^(?:png|jpe?g|webp)$/.test(extension) : extension !== "md" && !/^(?:png|jpe?g|webp)$/.test(extension)) { omitted(node.id, label, group ? "Group backgrounds include only static PNG, JPEG or WebP images; this source remains a placeholder." : "Only Markdown notes and static PNG, JPEG or WebP images are included; this attachment remains a placeholder."); continue; }
      if (extension !== "md" && subpath) { omitted(node.id, label, "Raster image subpaths are not supported."); continue; }
      let read = reads.get(file.path);
      if (!read) {
        if (reads.size >= canvasLocalExportLimits.sources) { throw new Error("Local export reads at most 32 distinct sources. Select fewer file cards or group backgrounds."); }
        const physical = await info(file), session = app.workspace.sessions.get(file.path);
        witnesses.set(file.path, { file, version: physical.version, session, ...(session ? { sessionText: session.text, sessionDirty: session.dirty, sessionDocument: session.document } : {}) });
        if (extension === "md") {
          if (physical.file.stat.size > canvasLocalExportLimits.noteBytes) { throw new Error("A local note exceeds the 1 MiB export source budget: " + file.path); }
          const document = await readDocument(file.path);
          if (document.file.path !== file.path || document.version !== physical.version || (await info(file)).version !== physical.version) { throw new Error("A referenced note changed while being captured: " + file.path); }
          if (session && (session.document.version !== physical.version || session.document.content !== document.content || (session.document.hasBom === true) !== (document.hasBom === true))) { throw new Error("A live note's saved version differs from disk: " + file.path); }
          witnesses.get(file.path)!.physical = { ...document };
          const text = session?.dirty ? session.text : document.content;
          if (text.length > canvasLocalExportLimits.noteCharacters || (totalText += text.length) > canvasLocalExportLimits.totalNoteCharacters) { throw new Error("Local note export is limited to 262,144 characters per source and 524,288 in total."); }
          read = { kind: "text", text, live: session?.dirty === true };
        } else {
          const size = physical.file.stat.size;
          if (!Number.isSafeInteger(size) || size < 1 || size > canvasLocalExportLimits.imageBytes || (totalImages += size) > canvasLocalExportLimits.totalImageBytes) { throw new Error("Local image export is limited to 2 MiB per source and 4 MiB in total."); }
          const bytes = await task.wait(readBaseCardImage({ path: file.path, extension, stat: { size } }, root, () => info(file), () => readBinary(file), alive));
          if (bytes.byteLength !== size) { throw new Error("A local raster's physical byte count changed: " + file.path); }
          const mime = sniffMime(new Uint8Array(bytes));
          if (!mime || !["image/png", "image/jpeg", "image/webp"].includes(mime) || mime !== (extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg")) { throw new Error("The local image's bytes do not match its supported extension: " + file.path); }
          const dimensions = canvasRasterDimensions(new Uint8Array(bytes), mime);
          const decode = options.decode ?? (typeof createImageBitmap === "function" ? (blob: Blob) => createImageBitmap(blob, { imageOrientation: "none" }) : null);
          if (!decode) { throw new Error("Local image decoding is unavailable. Use literal export on this host."); }
          // A cancelled/late decode still closes its bitmap; none is retained by SVG.
          await task.wait(Promise.resolve().then(() => decode(new Blob([bytes], { type: mime }))).then(bitmap => { try { task.check(); if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width > 4096 || bitmap.height > 4096 || bitmap.width * bitmap.height > 16_000_000) { throw new Error("The decoded local raster exceeds its pixel budget."); } if (bitmap.width !== dimensions.width || bitmap.height !== dimensions.height) { throw new Error("The decoded local raster dimensions differ from its reviewed bytes."); } } finally { bitmap.close(); } }));
          const base64 = encodeBinary(bytes); witnesses.get(file.path)!.raster = { size, base64 };
          read = { kind: "raster", text: "", dataUrl: "data:" + mime + ";base64," + base64, ...dimensions };
        }
        reads.set(file.path, read);
      }
      if (read.kind === "text") {
        let text: string;
        try { text = embeddedMarkdown(read.text, subpath, parseMarkdown(read.text)); } catch (error) { omitted(node.id, label, error instanceof Error ? error.message : String(error)); continue; }
        const summary = label + " — Included " + (read.live ? "live unsaved note text" : "saved note text") + (subpath ? " from this heading/block" : "") + "; literal text clipped to the card (" + text.length + " characters).";
        entries.push({ id: node.id, kind: "text", content: text, summary }); rows.push(summary);
      } else {
        if (group && node.backgroundStyle === "repeat") { const tiles = Math.ceil(node.width / read.width!) * Math.ceil(node.height / read.height!); if (tiles > canvasGroupBackgroundLimits.tiles || totalTiles + tiles > canvasGroupBackgroundLimits.totalTiles) { omitted(node.id, label, "Repeated backgrounds are limited to 65,536 intrinsic-size tiles per group and 262,144 tiles in total. Select fewer or smaller groups, or choose cover/ratio in the Canvas source."); continue; } totalTiles += tiles; }
        const summary = label + (group ? " — Included static local group background; native " + (node.backgroundStyle ?? "cover") + " style, " + read.width + " × " + read.height + " source pixels; clipped behind labels and cards at 30% opacity." : " — Included static local raster bytes; contained within the card."); entries.push({ id: node.id, kind: "raster", content: "", dataUrl: read.dataUrl, summary }); rows.push(summary);
      }
    }
    await verifySources(); const content = captureCanvasExportLocalContent(frame, entries);
    return { content, rows: Object.freeze(rows), async verify() { const work = deadline(options.signal, alive); try { await verifySources(work); } finally { work.dispose(); } }, dispose() { disposed = true; witnesses.clear(); resolutions.length = 0; reads.clear(); } };
  } catch (error) { disposed = true; witnesses.clear(); throw error; } finally { task.dispose(); }
}
