const { promises: fs } = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const CHANNEL = "vault:print-export";
const MAX_PDF_BYTES = 64 * 1024 * 1024;
const margins = { normal: 0.5, minimal: 0.25, none: 0 };

function printRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !["jobId", "title", "pageSize", "landscape", "margin"].includes(key))
    || typeof value.jobId !== "string" || !/^[a-f0-9-]{36}$/.test(value.jobId)
    || typeof value.title !== "string" || !value.title.trim() || value.title.length > 256 || /[\x00-\x1f\x7f]/.test(value.title)
    || !["A4", "Letter", "Legal"].includes(value.pageSize) || typeof value.landscape !== "boolean"
    || !Object.hasOwn(margins, value.margin)) { throw new Error("Invalid PDF export request."); }
  return { jobId: value.jobId, title: value.title, pageSize: value.pageSize, landscape: value.landscape, margin: value.margin };
}

function suggestedPdfName(title) {
  let name = title.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, "_").trim().replace(/[. ]+$/, "").slice(0, 160);
  if (!name || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) { name = "Note" + (name ? " " + name : ""); }
  return name + ".pdf";
}
const sameFile = (left, right) => left === null && right === null || left && right
  && ["dev", "ino", "size", "mtimeMs", "ctimeMs"].every(key => left[key] === right[key]);
async function destinationState(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) { throw new Error("Choose a regular .pdf file as the destination."); }
    return stat;
  } catch (error) { if (error?.code === "ENOENT") { return null; } throw error; }
}

/** Save only the actual owned main page's prepared print job. No path or HTML is accepted from IPC. */
function createPrintExport({ window, dialog, isLocalUrl, isClosing = () => false }) {
  let busy = false, disposed = false;
  const available = () => !disposed && !isClosing() && !window.isDestroyed() && !window.webContents.isDestroyed();
  async function current(jobId) {
    if (!available()) { throw new Error("The application is closing. No PDF was saved."); }
    const valid = await window.webContents.executeJavaScript(`(()=>{const job=globalThis[Symbol.for("slopsidian.print-export")],root=document.querySelector("body > [data-print-export-document]");return Boolean(root&&root.dataset.printExportJob===${JSON.stringify(jobId)}&&root.dataset.printExportState==="ready"&&job?.isCurrent(${JSON.stringify(jobId)})===true)})()`);
    if (!available() || valid !== true) { throw new Error("The note or print preview changed. No PDF was saved."); }
  }
  const handle = async (event, value) => {
    if (event.sender !== window.webContents || !event.senderFrame || event.senderFrame !== window.webContents.mainFrame || !isLocalUrl(event.senderFrame.url)) {
      throw new Error("PDF export is only available to the local application main window.");
    }
    const request = printRequest(value);
    if (!available()) { throw new Error("The application is closing. No PDF was saved."); }
    if (busy) { throw new Error("Wait for the current PDF export to finish."); }
    busy = true;
    let temporary = null;
    try {
      await current(request.jobId);
      const selected = await dialog.showSaveDialog(window, {
        title: "Export note to PDF", defaultPath: suggestedPdfName(request.title),
        filters: [{ name: "PDF document", extensions: ["pdf"] }],
        properties: ["showOverwriteConfirmation", "dontAddToRecent"],
      });
      if (selected.canceled || !selected.filePath) { return { canceled: true }; }
      const file = selected.filePath;
      if (typeof file !== "string" || !path.isAbsolute(file) || !/\.pdf$/i.test(file) || file.includes("\0")) { throw new Error("Choose an absolute .pdf file in the Save dialog."); }
      const expected = await destinationState(file);
      await current(request.jobId);
      const margin = margins[request.margin];
      const pdf = await window.webContents.printToPDF({ pageSize: request.pageSize, landscape: request.landscape, printBackground: true,
        displayHeaderFooter: false, preferCSSPageSize: true, scale: 1, margins: { top: margin, bottom: margin, left: margin, right: margin } });
      if (!Buffer.isBuffer(pdf) || pdf.length < 8 || pdf.length > MAX_PDF_BYTES || !pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
        throw new Error("The host did not produce a PDF within the 64 MiB export limit.");
      }
      await current(request.jobId);
      // Write a complete sibling first so generation/I/O failures cannot truncate an existing PDF.
      temporary = path.join(path.dirname(file), "." + path.basename(file) + ".slopsidian-" + randomUUID() + ".tmp");
      const output = await fs.open(temporary, "wx", 0o600);
      try { await output.writeFile(pdf); await output.sync(); } finally { await output.close(); }
      await current(request.jobId);
      // Do not leave a renderer round trip between the final destination check
      // and publication: the Save target can change while that reply is held.
      if (!sameFile(expected, await destinationState(file))) { throw new Error("The PDF destination changed while exporting. It was left unchanged."); }
      if (expected === null) {
        // Atomic create-only publication refuses a destination that appeared after the picker.
        await fs.link(temporary, file);
        await fs.unlink(temporary); temporary = null;
      } else {
        await fs.rename(temporary, file); temporary = null;
      }
      return { canceled: false, filePath: file, bytes: pdf.length };
    } finally {
      if (temporary !== null) { await fs.unlink(temporary).catch(error => { if (error?.code !== "ENOENT") { console.error("Could not remove an owned PDF export temporary file:", error); } }); }
      busy = false;
    }
  };
  return { handle, dispose() { disposed = true; } };
}

function installPrintExport(options) {
  const exporter = createPrintExport(options);
  options.ipcMain.handle(CHANNEL, exporter.handle);
  return () => { exporter.dispose(); options.ipcMain.removeHandler(CHANNEL); };
}

module.exports = { CHANNEL, MAX_PDF_BYTES, createPrintExport, installPrintExport, printRequest, suggestedPdfName };
