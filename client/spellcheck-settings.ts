import type { App } from "./app";
import { Modal } from "./ui";

export const MAX_MANAGED_SPELLING_LANGUAGES = 8;
export const MAX_MANAGED_SPELLING_WORDS = 10_000;
const MAX_WORD_CHARACTERS = 1_048_576;
export interface SpellingManagementState {
  readonly token: string;
  readonly supported: readonly string[];
  readonly languages: readonly string[];
  readonly words: readonly string[];
  readonly canSetLanguages: boolean;
  readonly canManageWords: boolean;
  readonly osSharedDictionary: boolean;
  readonly maxLanguages: number;
  readonly maxWords: number;
}
export type SpellingManagementInvoke = (operation: string, request: Record<string, unknown>) => Promise<unknown>;

export function validSpellingWord(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\s\x00-\x1f\x7f]/u.test(value);
}
export function validSpellingLanguages(value: unknown, supported: readonly string[]): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_MANAGED_SPELLING_LANGUAGES
    && new Set(value).size === value.length && value.every(language => typeof language === "string" && supported.includes(language));
}
export function spellingManagementState(value: unknown): SpellingManagementState {
  if (!value || typeof value !== "object") { throw new Error("The host returned unavailable spelling controls."); }
  const data = value as SpellingManagementState;
  const codes = (values: unknown, maximum: number): values is string[] => Array.isArray(values) && values.length <= maximum
    && new Set(values).size === values.length && values.every(code => typeof code === "string" && code.length <= 48 && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(code));
  if (typeof data.token !== "string" || !/^[a-f0-9]{32}$/.test(data.token) || !codes(data.supported, 256)
    || !codes(data.languages, MAX_MANAGED_SPELLING_LANGUAGES) || data.languages.some(language => !data.supported.includes(language))
    || !Array.isArray(data.words) || data.words.length > MAX_MANAGED_SPELLING_WORDS || new Set(data.words).size !== data.words.length
    || data.words.some(word => !validSpellingWord(word)) || data.words.reduce((sum, word) => sum + word.length, 0) > MAX_WORD_CHARACTERS
    || typeof data.canSetLanguages !== "boolean" || typeof data.canManageWords !== "boolean" || typeof data.osSharedDictionary !== "boolean"
    || data.maxLanguages !== MAX_MANAGED_SPELLING_LANGUAGES || data.maxWords !== MAX_MANAGED_SPELLING_WORDS) {
    throw new Error("The host returned unsupported spelling controls. Reload to try again.");
  }
  return Object.freeze({ ...data, supported: Object.freeze([...data.supported]), languages: Object.freeze([...data.languages]), words: Object.freeze([...data.words]) });
}

/** Owns async replies and accepted writes independently of the modal's DOM lifetime. */
export class SpellingManagementSession {
  private generation = 0;
  private closed = false;
  private readonly pending = new Set<Promise<unknown>>();
  private draining: Promise<void> | null = null;
  private accepted: SpellingManagementState | null = null;
  get state(): SpellingManagementState | null { return this.accepted; }
  get busy(): boolean { return this.pending.size > 0; }
  constructor(private readonly invoke: SpellingManagementInvoke, private readonly current: () => boolean,
    private readonly update: (resetLanguages: boolean) => void, private readonly error: (message: string) => void,
    private readonly mutated: () => void) {}
  private available(): boolean { return !this.closed && this.current(); }
  async reload(): Promise<boolean> {
    if (!this.available()) { return false; }
    const generation = ++this.generation; this.accepted = null;
    return this.track(async () => {
      const value = await this.invoke("management/read", {});
      if (!this.available() || generation !== this.generation) { return false; }
      this.accepted = spellingManagementState(value); this.error(""); this.update(true); return true;
    }, generation);
  }
  async change(operation: "languages" | "add" | "remove", value: unknown): Promise<boolean> {
    const data = this.accepted;
    if (!this.available() || this.busy || !data) { return false; }
    if (operation === "languages" ? !data.canSetLanguages || !validSpellingLanguages(value, data.supported)
      : !data.canManageWords || !validSpellingWord(value)) {
      this.error(operation === "languages" ? "Choose one to eight different supported languages." : "Use one word of up to 256 characters without spaces."); return false;
    }
    const generation = this.generation;
    return this.track(async () => {
      if (!this.available() || generation !== this.generation || this.accepted !== data) { return false; }
      try {
        const result = await this.invoke("management/" + operation, { token: data.token, ...(operation === "languages" ? { languages: value } : { word: value }) });
        const accepted = spellingManagementState(result);
        // Drain dispatched work after closing without reviving an obsolete page.
        if (!this.available() || generation !== this.generation) { return false; }
        this.accepted = accepted; this.error(""); this.update(operation === "languages"); return true;
      } catch (error) {
        if (this.available() && generation === this.generation) { this.accepted = null; }
        throw new Error((error instanceof Error ? error.message : String(error)) + " The change could not be confirmed and may already have been applied. Reload spelling controls before trying again.");
      } finally {
        // Native writes can succeed before their following dictionary read fails.
        // Every dispatched attempt therefore invalidates retained editor contexts.
        this.mutated();
      }
    }, generation);
  }
  private async track(action: () => Promise<boolean>, generation: number): Promise<boolean> {
    const operation = Promise.resolve().then(action); this.pending.add(operation); this.update(false);
    try { return await operation; }
    catch (error) { if (this.available() && generation === this.generation) { this.error(error instanceof Error ? error.message : String(error)); } return false; }
    finally { this.pending.delete(operation); if (this.available()) { this.update(false); } }
  }
  close(): Promise<void> {
    if (this.draining) { return this.draining; }
    this.closed = true; this.generation++; this.accepted = null;
    this.draining = (async () => {
      while (this.pending.size) { await Promise.allSettled([...this.pending]); }
      try { await this.invoke("management/release", {}); } catch { /* An already-gone owning window has no usable controls. */ }
    })();
    return this.draining;
  }
  whenIdle(): Promise<void> { return this.draining ?? Promise.allSettled([...this.pending]).then(() => {}); }
}

/** Explicit app-profile controls; custom-word changes may also affect Windows. */
export class SpellcheckManagementModal extends Modal {
  private readonly management: SpellingManagementSession;
  private readonly languages = document.createElement("div");
  private readonly languageFilter = document.createElement("input");
  private readonly selected = document.createElement("p");
  private readonly apply = document.createElement("button");
  private readonly wordFilter = document.createElement("input");
  private readonly wordInput = document.createElement("input");
  private readonly add = document.createElement("button");
  private readonly list = document.createElement("div");
  private readonly summary = document.createElement("p");
  private readonly status = document.createElement("p");
  private readonly reload = document.createElement("button");
  private readonly listeners = new AbortController();
  private chosen = new Set<string>();
  private initialized = false;
  private message = "Loading the app profile's spelling preferences…";

  constructor(app: App, invoke: SpellingManagementInvoke, private readonly pageCurrent: () => boolean, changed: () => void) {
    super(app); this.setTitle("Spellcheck languages and dictionary"); this.modalEl.dataset.spellingManagementDialog = "true";
    const intro = document.createElement("p"); intro.textContent = "Language choices apply to this app profile across vaults and are restored after restart. Dictionary availability and downloads are provided by the host.";
    const languageTitle = document.createElement("h3"); languageTitle.textContent = "Spellcheck languages";
    this.languageFilter.type = "search"; this.languageFilter.placeholder = "Filter languages"; this.languageFilter.setAttribute("aria-label", "Filter spelling languages"); this.languageFilter.maxLength = 64;
    this.languageFilter.dataset.spellingLanguageFilter = "true"; this.languageFilter.spellcheck = false;
    Object.assign(this.languages.style, { maxHeight: "170px", overflow: "auto", padding: "6px", border: "1px solid var(--background-modifier-border)" });
    this.languages.dataset.spellingLanguageList = "true";
    this.apply.type = "button"; this.apply.textContent = "Apply languages"; this.apply.dataset.spellingLanguagesApply = "true";
    const dictionaryTitle = document.createElement("h3"); dictionaryTitle.textContent = "Custom dictionary";
    const boundary = document.createElement("p"); boundary.textContent = "On Windows, adding or removing a custom word also changes the operating system dictionary. Other applications may use that dictionary. Notes and vault settings are unchanged.";
    boundary.dataset.spellingOsBoundary = "true";
    this.wordFilter.type = "search"; this.wordFilter.placeholder = "Find custom words"; this.wordFilter.setAttribute("aria-label", "Find custom dictionary words"); this.wordFilter.maxLength = 128; this.wordFilter.spellcheck = false;
    this.wordFilter.dataset.spellingWordFilter = "true";
    this.wordInput.type = "text"; this.wordInput.placeholder = "One new word"; this.wordInput.setAttribute("aria-label", "New custom dictionary word"); this.wordInput.maxLength = 256; this.wordInput.spellcheck = false; this.wordInput.dataset.spellingWordInput = "true";
    this.add.type = "button"; this.add.textContent = "Add word"; this.add.dataset.spellingWordAdd = "true";
    Object.assign(this.list.style, { maxHeight: "150px", overflow: "auto" }); this.list.dataset.spellingWordList = "true";
    const addRow = document.createElement("div"); Object.assign(addRow.style, { display: "flex", flexWrap: "wrap", gap: "8px", marginBlock: "8px" });
    Object.assign(this.wordInput.style, { flex: "1 1 180px", minWidth: "0" }); addRow.append(this.wordInput, this.add);
    this.status.setAttribute("role", "status"); this.status.setAttribute("aria-live", "polite"); this.status.dataset.spellingManagementStatus = "true";
    this.reload.type = "button"; this.reload.textContent = "Reload spelling controls"; this.reload.dataset.spellingManagementReload = "true";
    this.contentEl.append(intro, languageTitle, this.languageFilter, this.selected, this.languages, this.apply, dictionaryTitle, boundary, this.summary, this.wordFilter, this.list, addRow, this.status, this.reload);
    this.management = new SpellingManagementSession(invoke, () => this.available(), reset => this.render(reset), message => { this.message = message; this.status.textContent = message; }, changed);
    const listen = (element: HTMLElement, type: string, action: () => void) => element.addEventListener(type, () => { if (this.available()) { action(); } }, { signal: this.listeners.signal });
    listen(this.languageFilter, "input", () => this.render(false)); listen(this.wordFilter, "input", () => this.renderWords()); listen(this.wordInput, "input", () => this.renderButtons());
    listen(this.apply, "click", () => { void this.management.change("languages", [...this.chosen]); });
    listen(this.add, "click", () => { if (validSpellingWord(this.wordInput.value)) { void this.management.change("add", this.wordInput.value).then(changed => { if (changed && this.available()) { this.wordInput.value = ""; this.renderButtons(); } }); } });
    listen(this.reload, "click", () => { if (!this.management.busy) { void this.management.reload(); } });
  }
  private available(): boolean { return this.isOpen && this.pageCurrent() && this.modalEl.isConnected; }
  override onOpen(): void { this.render(false); void this.management.reload(); }
  override onClose(): void { this.listeners.abort(); void this.management.close(); }
  whenIdle(): Promise<void> { return this.management.whenIdle(); }
  private render(resetLanguages: boolean): void {
    if (!this.available()) { return; }
    const data = this.management?.state;
    if (data && (resetLanguages || !this.initialized)) { this.chosen = new Set(data.languages); this.initialized = true; }
    this.languages.replaceChildren();
    if (data) {
      const query = this.languageFilter.value.toLowerCase();
      for (const code of data.supported.filter(code => code.toLowerCase().includes(query))) {
        const label = document.createElement("label"), control = document.createElement("input"); control.type = "checkbox"; control.checked = this.chosen.has(code); control.dataset.spellingLanguage = code;
        control.disabled = this.management.busy || !data.canSetLanguages; Object.assign(label.style, { display: "flex", alignItems: "center", gap: "8px", paddingBlock: "3px" });
        control.addEventListener("change", () => {
          if (!this.available() || this.management.busy || this.management.state !== data || !control.isConnected || !this.languages.contains(control)) { return; }
          if (control.checked) { this.chosen.add(code); } else { this.chosen.delete(code); } this.renderButtons();
        }, { signal: this.listeners.signal });
        label.append(control, document.createTextNode(code)); this.languages.append(label);
      }
      this.summary.textContent = data.canManageWords ? `${data.words.length} custom words in this app profile. Enter text below to review matching words.`
        : "Custom dictionary management is unavailable on this host. Use its spelling settings.";
      if (data.canManageWords) { this.modalEl.dataset.spellingManagedWords = String(data.words.length); } else { delete this.modalEl.dataset.spellingManagedWords; }
      this.modalEl.dataset.spellingCanManageWords = String(data.canManageWords); this.modalEl.dataset.spellingCanSetLanguages = String(data.canSetLanguages);
    }
    this.status.textContent = this.message; this.renderWords(); this.renderButtons();
  }
  private renderButtons(): void {
    const data = this.management?.state, busy = this.management?.busy ?? true;
    this.selected.textContent = data && !data.canSetLanguages ? "Language management is unavailable on this host. Use its spelling settings."
      : "Selected: " + ([...this.chosen].join(", ") || "none") + ` (up to ${MAX_MANAGED_SPELLING_LANGUAGES}).`;
    const changed = Boolean(data && JSON.stringify([...this.chosen]) !== JSON.stringify(data.languages));
    this.apply.disabled = busy || !data?.canSetLanguages || !validSpellingLanguages([...this.chosen], data.supported) || !changed;
    this.add.disabled = busy || !data?.canManageWords || !validSpellingWord(this.wordInput.value) || data.words.includes(this.wordInput.value);
    this.reload.disabled = busy; this.wordInput.disabled = busy || !data?.canManageWords; this.languageFilter.disabled = busy || !data?.canSetLanguages; this.wordFilter.disabled = busy || !data?.canManageWords;
  }
  private renderWords(): void {
    this.list.replaceChildren(); const data = this.management?.state, filter = this.wordFilter.value.toLowerCase();
    if (data && !data.canManageWords) { const text = document.createElement("p"); text.textContent = "Custom dictionary management is unavailable on this host."; this.list.append(text); return; }
    if (!data || !filter) { const text = document.createElement("p"); text.textContent = "Enter text to find custom words."; this.list.append(text); return; }
    const matches = data.words.filter(word => word.toLowerCase().includes(filter)), visible = matches.slice(0, 50);
    for (const word of visible) {
      const row = document.createElement("div"), label = document.createElement("span"), remove = document.createElement("button");
      Object.assign(row.style, { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", paddingBlock: "4px" });
      label.textContent = word; label.style.overflowWrap = "anywhere"; remove.type = "button"; remove.textContent = "Remove"; remove.setAttribute("aria-label", "Remove " + word + " from the custom dictionary"); remove.disabled = this.management.busy || !data.canManageWords;
      remove.addEventListener("click", () => { if (this.available() && row.isConnected && this.management.state === data && !this.management.busy) { void this.management.change("remove", word); } }, { signal: this.listeners.signal });
      row.append(label, remove); this.list.append(row);
    }
    const count = document.createElement("p"); count.textContent = matches.length ? `Showing ${visible.length} of ${matches.length} matching words.` : "No matching custom words."; this.list.append(count);
  }
}
