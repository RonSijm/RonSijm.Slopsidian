import type { App } from "./app";
import type { CorePlugins } from "./core-plugins";
import { copyViewData, type ViewStateResult } from "./contracts";
import { element, reportError } from "./dom";
import { Events } from "./events";
import { icon } from "./icons";
import { frontmatterPropertyPosition, parseMarkdown, sameValue, validTag } from "./markdown";
import { inferPropertyType, parsePropertyValue, propertyName, propertyTypes } from "./property-types";
import { composingKey, numberText, numericLexemes } from "./properties-lexemes";
import { propertiesPaneState, propertySorts, sortedProperties } from "./properties-pane-model";
import { assertPropertyValueChoice, createPropertyHeading, createPropertyNote, PropertyValueSuggestions, propertyHeadingCreationChoice, propertyNoteCreationChoice, propertyValueChoices, propertyWikiValue, replacePropertyListValue, type PropertyNoteCreationOptions } from "./property-value-suggestions";
import { MAX_COMPLETION_RESULTS } from "./builtin-suggestion-model";
import { checkedMultilineText, createMultilinePropertyEditor, createStructuredPropertyInspector, hasMultilineText, multilineListSupported, preserveMultilinePropertySource, propertyTextControl as textControl, replaceMultilinePropertyValue, structuredPropertySourceSupported, type MultilinePropertyEditor } from "./multiline-properties";
import { Modal, Notice } from "./ui";
import { openTagSearch } from "./reading";
import { TFile } from "./vault";
import { ItemView } from "./views";
import { MarkdownView, type WorkspaceLeaf } from "./workspace";

function editable(value: unknown): boolean {
  return value == null || ["string", "boolean", "number"].includes(typeof value) || Array.isArray(value) && value.every(entry => typeof entry === "string" && !/[\r\n]/.test(entry));
}

function displayValue(value: unknown): string {
  if (value === null) { return "null"; }
  if (value === undefined) { return ""; }
  if (Array.isArray(value) && editable(value)) { return value.join("\n"); }
  if (typeof value === "object") { return "Structured YAML value (retained; edit in source)"; }
  return String(value);
}

interface RenderedProperty {
  entry: { key: string; value: unknown };
  containerEl: HTMLElement;
  valueEl: HTMLElement;
  source?: string;
  cleanup?: () => void;
  linksCurrent?: () => boolean;
  hasDraft?: () => boolean;
}

function inlinePropertyRow(properties: Properties, file: TFile, name: string, value: unknown, refresh: (name: string) => void, current: (ownedCreationMutation?: boolean) => boolean, source?: string): RenderedProperty {
  const prior = structuredClone(value);
  const row = document.createElement("div");
  row.className = "metadata-property";
  row.dataset.propertyKey = name;
  row.dataset.propertyName = name;
  row.dataset.readOnly = String(properties.app.vault.readOnly);
  const run = (action: () => unknown): void => {
    if (!row.isConnected || !current()) { return; }
    properties.app.core.run(() => { if (row.isConnected && current()) { return action(); } }).catch(reportError);
  };
  const widget = properties.app.metadataTypeManager.getAssignedWidget(name) ?? inferPropertyType(value);
  const label = document.createElement("div");
  label.className = "metadata-property-key";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "clickable-icon metadata-property-icon";
  edit.dataset.metadataPropertyAction = "edit";
  edit.dataset.propertyAction = "edit";
  edit.setAttribute("aria-label", `Edit property ${name}`);
  edit.append(icon(widget === "tags" ? "tag" : widget === "checkbox" ? "check" : widget === "date" || widget === "datetime" ? "calendar" : "list"));
  edit.addEventListener("click", () => run(() => properties.editDialog(file, name)));
  const title = document.createElement("span");
  title.textContent = name;
  label.append(edit, title);
  const valueEl = document.createElement("div");
  valueEl.className = "metadata-property-value";
  valueEl.dataset.metadataPropertyValue = "";
  valueEl.dataset.propertyValue = "";
  valueEl.dataset.propertyType = widget;
  const error = document.createElement("div");
  error.className = "metadata-property-error";
  error.setAttribute("role", "alert");
  const multilineList = widget === "multitext" && multilineListSupported(value);
  const writable = !properties.app.vault.readOnly && (editable(value) || multilineList) && propertyTypes.some(type => type === widget);
  let pending = false;
  let multilineEditor: MultilinePropertyEditor | null = null, cancelMultiline: ((refresh?: boolean) => void) | null = null, listDraft = false;
  const commit = async (next: unknown, guard?: (content: string) => void, transform?: (updated: string, original: string) => string): Promise<boolean> => {
    if (pending || !writable || !row.isConnected || !current()) { return false; }
    // A selected suggestion also consumes its draft when it resolves to the
    // existing value. Keep its guarded queue/row refresh; otherwise a later
    // blur could save the already-accepted query prefix as a literal value.
    if (sameValue(next, value) && !guard) { return true; }
    pending = true;
    row.setAttribute("aria-busy", "true");
    const controls = [...row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>("input,textarea,button")].map(control => ({ control, disabled: control.disabled, readOnly: textControl(control) && control.readOnly }));
    for (const { control } of controls) {
      if (textControl(control) && control.type !== "checkbox") { control.readOnly = true; }
      else { control.disabled = true; }
    }
    error.textContent = "";
    try {
      await properties.app.core.run(() => {
        if (!row.isConnected || !current()) { throw new Error("This property field belongs to an inactive note or pane."); }
        return properties.changeValue(file, name, prior, next, widget, guard, transform);
      });
      refresh(name);
      return true;
    } catch (issue) {
      error.textContent = issue instanceof Error ? issue.message : String(issue);
      return false;
    } finally {
      pending = false; row.removeAttribute("aria-busy");
      for (const { control, disabled, readOnly } of controls) {
        control.disabled = disabled;
        if (textControl(control)) { control.readOnly = readOnly; }
      }
    }
  };
  let suggestions: PropertyValueSuggestions | null = null;
  const suggestionInstances = new Set<PropertyValueSuggestions>();
  const attachSuggestions = (input: HTMLInputElement, existing: readonly string[], nextValue: (value: string) => unknown, allowCreation = true): PropertyValueSuggestions => {
    let creatingMutation = false;
    const instance = new PropertyValueSuggestions({ input, container: valueEl, current: ownedCreationMutation => row.isConnected && current(ownedCreationMutation),
      choices: query => {
        const values = propertyValueChoices(properties.app, file, name, widget, existing, query);
        const create = allowCreation ? propertyHeadingCreationChoice(properties.app, file, name, widget, existing, query) ?? propertyNoteCreationChoice(properties.app, file, name, widget, existing, query) : null;
        return create ? [...values.slice(0, MAX_COMPLETION_RESULTS - 1), create] : values;
      },
      preserveOwnedOnBlur: () => creatingMutation && properties.app.workspace.isChangingFiles,
      accept: async (choice, query, owned) => {
        if (choice.kind === "create-note" || choice.kind === "create-heading") {
          const owner = properties.app.workspace.leaves().find(leaf => leaf.view.containerEl.contains(row)), view = owner?.view;
          const mode = view instanceof MarkdownView ? view.getMode() : null, editing = view instanceof MarkdownView ? view.getEditingMode() : null;
          const creationCurrent = (): boolean => owned() && Boolean(owner && view && owner.view === view && properties.app.workspace.getLeafById(owner.id) === owner
            && view.containerEl.contains(row) && (row.checkVisibility?.() ?? true)
            && (!(view instanceof MarkdownView) || view.getMode() === mode && view.getEditingMode() === editing));
          const creationOptions: PropertyNoteCreationOptions = { widget, existing, query, current: creationCurrent,
            commit: async (candidate, guard, transform) => {
              if (!creationCurrent()) { return false; }
              // Creation's inert shell may have blurred this input. Restore its
              // owned focus so the synchronous editor-change render retains
              // the pending field and its eventual save error.
              input.focus({ preventScroll: true });
              if (!creationCurrent()) { return false; }
              return commit(nextValue(candidate), guard, transform);
            },
            ownMutation: pending => { creatingMutation = pending; },
            kept: path => { new Notice(choice.kind === "create-heading"
              ? 'Heading creation in "' + path + '" was confirmed. The property update did not complete; review the current target, property and any unsaved changes.'
              : 'Created "' + path + '". The property update did not complete. The new note was kept; review the property and any unsaved changes.', 10_000); },
            acknowledgedFailure: reportError };
          return choice.kind === "create-heading" ? createPropertyHeading(properties.app, choice, creationOptions) : createPropertyNote(properties.app, choice, creationOptions);
        }
        const guard = (content: string): void => {
          if (!owned()) { throw new Error("This property field closed or changed before its suggestion could be applied."); }
          assertPropertyValueChoice(properties.app, choice, widget, existing, query, content);
        };
        assertPropertyValueChoice(properties.app, choice, widget, existing, query);
        return commit(nextValue(choice.value), guard);
      }, error: message => { error.textContent = message; } });
    suggestionInstances.add(instance);
    return instance;
  };
  const linkProofs: (() => boolean)[] = [];
  const sourceText = (): string | undefined => properties.app.workspace.sessions.get(file.path)?.text ?? properties.app.metadataCache.getDocument(file.path)?.text;
  const openMultiline = (text: string, hidden: HTMLElement[], focus: HTMLButtonElement, replace: (text: string) => unknown, index?: number): void => {
    if (!writable || pending || !row.isConnected || !current()) { return; }
    try { checkedMultilineText(text); } catch (issue) { error.textContent = issue instanceof Error ? issue.message : String(issue); return; }
    cancelMultiline?.(false); suggestions?.close();
    const root = properties.app.vault.rootPath, path = file.path, session = properties.app.workspace.sessions.get(path), baseline = sourceText();
    if (!root || baseline === undefined) { error.textContent = "Load this note before editing its multiline value."; return; }
    const owner = properties.app.workspace.leaves().find(leaf => leaf.view.containerEl.contains(row)), view = owner?.view;
    const mode = view instanceof MarkdownView ? view.getMode() : null, editing = view instanceof MarkdownView ? view.getEditingMode() : null;
    const container = row.parentElement, focusLabel = focus.getAttribute("aria-label");
    const locationCurrent = (): boolean => Boolean(owner && view && owner.view === view && properties.app.workspace.getLeafById(owner.id) === owner)
      && (!(view instanceof MarkdownView) || view.getMode() === mode && view.getEditingMode() === editing);
    let editor: MultilinePropertyEditor;
    const owns = (): boolean => editor.active && row.isConnected && current() && !properties.app.vault.readOnly
      && root === properties.app.vault.rootPath && path === file.path && properties.app.vault.getFileByPath(path) === file
      && properties.app.workspace.sessions.get(path) === session && (!session || session.originRoot === root && !session.isReloading && !session.isSaving)
      && locationCurrent() && Boolean(view?.containerEl.contains(row)) && (row.checkVisibility?.() ?? true);
    const guard = (content: string): void => {
      if (!owns() || content !== baseline) { throw new Error("The note or multiline property owner changed. Cancel this draft and review the current source before applying it."); }
    };
    const close = (repaint = true): void => {
      editor.dispose(); for (const element of hidden) { element.hidden = false; }
      if (multilineEditor === editor) { multilineEditor = null; cancelMultiline = null; }
      if (repaint && row.isConnected && current()) { refresh(name); }
      if (locationCurrent() && current() && container?.isConnected) {
        const replacement = [...container.querySelectorAll<HTMLElement>("[data-property-key]")].find(element => element.dataset.propertyKey === name);
        const target = [...replacement?.querySelectorAll<HTMLButtonElement>("button") ?? []].find(button => button.getAttribute("aria-label") === focusLabel);
        (target ?? (focus.isConnected ? focus : null))?.focus();
      }
    };
    editor = createMultilinePropertyEditor(row.ownerDocument, { value: text, label: `Edit multiline value in ${name}`, current: owns,
      apply: candidate => { guard(sourceText() ?? ""); return commit(replace(candidate), guard, (updated, original) => preserveMultilinePropertySource(updated, original, name, index)); },
      error: message => { error.textContent = message; }, closed: close });
    multilineEditor = editor; cancelMultiline = close;
    for (const element of hidden) { element.hidden = true; }
    valueEl.append(editor.element); editor.input.focus(); editor.input.select();
  };
  const wikiAnchor = (value: string, index?: number, draftCurrent: () => boolean = () => true): HTMLAnchorElement | null => {
    const choice = propertyWikiValue(properties.app, file, name, value, index);
    linkProofs.push(() => {
      const fresh = propertyWikiValue(properties.app, file, name, value, index);
      return choice === null ? fresh === null : fresh?.target === choice.target && fresh.targetPath === choice.targetPath
        && fresh.linktext === choice.linktext && fresh.label === choice.label;
    });
    if (!choice) { return null; }
    const anchor = document.createElement("a");
    anchor.href = "#"; anchor.className = "internal-link metadata-property-link"; anchor.textContent = choice.label;
    anchor.dataset.propertyWikiValue = value; anchor.dataset.propertyWikiTarget = choice.targetPath;
    anchor.setAttribute("aria-label", "Open " + choice.label); anchor.title = choice.targetPath + " — " + value;
    anchor.addEventListener("mousedown", event => { if (event.button <= 1) { event.preventDefault(); } });
    const open = (event: MouseEvent): void => {
      if (event.button > 1) { return; }
      event.preventDefault();
      if (!draftCurrent()) { error.textContent = "Finish or cancel this property draft before opening its stored link."; return; }
      run(() => {
        const fresh = propertyWikiValue(properties.app, file, name, value, index);
        if (!anchor.isConnected || !draftCurrent() || !fresh || fresh.target !== choice.target || fresh.targetPath !== choice.targetPath || fresh.linktext !== choice.linktext) {
          error.textContent = "This property link or its destination changed. Review the current property before opening it."; return;
        }
        return properties.app.workspace.openLinkText(fresh.linktext, file.path, event.button === 1 || event.ctrlKey || event.metaKey ? "tab" : false);
      });
    };
    anchor.addEventListener("click", open); anchor.addEventListener("auxclick", open);
    return anchor;
  };
  const list = typeof value === "string" ? [value] : Array.isArray(value) && value.every(entry => typeof entry === "string") ? value as string[] : null;
  if (["tags", "multitext", "aliases"].includes(widget) && list) {
    const tags = widget === "tags";
    let cancelEdit: (() => void) | null = null;
    valueEl.classList.add("metadata-tags", "multi-select-container");
    for (const [index, item] of list.entries()) {
      const text = tags ? item.trim().replace(/^#/, "") : item;
      const pill = document.createElement("span");
      pill.className = "multi-select-pill";
      const linked = widget === "multitext" ? wikiAnchor(item, Array.isArray(value) ? index : undefined) : null;
      const content = linked ?? document.createElement(tags ? "a" : "span");
      content.className = (linked ? linked.className + " " : "") + "multi-select-pill-content" + (tags ? " metadata-tag" : "");
      if (!linked) { content.textContent = text; }
      if (hasMultilineText(item)) { content.classList.add("metadata-multiline-preview"); }
      if (tags && content instanceof HTMLAnchorElement) {
        content.href = "#" + text;
        content.addEventListener("click", event => { event.preventDefault(); run(() => openTagSearch(properties.app, text)); });
        content.addEventListener("auxclick", event => { if (event.button === 1) { event.preventDefault(); run(() => openTagSearch(properties.app, text)); } });
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "multi-select-pill-remove-button";
      remove.setAttribute("aria-label", `Remove ${tags ? "tag" : "value"} ${text}`);
      remove.disabled = !writable;
      remove.append(icon("close"));
      remove.addEventListener("click", () => { void commit(list.filter((_, position) => position !== index)); });
      pill.append(content, remove);
      if (widget === "multitext" && Array.isArray(value)) {
        const editValue = document.createElement("button");
        editValue.type = "button"; editValue.className = "metadata-value-edit"; editValue.disabled = !writable;
        editValue.dataset.propertyEditValue = String(index); editValue.setAttribute("aria-label", `Edit value ${index + 1} in ${name}`); editValue.textContent = "Edit";
        editValue.addEventListener("click", () => {
          if (!writable || pending || !row.isConnected || !current()) { return; }
          cancelEdit?.(); cancelMultiline?.(false); suggestions?.close();
          if (hasMultilineText(item)) { openMultiline(item, [pill], editValue, candidate => replaceMultilinePropertyValue(list, index, candidate), index); return; }
          const box = document.createElement("div"), draft = document.createElement("input"), apply = document.createElement("button"), cancel = document.createElement("button");
          box.className = "metadata-list-value-editor"; Object.assign(box.style, { display: "flex", flexWrap: "wrap", gap: "4px", width: "100%" });
          draft.className = "metadata-input"; draft.value = item; draft.dataset.metadataInput = ""; draft.dataset.propertyEditIndex = String(index); draft.setAttribute("aria-label", `Edit value ${index + 1} in ${name}`);
          apply.type = cancel.type = "button"; apply.textContent = "Apply value"; cancel.textContent = "Cancel";
          apply.dataset.propertyApplyValue = String(index); cancel.dataset.propertyCancelValue = String(index);
          let closed = false, composing = false;
          const remaining = list.filter((_, position) => position !== index), replace = (candidate: string): string[] => replacePropertyListValue(list, index, candidate);
          const editorSuggestions = attachSuggestions(draft, remaining, replace, false);
          const close = (): void => { if (closed) { return; } closed = true; editorSuggestions.dispose(); suggestionInstances.delete(editorSuggestions); box.remove(); pill.hidden = false; cancelEdit = null; listDraft = false; };
          cancelEdit = close; pill.hidden = true; listDraft = true;
          const save = (): void => {
            if (closed || composing || pending || editorSuggestions.suppressBlurCommit) { return; }
            const candidate = draft.value.trim();
            if (draft.value === item || !candidate || candidate === item) { close(); editValue.focus(); return; }
            try { void commit(replace(candidate)); } catch (issue) { error.textContent = issue instanceof Error ? issue.message : String(issue); }
          };
          draft.addEventListener("compositionstart", () => { composing = true; }); draft.addEventListener("compositionend", () => { composing = false; });
          // Existing-value edits require Apply/Enter. Moving focus with Tab
          // must leave Cancel usable without first committing the draft.
          draft.addEventListener("keydown", event => {
            if (composing || composingKey(event)) { return; }
            if (event.key === "Enter") { event.preventDefault(); save(); }
            if (event.key === "Escape") { event.preventDefault(); close(); error.textContent = ""; editValue.focus(); }
          });
          for (const button of [apply, cancel]) { button.addEventListener("mousedown", event => event.preventDefault()); }
          apply.addEventListener("click", save); cancel.addEventListener("click", () => { close(); error.textContent = ""; editValue.focus(); });
          box.append(draft, apply, cancel); valueEl.append(box); draft.focus(); draft.select();
        });
        pill.append(editValue);
      }
      valueEl.append(pill);
    }
    const input = document.createElement("input");
    input.className = "multi-select-input";
    input.dataset.metadataInput = "";
    input.setAttribute("aria-label", `Add ${tags ? "tag" : "value"} to ${name}`);
    input.placeholder = list.length ? "" : "Empty";
    input.disabled = !writable;
    const add = (): void => {
      if (pending || !input.value.trim()) { return; }
      const next = tags ? input.value.trim().replace(/^#/, "") : input.value.trim();
      if (tags && !validTag(next)) { error.textContent = "Enter a tag without spaces or a numeric-only name."; return; }
      if (list.some(item => (tags ? item.replace(/^#/, "") : item) === next)) { input.value = ""; return; }
      void commit([...list, next]);
    };
    let composing = false;
    input.addEventListener("compositionstart", () => { composing = true; });
    input.addEventListener("compositionend", () => { composing = false; });
    input.addEventListener("keydown", event => {
      if (composing || composingKey(event)) { return; }
      if (event.key === "Enter") { event.preventDefault(); add(); }
      if (event.key === "Escape") { event.preventDefault(); input.value = ""; error.textContent = ""; input.blur(); }
    });
    valueEl.append(input);
    suggestions = attachSuggestions(input, list, candidate => [...list, candidate]);
    input.addEventListener("blur", () => { if (!composing && !suggestions?.suppressBlurCommit) { add(); } });
  } else if (widget === "text" && hasMultilineText(value)) {
    const preview = document.createElement("div"), editText = document.createElement("button");
    preview.className = "metadata-multiline-preview"; preview.dataset.propertyMultilinePreview = ""; preview.textContent = value;
    editText.type = "button"; editText.className = "metadata-value-edit"; editText.textContent = "Edit text"; editText.dataset.propertyEditMultiline = "";
    editText.setAttribute("aria-label", `Edit multiline property ${name}`); editText.disabled = !writable;
    editText.addEventListener("click", () => openMultiline(value, [preview, editText], editText, candidate => candidate));
    valueEl.append(preview, editText);
  } else if (editable(value) && propertyTypes.some(type => type === widget) && !Array.isArray(value) && (typeof value !== "object" || value === null)) {
    const input = document.createElement("input");
    input.className = "metadata-input";
    input.dataset.metadataInput = "";
    input.setAttribute("aria-label", `Property ${name}`);
    input.type = widget === "checkbox" ? "checkbox" : "text";
    input.value = value == null ? "" : typeof value === "number" ? numberText(value, source) : String(value);
    input.checked = value === true;
    input.placeholder = "Empty";
    input.disabled = !writable;
    const initial = input.value;
    const save = (): void => {
      if (pending || widget !== "checkbox" && input.value === initial) { return; }
      try { void commit(parsePropertyValue(widget, input.value, input.checked)); }
      catch (issue) { error.textContent = issue instanceof Error ? issue.message : String(issue); }
    };
    let composing = false;
    input.addEventListener("compositionstart", () => { composing = true; });
    input.addEventListener("compositionend", () => { composing = false; });
    input.addEventListener(widget === "checkbox" ? "change" : "blur", () => { if (!composing && !suggestions?.suppressBlurCommit) { save(); } });
    input.addEventListener("keydown", event => {
      if (composing || composingKey(event)) { return; }
      if (event.key === "Enter") { event.preventDefault(); save(); }
      if (event.key === "Escape") { event.preventDefault(); input.value = initial; input.checked = value === true; error.textContent = ""; input.blur(); }
    });
    valueEl.append(input);
    if (widget === "text" && (value == null || typeof value === "string" && !/[\r\n]/.test(value))) {
      suggestions = attachSuggestions(input, [], candidate => candidate);
      if (typeof value === "string") {
        const anchor = wikiAnchor(value, undefined, () => input.value === initial && !multilineEditor?.active); if (anchor) { valueEl.append(anchor); }
        const editText = document.createElement("button"); editText.type = "button"; editText.className = "metadata-value-edit";
        editText.dataset.propertyEditMultiline = ""; editText.textContent = "Edit text"; editText.setAttribute("aria-label", `Edit multiline property ${name}`); editText.disabled = !writable;
        editText.addEventListener("mousedown", event => event.preventDefault());
        editText.addEventListener("click", () => {
          if (input.value !== initial) { error.textContent = "Finish or cancel the single-line draft before opening multiline editing."; return; }
          openMultiline(value, [input, editText, ...anchor ? [anchor] : []], editText, candidate => candidate);
        }); valueEl.append(editText);
      }
    }
  } else {
    const inspectionAllowed = structuredPropertySourceSupported(sourceText(), name);
    linkProofs.push(() => structuredPropertySourceSupported(sourceText(), name) === inspectionAllowed);
    const inspector = createStructuredPropertyInspector(row.ownerDocument, value, name, sourceText());
    if (inspector) { valueEl.append(inspector); } else { valueEl.textContent = displayValue(value); }
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "clickable-icon metadata-property-remove";
  remove.dataset.metadataPropertyAction = "remove";
  remove.dataset.propertyAction = "remove";
  remove.setAttribute("aria-label", `Remove property ${name}`);
  remove.disabled = properties.app.vault.readOnly;
  remove.append(icon("close"));
  remove.addEventListener("click", () => run(() => properties.editDialog(file, name, true)));
  edit.disabled = properties.app.vault.readOnly || !editable(value) || !propertyTypes.some(type => type === widget);
  row.append(label, valueEl, remove, error);
  return { entry: { key: name, value: prior }, containerEl: row, valueEl, source,
    // The mutation shell may blur an accepted creator. A target acknowledgement
    // must not replace that row before its still-guarded source queue completes.
    linksCurrent: () => pending || [...suggestionInstances].some(instance => instance.accepting) || linkProofs.every(proof => proof()),
    hasDraft: () => Boolean(multilineEditor?.active || listDraft),
    cleanup: () => { multilineEditor?.dispose(); multilineEditor = null; cancelMultiline = null; listDraft = false; for (const instance of suggestionInstances) { instance.dispose(); } suggestionInstances.clear(); } };
}

export class MetadataEditor {
  readonly contentEl = document.createElement("div");
  readonly rendered: RenderedProperty[] = [];
  readonly addPropertyButtonEl = document.createElement("button");
  private file: TFile | null = null;
  private values: Record<string, unknown> | null = null;

  constructor(private readonly properties: Properties, private readonly getFile: () => TFile | null, private readonly options: {
    isCurrent?: (ownedCreationMutation?: boolean) => boolean;
    entries?: (values: Record<string, unknown>) => [string, unknown][];
  } = {}) {
    this.contentEl.className = "metadata-container";
    this.addPropertyButtonEl.type = "button";
    this.addPropertyButtonEl.append(icon("plus"), document.createTextNode("Add property"));
    this.addPropertyButtonEl.className = "metadata-add-button";
    this.addPropertyButtonEl.dataset.metadataPropertyAction = "add";
    this.contentEl.addEventListener("focusout", () => queueMicrotask(() => { if (this.contentEl.isConnected) { this.render(); } }));
    this.addPropertyButtonEl.addEventListener("click", () => {
      if (!this.contentEl.isConnected || !(this.options.isCurrent?.() ?? true)) { return; }
      properties.app.core.run(() => {
      const file = this.getFile();
      if (!file) { throw new Error("Open a Markdown note before adding a property."); }
      if (!this.contentEl.isConnected || !this.current(file)) { return; }
      properties.editDialog(file);
      }).catch(reportError);
    });
  }

  private current(file: TFile, ownedCreationMutation = false): boolean {
    return this.getFile() === file && this.properties.app.vault.getFileByPath(file.path) === file
      && !this.properties.app.changingVault && !this.properties.app.core.busy && !this.properties.busy
      && this.properties.app.core.isEnabled("properties") && (this.options.isCurrent?.(ownedCreationMutation) ?? true);
  }

  render(force = false, committed?: string): void {
    this.contentEl.inert = this.properties.busy || this.properties.app.core.busy || !(this.options.isCurrent?.() ?? true);
    this.addPropertyButtonEl.disabled = this.properties.app.vault.readOnly || !this.properties.app.core.isEnabled("properties");
    try {
      const file = this.getFile();
      const values = file ? this.properties.values(file) : {};
      const numerics = file ? this.properties.numerics(file, values) : new Map<string, string>();
      const current = (property: RenderedProperty): boolean => Object.hasOwn(values, property.entry.key)
        && sameValue(property.entry.value, values[property.entry.key])
        && property.source === numerics.get(property.entry.key)
        && property.valueEl.dataset.propertyType === (this.properties.app.metadataTypeManager.getAssignedWidget(property.entry.key) ?? inferPropertyType(values[property.entry.key]))
        && property.containerEl.dataset.readOnly === String(this.properties.app.vault.readOnly)
        && property.linksCurrent?.() !== false;
      if (!force && this.file === file && this.values && sameValue(this.values, values) && this.rendered.every(current)) { return; }
      const focused = this.file === file && this.contentEl.contains(document.activeElement) ? document.activeElement : null;
      const focusedKey = focused?.closest<HTMLElement>("[data-property-key]")?.dataset.propertyKey;
      const focusedLabel = focused?.getAttribute("aria-label");
      const draft = textControl(focused) && focusedKey !== committed ? { value: focused.value, checked: "checked" in focused && focused.checked, from: focused.selectionStart, to: focused.selectionEnd } : null;
      const previous = this.file === file ? this.rendered : [];
      this.file = file;
      this.values = structuredClone(values);
      const rows = file ? (this.options.entries?.(values) ?? Object.entries(values)).map(([name, value]) => {
        const existing = previous.find(property => property.entry.key === name);
        // Keep the focused row and its original comparison value together.
        // Recreating a field while retaining its draft would silently rebase
        // that draft onto someone else's newer value.
        // An accepted draft is consumed even if Undo has already returned the
        // source to its prior value while an asynchronous save/index finishes.
        // Reusing that row would leave its accepted query to save again on blur.
        return existing && name !== committed && (name === focusedKey || existing.hasDraft?.() || current(existing)) ? existing
          : inlinePropertyRow(this.properties, file, name, value, key => this.render(true, key), ownedCreationMutation => this.current(file, ownedCreationMutation), numerics.get(name));
      }) : [];
      for (const property of previous) {
        if (property.entry.key !== committed && (property.entry.key === focusedKey || property.hasDraft?.()) && !Object.hasOwn(values, property.entry.key)) { rows.push(property); }
      }
      // Remove obsolete rows before ordering their replacements. Leaving them
      // interleaved would move unchanged later rows around them, blurring a
      // focused field and revoking a valid queued choice in another property.
      for (const property of this.rendered) { if (!rows.includes(property)) { property.cleanup?.(); property.containerEl.remove(); } }
      this.rendered.splice(0, this.rendered.length, ...rows);
      const heading = this.contentEl.querySelector<HTMLElement>(":scope > .metadata-properties-heading") ?? document.createElement("div");
      heading.className = "metadata-properties-heading";
      heading.textContent = "Properties";
      const children = [heading, ...this.rendered.map(property => property.containerEl), ...file ? [this.addPropertyButtonEl] : []];
      for (const [index, child] of children.entries()) {
        const present = this.contentEl.children.item(index);
        if (present !== child) { this.contentEl.insertBefore(child, present); }
      }
      while (this.contentEl.children.length > children.length) { this.contentEl.lastElementChild?.remove(); }
      if (focused && !focused.isConnected && focusedKey) {
        const row = this.rendered.find(property => property.entry.key === focusedKey)?.containerEl;
        const input = row?.querySelector<HTMLInputElement | HTMLTextAreaElement>(focusedLabel ? `input[aria-label="${CSS.escape(focusedLabel)}"],textarea[aria-label="${CSS.escape(focusedLabel)}"]` : "input,textarea");
        const target = input ?? row?.querySelector<HTMLInputElement | HTMLTextAreaElement>("[data-metadata-input]");
        if (target) {
          if (draft) { target.value = draft.value; if ("checked" in target) { target.checked = draft.checked; } }
          target.focus();
          if (draft?.from != null && draft.to != null && target.type !== "checkbox") { target.setSelectionRange(draft.from, draft.to); }
        }
      }
    } catch (error) {
      this.values = null;
      for (const property of this.rendered) { property.cleanup?.(); }
      this.rendered.length = 0;
      const status = document.createElement("p");
      status.className = "plugin-error";
      status.setAttribute("role", "alert");
      status.textContent = error instanceof Error ? error.message : String(error);
      this.contentEl.replaceChildren(status);
    }
  }
}

export class Properties extends Events {
  readonly id = "properties";
  private modal: Modal | null = null;
  busy = false;
  constructor(readonly app: App) { super(); }
  async changeValue(file: TFile, name: string, prior: unknown, next: unknown, widget?: string, guard?: (content: string) => void, transform?: (updated: string, original: string) => string): Promise<void> {
    if (!this.app.core.isEnabled(this.id)) { throw new Error("Enable Properties before editing a value."); }
    await this.app.fileManager.processFrontMatter(file, values => {
      if (!Object.hasOwn(values, name) || !sameValue(values[name], prior)) { throw new Error("This property changed while you were editing. Reopen the note to review its current value."); }
      if (widget !== undefined && widget !== (this.app.metadataTypeManager.getAssignedWidget(name) ?? inferPropertyType(values[name]))) { throw new Error("The property type changed while you were editing. Reopen the note to use its current type."); }
      Object.defineProperty(values, name, { value: next, enumerable: true, configurable: true, writable: true });
    }, undefined, guard, transform);
  }
  get options(): Record<string, unknown> { return this.app.core.state(this.id).settings; }

  register(core: CorePlugins): void {
    const views = {
      "all-properties": (leaf: WorkspaceLeaf) => new PropertiesView(leaf, this, false),
      "file-properties": (leaf: WorkspaceLeaf) => new PropertiesView(leaf, this, true),
    };
    core.register(this.id, async () => {
      const commands = this.app.commands.install([
        { id: "properties:open", name: "Show all properties", callback: () => core.run(() => this.open(false)) },
        { id: "properties:open-local", name: "Show file properties", callback: () => core.run(() => this.open(true)) },
        { id: "properties:open-tab", name: "Open all properties in a tab", callback: () => core.run(() => this.open(false, true)) },
        { id: "properties:open-local-tab", name: "Open file properties in a tab", callback: () => core.run(() => this.open(true, true)) },
      ]);
      let closeViews: () => void | Promise<void>;
      try {
        closeViews = await core.installViews(this.id, views);
      } catch (error) { commands(); throw error; }
      const status = document.createElement("button");
      status.className = "properties-status";
      status.dataset.coreStatus = this.id;
      status.setAttribute("aria-label", "Show file properties");
      status.addEventListener("click", () => this.app.commands.execute("properties:open-local").catch(reportError));
      const update = (): void => {
        const file = this.currentFile();
        const count = file ? Object.keys(this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}).length : 0;
        status.textContent = `${count} properties`;
        status.hidden = !file;
      };
      const refs = [this.app.metadataTypeManager.on("changed", update), this.app.workspace.on("file-open", update)];
      element("plugin-status-bar").append(status);
      update();
      return async () => {
        await closeViews();
        this.modal?.close();
        commands();
        refs.forEach(ref => ref.emitter.offref(ref));
        status.remove();
      };
    }, this, views);
  }

  currentFile(): TFile | null {
    const file = this.app.workspace.getActiveFile();
    return file?.extension.toLowerCase() === "md" ? file : null;
  }

  values(file: TFile): Record<string, unknown> {
    if (this.app.vault.getFileByPath(file.path) !== file || file.extension.toLowerCase() !== "md") { throw new Error("Properties needs a current Markdown note in the selected vault."); }
    const entry = this.app.metadataCache.getDocument(file.path);
    const session = this.app.workspace.sessions.get(file.path);
    if ((!entry || entry.missing) && !session) { throw new Error("The note is not available in the metadata index: " + file.path); }
    const cache = session && session.text !== entry?.text ? parseMarkdown(session.text) : entry?.cache;
    if (cache?.errors.length) { throw new Error("Fix this note's YAML before editing properties: " + cache.errors.join("\n")); }
    return cache?.frontmatter ?? {};
  }

  numerics(file: TFile, values: Record<string, unknown>): Map<string, string> {
    if (!Object.values(values).some(value => typeof value === "number")) { return new Map(); }
    const text = this.app.workspace.sessions.get(file.path)?.text ?? this.app.metadataCache.getDocument(file.path)?.text;
    return text === undefined ? new Map() : numericLexemes(text);
  }

  async open(local: boolean, newTab = false): Promise<void> {
    if (local && !this.currentFile()) { throw new Error("Open a Markdown note before viewing its properties."); }
    const type = local ? "file-properties" : "all-properties";
    const leaf = newTab ? this.app.workspace.getLeaf("tab") : this.app.workspace.getLeavesOfType(type)[0] ?? this.app.workspace.getRightLeaf();
    await leaf.setViewState({ type, state: leaf.view.getViewType() === type ? leaf.getViewState().state : {}, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  private createModal(title: string): Modal {
    if (this.app.core.busy || !this.app.core.isEnabled(this.id)) { throw new Error("Wait for Properties to finish loading."); }
    this.modal?.close();
    const modal = new Modal(this.app).setTitle(title);
    modal.modalEl.dataset.coreDialog = "properties";
    modal.modalEl.setAttribute("aria-label", title);
    modal.onClose = () => { if (this.modal === modal) { this.modal = null; } };
    this.modal = modal;
    return modal;
  }

  editDialog(file: TFile, existing?: string, remove = false): void {
    this.app.vault.assertWritable("edit properties");
    if (this.app.vault.getFileByPath(file.path) !== file) { throw new Error("Edit properties on a current note in the selected vault."); }
    const root = this.app.vault.rootPath;
    const values = this.values(file);
    const prior = existing === undefined ? undefined : structuredClone(values[existing]);
    const modal = this.createModal(remove ? "Remove property" : existing === undefined ? "Add property" : "Edit property");
    const form = document.createElement("form");
    const label = document.createElement("label");
    label.textContent = "Property name";
    const name = document.createElement("input");
    name.dataset.propertyField = "name";
    name.value = existing ?? "";
    name.disabled = existing !== undefined;
    label.append(name);
    const typeLabel = document.createElement("label");
    typeLabel.textContent = "Value type (assigned global types are changed in All properties)";
    const type = document.createElement("select");
    type.dataset.propertyField = "type";
    const assigned = existing === undefined ? null : this.app.metadataTypeManager.getAssignedWidget(existing);
    const kind = assigned ?? inferPropertyType(prior);
    for (const widget of [...propertyTypes, ...(propertyTypes.some(value => value === kind) ? [] : [kind])]) { type.add(new Option(widget, widget)); }
    type.value = kind;
    type.disabled = assigned !== null;
    typeLabel.append(type);
    const valueLabel = document.createElement("label");
    valueLabel.textContent = "Value (list values use one entry per line)";
    const value = document.createElement("textarea");
    value.dataset.propertyField = "value";
    value.value = Array.isArray(prior) && editable(prior) ? prior.join("\n") : prior == null ? "" : typeof prior === "number" && existing !== undefined ? numberText(prior, this.numerics(file, values).get(existing)) : displayValue(prior);
    valueLabel.append(value);
    const checkLabel = document.createElement("label");
    checkLabel.textContent = "Checked";
    const checked = document.createElement("input");
    checked.type = "checkbox";
    checked.dataset.propertyField = "checked";
    checked.checked = prior === true;
    checkLabel.append(checked);
    const error = document.createElement("p");
    error.className = "plugin-error";
    error.setAttribute("role", "alert");
    const save = document.createElement("button");
    save.type = "submit";
    save.dataset.propertyAction = remove ? "confirm-remove" : "save";
    save.textContent = remove ? "Remove property" : "Save property";
    const update = (): void => {
      typeLabel.hidden = remove;
      valueLabel.hidden = remove || type.value === "checkbox";
      checkLabel.hidden = remove || type.value !== "checkbox";
      save.disabled = !remove && (!propertyTypes.some(widget => widget === type.value) || !editable(prior));
      if (save.disabled) { error.textContent = "This type or structured value is retained but cannot be edited here. Use the source editor."; }
      else { error.textContent = ""; }
    };
    type.addEventListener("change", update);
    form.append(label, typeLabel, valueLabel, checkLabel, error, save);
    update();
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (this.modal !== modal || !form.isConnected) { return; }
      form.inert = true;
      this.app.core.run(async () => {
        if (this.modal !== modal || root !== this.app.vault.rootPath) { throw new Error("This property dialog belongs to an inactive note or vault."); }
        const key = propertyName(name.value);
        const assigned = this.app.metadataTypeManager.getAssignedWidget(key);
        if (!remove && assigned && assigned !== type.value) { throw new Error("This property has an assigned global type. Select its matching value type before saving."); }
        const next = remove ? undefined : parsePropertyValue(type.value, value.value, checked.checked);
        await this.app.fileManager.processFrontMatter(file, properties => {
          if (existing === undefined && Object.hasOwn(properties, key)) { throw new Error("This note already has a property with that name."); }
          if (existing !== undefined && (!Object.hasOwn(properties, existing) || !sameValue(properties[existing], prior))) { throw new Error("The property changed while this dialog was open. Close it and reopen its current value."); }
          if (remove) { delete properties[key]; }
          else { Object.defineProperty(properties, key, { value: next, enumerable: true, writable: true, configurable: true }); }
        });
        modal.close();
      }).catch(issue => { error.textContent = issue instanceof Error ? issue.message : String(issue); reportError(issue); }).finally(() => { form.inert = false; });
    });
    modal.contentEl.append(form);
    modal.open();
    (existing === undefined ? name : type.value === "checkbox" ? checked : value).focus();
  }

  renameDialog(name: string): void {
    this.app.vault.assertWritable("rename properties");
    const root = this.app.vault.rootPath;
    const modal = this.createModal("Rename property across the vault");
    const form = document.createElement("form");
    const description = document.createElement("p");
    description.textContent = `Rename "${name}" in every affected Markdown note and its assigned type. Open notes will be saved first. Browser batches use guarded rollback, not a native atomic transaction.`;
    const label = document.createElement("label");
    label.textContent = "New property name";
    const input = document.createElement("input");
    input.dataset.propertyField = "rename";
    input.value = name;
    label.append(input);
    const save = document.createElement("button");
    save.type = "submit";
    save.dataset.propertyAction = "rename";
    save.textContent = "Rename across vault";
    form.append(description, label, save);
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (this.modal !== modal || !form.isConnected) { return; }
      form.inert = true;
      this.app.core.run(async () => {
        if (this.modal !== modal || root !== this.app.vault.rootPath) { throw new Error("This property dialog belongs to an inactive vault."); }
        this.busy = true;
        this.trigger("changed");
        try { await this.app.fileManager.renameProperty(name, input.value); modal.close(); }
        finally { this.busy = false; this.trigger("changed"); }
      }).catch(reportError).finally(() => { form.inert = false; });
    });
    modal.contentEl.append(form);
    modal.open();
    input.focus();
  }
}

class PropertiesView extends ItemView {
  override icon = "file";
  readonly metadataEditor: MetadataEditor | null;
  private options = propertiesPaneState({});
  private readonly sourceRoot: string | null;
  private rendered: Record<string, unknown> | null = null;
  private readonly list = document.createElement("div");
  private readonly filter = document.createElement("input");
  private readonly sort = document.createElement("select");
  private readonly follow = document.createElement("input");
  private readonly caption = document.createElement("p");
  private readonly status = document.createElement("p");
  private queued = false;
  private forceRender = false;
  private generation = 0;
  private readonly actions = new Map<string, HTMLElement>();

  constructor(leaf: WorkspaceLeaf, private readonly properties: Properties, private readonly local: boolean) {
    super(leaf);
    this.sourceRoot = this.app.vault.rootPath;
    this.contentEl.classList.add("properties-pane", "core-organizer");
    this.contentEl.dataset.propertiesPane = leaf.id;
    const controls = document.createElement("div");
    controls.className = "properties-pane-controls";
    this.filter.type = "search"; this.filter.maxLength = 1024;
    this.filter.placeholder = "Filter properties"; this.filter.setAttribute("aria-label", "Filter properties"); this.filter.dataset.propertiesFilter = "";
    this.sort.dataset.propertiesSort = ""; this.sort.setAttribute("aria-label", "Sort properties");
    for (const [value, label] of Object.entries(propertySorts)) { this.sort.add(new Option(label, value)); }
    controls.append(this.filter, this.sort);
    if (local) {
      const label = document.createElement("label");
      this.follow.type = "checkbox"; this.follow.dataset.propertiesFollow = ""; label.append(this.follow, "Follow active note"); controls.append(label);
    }
    this.caption.dataset.propertiesFile = "";
    this.caption.className = "discovery-pane-caption";
    this.status.className = "discovery-status"; this.status.setAttribute("role", "status"); this.status.dataset.propertiesStatus = "";
    this.list.className = "properties-pane-list";
    this.metadataEditor = local ? new MetadataEditor(properties, () => this.file, {
      isCurrent: ownedCreationMutation => this.interactive(ownedCreationMutation),
      entries: values => {
        const catalog = this.app.metadataTypeManager.getAllProperties();
        return sortedProperties(Object.entries(values).map(([name, value]) => ({ name, value, occurrences: catalog[name.toLowerCase()]?.occurrences ?? 1 })), this.options.query, this.options.sort).map(entry => [entry.name, entry.value]);
      },
    }) : null;
    if (this.metadataEditor) { this.list.append(this.metadataEditor.contentEl); }
    this.contentEl.append(controls, this.caption, this.list, this.status);
    this.registerDomEvent(this.filter, "input", () => {
      const query = this.filter.value;
      this.run(() => { this.options.query = query; this.changed(true); });
    });
    this.registerDomEvent(this.sort, "change", () => {
      const sort = this.sort.value;
      this.run(() => { this.options.sort = propertiesPaneState({ sort }).sort; this.changed(true); });
    });
    this.registerDomEvent(this.follow, "change", () => {
      const follow = this.follow.checked;
      this.run(() => { this.options.followActiveFile = follow; this.syncTarget(); this.changed(); });
    });
    for (const reference of [
      this.app.metadataTypeManager.on("changed", () => this.schedule()),
      this.properties.on("changed", () => this.schedule()),
      this.app.workspace.on("file-open", () => { this.syncTarget(); this.schedule(); }),
      this.app.workspace.on("active-leaf-change", () => { this.syncTarget(); this.schedule(); }),
      this.app.workspace.on("editor-change", () => this.schedule()),
      this.app.workspace.on("layout-ready", () => { this.syncTarget(); this.schedule(); }),
      this.app.workspace.on("layout-change", () => { this.updateControls(); this.schedule(); }),
      this.app.core.on("changed", () => this.schedule()),
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile && this.options.file === oldPath && this.owned()) { this.options.file = file.path; this.changed(); }
      }),
      this.app.vault.on("delete", () => this.schedule()),
    ]) { this.registerEvent(reference); }
    this.register(() => { this.generation++; this.rendered = null; });
  }
  getViewType(): string { return this.local ? "file-properties" : "all-properties"; }
  getDisplayText(): string { return this.local ? "File properties" : "All properties"; }
  get file(): TFile | null { return this.local && this.options.file ? this.app.vault.getFileByPath(this.options.file) : null; }
  setFile(file: TFile): void {
    if (!this.local || !this.interactive() || !(file instanceof TFile) || file.extension.toLowerCase() !== "md" || this.app.vault.getFileByPath(file.path) !== file) {
      throw new Error("Set a live File properties pane to a current Markdown note after current operations finish.");
    }
    this.options.file = file.path; this.options.followActiveFile = false; this.changed(true);
  }
  override getState(): Record<string, unknown> {
    const { query, sort, file, followActiveFile, expandedProperties } = this.options;
    return { ...super.getState(), query, sort, ...(this.local ? { file, followActiveFile } : { expandedProperties: [...expandedProperties] }) };
  }
  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    const state = copyViewData(value), options = propertiesPaneState(state);
    if (!this.owned()) { throw new Error("Set state on a current Properties workspace pane."); }
    await super.setState(state, result);
    this.options = options; this.generation++; this.rendered = null; this.schedule(true);
  }

  protected override async onOpen(): Promise<void> {
    if (this.local) {
      this.actions.set("add", this.addAction("plus", "Add property", () => this.run(() => {
        const file = this.file; if (!file) { throw new Error("Open a Markdown note before adding properties."); }
        this.properties.editDialog(file);
      })));
      this.actions.set("pin", this.addAction("pin", "Pin or follow file properties", () => this.run(() => {
        this.options.followActiveFile = !this.options.followActiveFile; this.syncTarget(); this.changed();
      })));
    }
    this.actions.set("refresh", this.addAction("refresh", "Reload property types and notes", () => this.run(async () => {
      await this.app.metadataTypeManager.initialize(); await this.app.metadataCache.refresh();
    })));
    this.syncTarget(); this.schedule();
  }
  private owned(): boolean { return this.isLoaded && Boolean(this.sourceRoot) && this.sourceRoot === this.app.vault.rootPath && this.leaf.view === this && this.containerEl.isConnected; }
  private interactive(ownedCreationMutation = false): boolean {
    return this.owned() && !this.app.changingVault && !this.app.core.busy && !this.properties.busy && this.app.core.isEnabled("properties")
      && (ownedCreationMutation || !this.app.workspace.isChangingFiles) && !this.app.workspace.isChangingLayout;
  }
  private run(action: () => unknown): void {
    if (!this.interactive()) { return; }
    this.app.core.run(() => { if (this.interactive()) { return action(); } }).catch(error => {
      if (this.owned()) { this.status.textContent = error instanceof Error ? error.message : String(error); } reportError(error);
    });
  }
  private syncTarget(): void {
    if (!this.local || !this.owned() || !this.options.followActiveFile) { return; }
    const file = this.properties.currentFile();
    if (file && this.app.vault.getFileByPath(file.path) === file && file.path !== this.options.file) { this.options.file = file.path; this.changed(true); }
  }
  private changed(force = false): void { this.generation++; this.rendered = null; this.save(); this.schedule(force); }
  private save(): void { if (this.owned()) { this.app.workspace.requestSaveLayout().catch(reportError); } }
  private schedule(force = false): void {
    if (force) { this.rendered = null; }
    this.forceRender ||= force;
    if (this.queued) { return; } this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      const redraw = this.forceRender; this.forceRender = false;
      if (this.owned()) { this.render(redraw); }
    });
  }
  private updateControls(): void {
    const enabled = this.interactive();
    this.filter.disabled = this.sort.disabled = this.follow.disabled = !enabled;
    this.filter.value = this.options.query; this.sort.value = this.options.sort; this.follow.checked = this.options.followActiveFile;
    for (const [name, action] of this.actions) {
      if (action instanceof HTMLButtonElement) { action.disabled = !enabled || name === "add" && (this.app.vault.readOnly || !this.file); }
    }
    this.actions.get("pin")?.setAttribute("aria-pressed", String(!this.options.followActiveFile));
    this.list.inert = !enabled;
  }

  private render(force = false): void {
    this.syncTarget(); this.updateControls();
    try {
      if (this.local) {
        this.caption.dataset.propertiesFile = this.options.file ?? "";
        this.caption.textContent = this.options.file ? this.options.file + (this.options.followActiveFile ? "" : " (pinned)") : "Open a Markdown note to view its properties.";
        const file = this.file;
        if (!file || file.extension.toLowerCase() !== "md") {
          this.metadataEditor!.contentEl.hidden = true;
          this.status.textContent = this.options.file ? "This Markdown note is missing or unavailable: " + this.options.file : "";
        } else {
          this.metadataEditor!.contentEl.hidden = false; this.metadataEditor!.render(force);
          this.status.textContent = this.app.vault.readOnly ? "This vault is read-only. Property values cannot be changed." : "";
        }
        return;
      }
      const catalog = this.app.metadataTypeManager.getAllProperties();
      const entries = sortedProperties(Object.values(catalog), this.options.query, this.options.sort);
      const documents = this.app.metadataCache.getDocuments();
      const state = { ...this.options, entries, files: documents.map(entry => [entry.document.file.path, entry.text]), readOnly: this.app.vault.readOnly };
      if (this.rendered && sameValue(this.rendered, state)) { return; }
      this.rendered = structuredClone(state);
      this.generation++;
      this.list.replaceChildren();
      this.caption.textContent = `${Object.keys(catalog).length} distinct vault properties`;
      this.status.textContent = this.app.vault.lazy ? "Partial index: the property catalog covers only notes opened so far." : this.app.vault.indexComplete ? "Complete index: the property catalog covers every cached note." : "";
      for (const entry of entries) {
        const key = entry.name.toLowerCase(), generation = this.generation;
        const row = document.createElement("div");
        row.className = "property-row";
        row.dataset.propertyName = entry.name;
        const name = document.createElement("strong");
        name.textContent = entry.name;
        const value = document.createElement("span");
        value.className = "property-value";
        value.textContent = `${entry.occurrences} notes`;
        value.dataset.propertyValue = "";
        row.append(name, value);
        const button = (action: string, label: string, callback: () => unknown): HTMLButtonElement => {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.propertyAction = action;
          button.textContent = label;
          this.registerRowEvent(button, "click", row, generation, callback);
          row.append(button);
          return button;
        };
        const types = document.createElement("select");
        types.dataset.propertyType = entry.name;
        types.setAttribute("aria-label", "Global property type for " + entry.name);
        for (const type of [...propertyTypes, ...(propertyTypes.some(type => type === entry.widget) ? [] : [entry.widget])]) { types.add(new Option(type, type)); }
        types.value = entry.widget;
        const fixed = ["aliases", "tags", "cssclasses"].includes(key);
        types.disabled = this.app.vault.readOnly || fixed;
        this.registerRowEvent(types, "change", row, generation, async () => {
          try { await this.app.metadataTypeManager.setType(entry.name, types.value); }
          catch (error) { types.value = this.app.metadataTypeManager.getPropertyInfo(entry.name).widget; throw error; }
        });
        row.append(types);
        button("rename", "Rename across vault", () => this.properties.renameDialog(entry.name)).disabled = this.app.vault.readOnly || fixed;
        const expanded = this.options.expandedProperties.includes(key);
        const expand = button("files", expanded ? "Hide notes" : "Show notes", () => {
          const names = new Set(this.options.expandedProperties);
          if (expanded) { names.delete(key); }
          else {
            if (names.size >= 1024) { throw new Error("Collapse a property before expanding more than 1,024 properties."); }
            names.add(key);
          }
          this.options.expandedProperties = [...names]; this.changed();
        });
        expand.setAttribute("aria-expanded", String(expanded));
        this.list.append(row);
        if (expanded) {
          const files = document.createElement("div"); files.className = "property-note-results";
          for (const indexed of documents.filter(document => Object.keys(document.cache.frontmatter ?? {}).some(name => name.toLowerCase() === key)).sort((a, b) => a.document.file.path.localeCompare(b.document.file.path))) {
            const file = this.app.vault.getFileByPath(indexed.document.file.path);
            if (!file) { continue; }
            const result = document.createElement("button"); result.type = "button"; result.textContent = file.path; result.dataset.propertyNote = file.path;
            result.addEventListener("click", event => {
              if (!result.isConnected || generation !== this.generation) { return; }
              this.run(() => this.navigate(file, key, indexed.text, event.ctrlKey || event.metaKey, generation));
            });
            files.append(result);
          }
          this.list.append(files);
        }
      }
    } catch (error) {
      this.rendered = null;
      this.list.replaceChildren();
      const status = document.createElement("p");
      status.className = "plugin-error";
      status.dataset.propertiesError = "";
      status.setAttribute("role", "alert");
      status.textContent = error instanceof Error ? error.message : String(error);
      this.list.append(status);
    }
  }
  private registerRowEvent(control: HTMLElement, event: "click" | "change", row: HTMLElement, generation: number, action: () => unknown): void {
    control.addEventListener(event, () => {
      if (row.isConnected && generation === this.generation) { this.run(() => { if (row.isConnected && generation === this.generation) { return action(); } }); }
    });
  }
  private async navigate(file: TFile, key: string, text: string, newTab: boolean, generation: number): Promise<void> {
    await this.app.metadataCache.refresh();
    if (!this.interactive() || this.generation !== generation || this.app.vault.getFileByPath(file.path) !== file) { return; }
    const entry = this.app.metadataCache.getDocument(file.path);
    if (!entry || entry.missing || entry.text !== text) { this.status.textContent = "The property or note changed. Choose its refreshed result again."; this.schedule(); return; }
    const name = Object.keys(entry.cache.frontmatter ?? {}).find(name => name.toLowerCase() === key);
    const position = name === undefined ? null : frontmatterPropertyPosition(text, name);
    if (!position) { throw new Error("The property no longer has a supported source location. Refresh the catalog."); }
    const leaf = this.app.workspace.getLeaf(newTab ? "tab" : false); await leaf.openFile(file);
    const view = leaf.view;
    if (!this.interactive() || this.app.workspace.activeLeaf !== leaf || !(view instanceof MarkdownView) || view.file !== file) { return; }
    if (view.editor.getValue() !== text) { this.status.textContent = "The note changed before its property could be selected. Choose its refreshed result again."; this.schedule(); return; }
    view.setMode("source"); view.editor.setSelection(position.start, position.end); view.editor.scrollIntoView({ from: position.start, to: position.end }, true); view.focus();
  }
}
