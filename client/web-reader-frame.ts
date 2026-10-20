import { escapeReaderText, readerArticle, readerLink, type ReaderArticle } from "./web-reader-policy";
import { WEB_ZOOM_MIN, WEB_ZOOM_MAX, webZoomFactor } from "../shared/web-zoom.cjs";
import { READER_FONTS, READER_WIDTHS, READER_TYPOGRAPHY, readerAppearance, readerFontName, type ReaderAppearance } from "./web-reader-appearance";
import { readerProgress } from "./web-reader-progress";
import { CLIP_MAX_SELECTION } from "./web-clip-policy";

/** Self-contained code serialized into an opaque-origin frame with a unique CSP nonce. */
function readerBootstrap(token: string, parentOrigin: string, zoomMin: number, zoomMax: number, fonts: Record<string, string>, widths: Record<string, string>, typography: typeof READER_TYPOGRAPHY, maxSelection: number, fontName: typeof readerFontName): void {
  const send = (kind: string, data: Record<string, unknown> = {}): void => parent.postMessage({ channel: "slopsidian-reader", token, kind, ...data }, parentOrigin);
  let progress = 0, restoring = true, restoreFrame = 0, waitingForLayout = false;
  const main = document.querySelector("main")!;
  const hasLayout = (): boolean => (document.scrollingElement ?? document.documentElement).clientHeight > 0 && main.checkVisibility();
  const measure = (): number => {
    const root = document.scrollingElement ?? document.documentElement;
    if (!hasLayout()) { return progress; }
    const distance = root.scrollHeight - root.clientHeight;
    return distance > 0 ? Math.max(0, Math.min(1, root.scrollTop / distance)) : 0;
  };
  const restore = (value: number): void => {
    progress = value; restoring = true; waitingForLayout = !hasLayout();
    cancelAnimationFrame(restoreFrame);
    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = requestAnimationFrame(() => {
        const root = document.scrollingElement ?? document.documentElement;
        if (!hasLayout()) { waitingForLayout = true; return; }
        waitingForLayout = false;
        root.scrollTop = Math.max(0, root.scrollHeight - root.clientHeight) * progress;
        restoring = false;
        send("progress-restored", { progress: measure() });
      });
    });
  };
  const reportProgress = (requestId?: number): void => {
    if (!hasLayout()) { return; }
    if (!restoring) { progress = measure(); }
    send("progress", { progress, ...(requestId === undefined ? {} : { requestId }) });
  };
  addEventListener("scroll", () => { if (!restoring) { reportProgress(); } }, { passive: true });
  addEventListener("resize", () => restore(progress));
  new ResizeObserver(() => {
    if (!hasLayout()) { waitingForLayout = true; restoring = true; cancelAnimationFrame(restoreFrame); }
    else if (waitingForLayout) { restore(progress); }
  }).observe(main);
  const follow = (event: MouseEvent): void => {
    const anchor = event.target instanceof Element ? event.target.closest("a") : null;
    if (!anchor) { return; }
    event.preventDefault();
    if ((event.button === 0 || event.button === 1) && anchor.dataset.readerUrl) {
      send("navigate", { url: anchor.dataset.readerUrl, newTab: event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1 });
    }
  };
  document.addEventListener("click", follow);
  document.addEventListener("auxclick", follow);
  document.addEventListener("keydown", event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) { return; }
    const action = ({ f: "find", l: "address", h: "history", w: "close", "+": "zoom-in", "=": "zoom-in", "-": "zoom-out", "0": "zoom-reset" } as Record<string, string>)[event.key.toLowerCase()];
    if (action) { event.preventDefault(); send("shortcut", { action }); }
  });
  let lastQuery = "", selected = -1;
  let ranges: Range[] = [];
  addEventListener("message", event => {
    const data = event.data;
    if (event.source !== parent || event.origin !== parentOrigin || data?.channel !== "slopsidian-reader" || data.token !== token) { return; }
    if (data.kind === "capture-selection") {
      if (!Number.isSafeInteger(data.requestId) || data.requestId <= 0) { return; }
      try {
        const selected = getSelection(), unsupported = 'input,textarea,select,iframe,frame,object,embed,[contenteditable]:not([contenteditable="false"])';
        if (document.activeElement?.closest(unsupported) || !selected || selected.rangeCount !== 1 || selected.isCollapsed) { throw new Error("Select text in Reader before using Save selection."); }
        const range = selected.getRangeAt(0), main = document.querySelector("main");
        for (const node of [range.startContainer, range.endContainer]) {
          const element = node.nodeType === 1 ? node as Element : node.parentElement;
          if (node.getRootNode() !== document || !main?.contains(node) || element?.closest(unsupported)) { throw new Error("Select text in the displayed Reader article. Control and embedded-frame selections are unavailable."); }
        }
        const text = selected.toString();
        if (text.length > maxSelection) { throw new Error("This selection is too large to save. Select at most 200,000 characters."); }
        if (!text.trim() || text.includes("\0")) { throw new Error("Select text in Reader before using Save selection."); }
        send("selection-result", { requestId: data.requestId, text });
      } catch (error) {
        send("selection-result", { requestId: data.requestId, error: error instanceof Error ? error.message.slice(0, 500) : "The Reader selection could not be read. Select text and try again." });
      }
      return;
    }
    if (data.kind === "restore-progress") {
      if (typeof data.progress === "number" && Number.isFinite(data.progress) && data.progress >= 0 && data.progress <= 1) { restore(data.progress); }
      return;
    }
    if (data.kind === "capture-progress") {
      if (Number.isSafeInteger(data.requestId) && data.requestId > 0) { reportProgress(data.requestId); }
      return;
    }
    if (data.kind === "appearance") {
      if (typeof data.readerFont === "string" && Object.hasOwn(fonts, data.readerFont)
        && typeof data.readerWidth === "string" && Object.hasOwn(widths, data.readerWidth)
        && typeof data.readerFontSize === "number" && Number.isInteger(data.readerFontSize) && data.readerFontSize >= typography.fontSize.minimum && data.readerFontSize <= typography.fontSize.maximum
        && typeof data.readerLineHeight === "number" && data.readerLineHeight === Math.round(data.readerLineHeight * 10) / 10 && data.readerLineHeight >= typography.lineHeight.minimum && data.readerLineHeight <= typography.lineHeight.maximum
        && typeof data.readerParagraphSpacing === "number" && data.readerParagraphSpacing === Math.round(data.readerParagraphSpacing * 10) / 10 && data.readerParagraphSpacing >= typography.paragraphSpacing.minimum && data.readerParagraphSpacing <= typography.paragraphSpacing.maximum
        && typeof data.readerLetterSpacing === "number" && data.readerLetterSpacing === Math.round(data.readerLetterSpacing * 100) / 100 && data.readerLetterSpacing >= typography.letterSpacing.minimum && data.readerLetterSpacing <= typography.letterSpacing.maximum
        && typeof data.readerCustomWidth === "number" && Number.isInteger(data.readerCustomWidth) && data.readerCustomWidth >= typography.customWidth.minimum && data.readerCustomWidth <= typography.customWidth.maximum) {
        const style = document.documentElement.style;
        let font: string;
        try { const name = fontName(data.readerCustomFont); font = data.readerFont === "custom" ? JSON.stringify(name) + ",serif" : fonts[data.readerFont]; }
        catch { return; }
        const letterSpacing = data.readerLetterSpacing === 0 ? "normal" : data.readerLetterSpacing + "em";
        const width = data.readerWidth === "custom" ? data.readerCustomWidth + "ch" : widths[data.readerWidth];
        if (style.getPropertyValue("--reader-font") !== font || style.getPropertyValue("--reader-width") !== width
          || style.getPropertyValue("--reader-font-size") !== data.readerFontSize + "px" || style.getPropertyValue("--reader-line-height") !== String(data.readerLineHeight)
          || style.getPropertyValue("--reader-paragraph-spacing") !== data.readerParagraphSpacing + "em" || style.getPropertyValue("--reader-letter-spacing") !== letterSpacing) {
          if (!restoring) { progress = measure(); }
          style.setProperty("--reader-font", font);
          style.setProperty("--reader-width", width);
          style.setProperty("--reader-font-size", data.readerFontSize + "px");
          style.setProperty("--reader-line-height", String(data.readerLineHeight));
          style.setProperty("--reader-paragraph-spacing", data.readerParagraphSpacing + "em");
          style.setProperty("--reader-letter-spacing", letterSpacing);
          restore(progress);
        }
      }
      return;
    }
    if (data.kind === "zoom") {
      if (typeof data.factor === "number" && Number.isFinite(data.factor) && data.factor >= zoomMin && data.factor <= zoomMax && document.documentElement.style.zoom !== String(data.factor)) {
        if (!restoring) { progress = measure(); }
        document.documentElement.style.zoom = String(data.factor); restore(progress);
      }
      return;
    }
    if (data.kind !== "find" || typeof data.text !== "string" || data.text.length > 1024 || !Number.isSafeInteger(data.requestId)) { return; }
    try {
      if (lastQuery !== data.text || !data.next) {
        lastQuery = data.text; selected = -1; ranges = [];
        const root = document.querySelector("main")!;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes: { node: Node; start: number; end: number }[] = [];
        let text = "", node: Node | null;
        while ((node = walker.nextNode())) {
          const start = text.length; text += node.textContent ?? "";
          nodes.push({ node, start, end: text.length });
        }
        if (data.text) {
          const pattern = new RegExp(data.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
          let startIndex = 0, endIndex = 0;
          for (const match of text.matchAll(pattern)) {
            if (ranges.length >= 10_000) { throw new Error("Too many matches. Enter a more specific find query."); }
            const from = match.index, to = from + match[0].length;
            while (nodes[startIndex]?.end <= from) { startIndex++; }
            while (nodes[endIndex]?.end < to) { endIndex++; }
            const range = document.createRange();
            range.setStart(nodes[startIndex].node, from - nodes[startIndex].start);
            range.setEnd(nodes[endIndex].node, to - nodes[endIndex].start);
            ranges.push(range);
          }
        }
      }
      const selection = getSelection(); selection?.removeAllRanges();
      if (ranges.length) {
        selected = selected < 0 ? data.forward === false ? ranges.length - 1 : 0 : (selected + (data.forward === false ? -1 : 1) + ranges.length) % ranges.length;
        const range = ranges[selected]; selection?.addRange(range);
        (range.startContainer.parentElement ?? document.body).scrollIntoView({ block: "center" });
      }
      send("find-result", { requestId: data.requestId, active: selected + 1, matches: ranges.length });
    } catch (error) {
      ranges = []; selected = -1; lastQuery = "";
      send("find-result", { requestId: data.requestId, active: 0, matches: 0, error: error instanceof Error ? error.message : "Reader find failed." });
    }
  });
  send("ready");
}

export function readerDocument(article: ReaderArticle, token: string, parentOrigin: string, light: boolean, factor = 1, appearance: ReaderAppearance = readerAppearance()): string {
  readerArticle(article, article.url);
  if (!/^[a-f0-9-]{36}$/.test(token) || new URL(parentOrigin).origin !== parentOrigin) { throw new Error("Invalid reader session."); }
  const text = escapeReaderText, url = text(article.url);
  const zoom = webZoomFactor(factor);
  const { readerFont, readerWidth, readerFontSize, readerLineHeight, readerParagraphSpacing, readerLetterSpacing, readerCustomWidth, readerCustomFont } = readerAppearance(appearance);
  const font = readerFont === "custom" ? JSON.stringify(readerCustomFont) + ",serif" : READER_FONTS[readerFont];
  const width = readerWidth === "custom" ? readerCustomWidth + "ch" : READER_WIDTHS[readerWidth];
  const script = `(${readerBootstrap.toString()})(${JSON.stringify(token)},${JSON.stringify(parentOrigin)},${WEB_ZOOM_MIN},${WEB_ZOOM_MAX},${JSON.stringify(READER_FONTS)},${JSON.stringify(READER_WIDTHS)},${JSON.stringify(READER_TYPOGRAPHY)},${CLIP_MAX_SELECTION},(${readerFontName.toString()}));`;
  return `<!doctype html><html lang="${text(article.lang || "en")}" dir="${article.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${token}'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>${text(article.title)}</title><style>
    :root{zoom:${zoom};--reader-font:${font};--reader-width:${width};--reader-font-size:${readerFontSize}px;--reader-line-height:${readerLineHeight};--reader-paragraph-spacing:${readerParagraphSpacing}em;--reader-letter-spacing:${readerLetterSpacing === 0 ? "normal" : readerLetterSpacing + "em"};color-scheme:${light ? "light" : "dark"};font:var(--reader-font-size)/var(--reader-line-height) var(--reader-font);letter-spacing:var(--reader-letter-spacing);background:${light ? "#faf9f6" : "#202124"};color:${light ? "#262626" : "#e5e5e5"}}
    body{margin:0;padding:clamp(18px,5vw,60px)}main{max-width:var(--reader-width);margin:auto;overflow-wrap:anywhere}h1,h2,h3,h4{line-height:1.25}h1{font-size:2em;margin:0 0 .4em}.reader-meta{font:14px/1.6 system-ui;color:${light ? "#656565" : "#b7b7b7"};margin-bottom:2em;overflow-wrap:anywhere}a{color:${light ? "#255ca8" : "#9cc6ff"}}p{margin:var(--reader-paragraph-spacing) 0}pre{overflow:auto;padding:1em;background:${light ? "#efefed" : "#303134"};border-radius:5px}code{font-size:.85em}blockquote{border-inline-start:3px solid #888;margin-inline:0;padding-inline-start:1em}table{border-collapse:collapse;display:block;overflow:auto}td,th{border:1px solid #888;padding:.4em .65em}hr{border:0;border-top:1px solid #888;margin:2em 0}::selection{background:#ad7f2988}
    </style></head><body><main><header><h1>${text(article.title)}</h1><div class="reader-meta">${article.byline ? text(article.byline) + " · " : ""}About ${Math.max(1, Math.ceil(article.textLength / 1200))} min read<br><a href="#reader-link" data-reader-url="${url}">${url}</a></div></header><article>${article.content}</article></main><script nonce="${token}">${script}</script></body></html>`;
}

interface ReaderCallbacks {
  navigate(url: string, newTab: boolean): void;
  shortcut(action: string): void;
  find(requestId: number, active: number, matches: number, error?: string): void;
  progress?(value: number): void;
  documentChanged?(): void;
}

interface ReaderSelection { url: string; title: string; text: string }

export class WebReaderFrame {
  readonly frame = document.createElement("iframe");
  readonly ready: Promise<void>;
  private readonly token = crypto.randomUUID();
  private disposed = false;
  private readonly receive: (event: MessageEvent) => void;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly rejectReady: (error: Error) => void;
  private progress: number;
  private progressRestored = false;
  get progressReady(): boolean { return this.progressRestored; }
  private zoom: number;
  private appearance: ReaderAppearance;
  private progressRequest = 0;
  private readonly captures = new Map<number, { finish(): void; timer: ReturnType<typeof setTimeout> }>();
  private revision = 0;
  get documentRevision(): number { return this.revision; }
  private selectionRequest = 0;
  private readonly selectionSource: { url: string; title: string };
  private readonly selections = new Map<number, { finish(text?: string, error?: Error): void; timer: ReturnType<typeof setTimeout> }>();

  constructor(article: ReaderArticle, callbacks: ReaderCallbacks, zoom = 1, appearance: ReaderAppearance = readerAppearance(), progress = 0) {
    this.selectionSource = { url: article.url, title: article.title };
    this.progress = readerProgress(progress); this.zoom = webZoomFactor(zoom); this.appearance = readerAppearance(appearance);
    this.frame.className = "webviewer-reader"; this.frame.dataset.webviewerReader = "";
    this.frame.name = "reader-" + this.token; this.frame.title = "Reader: " + article.title;
    this.frame.setAttribute("sandbox", "allow-scripts"); this.frame.referrerPolicy = "no-referrer";
    let resolveReady!: () => void, rejectReady!: (error: Error) => void;
    this.ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    this.rejectReady = rejectReady;
    this.timer = setTimeout(() => rejectReady(new Error("The reader view could not load. The original page is still available.")), 8000);
    this.receive = event => {
      const data = event.data;
      if (this.disposed || event.source !== this.frame.contentWindow || data?.channel !== "slopsidian-reader" || data.token !== this.token) { return; }
      if (data.kind === "ready") {
        this.revision++;
        for (const selection of this.selections.values()) { selection.finish(undefined, new Error("The Reader document changed. Select text again.")); }
        if (this.revision > 1) { callbacks.documentChanged?.(); }
        clearTimeout(this.timer); resolveReady();
        // Workspace DOM moves can create a fresh iframe document with the same element.
        this.setZoom(this.zoom); this.setAppearance(this.appearance); this.restoreProgress(this.progress);
      }
      if (data.kind === "selection-result") {
        if (event.origin !== "null" || !Number.isSafeInteger(data.requestId) || data.requestId <= 0) { return; }
        const selection = this.selections.get(data.requestId);
        if (!selection) { return; }
        if (typeof data.text === "string" && data.text.trim() && data.text.length <= CLIP_MAX_SELECTION && !data.text.includes("\0") && !Object.hasOwn(data, "error")) { selection.finish(data.text); }
        else if (typeof data.error === "string" && data.error.trim() && data.error.length <= 500 && !Object.hasOwn(data, "text")) { selection.finish(undefined, new Error(data.error.replace(/[\u0000-\u001f\u007f]/g, " "))); }
        else { selection.finish(undefined, new Error("The Reader returned an invalid selection. Select text and try again.")); }
      }
      if (["progress", "progress-restored"].includes(data.kind) && typeof data.progress === "number" && Number.isFinite(data.progress) && data.progress >= 0 && data.progress <= 1) {
        if (data.kind === "progress-restored") { this.progressRestored = true; }
        this.progress = data.progress; callbacks.progress?.(data.progress);
        if (Number.isSafeInteger(data.requestId)) { this.captures.get(data.requestId)?.finish(); }
      }
      if (data.kind === "navigate" && typeof data.url === "string") {
        const url = readerLink(data.url, article.url);
        if (url) { callbacks.navigate(url, data.newTab === true); }
      }
      if (data.kind === "shortcut" && ["find", "address", "history", "close", "zoom-in", "zoom-out", "zoom-reset"].includes(data.action)) { callbacks.shortcut(data.action); }
      if (data.kind === "find-result" && [data.requestId, data.active, data.matches].every(Number.isSafeInteger)
        && data.matches >= 0 && data.matches <= 10_000 && data.active >= 0 && data.active <= data.matches) {
        callbacks.find(data.requestId, data.active, data.matches, typeof data.error === "string" ? data.error.slice(0, 500) : undefined);
      }
    };
    window.addEventListener("message", this.receive);
    this.frame.srcdoc = readerDocument(article, this.token, location.origin, document.body.classList.contains("theme-light"), zoom, appearance);
  }
  find(text: string, forward: boolean, next: boolean, requestId: number): void {
    this.frame.contentWindow?.postMessage({ channel: "slopsidian-reader", token: this.token, kind: "find", text, forward, next, requestId }, "*");
  }
  setZoom(value: number): void {
    const factor = webZoomFactor(value);
    this.zoom = factor;
    if (!this.disposed) { this.frame.contentWindow?.postMessage({ channel: "slopsidian-reader", token: this.token, kind: "zoom", factor }, "*"); }
  }
  setAppearance(value: ReaderAppearance): void {
    const appearance = readerAppearance(value);
    this.appearance = appearance;
    if (!this.disposed) { this.frame.contentWindow?.postMessage({ channel: "slopsidian-reader", token: this.token, kind: "appearance", ...appearance }, "*"); }
  }
  restoreProgress(value: number): void {
    this.progress = readerProgress(value);
    this.progressRestored = false;
    if (!this.disposed) { this.frame.contentWindow?.postMessage({ channel: "slopsidian-reader", token: this.token, kind: "restore-progress", progress: this.progress }, "*"); }
  }
  async captureSelection(): Promise<ReaderSelection> {
    const target = this.frame.contentWindow;
    if (this.disposed || !target || !this.frame.checkVisibility()) { throw new Error("This Reader is closed or unavailable. Select text in a visible Reader."); }
    if (this.selections.size) { throw new Error("A Reader selection capture is already running."); }
    const requestId = ++this.selectionRequest;
    return new Promise<ReaderSelection>((resolve, reject) => {
      const finish = (text?: string, error?: Error): void => {
        const pending = this.selections.get(requestId);
        if (!pending) { return; }
        clearTimeout(pending.timer); this.selections.delete(requestId);
        if (error) { reject(error); } else { resolve({ ...this.selectionSource, text: text! }); }
      };
      this.selections.set(requestId, { finish, timer: setTimeout(() => finish(undefined, new Error("Reader selection capture timed out. Select text and try again.")), 2000) });
      try { target.postMessage({ channel: "slopsidian-reader", token: this.token, kind: "capture-selection", requestId }, "*"); }
      catch { finish(undefined, new Error("The Reader selection is unavailable. Reopen Reader and select text again.")); }
    });
  }
  async flushProgress(): Promise<void> {
    if (this.disposed || !this.frame.checkVisibility()) { return; }
    const requestId = ++this.progressRequest;
    await new Promise<void>(resolve => {
      const finish = (): void => { const capture = this.captures.get(requestId); if (capture) { clearTimeout(capture.timer); this.captures.delete(requestId); } resolve(); };
      this.captures.set(requestId, { finish, timer: setTimeout(finish, 500) });
      this.frame.contentWindow?.postMessage({ channel: "slopsidian-reader", token: this.token, kind: "capture-progress", requestId }, "*");
    });
  }
  dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true; clearTimeout(this.timer); window.removeEventListener("message", this.receive);
    for (const capture of this.captures.values()) { capture.finish(); }
    for (const selection of this.selections.values()) { selection.finish(undefined, new Error("This Reader has closed. Select text again.")); }
    this.rejectReady(new DOMException("Reader was closed.", "AbortError")); this.frame.remove();
  }
}
