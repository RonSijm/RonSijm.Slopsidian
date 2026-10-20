import type { CorePlugins } from "./core-plugins";
import type { CoreSettingValue } from "./contracts";
import { element } from "./dom";
import type { FileRecovery } from "./file-recovery";
import { clipDefaults } from "./web-clip-policy";
import { readerAppearance } from "./web-reader-appearance";

export class CoreSettings {
  private selected: string | null = null;
  private failure = "";
  private readonly host = element("core-settings-host");

  constructor(private readonly core: CorePlugins) {
    core.on("changed", () => this.render());
    this.render();
  }

  private run(action: () => Promise<void>): void {
    this.failure = "";
    action().catch(error => {
      console.error(error);
      this.failure = error instanceof Error ? error.message : String(error);
      this.render();
    });
  }

  private render(): void {
    this.host.replaceChildren();
    if (this.failure) {
      const error = document.createElement("p");
      error.className = "plugin-error";
      error.id = "core-settings-error";
      error.setAttribute("role", "alert");
      error.textContent = this.failure;
      this.host.appendChild(error);
    }
    if (this.selected && !this.core.isEnabled(this.selected)) {
      this.selected = null;
    }
    if (this.selected) {
      this.renderSettings(this.selected);
      return;
    }
    for (const state of this.core.states) {
      const row = document.createElement("section");
      row.className = "core-plugin-card";
      row.dataset.coreId = state.id;
      row.dataset.enabled = String(this.core.isEnabled(state.id));
      const info = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = state.name;
      const detail = document.createElement("p");
      detail.className = "muted";
      detail.textContent = state.implemented
        ? "Independent implementation; reference compatibility is still being verified."
        : state.id === "webviewer" ? "Available in the desktop application. This browser host cannot embed desktop Web viewer panes."
          : "Not implemented. Existing vault configuration is preserved.";
      info.append(name, detail);
      const actions = document.createElement("div");
      actions.className = "core-plugin-actions";
      const toggle = document.createElement("button");
      toggle.dataset.coreToggle = state.id;
      toggle.setAttribute("role", "switch");
      toggle.setAttribute("aria-checked", String(this.core.isEnabled(state.id)));
      toggle.setAttribute("aria-label", state.name);
      toggle.textContent = this.core.isEnabled(state.id) ? "Disable" : "Enable";
      toggle.disabled = !state.implemented || this.core.busy || !this.core.app.vault.rootPath;
      toggle.addEventListener("click", () => this.run(() => this.core.setEnabled(state.id, !this.core.isEnabled(state.id))));
      actions.appendChild(toggle);
      if (state.settingsSupport === "implemented") {
        const settings = document.createElement("button");
        settings.dataset.coreSettings = state.id;
        settings.textContent = "Settings";
        settings.disabled = !this.core.isEnabled(state.id) || this.core.busy;
        settings.addEventListener("click", () => { this.selected = state.id; this.render(); });
        actions.appendChild(settings);
      } else if (state.implemented && state.settingsSupport === "unimplemented") {
        const pending = document.createElement("span");
        pending.className = "muted";
        pending.textContent = "Settings not implemented";
        actions.appendChild(pending);
      }
      row.append(info, actions);
      this.host.appendChild(row);
    }
  }

  private renderSettings(id: string): void {
    const state = this.core.state(id);
    const back = document.createElement("button");
    back.id = "core-settings-back";
    back.textContent = "Back to core plugins";
    back.addEventListener("click", () => { this.selected = null; this.render(); });
    const title = document.createElement("h3");
    title.textContent = state.name;
    const form = document.createElement("form");
    form.dataset.coreForm = id;
    const inputs = new Map<string, () => CoreSettingValue>();
    for (const field of state.fields) {
      if (field.visible === false) { continue; }
      if (field.type === "commands") {
        inputs.set(field.key, this.renderCommands(form, field.key, state.settings[field.key]));
        continue;
      }
      const label = document.createElement("label");
      label.className = "core-setting-field";
      const text = document.createElement("span");
      text.textContent = field.label;
      if (field.type === "select") {
        if (!field.options?.length) { throw new Error("The setting has no available choices: " + field.key); }
        const select = document.createElement("select");
        select.dataset.coreField = field.key;
        select.disabled = this.core.busy;
        for (const value of field.options) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = value[0].toUpperCase() + value.slice(1);
          select.append(option);
        }
        select.value = String(state.settings[field.key]);
        inputs.set(field.key, () => select.value);
        label.append(text, select);
        form.append(label);
        continue;
      }
      const input = document.createElement("input");
      input.type = field.type;
      input.dataset.coreField = field.key;
      input.disabled = this.core.busy;
      if (field.type === "number" || field.type === "range") {
        input.required = true;
        input.step = String(field.step ?? "any");
        input.min = String(field.minimum ?? (field.key === "keepDays" ? 1 : 0));
        input.max = String(field.maximum ?? (field.key === "keepDays" ? 3650 : 10080));
      }
      if (field.type === "checkbox") {
        input.checked = state.settings[field.key] === true;
      } else {
        input.value = String(state.settings[field.key]);
      }
      inputs.set(field.key, () => input.type === "checkbox" ? input.checked : input.type === "number" || input.type === "range" ? Number(input.value) : input.value);
      label.append(text, input);
      if (field.type === "range") {
        const value = document.createElement("output");
        const reset = document.createElement("button");
        reset.type = "button";
        reset.textContent = "Restore default";
        reset.dataset.coreReset = field.key;
        reset.disabled = this.core.busy;
        const update = (): void => { value.textContent = input.value; reset.hidden = Number(input.value) === 0; };
        input.addEventListener("input", update);
        reset.addEventListener("click", () => { input.value = "0"; update(); });
        update();
        label.append(value, reset);
      }
      form.appendChild(label);
    }
    if (id === "webviewer") {
      const font = form.querySelector<HTMLSelectElement>('[data-core-field="readerFont"]');
      const customFont = form.querySelector<HTMLInputElement>('[data-core-field="readerCustomFont"]');
      const fontLabel = customFont?.closest("label");
      if (font && customFont && fontLabel) {
        const savedCustomFont = readerAppearance(state.settings).readerCustomFont;
        customFont.required = true; customFont.maxLength = 100; customFont.placeholder = "For example, Arial";
        const update = (): void => { fontLabel.hidden = font.value !== "custom"; customFont.disabled = this.core.busy || fontLabel.hidden; };
        font.addEventListener("change", update);
        inputs.set("readerCustomFont", () => font.value === "custom" ? customFont.value : savedCustomFont);
        update();
      }
      const width = form.querySelector<HTMLSelectElement>('[data-core-field="readerWidth"]');
      const custom = form.querySelector<HTMLInputElement>('[data-core-field="readerCustomWidth"]');
      const label = custom?.closest("label");
      if (width && custom && label) {
        const savedCustomWidth = readerAppearance(state.settings).readerCustomWidth;
        const update = (): void => { label.hidden = width.value !== "custom"; custom.disabled = this.core.busy || label.hidden; };
        width.addEventListener("change", update);
        inputs.set("readerCustomWidth", () => width.value === "custom" ? Number(custom.value) : savedCustomWidth);
        update();
      }
    }
    if (id === "canvas") {
      const location = form.querySelector<HTMLSelectElement>('[data-core-field="newFileLocation"]');
      const folder = form.querySelector('[data-core-field="newFileFolderPath"]')?.closest("label");
      if (location && folder) {
        const update = (): void => { folder.hidden = location.value !== "folder"; };
        location.addEventListener("change", update);
        update();
      }
    }
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "mod-cta";
    save.dataset.coreSave = id;
    save.disabled = this.core.busy;
    save.textContent = "Save settings";
    form.appendChild(save);
    form.addEventListener("submit", event => {
      event.preventDefault();
      const values = Object.fromEntries([...inputs].map(([key, read]) => [key, read()]));
      this.run(async () => {
        if (id === "webviewer") { clipDefaults(values); readerAppearance(values); }
        await this.core.saveSettings(id, values);
      });
    });
    this.host.append(back, title, form);
    if (id === "file-recovery") {
      const history = document.createElement("button");
      history.textContent = "View recovery history";
      history.dataset.recoverySettingsHistory = "";
      history.disabled = this.core.busy;
      history.addEventListener("click", () => { (this.core.getEnabledPluginById(id) as FileRecovery | null)?.openModal(); });
      this.host.append(history);
    }
  }

  private renderCommands(parent: HTMLElement, key: string, value: unknown): () => CoreSettingValue {
    if (value !== null && (!Array.isArray(value) || !value.every(id => typeof id === "string"))) {
      throw new Error("Pinned commands must be an array of command identifiers or null.");
    }
    const pinned: string[] = value === null ? [] : [...value];
    const container = document.createElement("div");
    container.className = "core-command-list";
    container.dataset.coreField = key;
    const title = document.createElement("h4");
    title.textContent = "Pinned commands";
    const list = document.createElement("div");
    const add = document.createElement("div");
    add.className = "core-command-add";
    const input = document.createElement("input");
    input.dataset.coreCommandInput = "";
    input.setAttribute("aria-label", "Command to pin");
    input.setAttribute("list", "core-command-options");
    input.placeholder = "Choose a command...";
    input.disabled = this.core.busy;
    input.addEventListener("input", () => input.setCustomValidity(""));
    const options = document.createElement("datalist");
    options.id = "core-command-options";
    const render = (): void => {
      list.replaceChildren();
      options.replaceChildren();
      const commands = this.core.app.commands.listCommands();
      pinned.forEach((id, index) => {
        const row = document.createElement("div");
        row.className = "core-command-row";
        row.dataset.corePinned = id;
        const name = document.createElement("span");
        name.textContent = commands.find(command => command.id === id)?.name ?? `${id} (unavailable)`;
        const button = (text: string, action: string, disabled: boolean, callback: () => void): HTMLButtonElement => {
          const result = document.createElement("button");
          result.type = "button";
          result.dataset.corePinAction = action;
          result.textContent = text;
          result.setAttribute("aria-label", `${text}: ${name.textContent}`);
          result.disabled = disabled || this.core.busy;
          result.addEventListener("click", () => { callback(); render(); });
          return result;
        };
        row.append(name,
          button("Move up", "up", index === 0, () => { [pinned[index - 1], pinned[index]] = [pinned[index], pinned[index - 1]]; }),
          button("Move down", "down", index === pinned.length - 1, () => { [pinned[index], pinned[index + 1]] = [pinned[index + 1], pinned[index]]; }),
          button("Remove", "remove", false, () => { pinned.splice(index, 1); }));
        list.appendChild(row);
      });
      if (!pinned.length) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "No pinned commands.";
        list.appendChild(empty);
      }
      commands.filter(command => !pinned.includes(command.id)).sort((left, right) => left.name.localeCompare(right.name)).forEach(command => {
        const option = document.createElement("option");
        option.value = command.id;
        option.label = command.name;
        options.appendChild(option);
      });
    };
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.dataset.corePinAdd = "";
    addButton.textContent = "Add";
    addButton.disabled = this.core.busy;
    addButton.addEventListener("click", () => {
      const command = this.core.app.commands.listCommands().find(command => command.id === input.value || command.name === input.value);
      if (!command || pinned.includes(command.id)) {
        input.setCustomValidity(command ? "This command is already pinned." : "Choose a registered command.");
        input.reportValidity();
        return;
      }
      pinned.push(command.id);
      input.value = "";
      render();
    });
    add.append(input, options, addButton);
    container.append(title, list, add);
    parent.appendChild(container);
    render();
    return () => pinned.length ? [...pinned] : null;
  }
}
