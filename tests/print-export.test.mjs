import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, readdir, rm, rmdir, utimes, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const require = createRequire(import.meta.url);
const { CHANNEL, MAX_PDF_BYTES, createPrintExport, installPrintExport, printRequest, suggestedPdfName } = require("../desktop/print-export.cjs");
const bundle = await build({ entryPoints: ["client/print-export-model.ts"], bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent" });
const model = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].contents).toString("base64"));
const request = () => ({ jobId: "12345678-1234-1234-1234-123456789abc", title: "Exact λ note", pageSize: "A4", landscape: false, margin: "normal" });
const pdf = Buffer.from("%PDF-1.7\nA complete generated document\n%%EOF\n");
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

async function fixture(body) {
  const runtime = resolve(".runtime"); await mkdir(runtime, { recursive: true });
  const directory = await mkdtemp(join(runtime, "print-export-tests-")), calls = [];
  const destination = join(directory, "Printed note.pdf");
  const webContents = { mainFrame: { url: "http://127.0.0.1:3456/" }, isDestroyed: () => false,
    executeJavaScript: async script => { calls.push(["validate", script]); return true; },
    printToPDF: async options => { calls.push(["pdf", options]); return pdf; } };
  const window = { webContents, isDestroyed: () => false };
  const dialog = { showSaveDialog: async (owner, options) => { calls.push(["dialog", owner, options]); return { canceled: false, filePath: destination }; } };
  const options = { window, dialog, isLocalUrl: value => value === webContents.mainFrame.url, isClosing: () => false };
  const exporter = createPrintExport(options), event = { sender: webContents, senderFrame: webContents.mainFrame };
  try { await body({ directory, destination, calls, window, webContents, dialog, options, exporter, event }); }
  finally { assert.ok(directory.startsWith(runtime + sep)); await rm(directory, { recursive: true, force: true }); }
}

test("print options only produce supported page rules and safe suggested filenames", () => {
  assert.equal(model.printPageRule({ ...model.DEFAULT_PRINT_OPTIONS, pageSize: "Letter", landscape: true, margin: "minimal" }), "@page { size: Letter landscape; margin: 6.35mm; }");
  for (const bad of [null, { ...model.DEFAULT_PRINT_OPTIONS, pageSize: "A4;} body{display:none}" }, { ...model.DEFAULT_PRINT_OPTIONS, landscape: 1 }, { ...model.DEFAULT_PRINT_OPTIONS, margin: "__proto__" }, { ...model.DEFAULT_PRINT_OPTIONS, other: true }]) {
    assert.throws(() => model.validatePrintOptions(bad));
  }
  for (const [title, expected] of [["Exact λ note", "Exact λ note.pdf"], ["CON", "Note CON.pdf"], ["a/b\\c:*?. ", "a_b_c___.pdf"], ["..", "Note.pdf"]]) {
    assert.equal(suggestedPdfName(title), expected); assert.equal(model.suggestedPdfName(title), expected);
  }
});

test("native requests accept options and job identity, never arbitrary paths, HTML or unknown fields", () => {
  assert.deepEqual(printRequest(request()), request());
  for (const bad of [null, [], { ...request(), filePath: "C:\\User\\secret.pdf" }, { ...request(), html: "<script>" }, { ...request(), jobId: "x' ; alert(1)" }, { ...request(), title: "a\nprint" }, { ...request(), pageSize: "Custom" }, { ...request(), margin: "constructor" }, { ...request(), landscape: "false" }]) {
    assert.throws(() => printRequest(bad), /Invalid PDF export/);
  }
});

test("only the exact owned local main frame can open the Save dialog", () => fixture(async f => {
  for (const event of [{ ...f.event, sender: {} }, { ...f.event, senderFrame: { ...f.webContents.mainFrame } }, { ...f.event, senderFrame: null }]) {
    await assert.rejects(f.exporter.handle(event, request()), /local application main window/);
  }
  const alternate = createPrintExport({ ...f.options, isLocalUrl: () => false });
  await assert.rejects(alternate.handle(f.event, request()), /local application main window/);
  assert.deepEqual(f.calls, []);
}));

test("canceling the actual Save selection produces no PDF or filesystem output", () => fixture(async f => {
  f.dialog.showSaveDialog = async (_owner, options) => {
    assert.deepEqual(options.filters, [{ name: "PDF document", extensions: ["pdf"] }]);
    assert.ok(options.properties.includes("showOverwriteConfirmation"));
    return { canceled: true };
  };
  assert.deepEqual(await f.exporter.handle(f.event, request()), { canceled: true });
  assert.equal(f.calls.filter(([name]) => name === "pdf").length, 0); assert.deepEqual(await readdir(f.directory), []);
}));

test("a confirmed valid job prints the current page with selected options and publishes complete PDF bytes", () => fixture(async f => {
  const result = await f.exporter.handle(f.event, { ...request(), pageSize: "Letter", landscape: true, margin: "minimal" });
  assert.deepEqual(result, { canceled: false, filePath: f.destination, bytes: pdf.length });
  assert.deepEqual(await readFile(f.destination), pdf); assert.deepEqual(await readdir(f.directory), ["Printed note.pdf"]);
  const options = f.calls.find(([name]) => name === "pdf")[1];
  assert.equal(options.pageSize, "Letter"); assert.equal(options.landscape, true); assert.equal(options.printBackground, true); assert.equal(options.displayHeaderFooter, false);
  assert.deepEqual(options.margins, { top: .25, bottom: .25, left: .25, right: .25 });
  assert.ok(f.calls.filter(([name]) => name === "validate").length >= 4);
}));

test("explicitly confirmed replacement publishes a complete PDF without leaving staging files", () => fixture(async f => {
  await writeFile(f.destination, "Old PDF retained until commit");
  await f.exporter.handle(f.event, request());
  assert.deepEqual(await readFile(f.destination), pdf); assert.deepEqual(await readdir(f.directory), ["Printed note.pdf"]);
}));

test("generation failure and invalid/over-limit host data retain an existing destination exactly", () => fixture(async f => {
  const original = Buffer.from("Previously saved PDF"); await writeFile(f.destination, original);
  for (const produce of [() => { throw new Error("Renderer failed"); }, () => Buffer.from("not PDF"), () => Buffer.alloc(MAX_PDF_BYTES + 1)]) {
    f.webContents.printToPDF = async () => produce();
    await assert.rejects(f.exporter.handle(f.event, request()), /Renderer failed|did not produce a PDF/);
    assert.deepEqual(await readFile(f.destination), original); assert.deepEqual(await readdir(f.directory), ["Printed note.pdf"]);
  }
}));

test("stale print ownership refuses before the picker, after selection, after rendering and before publication", () => fixture(async f => {
  for (const failAt of [1, 2, 3, 4]) {
    let calls = 0;
    f.webContents.executeJavaScript = async () => ++calls < failAt;
    await assert.rejects(f.exporter.handle(f.event, request()), /note or print preview changed/);
    assert.deepEqual(await readdir(f.directory), []);
  }
}));

test("a destination changed or created while PDF generation is held remains untouched", () => fixture(async f => {
  for (const existing of [false, true]) {
    if (existing) { await writeFile(f.destination, "Old value"); }
    const gate = deferred(), started = deferred();
    f.webContents.printToPDF = async () => { started.resolve(); await gate.promise; return pdf; };
    const pending = f.exporter.handle(f.event, request()); await started.promise;
    await writeFile(f.destination, "External replacement"); const later = new Date(Date.now() + 4000); await utimes(f.destination, later, later);
    gate.resolve(); await assert.rejects(pending, /destination changed/);
    assert.equal(await readFile(f.destination, "utf8"), "External replacement");
    assert.deepEqual(await readdir(f.directory), ["Printed note.pdf"]);
    await rm(f.destination);
  }
}));

test("unsupported picker destinations refuse before generation", () => fixture(async f => {
  const folder = join(f.directory, "folder.pdf");
  for (const filePath of ["relative.pdf", join(f.directory, "note.txt"), folder]) {
    if (filePath === folder) { await mkdir(filePath); }
    f.dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    try { await assert.rejects(f.exporter.handle(f.event, request()), /absolute .pdf|regular .pdf/); }
    finally { if (filePath === folder) { await rmdir(filePath); } }
  }
  assert.equal(f.calls.filter(([name]) => name === "pdf").length, 0);
}));

test("an existing PDF changed during the final renderer ownership round trip is not overwritten", () => fixture(async f => {
  await writeFile(f.destination, "Original PDF");
  const held = deferred(), entered = deferred(); let checks = 0;
  f.webContents.executeJavaScript = async () => { if (++checks === 4) { entered.resolve(); await held.promise; } return true; };
  const pending = f.exporter.handle(f.event, request()); await entered.promise;
  await writeFile(f.destination, "External bytes written while the final renderer check is held");
  held.resolve(); await assert.rejects(pending, /destination changed/);
  assert.equal(await readFile(f.destination, "utf8"), "External bytes written while the final renderer check is held");
  assert.deepEqual(await readdir(f.directory), ["Printed note.pdf"]);
}));

test("a held export excludes another request and releases its busy state after cancellation", () => fixture(async f => {
  const gate = deferred(), started = deferred();
  f.dialog.showSaveDialog = async () => { started.resolve(); await gate.promise; return { canceled: true }; };
  const pending = f.exporter.handle(f.event, request()); await started.promise;
  await assert.rejects(f.exporter.handle(f.event, request()), /current PDF export/);
  gate.resolve(); assert.deepEqual(await pending, { canceled: true });
  assert.deepEqual(await f.exporter.handle(f.event, request()), { canceled: true });
}));

test("closing/disposal invalidates a pending generation and installation removes only its owned channel", () => fixture(async f => {
  const gate = deferred(), started = deferred();
  f.webContents.printToPDF = async () => { started.resolve(); await gate.promise; return pdf; };
  const handlers = new Map(), ipcMain = { handle: (name, callback) => handlers.set(name, callback), removeHandler: name => handlers.delete(name) };
  const dispose = installPrintExport({ ...f.options, ipcMain }); assert.equal(handlers.size, 1);
  const pending = handlers.get(CHANNEL)(f.event, request()); await started.promise; dispose(); gate.resolve();
  await assert.rejects(pending, /closing/); assert.equal(handlers.size, 0); assert.deepEqual(await readdir(f.directory), []);
}));
