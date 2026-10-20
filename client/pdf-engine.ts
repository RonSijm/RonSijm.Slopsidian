import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { pdfLimits, planPdfCanvas } from "./media-policy";

export class PdfPasswordError extends Error {
  constructor(readonly incorrect: boolean) { super(incorrect ? "The password is incorrect." : "This PDF is password protected."); this.name = "PdfPasswordError"; }
}
export class PdfDocumentError extends Error {
  constructor(message: string, readonly kind: "invalid" | "unsupported" | "failed") { super(message); this.name = "PdfDocumentError"; }
}
export interface PdfShown { page: number; zoom: number; effectiveZoom: number; capped: boolean; width: number; height: number }
export interface PdfRenderHandle { readonly pageCount: number; show(page: number, zoom: number): Promise<PdfShown | null>; dispose(): Promise<void> }
export interface PdfRenderer { open(bytes: ArrayBuffer, container: HTMLElement, options?: { password?: string; signal?: AbortSignal }): Promise<PdfRenderHandle> }

type PdfApi = typeof import("pdfjs-dist");
let apiPromise: Promise<PdfApi> | null = null;

function loadApi(): Promise<PdfApi> {
  return apiPromise ??= import(/* @vite-ignore */ new URL("js/pdf-api.js", document.baseURI).href).then((module: { default: PdfApi }) => {
    module.default.GlobalWorkerOptions.workerSrc = new URL("js/pdf-worker.js", document.baseURI).href;
    return module.default;
  }, error => { apiPromise = null; throw error; });
}

// Only same-origin copies of the packaged pdf.js data files are ever fetched.
class LocalBinaryDataFactory {
  private readonly bases: Record<string, string | null>;
  constructor(options: { cMapUrl?: string | null; standardFontDataUrl?: string | null; wasmUrl?: string | null }) {
    this.bases = { cMapUrl: options.cMapUrl ?? null, standardFontDataUrl: options.standardFontDataUrl ?? null, wasmUrl: options.wasmUrl ?? null };
  }
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const base = this.bases[kind];
    if (!base || !/^[A-Za-z0-9._-]{1,80}$/.test(filename)) { throw new Error("Unsupported PDF data request."); }
    const response = await fetch(base + filename + (kind === "wasmUrl" ? "" : ".txt"), { credentials: "same-origin" });
    if (!response.ok) { throw new Error("PDF data file is unavailable: " + filename); }
    return new Uint8Array(await response.arrayBuffer());
  }
}

export const pdfJsRenderer: PdfRenderer = {
  async open(bytes, container, options = {}) {
    const api = await loadApi();
    if (options.signal?.aborted) { throw new DOMException("PDF load was cancelled.", "AbortError"); }
    const data = new Uint8Array(bytes.slice(0));
    const dataUrl = (name: string): string => new URL("js/pdf/" + name + "/", document.baseURI).href;
    const task = api.getDocument({
      data, password: options.password, enableXfa: false, disableAutoFetch: true, disableStream: true, disableRange: true,
      useWorkerFetch: false, useSystemFonts: false, verbosity: 0, maxImageSize: pdfLimits.maxImagePixels, canvasMaxAreaInBytes: pdfLimits.maxCanvasPixels * 4,
      BinaryDataFactory: LocalBinaryDataFactory as never, cMapUrl: dataUrl("cmaps"), standardFontDataUrl: dataUrl("standard_fonts"), wasmUrl: dataUrl("wasm"),
    } as Parameters<PdfApi["getDocument"]>[0]);
    const abort = (): void => { void task.destroy(); };
    options.signal?.addEventListener("abort", abort, { once: true });
    let document_: PDFDocumentProxy;
    try { document_ = await task.promise; }
    catch (error) {
      await task.destroy().catch(() => undefined);
      if (options.signal?.aborted) { throw new DOMException("PDF load was cancelled.", "AbortError"); }
      const name = error instanceof Error ? error.name : "";
      if (name === "PasswordException") { throw new PdfPasswordError((error as { code?: number }).code === api.PasswordResponses.INCORRECT_PASSWORD); }
      if (name === "InvalidPDFException") { throw new PdfDocumentError("The file is not a readable PDF: " + (error as Error).message, "invalid"); }
      throw new PdfDocumentError("The PDF could not be opened: " + (error instanceof Error ? error.message : String(error)), "failed");
    } finally { options.signal?.removeEventListener("abort", abort); }
    if (document_.numPages < 1 || document_.numPages > pdfLimits.maxPages) {
      await task.destroy();
      throw new PdfDocumentError(`The PDF has ${document_.numPages} pages; the viewer supports 1 to ${pdfLimits.maxPages}.`, "unsupported");
    }
    const canvas = globalThis.document.createElement("canvas");
    canvas.className = "pdf-page-canvas";
    container.replaceChildren(canvas);
    let render: RenderTask | null = null, token = 0, disposed = false;
    return {
      pageCount: document_.numPages,
      async show(pageNumber, zoom) {
        if (disposed) { return null; }
        if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document_.numPages) { throw new RangeError("PDF page is outside the document."); }
        const mine = ++token;
        render?.cancel(); render = null;
        const page = await document_.getPage(pageNumber);
        if (mine !== token || disposed) { return null; }
        const base = page.getViewport({ scale: 1 });
        const plan = planPdfCanvas(base.width, base.height, zoom, globalThis.devicePixelRatio || 1);
        const viewport = page.getViewport({ scale: plan.cssScale * plan.outputScale });
        canvas.width = plan.width; canvas.height = plan.height;
        canvas.style.width = Math.floor(base.width * plan.cssScale) + "px"; canvas.style.height = Math.floor(base.height * plan.cssScale) + "px";
        const context = canvas.getContext("2d");
        if (!context) { throw new PdfDocumentError("This host cannot create a canvas for PDF pages.", "unsupported"); }
        const current = render = page.render({ canvasContext: context, canvas, viewport });
        try { await current.promise; }
        catch (error) {
          if (error instanceof Error && error.name === "RenderingCancelledException") { return null; }
          throw new PdfDocumentError("PDF page " + pageNumber + " could not be rendered: " + (error instanceof Error ? error.message : String(error)), "failed");
        } finally { if (render === current) { render = null; } page.cleanup(); }
        if (mine !== token || disposed) { return null; }
        return { page: pageNumber, zoom, effectiveZoom: plan.cssScale, capped: plan.capped, width: canvas.width, height: canvas.height };
      },
      async dispose() {
        if (disposed) { return; }
        disposed = true; token++;
        render?.cancel(); render = null;
        canvas.width = canvas.height = 0; canvas.remove();
        await task.destroy().catch(() => undefined);
      },
    };
  },
};
