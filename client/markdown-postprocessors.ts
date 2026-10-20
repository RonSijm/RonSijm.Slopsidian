import { reportError } from "./dom";
import type { CachedMetadata } from "./markdown";
import type { MarkdownRenderChild } from "./plugin";

export interface MarkdownSectionInformation { text: string; lineStart: number; lineEnd: number }
export interface MarkdownPostProcessorContext {
  docId: string;
  sourcePath: string;
  frontmatter: Record<string, unknown> | undefined;
  addChild(child: MarkdownRenderChild): void;
  getSectionInfo(element: HTMLElement): MarkdownSectionInformation | null;
}
export interface MarkdownPostProcessor {
  (element: HTMLElement, context: MarkdownPostProcessorContext): unknown | Promise<unknown>;
  sortOrder?: number;
}
export type MarkdownCodeBlockProcessor = (source: string, element: HTMLElement, context: MarkdownPostProcessorContext) => unknown | Promise<unknown>;

const processors = new Map<MarkdownPostProcessor, number>();
const codeBlockLanguages = new Map<string, MarkdownPostProcessor>();
const listeners = new Set<() => void>();
const ownedChildren = new WeakSet<MarkdownRenderChild>();
let version = 0;

function changed(): void {
  version++;
  for (const listener of [...listeners]) { listener(); }
}

export class MarkdownPreviewRenderer {
  static registerPostProcessor(processor: MarkdownPostProcessor, sortOrder?: number): void {
    if (typeof processor !== "function") { throw new Error("Markdown postprocessors require a callback."); }
    const order = sortOrder ?? processor.sortOrder ?? 0;
    if (!Number.isInteger(order)) {
      throw new Error("Markdown postprocessors require a callback and an integer sort order.");
    }
    if (processors.has(processor)) { throw new Error("This Markdown postprocessor is already registered."); }
    processors.set(processor, order);
    changed();
  }

  static unregisterPostProcessor(processor: MarkdownPostProcessor): void {
    if (processors.delete(processor)) { changed(); }
  }

  static createCodeBlockPostProcessor(language: string, handler: MarkdownCodeBlockProcessor): MarkdownPostProcessor {
    if (typeof language !== "string" || !language || /[\s\0]/.test(language) || typeof handler !== "function") {
      throw new Error("Code block processors require a nonempty language without whitespace and a callback.");
    }
    return async (element, context) => {
      const blocks = [...element.querySelectorAll<HTMLElement>("pre > code")].filter(code => code.classList.contains("language-" + language));
      await Promise.all(blocks.map(async code => {
        const pre = code.parentElement;
        if (!pre || !element.contains(pre)) { return; }
        const text = code.textContent ?? "";
        const source = text.endsWith("\n") ? text.slice(0, -1) : text;
        const container = document.createElement("div");
        container.className = "block-language-" + language;
        if (pre.dataset.sourceLine !== undefined) { container.dataset.sourceLine = pre.dataset.sourceLine; }
        pre.replaceWith(container);
        try {
          await handler(source, container, context);
        } catch (error) {
          const message = document.createElement("p");
          message.className = "reading-embed-error";
          message.setAttribute("role", "status");
          message.textContent = "Code block processor failed: " + (error instanceof Error ? error.message : String(error));
          container.replaceChildren(message, pre);
          throw error;
        }
      }));
    };
  }
}

export function registerCodeBlockProcessor(language: string, handler: MarkdownCodeBlockProcessor, sortOrder?: number): { processor: MarkdownPostProcessor; dispose: () => void } {
  if (codeBlockLanguages.has(language)) { throw new Error("A code block processor is already registered for language " + language + "."); }
  const processor = MarkdownPreviewRenderer.createCodeBlockPostProcessor(language, handler);
  if (language.toLowerCase() === "mermaid") { throw new Error("The built-in Mermaid renderer already owns this code block language."); }
  MarkdownPreviewRenderer.registerPostProcessor(processor, sortOrder);
  codeBlockLanguages.set(language, processor);
  return {
    processor,
    dispose() {
      if (codeBlockLanguages.get(language) === processor) { codeBlockLanguages.delete(language); }
      MarkdownPreviewRenderer.unregisterPostProcessor(processor);
    },
  };
}

export function markdownProcessorsVersion(): number { return version; }

export function observeMarkdownProcessors(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function processRenderedMarkdown(element: HTMLElement, sourcePath: string, text: string, cache: CachedMetadata, current: () => boolean, sectionInfo = true, retainDetachedRoot = false): { ready: Promise<void>; dispose: () => Promise<void> } {
  const children = new Map<MarkdownRenderChild, { loading: Promise<void>; attached: boolean }>();
  const releasing = new Set<Promise<void>>();
  let disposed = false;
  let disposal: Promise<void> | null = null;
  let processing = true;
  let connected = element.isConnected;
  let observer: MutationObserver | null = null;
  const active = (): boolean => !disposed && current();
  const release = async (child: MarkdownRenderChild, loading: Promise<void>): Promise<void> => {
    if (!children.delete(child)) { return; }
    const operation = (async () => {
      try {
        await Promise.allSettled([loading]);
        if (typeof child.unloadAndWait === "function") { await child.unloadAndWait(); }
        else { await child.unload(); }
      } finally { ownedChildren.delete(child); }
    })();
    releasing.add(operation);
    operation.then(() => releasing.delete(operation), () => releasing.delete(operation));
    await operation;
  };
  const checkChildren = (): void => {
    if (element.isConnected) { connected = true; }
    for (const [child, record] of children) {
      const attached = element.contains(child.containerEl);
      // Processors may register children while constructing a detached replacement.
      // Keep those children until insertion or completion; removal after adoption
      // still ends ownership immediately.
      if (attached) { record.attached = true; }
      if (!active() || !retainDetachedRoot && connected && !element.isConnected || !attached && (record.attached || child.containerEl.isConnected || !processing)) {
        release(child, record.loading).catch(reportError);
      }
    }
    if (!children.size) { observer?.disconnect(); observer = null; }
  };
  const context: MarkdownPostProcessorContext = {
    docId: crypto.randomUUID(), sourcePath, frontmatter: cache.frontmatter,
    addChild(child) {
      if (!active()) { throw new Error("This Markdown render is no longer active."); }
      if (!child || !(child.containerEl instanceof HTMLElement) || typeof child.load !== "function" || typeof child.unload !== "function" || child.containerEl.ownerDocument !== element.ownerDocument || !element.contains(child.containerEl) && child.containerEl.isConnected || ownedChildren.has(child)) {
        throw new Error("A Markdown render child needs an available element in this document and a distinct component lifecycle.");
      }
      const record = { loading: Promise.resolve(), attached: element.contains(child.containerEl) };
      ownedChildren.add(child);
      children.set(child, record);
      try { record.loading = Promise.resolve(child.load()); }
      catch (error) { record.loading = Promise.reject(error); }
      record.loading.catch(reportError);
      if (!observer) {
        observer = new MutationObserver(checkChildren);
        observer.observe(element, { childList: true, subtree: true });
        observer.observe(element.ownerDocument, { childList: true, subtree: true });
      }
      if (!processing) { queueMicrotask(checkChildren); }
    },
    getSectionInfo(target) {
      if (!sectionInfo || !active() || !element.contains(target)) { return null; }
      const block = target.closest<HTMLElement>("[data-source-line]");
      if (!block || !element.contains(block)) { return null; }
      const line = Number(block.dataset.sourceLine);
      const section = cache.sections.find(section => section.position.start.line === line);
      if (!section) { return null; }
      return { text, lineStart: section.position.start.line, lineEnd: section.position.end.line };
    },
  };
  const ready = Promise.resolve().then(async () => {
    try {
      for (const [processor] of [...processors].sort((left, right) => left[1] - right[1])) {
        if (!active()) { return; }
        if (processors.has(processor)) { await processor(element, context); }
      }
      await Promise.all([...children.values()].map(record => record.loading));
    } finally {
      processing = false;
      checkChildren();
      await Promise.all(releasing);
    }
  });
  return {
    ready,
    dispose() {
      if (disposal) { return disposal; }
      disposed = true;
      observer?.disconnect(); observer = null;
      for (const [child, record] of children) { release(child, record.loading).catch(reportError); }
      disposal = Promise.all(releasing).then(() => {});
      return disposal;
    },
  };
}
