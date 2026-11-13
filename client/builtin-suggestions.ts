import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { App } from "./app";
import type { Editor, EditorPosition } from "./editor";
import { parseFrontMatterAliases, parseMarkdown, sourcePositions, type CachedMetadata } from "./markdown";
import { resolveSubpath } from "./links";
import { builtinCompletionTrigger, createNoteCompletion, globalHeadingCompletions, headingCompletionSubpath, linkCompletions, MAX_COMPLETION_CANDIDATES, MAX_COMPLETION_GLOBAL_DOCUMENTS, MAX_COMPLETION_KEYS, MAX_COMPLETION_RESULTS, MAX_COMPLETION_SOURCE, MAX_COMPLETION_VALUE_DOCUMENTS, MAX_COMPLETION_VALUES, planBuiltinCompletion, planCreateNoteCompletion, propertyCompletions, propertyValueCompletions, subpathCompletions, type BuiltinCompletion, type BuiltinCompletionTrigger, type CreateNoteCompletion, type GlobalHeadingSource } from "./builtin-suggestion-model";
import { EditorSuggest, type EditorSuggestContext, type EditorSuggestTriggerInfo } from "./suggestions";
import { Notice } from "./ui";
import type { TFile } from "./vault";
import { unresolvedHeadingCompletion, planUnresolvedHeadingCompletion, type UnresolvedHeadingCompletion } from "./unresolved-heading-completion";
import { blockAuthoringCompletions, newBlockId, planBlockId, type BlockAuthoringChoice } from "./block-authoring";
import { headingAuthoringCompletion, planHeadingCreation, type HeadingAuthoringChoice } from "./heading-authoring";

type Completion = (BuiltinCompletion | CreateNoteCompletion | UnresolvedHeadingCompletion | BlockAuthoringChoice | HeadingAuthoringChoice) & { target?: TFile; targetText?: string; targetLinktext?: string };

/** Built-in source completions are fallbacks: installed plugins retain first refusal. */
export class BuiltinEditorSuggestions extends EditorSuggest<Completion> {
  override limit = MAX_COMPLETION_RESULTS;
  private pendingCreate: object | null = null;

  constructor(app: App) {
    super(app);
    this.containerEl.dataset.builtinSuggest = "source";
    this.setInstructions([{ command: "Enter / Tab", purpose: "Insert suggestion" }, { command: "Esc", purpose: "Dismiss" }]);
  }

  private writable(editor: Editor, file: TFile | null): boolean {
    return Boolean(file && file.vault === this.app.vault && this.app.vault.getFileByPath(file.path) === file
      && !this.app.vault.readOnly && !this.app.changingVault && !this.app.workspace.isChangingFiles
      && !editor.cm.composing
      && !editor.cm.state.readOnly && editor.cm.state.facet(EditorState.readOnly) !== true
      && editor.cm.state.facet(EditorView.editable) && editor.cm.state.doc.length <= MAX_COMPLETION_SOURCE);
  }

  override onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
    if (this.pendingCreate || !this.writable(editor, file)) { return null; }
    const text = editor.getValue(), offset = sourcePositions(text)(0, text.length);
    // The public cursor uses raw line/ch positions; line endings retain their original widths.
    if (cursor.line < 0 || cursor.line > offset.end.line || cursor.ch < 0 || cursor.ch > editor.getLine(cursor.line).length) { return null; }
    const trigger = this.sourceTrigger(editor, text, this.rawCursor(text, cursor));
    if (!trigger) { return null; }
    const position = sourcePositions(text)(trigger.from, trigger.to);
    return { start: position.start, end: position.end, query: trigger.query };
  }

  private rawCursor(text: string, cursor: EditorPosition): number {
    let line = 0, offset = 0;
    while (line < cursor.line) { const next = text.indexOf("\n", offset); if (next < 0) { return -1; } offset = next + 1; line++; }
    return offset + cursor.ch;
  }

  private currentTrigger(context: EditorSuggestContext): BuiltinCompletionTrigger | null {
    const text = context.editor.getValue();
    return this.sourceTrigger(context.editor, text, this.rawCursor(text, context.editor.getCursor()));
  }

  private sourceTrigger(editor: Editor, text: string, cursor: number): BuiltinCompletionTrigger | null {
    const trigger = builtinCompletionTrigger(text, cursor);
    // Properties owns frontmatter in ordinary Live Preview. Its hidden source is
    // not an input surface; use Source mode (or disable Properties) for raw YAML.
    if ((trigger?.kind === "property" || trigger?.kind === "property-value") && editor.editorComponent?.getEditingMode() === "live-preview" && this.app.core.isEnabled("properties")) { return null; }
    return trigger;
  }

  private subpathSource(context: EditorSuggestContext, trigger: BuiltinCompletionTrigger): { target: TFile; text: string; cache: CachedMetadata } | null {
    const text = context.editor.getValue();
    const destination = this.app.metadataCache.resolveReference({ link: trigger.linkpath ?? "", original: "", kind: "wiki", position: sourcePositions(text)(trigger.from, trigger.to) }, context.file.path);
    const target = destination?.file;
    if (!target || destination?.ambiguous || !/\.md$/i.test(target.path) || target.vault !== this.app.vault || this.app.vault.getFileByPath(target.path) !== target) { return null; }
    const entry = this.app.metadataCache.getDocument(target.path), session = this.app.workspace.sessions?.get(target.path);
    if (entry?.missing || session && (session.originRoot !== this.app.vault.rootPath || session.isReloading)) { return null; }
    // Open editors can be ahead of the metadata notification timer. Derive this
    // bounded snapshot from their real current source rather than suggesting a
    // removed heading while an index update is queued.
    const source = target === context.file ? text : session?.text ?? entry?.text;
    if (source === undefined || source.length > MAX_COMPLETION_SOURCE) { return null; }
    return { target, text: source, cache: entry?.text === source ? entry.cache : parseMarkdown(source) };
  }

  override getSuggestions(context: EditorSuggestContext): Completion[] {
    if (this.pendingCreate || !this.writable(context.editor, context.file)) { return []; }
    const trigger = this.currentTrigger(context);
    if (!trigger) { return []; }
    if (trigger.kind === "property") {
      const keys = new Set(["aliases", "cssclasses", "tags"]);
      for (const entry of this.app.metadataCache.getDocuments().slice(0, 2_000)) {
        const properties = entry.cache.frontmatter ?? {};
        for (const key in properties) {
          if (Object.hasOwn(properties, key)) { keys.add(key); }
          if (keys.size >= MAX_COMPLETION_KEYS) { break; }
        }
        if (keys.size >= MAX_COMPLETION_KEYS) { break; }
      }
      return propertyCompletions(trigger.query, keys, trigger.existingKeys ?? []);
    }
    if (trigger.kind === "property-value") {
      const sources = new Map<string, { target: TFile; targetText: string }>(), values: unknown[] = [];
      // Cached scalar values avoid reparsing every document on each key press.
      // Only dirty open sessions need parsing; keep that work bounded as well.
      let parsedCharacters = 0;
      for (const entry of this.app.metadataCache.getDocuments().slice(0, MAX_COMPLETION_VALUE_DOCUMENTS)) {
        const path = entry.document.file.path, target = this.app.vault.getFileByPath(path);
        if (!target || target === context.file || !/\.md$/i.test(path) || entry.missing || target.vault !== this.app.vault) { continue; }
        const session = this.app.workspace.sessions?.get(path);
        if (session && (session.originRoot !== this.app.vault.rootPath || session.isReloading)) { continue; }
        const text = session?.text ?? entry.text;
        if (text.length > MAX_COMPLETION_SOURCE) { continue; }
        let cache = entry.cache;
        if (text !== entry.text) {
          if (parsedCharacters + text.length > MAX_COMPLETION_SOURCE) { continue; }
          parsedCharacters += text.length; cache = parseMarkdown(text);
        }
        const frontmatter = cache.frontmatter;
        if (!frontmatter || !Object.hasOwn(frontmatter, trigger.property!)) { continue; }
        const property = frontmatter[trigger.property!], items: unknown[] = Array.isArray(property) ? property : [property];
        for (const value of items) {
          if (values.length >= MAX_COMPLETION_VALUES) { break; }
          values.push(value);
          if (typeof value === "string" && !sources.has(value)) { sources.set(value, { target, targetText: text }); }
        }
        if (values.length >= MAX_COMPLETION_VALUES) { break; }
      }
      return propertyValueCompletions(trigger, values).map(value => ({ ...value, ...sources.get(value.value)! }));
    }
    if (trigger.kind === "heading" || trigger.kind === "block") {
      const source = this.subpathSource(context, trigger);
      if (!source) { return []; }
      const existing = subpathCompletions(trigger, source.target.path, source.text, source.cache);
      const choices: Completion[] = trigger.kind === "block"
        ? blockAuthoringCompletions(trigger.query, source.target.path, source.text, source.target === context.file ? { exclude: trigger } : {})
        : existing.length ? [] : [unresolvedHeadingCompletion(context.editor.getValue(), this.rawCursor(context.editor.getValue(), context.editor.getCursor()), trigger, source.target.path, source.text, source.cache)].filter((value): value is UnresolvedHeadingCompletion => value !== null);
      const heading = trigger.kind === "heading" && this.createHeadingChoice(context, trigger, source);
      if (heading) { choices.push(heading); }
      return [...existing, ...choices].slice(0, MAX_COMPLETION_RESULTS).map(value => ({ ...value, target: source.target, targetText: source.text }));
    }
    if (trigger.kind === "global-heading") {
      const sources: GlobalHeadingSource[] = [], targets = new Map<string, { target: TFile; targetText: string }>();
      let parsedCharacters = 0;
      for (const entry of this.app.metadataCache.getDocuments().slice(0, MAX_COMPLETION_GLOBAL_DOCUMENTS)) {
        const path = entry.document.file.path, target = this.app.vault.getFileByPath(path);
        if (!target || !/\.md$/i.test(path) || entry.missing || target.vault !== this.app.vault) { continue; }
        const session = this.app.workspace.sessions?.get(path);
        if (session && (session.originRoot !== this.app.vault.rootPath || session.isReloading)) { continue; }
        const text = target === context.file ? context.editor.getValue() : session?.text ?? entry.text;
        if (text.length > MAX_COMPLETION_SOURCE) { continue; }
        let cache = entry.cache;
        if (text !== entry.text) {
          if (parsedCharacters + text.length > MAX_COMPLETION_SOURCE) { continue; }
          parsedCharacters += text.length; cache = parseMarkdown(text);
        }
        sources.push({ path, text, cache }); targets.set(path, { target, targetText: text });
      }
      // Resolve only the bounded best set: link-text preferences may otherwise
      // scan the vault once for every indexed note on every key press.
      const position = sourcePositions(context.editor.getValue())(trigger.from, trigger.to);
      return globalHeadingCompletions(trigger, sources).flatMap(value => {
        const source = targets.get(value.path)!;
        try {
          const link = this.app.metadataCache.fileToLinktext(source.target, context.file.path);
          const destination = this.app.metadataCache.resolveReference({ link, original: "", kind: "wiki", position }, context.file.path);
          return destination?.file === source.target && !destination.ambiguous ? [{ ...value, ...source, targetLinktext: link }] : [];
        } catch {
          // A known file can still have no unambiguous supported link spelling.
          return [];
        }
      });
    }
    const files = this.app.vault.getMarkdownFiles().slice(0, MAX_COMPLETION_CANDIDATES), identities = new Map(files.map(file => [file.path, file]));
    const values: Completion[] = linkCompletions(trigger.query, files.map(file => ({ path: file.path, aliases: parseFrontMatterAliases(this.app.metadataCache.getFileCache(file)?.frontmatter) ?? [] })))
      .map(value => ({ ...value, target: identities.get(value.path)! }));
    const create = this.createNoteChoice(context, trigger);
    return create ? [...values.slice(0, MAX_COMPLETION_RESULTS - 1), create] : values;
  }

  private createHeadingChoice(context: EditorSuggestContext, trigger: BuiltinCompletionTrigger, source: { target: TFile; text: string }): HeadingAuthoringChoice | null {
    const text = context.editor.getValue(), root = this.app.vault.rootPath;
    const owner = this.app.workspace.sessions?.get(context.file.path), target = this.app.workspace.sessions?.get(source.target.path);
    if (context.editor.cm.state.selection.ranges.length !== 1 || !context.editor.cm.state.selection.main.empty || context.editor.cm.dom?.isConnected === false) { return null; }
    if (owner && (owner.originRoot !== root || owner.isReloading || owner.text !== text)) { return null; }
    if (source.target !== context.file) {
      const indexed = this.app.metadataCache.getDocument(source.target.path);
      if (!indexed || indexed.missing || indexed.text !== source.text || target && (target.dirty || target.originRoot !== root || target.isReloading || target.text !== source.text)) { return null; }
    }
    return headingAuthoringCompletion(text, this.rawCursor(text, context.editor.getCursor()), trigger, source.target.path, source.text);
  }

  private createNoteChoice(context: EditorSuggestContext, trigger: BuiltinCompletionTrigger): CreateNoteCompletion | null {
    try {
      const text = context.editor.getValue(), cursor = this.rawCursor(text, context.editor.getCursor());
      const path = this.app.fileManager.getNewNotePath(trigger.query, context.file.path, true);
      const choice = createNoteCompletion(text, cursor, trigger, path, context.file.path);
      if (!choice || this.app.vault.getAbstractFileByPathInsensitive(path)) { return null; }
      const session = this.app.workspace.sessions?.get(context.file.path);
      if (session && (session.originRoot !== this.app.vault.rootPath || session.isReloading || session.text !== text)) { return null; }
      const reference = { link: choice.name, original: "", kind: "wiki" as const, position: sourcePositions(text)(trigger.from, trigger.to) };
      if (this.app.metadataCache.resolveReference(reference, context.file.path)) { return null; }
      const files = this.app.vault.getMarkdownFiles();
      // Do not claim a missing target from an incomplete alias inventory.
      if (files.length > MAX_COMPLETION_CANDIDATES) { return null; }
      const names = new Set([choice.name.toLowerCase(), choice.name.replace(/\.md$/i, "").toLowerCase()]);
      let parsedCharacters = 0, aliases = 0, aliasCharacters = 0;
      for (const file of files) {
        const opened = this.app.workspace.sessions?.get(file.path);
        if (opened && (opened.originRoot !== this.app.vault.rootPath || opened.isReloading)) { return null; }
        const cached = this.app.metadataCache.getFileCache(file), indexed = this.app.metadataCache.getDocument(file.path);
        if (!opened && (!cached || !indexed || indexed.missing)) { return null; }
        let frontmatter = cached?.frontmatter;
        if (opened && (!cached || indexed?.missing || opened.text !== indexed?.text)) {
          if (opened.text.length > MAX_COMPLETION_SOURCE || (parsedCharacters += opened.text.length) > MAX_COMPLETION_SOURCE) { return null; }
          frontmatter = parseMarkdown(opened.text).frontmatter;
        }
        for (const alias of parseFrontMatterAliases(frontmatter) ?? []) {
          if (++aliases > MAX_COMPLETION_CANDIDATES || (aliasCharacters += alias.length) > MAX_COMPLETION_SOURCE) { return null; }
          if (names.has(alias.toLowerCase())) { return null; }
        }
      }
      return choice;
    } catch { return null; }
  }

  override renderSuggestion(value: Completion, element: HTMLElement): void {
    if (value.kind === "unresolved-heading" || value.kind === "create-block" || value.kind === "create-heading") {
      const title = document.createElement("div"); title.className = "suggestion-title";
      const path = document.createElement("small"); path.className = "suggestion-note";
      if (value.kind === "unresolved-heading") {
        element.dataset.builtinUnresolvedHeading = value.path; element.dataset.builtinUnresolvedSubpath = value.subpath;
        title.textContent = "Link to missing heading: " + value.subpath; path.textContent = value.path + "#" + value.subpath;
      } else if (value.kind === "create-heading") {
        element.dataset.builtinCreateHeading = value.path; element.dataset.builtinHeadingSubpath = value.subpath;
        element.dataset.builtinHeadingLevel = String(value.level);
        if (value.newHeadings) {
          element.dataset.builtinHeadingCount = String(value.newHeadings.length);
          title.textContent = "Create heading chain: " + value.newHeadings.map(heading => heading.heading).join(" → ");
          path.textContent = value.path + "#" + value.subpath;
          const preview = document.createElement("small"); preview.className = "suggestion-note";
          preview.dataset.builtinHeadingPreview = ""; preview.style.whiteSpace = "pre-line"; preview.textContent = value.preview;
          title.title = title.textContent; path.title = path.textContent; element.append(title, path, preview); return;
        }
        title.textContent = "Create heading: " + value.heading; path.textContent = value.path + "#" + value.subpath + " · " + value.preview;
      } else {
        element.dataset.builtinCreateBlock = value.path; element.dataset.builtinBlockStart = String(value.from);
        title.textContent = "Create block reference: " + value.preview; path.textContent = value.path;
      }
      title.title = title.textContent; path.title = path.textContent; element.append(title, path); return;
    }
    if (value.kind === "create-note") {
      element.dataset.builtinCreateNote = value.path;
      const title = document.createElement("div"); title.className = "suggestion-title"; title.textContent = "Create note: " + value.name;
      const path = document.createElement("small"); path.className = "suggestion-note"; path.textContent = value.path;
      element.append(title, path); return;
    }
    const title = document.createElement("div");
    title.className = "suggestion-title";
    title.textContent = value.kind === "property" ? value.name : value.kind === "property-value" ? value.value : value.kind === "heading" || value.kind === "global-heading" ? value.heading : value.kind === "block" ? value.preview || "^" + value.id : value.alias ?? value.path.slice(0, -3).split("/").at(-1)!;
    element.appendChild(title);
    if (value.kind === "property-value") {
      element.dataset.builtinPropertyValue = value.value; element.dataset.builtinPropertyKey = value.property;
      const key = document.createElement("small"); key.className = "suggestion-note"; key.textContent = value.property; element.appendChild(key);
    } else if (value.kind !== "property") {
      element.dataset.builtinLink = value.path;
      if (value.kind === "link" && value.alias) { element.dataset.builtinAlias = value.alias; }
      if (value.kind === "heading" || value.kind === "global-heading") { element.dataset.builtinHeading = value.heading; }
      if (value.kind === "heading" && value.parents?.length) { element.dataset.builtinHeadingPath = headingCompletionSubpath(value); }
      if (value.kind === "global-heading") { element.dataset.builtinGlobalHeading = "true"; }
      if (value.kind === "block") { element.dataset.builtinBlock = value.id; }
      const path = document.createElement("small"); path.className = "suggestion-note"; path.textContent = value.path + (value.kind === "heading" || value.kind === "global-heading" ? "#" + headingCompletionSubpath(value) : value.kind === "block" ? "#^" + value.id : ""); element.appendChild(path);
    } else { element.dataset.builtinProperty = value.name; }
  }

  protected override isCurrent(): boolean {
    return super.isCurrent() && Boolean(this.context && this.writable(this.context.editor, this.context.file));
  }

  override selectSuggestion(value: Completion): void | Promise<void> {
    const context = this.context;
    if (this.pendingCreate || !this.isCurrent() || !context) { return; }
    const trigger = this.currentTrigger(context);
    if (!trigger) { return; }
    if (value.kind === "create-note") { return this.createNote(context, trigger, value); }
    if (value.kind === "create-block") { return this.createBlock(context, trigger, value); }
    if (value.kind === "create-heading") { return this.createHeading(context, trigger, value); }
    if (value.kind === "unresolved-heading") {
      const source = this.subpathSource(context, trigger), text = context.editor.getValue(), cursor = this.rawCursor(text, context.editor.getCursor());
      const current = source && unresolvedHeadingCompletion(text, cursor, trigger, source.target.path, source.text, source.cache);
      if (!source || !current || source.target !== value.target || source.text !== value.targetText || current.subpath !== value.subpath || current.path !== value.path) { this.close(); return; }
      const link = trigger.linkpath === "" ? "" : this.app.metadataCache.fileToLinktext(source.target, context.file.path);
      const destination = this.app.metadataCache.resolveReference({ link, original: "", kind: "wiki", position: sourcePositions(text)(trigger.from, trigger.to) }, context.file.path);
      if (destination?.file !== source.target || destination.ambiguous) { this.close(); return; }
      const plan = planUnresolvedHeadingCompletion(text, cursor, trigger, current, link);
      context.editor.replaceExpected(text, plan.from, plan.to, plan.insert, "input.complete");
      if (context.editor.getValue() === plan.text) { context.editor.setCursor(sourcePositions(plan.text)(plan.cursor, plan.cursor).start); }
      return;
    }
    const text = context.editor.getValue(), cursor = this.rawCursor(text, context.editor.getCursor());
    let linktext: string | undefined;
    if (value.kind === "link") {
      if (!value.target || value.target.path !== value.path || this.app.vault.getFileByPath(value.path) !== value.target) { this.close(); return; }
      if (value.alias && !parseFrontMatterAliases(this.app.metadataCache.getFileCache(value.target)?.frontmatter)?.includes(value.alias)) { this.close(); return; }
      // Another action may keep the popup current after this query stops
      // matching a formerly offered note or alias. Revalidate that exact row.
      if (!this.getSuggestions(context).some(current => current.kind === "link" && current.path === value.path
        && current.alias === value.alias && current.target === value.target)) { this.close(); return; }
      linktext = this.app.metadataCache.fileToLinktext(value.target, context.file.path);
    } else if (value.kind === "heading" || value.kind === "block") {
      let subpath: string;
      try { subpath = value.kind === "heading" ? "#" + headingCompletionSubpath(value) : "#^" + value.id; }
      catch { this.close(); return; }
      const source = this.subpathSource(context, trigger);
      const destination = source && resolveSubpath(source.cache, subpath);
      if (!source || source.target !== value.target || source.target.path !== value.path || source.text !== value.targetText
        || destination?.type !== value.kind || destination.start.offset !== value.from || destination.end.offset !== value.to
        || !subpathCompletions(trigger, value.path, source.text, source.cache).some(current => current.kind === value.kind && current.from === value.from && current.to === value.to
          && (current.kind === "heading" && value.kind === "heading" ? current.heading === value.heading && JSON.stringify(current.parents ?? []) === JSON.stringify(value.parents ?? []) : current.kind === "block" && value.kind === "block" && current.id === value.id))) { this.close(); return; }
      linktext = trigger.linkpath === "" ? "" : this.app.metadataCache.fileToLinktext(source.target, context.file.path);
    } else if (value.kind === "global-heading") {
      const current = value.target && this.getSuggestions(context).find(current => current.kind === "global-heading" && current.path === value.path
        && current.heading === value.heading && current.from === value.from && current.to === value.to
        && current.target === value.target && current.targetText === value.targetText);
      if (!current || current.targetLinktext === undefined) { this.close(); return; }
      const cache = this.app.metadataCache.getDocument(value.path);
      const session = this.app.workspace.sessions?.get(value.path);
      const text = value.target === context.file ? context.editor.getValue() : session?.text ?? cache?.text;
      if (text === undefined || text !== value.targetText) { this.close(); return; }
      const destination = resolveSubpath(cache?.text === text ? cache.cache : parseMarkdown(text), "#" + value.heading);
      if (destination?.type !== "heading" || destination.start.offset !== value.from || destination.end.offset !== value.to) { this.close(); return; }
      linktext = current.targetLinktext;
    } else if (value.kind === "property-value") {
      if (!value.target || !this.getSuggestions(context).some(current => current.kind === "property-value" && current.property === value.property && current.value === value.value
        && current.target === value.target && current.targetText === value.targetText)) { this.close(); return; }
    } else if (!this.getSuggestions(context).some(current => current.kind === "property" && current.name === value.name)) { this.close(); return; }
    const plan = planBuiltinCompletion(text, cursor, trigger, value, linktext);
    context.editor.replaceExpected(text, plan.from, plan.to, plan.insert, "input.complete");
    if (context.editor.getValue() === plan.text) { context.editor.setCursor(sourcePositions(plan.text)(plan.cursor, plan.cursor).start); }
  }

  private createdWithoutLink(path: string): void {
    new Notice('Created "' + path + '". The source or link destination changed, so no link was inserted. The new note was kept.', 10_000);
  }

  private blockWithoutLink(path: string): void {
    new Notice('A block ID was written in "' + path + '". The source or target changed or could not be updated, so no source link was inserted. Check the target note; its current contents were retained.', 10_000);
  }

  private headingWithoutLink(path: string, count = 1): void {
    new Notice((count === 1 ? "A heading was written" : count + " headings were written") + ' in "' + path + '". The source or target changed or could not be updated, so no source link was inserted. Check the target note; its current contents were retained.', 10_000);
  }

  private async createHeading(context: EditorSuggestContext, trigger: BuiltinCompletionTrigger, value: HeadingAuthoringChoice & { target?: TFile; targetText?: string }): Promise<void> {
    const target = this.subpathSource(context, trigger), { editor, file } = context;
    const currentChoice = target && this.createHeadingChoice(context, trigger, target);
    if (trigger.kind !== "heading" || !target || target.target !== value.target || target.text !== value.targetText || !currentChoice
      || currentChoice.path !== value.path || currentChoice.subpath !== value.subpath || currentChoice.from !== value.from || currentChoice.level !== value.level
      || currentChoice.preview !== value.preview || currentChoice.heading !== value.heading
      || JSON.stringify(currentChoice.parents ?? []) !== JSON.stringify(value.parents ?? [])
      || JSON.stringify(currentChoice.newHeadings) !== JSON.stringify(value.newHeadings)) { this.close(); return; }
    const heading = planHeadingCreation(target.text, value), text = editor.getValue(), cursor = this.rawCursor(text, editor.getCursor());
    const linktext = trigger.linkpath === "" ? "" : this.app.metadataCache.fileToLinktext(target.target, file.path);
    const destination = this.app.metadataCache.resolveReference({ link: linktext, original: "", kind: "wiki", position: sourcePositions(text)(trigger.from, trigger.to) }, file.path);
    if (destination?.file !== target.target || destination.ambiguous) { this.close(); return; }
    const missing: UnresolvedHeadingCompletion = { kind: "unresolved-heading", path: value.path, subpath: value.subpath, heading: value.heading, ...(value.parents ? { parents: value.parents } : {}) };
    const link = planUnresolvedHeadingCompletion(text, cursor, trigger, missing, linktext);
    if (target.target === file) {
      if (heading.from > link.from && heading.from < link.to) { this.close(); return; }
      const changes = [{ from: link.from, to: link.to, insert: link.insert }, { from: heading.from, to: heading.to, insert: heading.insert }].sort((a, b) => a.from - b.from);
      let updated = text;
      for (const change of [...changes].reverse()) { updated = updated.slice(0, change.from) + change.insert + updated.slice(change.to); }
      const shift = link.to <= heading.from ? link.insert.length - (link.to - link.from) : 0, cache = parseMarkdown(updated);
      if (heading.createdHeadings.some(value => resolveSubpath(cache, "#" + value.subpath)?.start.offset !== value.from + shift)) { this.close(); return; }
      editor.replaceExpectedChanges(text, changes, "input.complete");
      if (editor.getValue() === updated) {
        const offset = link.cursor + (heading.from <= link.from ? heading.insert.length : 0);
        editor.setCursor(sourcePositions(updated)(offset, offset).start);
      }
      return;
    }
    const owner = this.app.workspace.activeEditor, component = editor.editorComponent, root = this.app.vault.rootPath;
    const document = editor.cm.state.doc, selection = editor.cm.state.selection.main.head, sourcePath = file.path;
    const session = this.app.workspace.sessions.get(sourcePath), targetSession = this.app.workspace.sessions.get(value.path);
    const mode = component?.getMode(), editingMode = component?.getEditingMode();
    const preferences = ["newLinkFormat", "useMarkdownLinks"].map(key => [key, this.app.vault.getConfig(key)] as const);
    const token = {}; this.pendingCreate = token;
    const current = (): boolean => this.pendingCreate === token && root === this.app.vault.rootPath && !this.app.changingVault && !this.app.vault.readOnly
      && this.app.workspace.activeEditor === owner && owner?.editor === editor && owner.file === file && file.path === sourcePath
      && this.app.vault.getFileByPath(sourcePath) === file && this.app.vault.getFileByPath(value.path) === target.target
      && editor.cm.dom.isConnected && !editor.cm.composing && editor.cm.state.doc === document && editor.getValue() === text
      && editor.cm.state.selection.ranges.length === 1 && editor.cm.state.selection.main.empty && editor.cm.state.selection.main.head === selection
      && editor.editorComponent === component && component?.getMode() === mode && component?.getEditingMode() === editingMode
      && this.app.workspace.sessions.get(sourcePath) === session && (!session || session.originRoot === root && !session.isReloading && session.text === text)
      && this.app.workspace.sessions.get(value.path) === targetSession && (!targetSession || targetSession.originRoot === root && !targetSession.isReloading && !targetSession.dirty)
      && preferences.every(([key, expected]) => this.app.vault.getConfig(key) === expected);
    const kept = (): void => { this.headingWithoutLink(value.path, heading.createdHeadings.length); };
    this.close(); let acknowledged = false;
    try {
      const written = await this.app.fileManager.assignMarkdownSubpath(target.target, target.text, content => planHeadingCreation(content, value).text,
        { guard: current, written: () => { acknowledged = true; } });
      const freshTarget = this.subpathSource(context, trigger), indexedTarget = this.app.metadataCache.getDocument(value.path);
      const freshCache = freshTarget && parseMarkdown(freshTarget.text);
      if (!current() || !this.writable(editor, file) || written.content !== heading.text
        || freshTarget?.target !== target.target || freshTarget.text !== heading.text || !indexedTarget || indexedTarget.missing || indexedTarget.text !== heading.text
        || !freshCache || heading.createdHeadings.some(value => resolveSubpath(freshCache, "#" + value.subpath)?.start.offset !== value.from)) { kept(); return; }
      const freshLink = this.app.metadataCache.fileToLinktext(target.target, file.path);
      const resolved = this.app.metadataCache.resolveReference({ link: freshLink, original: "", kind: "wiki", position: sourcePositions(text)(trigger.from, trigger.to) }, file.path);
      if (freshLink !== linktext || resolved?.file !== target.target || resolved.ambiguous) { kept(); return; }
      editor.replaceExpected(text, link.from, link.to, link.insert, "input.complete");
      if (editor.getValue() === link.text) { editor.setCursor(sourcePositions(link.text)(link.cursor, link.cursor).start); }
      else { kept(); }
    } catch (error) { if (acknowledged) { kept(); } throw error; }
    finally { if (this.pendingCreate === token) { this.pendingCreate = null; } }
  }

  private async createBlock(context: EditorSuggestContext, trigger: BuiltinCompletionTrigger, value: BlockAuthoringChoice & { target?: TFile; targetText?: string }): Promise<void> {
    const target = this.subpathSource(context, trigger), { editor, file } = context;
    if (trigger.kind !== "block" || !target || target.target !== value.target || target.text !== value.targetText
      || !blockAuthoringCompletions(trigger.query, target.target.path, target.text, target.target === file ? { exclude: trigger } : {})
        .some(choice => choice.from === value.from && choice.to === value.to && choice.body === value.body)) { this.close(); return; }
    const id = newBlockId(target.text);
    if (!id) { this.close(); return; }
    const marker = planBlockId(target.text, value, id), text = editor.getValue(), cursor = this.rawCursor(text, editor.getCursor());
    const linktext = trigger.linkpath === "" ? "" : this.app.metadataCache.fileToLinktext(target.target, file.path);
    const destination = this.app.metadataCache.resolveReference({ link: linktext, original: "", kind: "wiki", position: sourcePositions(text)(trigger.from, trigger.to) }, file.path);
    if (destination?.file !== target.target || destination.ambiguous) { this.close(); return; }
    const link = planBuiltinCompletion(text, cursor, trigger, { kind: "block", path: value.path, id, preview: value.preview, from: value.from, to: value.to }, linktext);
    if (target.target === file) {
      const changes = [{ from: link.from, to: link.to, insert: link.insert }, { from: marker.from, to: marker.to, insert: marker.insert }].sort((a, b) => a.from - b.from);
      let updated = text;
      for (const change of [...changes].reverse()) { updated = updated.slice(0, change.from) + change.insert + updated.slice(change.to); }
      editor.replaceExpectedChanges(text, changes, "input.complete");
      if (editor.getValue() === updated) {
        const offset = link.cursor + (marker.from <= link.from ? marker.insert.length : 0);
        editor.setCursor(sourcePositions(updated)(offset, offset).start);
      }
      return;
    }
    const owner = this.app.workspace.activeEditor, component = editor.editorComponent, root = this.app.vault.rootPath;
    const document = editor.cm.state.doc, selection = editor.cm.state.selection.main.head, sourcePath = file.path;
    const session = this.app.workspace.sessions.get(sourcePath), targetSession = this.app.workspace.sessions.get(value.path);
    const mode = component?.getMode(), editingMode = component?.getEditingMode();
    const preferences = ["newLinkFormat", "useMarkdownLinks"].map(key => [key, this.app.vault.getConfig(key)] as const);
    const token = {}; this.pendingCreate = token;
    const current = (): boolean => this.pendingCreate === token && root === this.app.vault.rootPath && !this.app.changingVault && !this.app.vault.readOnly
      && this.app.workspace.activeEditor === owner && owner?.editor === editor && owner.file === file && file.path === sourcePath
      && this.app.vault.getFileByPath(sourcePath) === file && this.app.vault.getFileByPath(value.path) === target.target
      && editor.cm.dom.isConnected && !editor.cm.composing && editor.cm.state.doc === document && editor.getValue() === text
      && editor.cm.state.selection.ranges.length === 1 && editor.cm.state.selection.main.empty && editor.cm.state.selection.main.head === selection
      && editor.editorComponent === component && component?.getMode() === mode && component?.getEditingMode() === editingMode
      && this.app.workspace.sessions.get(sourcePath) === session && (!session || session.originRoot === root && !session.isReloading && session.text === text)
      && this.app.workspace.sessions.get(value.path) === targetSession && (!targetSession || targetSession.originRoot === root && !targetSession.isReloading)
      && preferences.every(([key, expected]) => this.app.vault.getConfig(key) === expected);
    const kept = (): void => { this.blockWithoutLink(value.path); };
    this.close(); let acknowledged = false;
    try {
      const written = await this.app.fileManager.assignBlockId(target.target, target.text, content => planBlockId(content, value, id).text,
        { guard: current, written: () => { acknowledged = true; } });
      const freshTarget = this.subpathSource(context, trigger), indexedTarget = this.app.metadataCache.getDocument(value.path);
      if (!current() || !this.writable(editor, file) || written.content !== marker.text
        || freshTarget?.target !== target.target || freshTarget.text !== marker.text || !indexedTarget || indexedTarget.missing || indexedTarget.text !== marker.text
        || resolveSubpath(parseMarkdown(freshTarget.text), "#^" + id)?.start.offset !== value.from) { kept(); return; }
      const freshLink = this.app.metadataCache.fileToLinktext(target.target, file.path);
      const resolved = this.app.metadataCache.resolveReference({ link: freshLink, original: "", kind: "wiki", position: sourcePositions(text)(trigger.from, trigger.to) }, file.path);
      if (freshLink !== linktext || resolved?.file !== target.target || resolved.ambiguous) { kept(); return; }
      editor.replaceExpected(text, link.from, link.to, link.insert, "input.complete");
      if (editor.getValue() === link.text) { editor.setCursor(sourcePositions(link.text)(link.cursor, link.cursor).start); }
      else { kept(); }
    } catch (error) { if (acknowledged) { kept(); } throw error; }
    finally { if (this.pendingCreate === token) { this.pendingCreate = null; } }
  }

  private async createNote(context: EditorSuggestContext, trigger: BuiltinCompletionTrigger, value: CreateNoteCompletion): Promise<void> {
    const choice = this.createNoteChoice(context, trigger);
    if (!choice || choice.name !== value.name || choice.path !== value.path) { this.close(); return; }
    const { editor, file } = context, owner = this.app.workspace.activeEditor, component = editor.editorComponent;
    const root = this.app.vault.rootPath, sourcePath = file.path, text = editor.getValue(), document = editor.cm.state.doc;
    const cursor = editor.cm.state.selection.main.head, session = this.app.workspace.sessions?.get(sourcePath);
    const mode = component?.getMode(), editingMode = component?.getEditingMode();
    const preferences = ["newFileLocation", "newFileFolderPath", "newLinkFormat", "useMarkdownLinks"].map(key => [key, this.app.vault.getConfig(key)] as const);
    const token = {}; this.pendingCreate = token;
    // FileManager temporarily locks editing, makes its shell inert and may drop
    // focus. During that owned write, compare the source identity and state
    // without mistaking its temporary facets for a newly read-only editor.
    const sourceCurrent = (): boolean => this.pendingCreate === token && root === this.app.vault.rootPath && !this.app.changingVault && !this.app.vault.readOnly
      && this.app.workspace.activeEditor === owner && owner?.editor === editor && owner.file === file && file.path === sourcePath
      && file.vault === this.app.vault && this.app.vault.getFileByPath(sourcePath) === file && editor.cm.dom.isConnected && !editor.cm.composing
      && editor.cm.state.doc === document && editor.getValue() === text && editor.cm.state.selection.ranges.length === 1
      && editor.cm.state.selection.main.empty && editor.cm.state.selection.main.head === cursor
      && editor.editorComponent === component && component?.getMode() === mode && component?.getEditingMode() === editingMode
      && this.app.workspace.sessions?.get(sourcePath) === session && (!session || session.originRoot === root && !session.isReloading && session.text === text)
      && preferences.every(([key, expected]) => this.app.vault.getConfig(key) === expected);
    this.close();
    try {
      let acknowledged: TFile | null = null, created: TFile;
      try {
        created = await this.app.fileManager.createLinkedNote(choice.name, sourcePath, { expectedPath: choice.path, created: file => { acknowledged = file; }, guard: () => {
          if (!sourceCurrent()) { return false; }
          const current = this.currentTrigger(context), next = current && this.createNoteChoice(context, current);
          return Boolean(next && next.path === choice.path && next.name === choice.name);
        } });
      } catch (error) {
        // A real create acknowledgement can precede a failing metadata refresh
        // or layout save. Preserve its receipt, retain the note, and report the
        // original cleanup error without inserting a success link.
        if (acknowledged) { this.createdWithoutLink(choice.path); }
        throw error;
      }
      if (!sourceCurrent() || !this.writable(editor, file) || created.path !== choice.path || created.vault !== this.app.vault || this.app.vault.getFileByPath(choice.path) !== created) { this.createdWithoutLink(choice.path); return; }
      try {
        const insert = this.app.fileManager.generateMarkdownLink(created, sourcePath), cache = parseMarkdown(insert), reference = cache.links[0];
        const destination = reference && this.app.metadataCache.resolveReference(reference, sourcePath);
        if (destination?.file !== created || destination.ambiguous) { this.createdWithoutLink(choice.path); return; }
        const plan = planCreateNoteCompletion(text, this.rawCursor(text, editor.getCursor()), trigger, choice, insert, sourcePath);
        editor.replaceExpected(text, plan.from, plan.to, plan.insert, "input.complete");
        if (editor.getValue() === plan.text) { editor.setCursor(sourcePositions(plan.text)(plan.cursor, plan.cursor).start); }
        else { this.createdWithoutLink(choice.path); }
      } catch { this.createdWithoutLink(choice.path); }
    } finally { if (this.pendingCreate === token) { this.pendingCreate = null; } }
  }
}

export function registerBuiltinSuggestions(app: App): () => void {
  return app.editorSuggestions.register("slopsidian:builtin-completion", new BuiltinEditorSuggestions(app), { fallback: true });
}
