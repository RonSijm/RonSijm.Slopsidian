import type { App } from "./app";
import { MAX_COMPLETION_SUBPATHS, MAX_COMPLETION_VALUE_CHARACTERS, MAX_COMPLETION_VALUE_LENGTH } from "./builtin-suggestion-model";
import { parseLinktext, resolveSubpath } from "./links";
import { parseMarkdown, type CachedMetadata, type LinkCache } from "./markdown";
import { assertPropertyValueChoice, propertySuggestionSource, propertyValueChoices, PropertyValueSuggestions, type PropertyValueChoice } from "./property-value-suggestions";
import { structuredPropertyModel, type StructuredPropertyPath } from "./structured-properties";
import type { TFile } from "./vault";

export interface StructuredPropertyLinkContext { readonly file: TFile; readonly property: string; readonly value: unknown; readonly path: StructuredPropertyPath; readonly sourceText: string }
export interface StructuredPropertyLink { readonly target: TFile; readonly targetPath: string; readonly targetText: string; readonly linktext: string; readonly label: string; readonly format: "wiki" | "markdown" }
const samePath = (left: StructuredPropertyPath, right: StructuredPropertyPath): boolean => left.length === right.length && left.every((part, index) => part === right[index]);

function currentLeaf(app: App, context: StructuredPropertyLinkContext) {
  if (propertySuggestionSource(app, context.file) !== context.sourceText) { return null; }
  return structuredPropertyModel(context.value, context.sourceText, context.property)?.leaves.find(leaf => samePath(leaf.path, context.path)) ?? null;
}

/** A deliberately small whole-scalar grammar. Mixed prose, embeds, titles,
 * references, escapes and ambiguous destinations remain literal YAML text. */
export function structuredPropertyLinkSyntax(value: string): { destination: string; label: string; format: "wiki" | "markdown" } | null {
  if (!value || value.length > MAX_COMPLETION_VALUE_LENGTH || /[\\\x00-\x1f\x7f\u0085\u2028\u2029]/.test(value) || /[\uD800-\uDFFF]/u.test(value)) { return null; }
  const wiki = /^\[\[([^\[\]|]+)(?:\|([^\[\]|]+))?\]\]$/.exec(value);
  if (wiki) {
    if (wiki[1] !== wiki[1].trim() || wiki[2] !== undefined && wiki[2] !== wiki[2].trim()) { return null; }
    return { destination: wiki[1], label: wiki[2] ?? wiki[1], format: "wiki" };
  }
  const markdown = /^\[([^\[\]\r\n]+)\]\(([^()<>\s]+)\)$/.exec(value);
  if (!markdown || !markdown[1].trim()) { return null; }
  // Require the real Markdown parser to agree with the bounded spelling.
  const parsed = parseMarkdown(value), link = parsed.links[0];
  if (parsed.errors.length || parsed.links.length !== 1 || parsed.embeds.length || !link || link.kind !== "markdown" || link.original !== value || link.link !== markdown[2]) { return null; }
  return { destination: markdown[2], label: markdown[1], format: "markdown" };
}

function boundedSubpaths(cache: CachedMetadata): boolean {
  if (cache.errors.length || cache.headings.length > MAX_COMPLETION_SUBPATHS || Object.keys(cache.blocks).length > MAX_COMPLETION_SUBPATHS) { return false; }
  let characters = 0;
  for (const heading of cache.headings) {
    if (heading.heading.length > MAX_COMPLETION_VALUE_LENGTH || (characters += heading.heading.length) > MAX_COMPLETION_VALUE_CHARACTERS) { return false; }
  }
  return true;
}

function resolveStoredLink(app: App, file: TFile, value: string, targets?: Map<TFile, { text: string; cache: CachedMetadata }>): StructuredPropertyLink | null {
  try {
    const syntax = structuredPropertyLinkSyntax(value);
    if (!syntax) { return null; }
    const reference = parseLinktext(syntax.destination, syntax.format === "markdown");
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference.path) || /[\[\]|\\\x00-\x1f\x7f]/.test(reference.path + reference.subpath)) { return null; }
    const location = { line: 0, ch: 0, offset: 0 }, link: LinkCache = { kind: syntax.format, link: syntax.destination, original: value, position: { start: location, end: location } };
    const resolved = app.metadataCache.resolveReference(link, file.path), target = resolved?.file;
    if (!target || resolved?.ambiguous || target.vault !== app.vault || target.extension.toLowerCase() !== "md" || app.vault.getFileByPath(target.path) !== target
      || target.path.length > MAX_COMPLETION_VALUE_LENGTH || /[\[\]#|\\\x00-\x1f\x7f]/.test(target.path)) { return null; }
    const targetText = propertySuggestionSource(app, target);
    if (targetText === null) { return null; }
    const prior = targets?.get(target), cache = prior?.text === targetText ? prior.cache : parseMarkdown(targetText);
    if (targets && prior?.text !== targetText) { targets.set(target, { text: targetText, cache }); }
    if (!boundedSubpaths(cache) || reference.subpath && !resolveSubpath(cache, reference.subpath)) { return null; }
    return { target, targetPath: target.path, targetText, linktext: target.path + reference.subpath, label: syntax.label, format: syntax.format };
  } catch { return null; }
}

/** Existing exact destinations only: this function never opens, reads disk or
 * creates a target, including in a genuine cached read-only vault. */
export function structuredPropertyLinkValue(app: App, context: StructuredPropertyLinkContext): StructuredPropertyLink | null {
  try { const leaf = currentLeaf(app, context); return typeof leaf?.value === "string" ? resolveStoredLink(app, context.file, leaf.value) : null; } catch { return null; }
}

/** A rendered inspector proves the shared YAML tree once. Exact current source
 * bytes keep that proof valid; repeated links share target parsing by exact text. */
export function createStructuredPropertyLinkReader(app: App, file: TFile, property: string, value: unknown, sourceText: string): (path: StructuredPropertyPath) => StructuredPropertyLink | null {
  const model = structuredPropertyModel(value, sourceText, property), leaves = new Map<string, string>(), targets = new Map<TFile, { text: string; cache: CachedMetadata }>();
  for (const leaf of model?.leaves ?? []) { if (typeof leaf.value === "string") { leaves.set(JSON.stringify(leaf.path), leaf.value); } }
  const root = app.vault.rootPath, adapter = app.vault.adapter;
  return path => {
    if (root !== app.vault.rootPath || adapter !== app.vault.adapter || propertySuggestionSource(app, file) !== sourceText) { return null; }
    const text = leaves.get(JSON.stringify(path));
    return text === undefined ? null : resolveStoredLink(app, file, text, targets);
  };
}

/** Reuse the ordinary Properties destination/alias/subpath completion pipeline;
 * a nested leaf adds its own exact source proof and offers no creation actions. */
export function structuredPropertyLinkChoices(app: App, context: StructuredPropertyLinkContext, query: string): PropertyValueChoice[] {
  try {
    if (typeof currentLeaf(app, context)?.value !== "string" || !query.startsWith("[[")) { return []; }
    return propertyValueChoices(app, context.file, context.property, "text", [], query).filter(choice => choice.kind === "link" || choice.kind === "subpath");
  } catch { return []; }
}

export interface StructuredPropertyLinkAuthoring { readonly element: HTMLElement; assert(content: string): void; dispose(): void }
export function createStructuredPropertyLinkAuthoring(document: Document, options: {
  app: App; context: StructuredPropertyLinkContext; input: HTMLTextAreaElement; current: () => boolean;
  value?: () => string;
  update: (value: string) => void; error: (message: string) => void;
}): StructuredPropertyLinkAuthoring {
  const { app, context } = options, element = document.createElement("div"), label = document.createElement("label"), query = document.createElement("input"), review = document.createElement("p");
  element.className = "metadata-structured-links"; element.dataset.propertyStructuredLinks = "";
  query.type = "text"; query.className = "metadata-input"; query.maxLength = 256; query.dataset.propertyStructuredLinkQuery = "";
  query.placeholder = "[[Note, [[Note#Heading or [[Note#^block"; query.setAttribute("aria-label", "Find an existing link for " + context.property + " " + JSON.stringify(context.path));
  label.textContent = "Find existing link "; label.append(query);
  review.className = "metadata-multiline-help"; review.dataset.propertyStructuredLinkReview = ""; review.setAttribute("aria-live", "polite");
  const help = "Choose a known note, heading or block to fill this Text draft. Review it, then Apply value. Existing targets only; use [[… syntax to search.";
  review.textContent = help; element.append(label, review);
  const root = app.vault.rootPath, adapter = app.vault.adapter, session = app.workspace.sessions.get(context.file.path), widget = app.metadataTypeManager.getAssignedWidget(context.property);
  const preferences = ["newLinkFormat", "useMarkdownLinks"].map(key => [key, app.vault.getConfig(key)] as const);
  let disposed = false, picked: { choice: PropertyValueChoice; query: string } | null = null;
  const owned = (): boolean => !disposed && options.current() && root === app.vault.rootPath && adapter === app.vault.adapter && !app.vault.readOnly
    && app.vault.getFileByPath(context.file.path) === context.file && app.workspace.sessions.get(context.file.path) === session
    && widget === app.metadataTypeManager.getAssignedWidget(context.property) && preferences.every(([key, value]) => Object.is(app.vault.getConfig(key), value));
  const assert = (content: string): void => {
    if (!owned() || content !== context.sourceText || !currentLeaf(app, context)) { throw new Error("The nested link source, owner or preferences changed. Cancel this draft and review the current source."); }
    if (picked) {
      if ((options.value?.() ?? options.input.value) !== picked.choice.value) { throw new Error("The selected nested link draft changed. Choose its destination again."); }
      assertPropertyValueChoice(app, picked.choice, "text", [], picked.query, content);
    }
  };
  const suggestions = new PropertyValueSuggestions({ input: query, container: element, current: owned,
    choices: text => owned() ? structuredPropertyLinkChoices(app, context, text) : [],
    accept: async (choice, text, current) => {
      if (choice.kind !== "link" && choice.kind !== "subpath" || !current()) { return false; }
      assert(context.sourceText); assertPropertyValueChoice(app, choice, "text", [], text);
      picked = { choice, query: text }; options.update(choice.value); options.error("");
      review.textContent = "Selected " + choice.targetPath + (choice.kind === "subpath" ? choice.subpath : "") + ". Draft: " + choice.value + ". Apply value changes this property; Cancel keeps the original source.";
      return true;
    }, error: options.error });
  const abort = new (document.defaultView?.AbortController ?? AbortController)();
  options.input.addEventListener("input", () => { if (!disposed) { picked = null; review.textContent = help; } }, { signal: abort.signal });
  return { element, assert, dispose() { disposed = true; abort.abort(); suggestions.dispose(); element.remove(); } };
}
