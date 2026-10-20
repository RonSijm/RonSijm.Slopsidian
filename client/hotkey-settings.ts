import type { App } from "./app";
import { reportError } from "./dom";
import { hotkeyFromEvent, hotkeySignature, printHotkey, type Hotkey } from "./hotkeys";
import { SettingTab } from "./settings";
import { ButtonComponent, Setting } from "./ui";

interface HotkeyRow { id: string; name: string; loaded: boolean; enabled: boolean }

export class HotkeySettings extends SettingTab {
  private status = "";
  private statusKind: "info" | "error" = "info";
  private query = "";
  private recording: { id: string; stop: () => void } | null = null;
  private listEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private generation = 0;

  constructor(app: App) {
    super(app);
    this.containerEl.dataset.hotkeySettings = "";
    app.registerLeaveGuard(() => this.closeSettings());
  }

  async open(container: HTMLElement): Promise<void> {
    await this.closeSettings();
    container.replaceChildren(this.containerEl);
    await this.showSettings();
  }

  override display(): void {
    this.cancelRecording();
    const generation = ++this.generation;
    this.containerEl.replaceChildren();
    const manager = this.app.hotkeyManager;
    if (manager.loadError) {
      const warning = this.containerEl.createDiv({ cls: "setting-item-description", text: "This vault's hotkeys file could not be read, so changes are kept for this session only and the file is never overwritten: " + manager.loadError.message });
      warning.dataset.hotkeyLoadError = "";
    }
    new Setting(this.containerEl)
      .setName("Filter commands")
      .setDesc("Search by command name, identifier or current shortcut.")
      .addText(text => {
        text.setPlaceholder("Filter commands").setValue(this.query).onChange(value => { this.query = value; this.renderList(); });
        text.inputEl.dataset.hotkeyFilter = "";
      })
      .addButton(button => {
        button.setButtonText("Restore all defaults").setWarning().onClick(() => this.restoreAll());
        button.buttonEl.dataset.hotkeyRestoreAll = "";
      });
    this.statusEl = this.containerEl.createDiv({ cls: "setting-item-description" });
    this.statusEl.dataset.hotkeyStatus = "";
    this.statusEl.setAttribute("role", "status");
    this.listEl = this.containerEl.createDiv();
    this.listEl.dataset.hotkeyList = "";
    this.renderStatus();
    if (generation === this.generation) { this.renderList(); }
  }

  override hide(): void { this.cancelRecording(); }

  private rows(): HotkeyRow[] {
    const manager = this.app.hotkeyManager;
    const rows = this.app.commands.status().map(command => ({ ...command, loaded: true }));
    const known = new Set(rows.map(row => row.id));
    for (const id of Object.keys(manager.customKeys)) {
      if (!known.has(id)) { rows.push({ id, name: id, loaded: false, enabled: false }); }
    }
    const query = this.query.trim().toLowerCase();
    return rows
      .filter(row => !query || row.name.toLowerCase().includes(query) || row.id.toLowerCase().includes(query) || manager.getActiveHotkeys(row.id).some(hotkey => printHotkey(hotkey).toLowerCase().includes(query)))
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  }

  private renderList(): void {
    if (!this.listEl) { return; }
    this.cancelRecording();
    const rows = this.rows();
    this.listEl.replaceChildren();
    if (!rows.length) { this.listEl.createDiv({ cls: "setting-item-description", text: "No commands match." }); }
    for (const row of rows) { this.renderRow(this.listEl, row); }
  }

  private renderRow(container: HTMLElement, row: HotkeyRow): void {
    const manager = this.app.hotkeyManager;
    const override = manager.getHotkeys(row.id);
    const active = manager.getActiveHotkeys(row.id);
    const state = override === undefined ? "Default" : override.length ? "Customized" : "Disabled";
    const setting = new Setting(container).setName(row.name);
    setting.settingEl.dataset.hotkeyCommand = row.id;
    setting.settingEl.dataset.hotkeyState = state.toLowerCase();
    const notes: string[] = [row.id, state];
    if (!row.loaded) { notes.push("Command is not loaded (its plugin may be disabled); the saved shortcut is kept"); }
    else if (!row.enabled) { notes.push("Not available in the current context"); }
    setting.setDesc(notes.join(" · "));
    if (!row.loaded) { setting.descEl.dataset.hotkeyAvailability = "not-loaded"; }
    else { setting.descEl.dataset.hotkeyAvailability = row.enabled ? "available" : "unavailable"; }

    const chips = setting.controlEl.createDiv({ cls: "setting-hotkey-list" });
    for (const hotkey of active) {
      const chip = chips.createSpan({ cls: "setting-hotkey" });
      chip.dataset.hotkeyChip = hotkeySignature(hotkey);
      chip.createSpan({ text: printHotkey(hotkey) });
      const remove = new ButtonComponent(chip).setIcon("x").setTooltip("Remove hotkey " + printHotkey(hotkey));
      remove.buttonEl.classList.add("clickable-icon");
      remove.buttonEl.dataset.hotkeyRemove = hotkeySignature(hotkey);
      remove.onClick(() => this.apply(() => manager.setHotkeys(row.id, active.filter(candidate => hotkeySignature(candidate) !== hotkeySignature(hotkey))), `Removed ${printHotkey(hotkey)} from ${row.name}.`));
      const others = manager.getConflicts(hotkey, row.id);
      if (others.length) {
        const names = others.map(id => this.app.commands.commands[id]?.name ?? id).join(", ");
        const warning = setting.descEl.createDiv({ cls: "mod-warning", text: `${printHotkey(hotkey)} is also used by: ${names}` });
        warning.dataset.hotkeyCollision = hotkeySignature(hotkey);
      }
    }
    if (!active.length) { chips.createSpan({ cls: "setting-hotkey-empty", text: override ? "Disabled" : "Blank" }); }

    new ButtonComponent(setting.controlEl).setIcon("plus").setTooltip("Customize this hotkey").onClick(() => this.record(row, active, setting));
    setting.controlEl.lastElementChild?.setAttribute("data-hotkey-record", "");
    const disable = new ButtonComponent(setting.controlEl).setButtonText("Disable").setTooltip("Disable all shortcuts for this command").setDisabled(override !== undefined && !override.length || override === undefined && !active.length);
    disable.buttonEl.dataset.hotkeyDisable = "";
    disable.onClick(() => this.apply(() => manager.disableHotkeys(row.id), `Disabled shortcuts for ${row.name}.`));
    const restore = new ButtonComponent(setting.controlEl).setButtonText("Restore default").setTooltip("Return to the built-in or plugin-provided shortcuts").setDisabled(override === undefined);
    restore.buttonEl.dataset.hotkeyRestore = "";
    restore.onClick(() => this.apply(() => manager.removeHotkeys(row.id), `Restored the default shortcuts for ${row.name}.`));
  }

  private record(row: HotkeyRow, active: Hotkey[], setting: Setting): void {
    this.cancelRecording();
    const button = setting.controlEl.querySelector<HTMLButtonElement>("[data-hotkey-record]");
    if (!button) { return; }
    const original = button.innerHTML;
    button.textContent = "Press keys… (Esc cancels)";
    button.classList.add("mod-recording");
    button.dataset.hotkeyRecording = "";
    const finish = (): void => {
      button.removeEventListener("keydown", onKey, true);
      button.removeEventListener("blur", onBlur);
      button.classList.remove("mod-recording");
      delete button.dataset.hotkeyRecording;
      button.innerHTML = original;
      if (this.recording?.stop === finish) { this.recording = null; }
    };
    const onBlur = (): void => { finish(); };
    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) { finish(); return; }
      const hotkey = hotkeyFromEvent(event);
      if (!hotkey) { return; }
      finish();
      if (active.some(candidate => hotkeySignature(candidate) === hotkeySignature(hotkey))) {
        this.setStatus(`${printHotkey(hotkey)} is already assigned to ${row.name}.`, "error");
        return;
      }
      const conflicts = this.app.hotkeyManager.getConflicts(hotkey, row.id).map(id => this.app.commands.commands[id]?.name ?? id);
      const warning = conflicts.length ? ` It is also used by: ${conflicts.join(", ")}.` : "";
      this.apply(() => this.app.hotkeyManager.setHotkeys(row.id, [...active, hotkey]), `Assigned ${printHotkey(hotkey)} to ${row.name}.${warning}`);
    };
    button.addEventListener("keydown", onKey, true);
    button.addEventListener("blur", onBlur);
    button.focus();
    this.recording = { id: row.id, stop: finish };
  }

  private cancelRecording(): void { this.recording?.stop(); this.recording = null; }

  private restoreAll(): void {
    const manager = this.app.hotkeyManager;
    const ids = Object.keys(manager.customKeys);
    this.apply(() => ids.forEach(id => manager.removeHotkeys(id)), ids.length ? `Restored the default shortcuts for ${ids.length} command${ids.length === 1 ? "" : "s"}.` : "No customized shortcuts to restore.");
  }

  private apply(change: () => void, message: string): void {
    const generation = this.generation;
    try { change(); }
    catch (error) { this.setStatus(error instanceof Error ? error.message : String(error), "error"); return; }
    this.renderList();
    this.setStatus(message, "info");
    this.app.hotkeyManager.save().then(
      () => { if (generation === this.generation) { this.renderStatus(); } },
      error => {
        reportError(error);
        if (generation === this.generation) { this.setStatus("The change is active but could not be saved: " + (error instanceof Error ? error.message : String(error)), "error"); }
      });
  }

  private setStatus(message: string, kind: "info" | "error"): void { this.status = message; this.statusKind = kind; this.renderStatus(); }

  private renderStatus(): void {
    if (!this.statusEl) { return; }
    this.statusEl.textContent = this.status;
    this.statusEl.classList.toggle("mod-warning", this.statusKind === "error");
    this.statusEl.dataset.hotkeyStatusKind = this.statusKind;
  }
}
