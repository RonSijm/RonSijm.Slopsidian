import { Prec, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { App } from "./app";
import { getBrowserHost, type VaultConfigurationDocument } from "./contracts";
import type { Editor } from "./editor";
import { Menu } from "./menu";
import { SettingTab, type SettingDefinitionItem } from "./settings";
import type { MarkdownView } from "./workspace";
import { editorPreference, isEditorPreference, validateEditorPreference } from "./editor-preferences";
import { SpellcheckManagementModal } from "./spellcheck-settings";
import { reportError } from "./dom";

export const SPELLCHECK_CHANNEL = "slopsidian:spellcheck";
export const MAX_SPELLING_SOURCE = 1_048_576;
export function spellcheckPreference(value: unknown): { enabled: boolean; valid: boolean } {
  return { enabled: value === undefined || value === true, valid: value === undefined || typeof value === "boolean" };
}

export function editorSpellcheckEnabled(editor: Editor): boolean {
  const owner = editor.editorComponent;
  if (!owner) { return false; }
  try { return spellcheckPreference(owner.app.configuration.get("app", "spellcheck")).enabled; }
  catch { return false; }
}

type NativeSpelling = { token: string; word: string; suggestions: string[] };
type NativeIpc = Pick<import("electron").IpcRenderer, "invoke">;
function nativeSpellingInDocument(document: Document | undefined): NativeIpc | null {
  if (!document || getBrowserHost()) { return null; }
  try {
    const win = document.defaultView as (Window & { require?: NodeRequire }) | null;
    const load = win?.require ?? (typeof require === "function" ? require : null);
    return load?.("electron").ipcRenderer ?? null;
  } catch { return null; }
}
function nativeSpelling(editor: Editor): NativeIpc | null { return nativeSpellingInDocument(editor.cm.dom.ownerDocument); }

interface SpellingSource {
  editor: Editor; owner: MarkdownView; root: string | null; file: MarkdownView["file"];
  document: Editor["cm"]["state"]["doc"]; text: string; cursor: number; x: number; y: number; time: number;
  native: NativeSpelling | null;
  request: SpellingRequestOwner; generation: number;
}
const contexts = new WeakMap<Editor, SpellingSource>();

/** A superseded asynchronous context may neither open a menu nor clear a newer request. */
export class SpellingRequestOwner {
  private generation = 0;
  private latest: object | null = null;
  invalidate(): number { this.latest = null; return ++this.generation; }
  isCurrent(generation: number): boolean { return generation === this.generation; }
  begin(generation: number): object | null {
    if (generation !== this.generation) { return null; }
    return this.latest = {};
  }
  finish(generation: number, token: object): boolean {
    if (generation !== this.generation || this.latest !== token) { return false; }
    this.latest = null; return true;
  }
}
const requests = new WeakMap<Editor, SpellingRequestOwner>();
export function invalidateEditorSpellcheck(editor: Editor): void { requests.get(editor)?.invalidate(); contexts.delete(editor); }

/** Resolve only the exact native-reported word containing the clicked raw UTF-16 offset. */
export function spellingWordRange(text: string, cursor: number, word: string): { from: number; to: number } | null {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > text.length || text.length > MAX_SPELLING_SOURCE
    || !word || word.length > 256 || /[\s\x00-\x1f\x7f]/u.test(word)) { return null; }
  const letter = /[\p{L}\p{N}\p{M}_]/u;
  for (let from = Math.max(0, cursor - word.length); from <= cursor; from++) {
    const to = from + word.length;
    if (cursor <= to && text.slice(from, to) === word && (!from || !letter.test(Array.from(text.slice(Math.max(0, from - 2), from)).at(-1)!))
      && (to === text.length || !letter.test(String.fromCodePoint(text.codePointAt(to)!)))) { return { from, to }; }
  }
  return null;
}

function current(source: SpellingSource): boolean {
  const { editor, owner } = source, app = owner.app;
  return Boolean(owner.isLoaded && owner.file === source.file && app.vault.rootPath === source.root && source.file
    && app.vault.getFileByPath(source.file.path) === source.file && app.workspace.activeLeaf === owner.leaf
    && owner.getMode() === "source" && editor.cm.state.doc === source.document && editor.cm.dom.isConnected
    && source.request.isCurrent(source.generation) && editorSpellcheckEnabled(editor) && !editor.cm.composing && editor.canReplace());
}

/** Attribute reconfiguration does not replace the document, selection, history or editor. */
export function editorSpellcheck(editor: Editor, enabled: boolean): Extension {
  const request = requests.get(editor) ?? new SpellingRequestOwner(); requests.set(editor, request);
  const generation = request.invalidate(); contexts.delete(editor);
  return [Prec.highest(EditorView.contentAttributes.of(view => ({
    spellcheck: String(enabled && !view.state.readOnly && view.state.facet(EditorView.editable)),
    "data-editor-spellcheck": String(enabled),
  }))), EditorView.domEventHandlers({ contextmenu(event, view) {
    const token = request.begin(generation);
    if (!token) { return false; }
    contexts.delete(editor);
    const owner = editor.editorComponent;
    if (!owner || !enabled || !event.isTrusted || !(event.target instanceof view.dom.ownerDocument.defaultView!.Node)
      || !view.contentDOM.contains(event.target) || !editor.canReplace() || view.composing) { return false; }
    // An actual host browser supplies its own spelling menu. Keep our ordinary
    // plugin/editor menu, with an explicit Alt+right-click escape to that menu.
    if (getBrowserHost() && event.altKey) { event.stopPropagation(); return false; }
    const ipc = nativeSpelling(editor);
    if (!ipc || view.state.doc.length > MAX_SPELLING_SOURCE) { return false; }
    const offset = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (offset === null) { return false; }
    const source: SpellingSource = { editor, owner, root: owner.app.vault.rootPath, file: owner.file, document: view.state.doc,
      text: editor.getValue(), cursor: view.state.sliceDoc(0, offset).length, x: event.clientX, y: event.clientY, time: Date.now(), native: null, request, generation };
    // Let Chromium produce its native dictionary event before the shared menu's
    // preventDefault. Dispatch only that final shared event on the source host;
    // the inner editor's context handlers are not invoked a second time.
    event.stopPropagation();
    void ipc.invoke(SPELLCHECK_CHANNEL, "context", { x: source.x, y: source.y }).then((result: unknown) => {
      if (validNative(result)) { source.native = result; }
    }).catch(error => console.error("Spelling suggestions unavailable:", error)).finally(() => {
      if (!request.finish(generation, token) || !current(source)) { return; }
      contexts.set(editor, source);
      const MenuEvent = view.dom.ownerDocument.defaultView!.MouseEvent;
      owner.sourceEl.dispatchEvent(new MenuEvent("contextmenu", { bubbles: true, cancelable: true, clientX: source.x, clientY: source.y }));
    });
    return false;
  } })];
}

export function refreshEditorSpellcheck(app: App): void {
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    const view = leaf.view as MarkdownView;
    view.editor?.refreshSpellcheck();
  }
}

function validNative(value: unknown): value is NativeSpelling {
  if (!value || typeof value !== "object") { return false; }
  const result = value as Partial<NativeSpelling>;
  return typeof result.token === "string" && /^[a-f0-9]{32}$/.test(result.token) && typeof result.word === "string"
    && result.word.length > 0 && result.word.length <= 256 && Array.isArray(result.suggestions) && result.suggestions.length <= 6
    && result.suggestions.every(text => typeof text === "string" && text.length > 0 && text.length <= 256 && !/[\r\n\x00]/.test(text));
}

/** Installed after Workspace construction. Existing plugin/editor menu sections remain available. */
export function registerEditorSpellcheck(app: App): () => void {
  const menus = app.workspace.on("editor-menu", (menu, editor, info) => {
    if (!(menu instanceof Menu) || !editor || typeof (editor as Editor).refreshSpellcheck !== "function") { return; }
    const api = editor as Editor, source = contexts.get(api);
    contexts.delete(api);
    if (!source || info !== source.owner || Date.now() - source.time > 500 || !current(source)) { return; }
    const ipc = nativeSpelling(api), result = source.native;
    if (!ipc || !result || !spellingWordRange(source.text, source.cursor, result.word)) { return; }
    menu.addItem(root => {
      root.setTitle("Spelling").setSection("spellcheck"); root.dom.dataset.spellingMenu = "";
      const choices = root.setSubmenu();
      if (!result.suggestions.length) { choices.addItem(choice => choice.setTitle("No spelling suggestions").setDisabled(true)); }
      for (const replacement of result.suggestions) {
        choices.addItem(choice => {
          choice.setTitle(replacement).onClick(() => {
            if (!current(source)) { return; }
            const range = spellingWordRange(source.text, source.cursor, result.word);
            if (!range) { return; }
            api.replaceExpected(source.text, range.from, range.to, replacement, "input.spellcheck"); api.focus();
          });
          choice.dom.dataset.spellingReplacement = replacement;
        });
      }
      choices.addItem(choice => choice.setTitle("Add to spelling dictionary").setSection("dictionary").onClick(async () => {
        if (current(source)) { await ipc.invoke(SPELLCHECK_CHANNEL, "add", { token: result.token }); }
      }));
    });
  });
  const commands = app.commands.install([{ id: "editor:toggle-spellcheck", name: "Toggle spellcheck", callback: async () => {
    if (!app.vault.rootPath || app.changingVault) { throw new Error("Open a vault and wait for its transition before changing spellcheck."); }
    await app.configuration.update("app", data => { data.spellcheck = !spellcheckPreference(data.spellcheck).enabled; });
  } }]);
  return () => { app.workspace.offref(menus); commands(); };
}

/** Version-bound app.json controls, using the same owned-page lifecycle as Files and links. */
export class EditorSpellcheckSettings extends SettingTab {
  private document: VaultConfigurationDocument | null = null;
  private writes: Promise<void> = Promise.resolve();
  private saving = 0;
  private unwatch: (() => void) | null = null;
  private generation = 0;
  private nativeDialog: SpellcheckManagementModal | null = null;
  private closingPage: Promise<void> = Promise.resolve();

  constructor(app: App) {
    super(app); this.containerEl.dataset.editorSettings = "";
    app.registerLeaveGuard(() => this.closeSettings());
  }
  async open(container: HTMLElement): Promise<void> {
    const generation = ++this.generation, root = this.app.vault.rootPath;
    await this.closeOwnedPage();
    if (generation !== this.generation || !container.isConnected) { return; }
    const accepted = await this.app.configuration.read("app");
    if (generation !== this.generation || !container.isConnected || accepted.root !== root || root !== this.app.vault.rootPath) { return; }
    this.document = accepted;
    container.replaceChildren(this.containerEl);
    this.unwatch = this.app.configuration.watch("app", accepted => {
      if (generation !== this.generation || !this.unwatch || !this.containerEl.isConnected || this.saving || this.containerEl.contains(this.containerEl.ownerDocument.activeElement)
        || accepted.root !== this.app.vault.rootPath || accepted.root !== this.document?.root) { return; }
      this.document = accepted; this.update();
    }, error => console.error(error));
    await this.showSettings();
  }
  override async closeSettings(): Promise<void> {
    this.generation++;
    await this.closeOwnedPage();
  }
  private closeOwnedPage(): Promise<void> {
    const dialog = this.nativeDialog, writes = this.writes; this.nativeDialog = null; dialog?.close();
    this.unwatch?.(); this.unwatch = null;
    this.document = null;
    const operation = (this.closingPage ?? Promise.resolve()).then(async () => {
      await dialog?.whenIdle(); await Promise.allSettled([writes]); await super.closeSettings();
    });
    this.closingPage = operation.catch(() => {}); return operation;
  }
  private async openSpellingManagement(): Promise<void> {
    const generation = this.generation, root = this.document?.root, previous = this.nativeDialog;
    const current = (): boolean => generation === this.generation && Boolean(this.unwatch && this.document && this.containerEl.isConnected
      && root === this.document.root && root === this.app.vault.rootPath && !this.app.changingVault);
    if (!current()) { return; }
    if (previous?.isOpen) { previous.modalEl.focus(); return; }
    await previous?.whenIdle();
    const ipc = nativeSpellingInDocument(this.containerEl.ownerDocument);
    if (!current() || !ipc || this.nativeDialog !== previous) { return; }
    const dialog = new SpellcheckManagementModal(this.app, (operation, request) => ipc.invoke(SPELLCHECK_CHANNEL, operation, request),
      () => current() && this.nativeDialog === dialog, () => refreshEditorSpellcheck(this.app));
    this.nativeDialog = dialog; dialog.open();
  }
  override getControlValue(key: string): unknown {
    if (key === "spellcheck") { return spellcheckPreference(this.document?.data.spellcheck).enabled; }
    if (!isEditorPreference(key)) { throw new Error("This editor preference is not supported."); }
    return editorPreference(key, this.document?.data[key]).value;
  }
  override async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "spellcheck") {
      if (typeof value !== "boolean") { throw new Error("Spellcheck must be Boolean."); }
    } else { validateEditorPreference(key, value); }
    const root = this.app.vault.rootPath, generation = this.generation;
    const save = async (): Promise<void> => {
      const previous = this.document;
      if (!previous || !this.unwatch || generation !== this.generation || previous.root !== root || root !== this.app.vault.rootPath || this.app.changingVault || !this.containerEl.isConnected) {
        throw new Error("These Editor settings belong to an inactive vault or page.");
      }
      this.saving++;
      try {
        const accepted = await this.app.configuration.write(previous, { ...previous.data, [key]: value });
        if (generation === this.generation && root === this.app.vault.rootPath) { this.document = accepted; }
      }
      finally { this.saving--; }
    };
    const operation = this.writes.then(save, save); this.writes = operation; await operation;
  }
  override getSettingDefinitions(): SettingDefinitionItem[] {
    const valid = spellcheckPreference(this.document?.data.spellcheck).valid;
    const desc = (key: "showLineNumber" | "lineWrap" | "readableLineLength" | "useTab" | "tabSize" | "foldHeading" | "foldIndent" | "autoPairBrackets" | "autoPairMarkdown" | "smartIndentList", text: string): string =>
      (editorPreference(key, this.document?.data[key]).valid ? "" : "The saved value is invalid; the default is used until you choose a valid value. ") + text;
    return [
      { name: "Spellcheck", desc: (valid ? "" : "The saved value is invalid; spellcheck is disabled until you choose a Boolean value. ")
        + "Check spelling in Source and Live Preview using the host's available dictionaries. On desktop, right-click a marked word and open Spelling. In a browser, Alt+right-click opens its spelling menu. Dictionary availability and languages are controlled by your host.", control: { type: "toggle", key: "spellcheck", defaultValue: true } },
      { name: "Spellcheck languages and dictionary", disabled: !nativeSpellingInDocument(this.containerEl.ownerDocument), desc: nativeSpellingInDocument(this.containerEl.ownerDocument)
        ? "Manage spelling languages for this app profile and review custom words. On Windows, adding or removing words also changes the operating system dictionary."
        : "Spelling languages and custom words are managed by your browser. Use its spelling settings and menu.",
        render: setting => {
          setting.settingEl.dataset.spellingManagementEntry = "true";
          setting.addButton(button => {
            button.setButtonText("Manage").setDisabled(!nativeSpellingInDocument(this.containerEl.ownerDocument)).onClick(() => { void this.openSpellingManagement().catch(reportError); });
            button.buttonEl.dataset.spellingManagementOpen = "true";
          });
        } },
      { name: "Show line numbers", desc: desc("showLineNumber", "Display source line numbers in Source and Live Preview."), control: { type: "toggle", key: "showLineNumber", defaultValue: false } },
      { name: "Wrap long lines", desc: desc("lineWrap", "Wrap long source lines to fit the editor width. Turning this off allows horizontal scrolling."), control: { type: "toggle", key: "lineWrap", defaultValue: true } },
      { name: "Readable line length", desc: desc("readableLineLength", "Limit the source editor's text width using the theme's file line width. Applies to Source and Live Preview."), control: { type: "toggle", key: "readableLineLength", defaultValue: true } },
      { name: "Automatic bracket pairs", desc: desc("autoPairBrackets", "Insert matching brackets and quotes as you type in Source and Live Preview. Backspace can remove an empty pair, and typing its generated closing character moves past it. Turning this off retains existing note text."), control: { type: "toggle", key: "autoPairBrackets", defaultValue: true } },
      { name: "Automatic Markdown pairs", desc: desc("autoPairMarkdown", "Pair asterisks and underscores for emphasis. In inline prose, type two tildes or equals signs for strikethrough or highlight pairs. Wrap a supported single-line selection one marker at a time, or skip generated closing markers. Brackets and quotes follow Automatic bracket pairs."), control: { type: "toggle", key: "autoPairMarkdown", defaultValue: true } },
      { name: "Continue lists and quotes", desc: desc("smartIndentList", "Continue supported Markdown list and quote markers on Enter in Source and Live Preview. Turning this off uses an ordinary newline with indentation; manual indentation keeps its existing behavior."), control: { type: "toggle", key: "smartIndentList", defaultValue: true } },
      { name: "Fold headings", desc: desc("foldHeading", "Allow heading sections to collapse in Source, Live Preview and Reading. Turning this off expands heading folds immediately; other folds and note text are retained."), control: { type: "toggle", key: "foldHeading", defaultValue: true } },
      { name: "Fold lists", desc: desc("foldIndent", "Allow Markdown list items to collapse in Source, Live Preview and Reading. Reading folds hide nested child lists. Turning this off expands list folds immediately; code and other section folds are retained."), control: { type: "toggle", key: "foldIndent", defaultValue: true } },
      { name: "Indent using tabs", desc: desc("useTab", "Indent commands and automatic indentation use a tab character when enabled, or spaces matching Tab size when disabled. Existing indentation is retained."), control: { type: "toggle", key: "useTab", defaultValue: false } },
      { name: "Tab size", desc: desc("tabSize", "Display tabs at this width and use this many spaces for new indentation when tabs are disabled. Choose an integer from 2 to 8."), control: { type: "number", key: "tabSize", min: 2, max: 8, step: 1, defaultValue: 4,
        validate: value => Number.isInteger(value) ? undefined : "Tab size must be an integer from 2 to 8." } },
      { name: "Reload Editor settings", desc: "Read external app.json changes without changing note text, selection or Undo history.", action: async () => {
        const generation = this.generation, root = this.document?.root;
        await Promise.allSettled([this.writes]);
        const accepted = await this.app.configuration.read("app");
        if (generation !== this.generation || !this.unwatch || !this.containerEl.isConnected || root !== this.app.vault.rootPath || accepted.root !== root) { return; }
        this.document = accepted; this.update();
      } },
    ];
  }
}
