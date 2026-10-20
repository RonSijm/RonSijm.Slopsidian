import { reportError } from "./dom";

export type Modifier = "Mod" | "Ctrl" | "Meta" | "Shift" | "Alt";
export interface Hotkey { modifiers: Modifier[]; key: string }

const MODIFIER_ORDER: readonly Modifier[] = ["Mod", "Ctrl", "Meta", "Alt", "Shift"];
const isMac = (): boolean => /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "");

/** Persistent storage for user overrides; `update` receives the stored object and edits it in place. */
export interface HotkeyStore {
  ready(): boolean;
  read(): Promise<Record<string, unknown>>;
  update(change: (data: Record<string, unknown>) => void): Promise<unknown>;
}

export interface HotkeyHost {
  /** Runs the command when it is registered and available; returns whether it handled the key. */
  dispatch(id: string): boolean;
  isRepeatable?(id: string): boolean;
  isRunnable?(id: string): boolean;
  /** Application commands keep their key even when unavailable, so browser defaults such as Ctrl+S stay suppressed. */
  isApplication?(id: string): boolean;
  /** Whether a command may run while a dialog or modal is open. */
  allowInModal?(id: string): boolean;
  onError?(error: unknown): void;
  store?: HotkeyStore;
}

interface Binding { id: string; hotkey: Hotkey; source: "custom" | "default"; signature: string }

export function normalizeHotkey(value: unknown): Hotkey {
  if (!value || typeof value !== "object") { throw new Error("A hotkey needs a key and supported modifiers."); }
  const { modifiers, key } = value as { modifiers?: unknown; key?: unknown };
  if (typeof key !== "string" || !key || key.length > 64 || /[\x00-\x1f\x7f]/.test(key) || !Array.isArray(modifiers)) { throw new Error("A hotkey needs a key and supported modifiers."); }
  if (modifiers.some(modifier => !MODIFIER_ORDER.includes(modifier as Modifier))) { throw new Error("A hotkey needs a key and supported modifiers."); }
  const unique = MODIFIER_ORDER.filter(modifier => modifiers.includes(modifier));
  return { modifiers: unique, key };
}

/** Platform-aware identity: Mod equals Ctrl (or Meta on macOS) and single-character keys ignore case. */
export function hotkeySignature(hotkey: Hotkey): string {
  const modifiers = hotkey.modifiers.map(modifier => modifier === "Mod" ? isMac() ? "Meta" : "Ctrl" : modifier);
  return [...new Set(modifiers)].sort().join(",") + "|" + (hotkey.key.length === 1 ? hotkey.key.toLowerCase() : hotkey.key);
}

function eventKeys(event: KeyboardEvent): Set<string> {
  const keys = new Set<string>();
  keys.add(event.key.length === 1 ? event.key.toLowerCase() : event.key);
  if (event.code) {
    keys.add(event.code);
    const physical = /^Key([A-Z])$/.exec(event.code)?.[1].toLowerCase() ?? /^Digit(\d)$/.exec(event.code)?.[1];
    if (physical) { keys.add(physical); }
  }
  return keys;
}

function eventSignatures(event: KeyboardEvent): Set<string> {
  const modifiers = ([["Ctrl", event.ctrlKey], ["Meta", event.metaKey], ["Alt", event.altKey], ["Shift", event.shiftKey]] as const).filter(([, down]) => down).map(([name]) => name).sort().join(",");
  return new Set([...eventKeys(event)].map(key => modifiers + "|" + key));
}

export function printHotkey(hotkey: Hotkey): string {
  const names: Record<string, string> = { Mod: isMac() ? "Cmd" : "Ctrl", Meta: isMac() ? "Cmd" : "Win" };
  const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;
  return [...hotkey.modifiers.map(modifier => names[modifier] ?? modifier), key].join("+");
}

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "OS", "CapsLock", "NumLock", "ScrollLock", "Dead", "Process", "Unidentified"]);

/** Captures a pressed combination as a persistable hotkey; null while only modifiers are held. */
export function hotkeyFromEvent(event: KeyboardEvent): Hotkey | null {
  if (MODIFIER_KEYS.has(event.key) || event.isComposing) { return null; }
  const mac = isMac();
  const modifiers: Modifier[] = [];
  if (event.ctrlKey) { modifiers.push(mac ? "Ctrl" : "Mod"); }
  if (event.metaKey) { modifiers.push(mac ? "Mod" : "Meta"); }
  if (event.altKey) { modifiers.push("Alt"); }
  if (event.shiftKey) { modifiers.push("Shift"); }
  const physical = /^Key([A-Z])$/.exec(event.code)?.[1].toLowerCase() ?? /^Digit(\d)$/.exec(event.code)?.[1];
  const key = event.key === " " ? "Space" : modifiers.length && physical ? physical : event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return normalizeHotkey({ modifiers, key });
}

const copyHotkeys = (hotkeys: readonly Hotkey[]): Hotkey[] => hotkeys.map(hotkey => ({ modifiers: [...hotkey.modifiers], key: hotkey.key }));

export class HotkeyManager {
  /** Plugin and application defaults, keyed by command identifier, in registration order. */
  readonly defaultKeys: Record<string, Hotkey[]> = Object.create(null);
  /** User overrides; an empty list disables every default for that command. */
  customKeys: Record<string, Hotkey[]> = Object.create(null);
  bakedHotkeys: Hotkey[] = [];
  bakedIds: string[] = [];
  loadError: Error | null = null;
  private bindings: Binding[] = [];
  private readonly dirty = new Set<string>();
  private foreign: Record<string, unknown> = Object.create(null);
  private epoch = 0;
  private saving: Promise<void> = Promise.resolve();
  private readonly host: HotkeyHost;

  constructor(dispatch: ((id: string) => boolean) | HotkeyHost) {
    this.host = typeof dispatch === "function" ? { dispatch } : dispatch;
  }

  addDefaultHotkeys(id: string, hotkeys: Hotkey[]): void {
    if (typeof id !== "string" || !id || !Array.isArray(hotkeys)) { throw new Error("Default hotkeys need a command identifier and bindings."); }
    const copy = hotkeys.map(normalizeHotkey);
    delete this.defaultKeys[id];
    this.defaultKeys[id] = copy;
    this.bake();
  }

  removeDefaultHotkeys(id: string): void {
    if (id in this.defaultKeys) { delete this.defaultKeys[id]; this.bake(); }
  }

  getDefaultHotkeys(id: string): Hotkey[] { return copyHotkeys(this.defaultKeys[id] ?? []); }

  /** The user override for a command, or undefined when it follows its defaults. */
  getHotkeys(id: string): Hotkey[] | undefined {
    return id in this.customKeys ? copyHotkeys(this.customKeys[id]) : undefined;
  }

  /** The bindings that currently fire for a command: its override when present, otherwise its defaults. */
  getActiveHotkeys(id: string): Hotkey[] { return copyHotkeys(this.customKeys[id] ?? this.defaultKeys[id] ?? []); }

  setHotkeys(id: string, hotkeys: Hotkey[]): void {
    if (typeof id !== "string" || !id || !Array.isArray(hotkeys)) { throw new Error("Hotkeys need a command identifier and bindings."); }
    this.customKeys[id] = hotkeys.map(normalizeHotkey);
    delete this.foreign[id];
    this.changed(id);
  }

  /** Removes the user override so the command follows its defaults again. */
  removeHotkeys(id: string): void {
    if (!(id in this.customKeys) && !(id in this.foreign)) { return; }
    delete this.customKeys[id];
    delete this.foreign[id];
    this.changed(id);
  }

  /** Disables a command's keyboard shortcuts without removing the command. */
  disableHotkeys(id: string): void { this.setHotkeys(id, []); }

  /** Other commands whose active bindings collide with this hotkey. */
  getConflicts(hotkey: Hotkey, exceptId?: string): string[] {
    const signature = hotkeySignature(normalizeHotkey(hotkey));
    return [...new Set(this.bindings.filter(binding => binding.signature === signature && binding.id !== exceptId).map(binding => binding.id))];
  }

  printHotkeyForCommand(id: string): string {
    const hotkey = this.getActiveHotkeys(id)[0];
    return hotkey ? printHotkey(hotkey) : "";
  }

  /** Rebuilds dispatch order: overrides first, then defaults with later registrations ahead of earlier ones. */
  bake(): void {
    const bindings: Binding[] = [];
    const add = (source: Binding["source"], map: Record<string, Hotkey[]>, ids: string[]): void => {
      for (const id of ids) { for (const hotkey of map[id]) { bindings.push({ id, hotkey, source, signature: hotkeySignature(hotkey) }); } }
    };
    add("custom", this.customKeys, Object.keys(this.customKeys).reverse());
    add("default", this.defaultKeys, Object.keys(this.defaultKeys).filter(id => !(id in this.customKeys)).reverse());
    this.bindings = bindings;
    this.bakedHotkeys = copyHotkeys(bindings.map(binding => binding.hotkey));
    this.bakedIds = bindings.map(binding => binding.id);
  }

  /**
   * Runs the first available command bound to the event. While a modal is open only commands the host
   * allows there run; an unavailable application command still consumes its key so the browser default is suppressed.
   */
  handle(event: KeyboardEvent, options: { modal?: boolean } = {}): boolean {
    if (event.defaultPrevented || event.isComposing || !this.bindings.length) { return event.defaultPrevented === true; }
    const signatures = eventSignatures(event);
    const tried = new Set<string>();
    let swallow = false;
    const consume = (): true => { event.preventDefault(); event.stopPropagation(); return true; };
    for (const binding of this.bindings) {
      if (!signatures.has(binding.signature) || tried.has(binding.id)) { continue; }
      if (options.modal && !this.host.allowInModal?.(binding.id)) { continue; }
      tried.add(binding.id);
      if (this.host.isApplication?.(binding.id)) { swallow = true; }
      if (event.repeat && !this.host.isRepeatable?.(binding.id)) {
        if (this.host.isRunnable?.(binding.id) === false) { continue; }
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
      if (this.host.dispatch(binding.id)) { return consume(); }
    }
    return swallow ? consume() : false;
  }

  /** Forgets user overrides when the vault changes; defaults belong to loaded plugins and stay. */
  reset(): void {
    this.epoch++;
    this.customKeys = Object.create(null);
    this.foreign = Object.create(null);
    this.dirty.clear();
    this.loadError = null;
    this.bake();
  }

  async load(): Promise<void> {
    const store = this.host.store;
    if (!store?.ready()) { return; }
    const epoch = this.epoch;
    let data: Record<string, unknown>;
    try { data = await store.read(); }
    catch (error) {
      if (epoch === this.epoch) { this.loadError = error instanceof Error ? error : new Error(String(error)); }
      throw error;
    }
    if (epoch !== this.epoch) { return; }
    const custom: Record<string, Hotkey[]> = Object.create(null), foreign: Record<string, unknown> = Object.create(null);
    for (const [id, value] of Object.entries(data)) {
      try {
        if (!Array.isArray(value)) { throw new Error("Hotkeys must be a list."); }
        custom[id] = value.map(normalizeHotkey);
      } catch { foreign[id] = value; }
    }
    this.customKeys = custom;
    this.foreign = foreign;
    this.loadError = null;
    this.bake();
  }

  /** Persists pending overrides; resolves when every change made so far is stored or has failed. */
  save(): Promise<void> {
    const store = this.host.store;
    const epoch = this.epoch;
    const run = async (): Promise<void> => {
      if (!this.dirty.size || epoch !== this.epoch) { return; }
      if (!store?.ready()) { throw new Error("Select a vault before saving hotkeys."); }
      if (this.loadError) { throw new Error("The vault's hotkeys file could not be read, so it was not overwritten: " + this.loadError.message); }
      const ids = [...this.dirty];
      const snapshot = new Map(ids.map(id => [id, this.customKeys[id] ? copyHotkeys(this.customKeys[id]) : undefined]));
      await store.update(data => {
        for (const [id, hotkeys] of snapshot) { if (hotkeys) { data[id] = hotkeys; } else { delete data[id]; } }
      });
      if (epoch === this.epoch) {
        for (const id of ids) {
          const current = this.customKeys[id];
          if (JSON.stringify(snapshot.get(id)) === JSON.stringify(current ? copyHotkeys(current) : undefined)) { this.dirty.delete(id); }
        }
      }
    };
    this.saving = this.saving.then(run, run);
    return this.saving;
  }

  private changed(id: string): void {
    this.dirty.add(id);
    this.bake();
    if (this.host.store?.ready()) { this.save().catch(this.host.onError ?? reportError); }
  }
}
