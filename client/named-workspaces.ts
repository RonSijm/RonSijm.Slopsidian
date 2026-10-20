import moment from "moment";
import type { App } from "./app";
import type { CorePlugins } from "./core-plugins";
import { copyViewData, requestJson, type VaultConfigurationDocument, type WorkspaceLayout } from "./contracts";
import { element, reportError } from "./dom";
import { iconButton } from "./icons";
import { Modal } from "./ui";
import { exportObsidianWorkspace, importObsidianWorkspace, workspaceName, workspaceProfiles as profiles } from "./workspace-import";

interface TransferReview {
  original: VaultConfigurationDocument;
  local: VaultConfigurationDocument;
  kind: "import" | "export";
  name?: string;
}

export class NamedWorkspaces {
  readonly id = "workspaces";
  private readonly configurationId = "vault-dotnet-workspaces";
  private document: VaultConfigurationDocument | null = null;
  private modal: Modal | null = null;
  private transfer: TransferReview | null = null;
  busy = false;

  constructor(readonly app: App) {}
  get options(): Record<string, unknown> { return this.app.core.state(this.id).settings; }
  get names(): string[] { return Object.keys(profiles(this.requireDocument().data)).sort((left, right) => left.localeCompare(right)); }
  get active(): string | null {
    const active = this.app.workspace.getViewOptions("named-workspaces").active;
    if (active != null && typeof active !== "string") { throw new Error("The active named workspace must be text."); }
    return typeof active === "string" ? active : null;
  }

  register(core: CorePlugins): void {
    core.register(this.id, async () => {
      this.document = await this.app.configuration.read(this.configurationId);
      profiles(this.document.data);
      const remove = this.app.commands.install([
        { id: "workspaces:open-modal", name: "Manage workspaces", callback: () => core.run(() => this.open()) },
        { id: "workspaces:save", name: "Save current workspace", callback: () => core.run(() => this.open()) },
        { id: "workspaces:load", name: "Load workspace", callback: () => core.run(() => this.open()) },
        { id: "workspaces:import", name: "Import Obsidian workspace", callback: () => this.openTransfer("import") },
      ]);
      const ribbon = iconButton("layout", "Manage workspaces", () => this.app.commands.execute("workspaces:open-modal").catch(reportError));
      ribbon.dataset.coreRibbon = this.id;
      element("core-ribbon").append(ribbon);
      return () => {
        this.modal?.close();
        remove();
        ribbon.remove();
        this.document = null;
        this.transfer = null;
      };
    }, this);
  }

  private requireDocument(): VaultConfigurationDocument {
    if (!this.document) { throw new Error("Enable Workspaces before managing saved layouts."); }
    return this.document;
  }

  private run(action: () => Promise<void>): Promise<void> {
    return this.app.core.run(async () => {
      if (!this.app.core.isEnabled(this.id) || this.busy) {
        throw new Error("Wait for the current workspace operation to finish.");
      }
      this.busy = true;
      try { await action(); }
      finally { this.busy = false; }
    });
  }

  async reload(): Promise<void> {
    await this.run(async () => {
      const document = await this.app.configuration.read(this.configurationId);
      profiles(document.data);
      this.document = document;
    });
  }

  async save(value: string, overwrite = false): Promise<void> {
    const name = workspaceName(value);
    await this.run(async () => {
      await this.app.saveAll();
      await this.app.workspace.whenIdle();
      const document = this.requireDocument();
      const data = copyViewData(document.data, 256);
      const saved = profiles(data);
      if (Object.hasOwn(saved, name) && !overwrite) { throw new Error("This workspace already exists. Select Replace existing workspace to overwrite it."); }
      const prior = Object.hasOwn(saved, name) ? copyViewData(saved[name], 256) : {};
      Object.defineProperty(saved, name, {
        value: { ...prior, ...this.app.workspace.getLayout(), mtime: moment().format() },
        enumerable: true, writable: true, configurable: true,
      });
      data.workspaces = saved;
      this.document = await this.app.configuration.write(document, data);
      this.app.workspace.setViewOptions("named-workspaces", { active: name });
      await this.app.workspace.flushLayout();
    });
  }

  async load(value: string): Promise<void> {
    const name = workspaceName(value);
    await this.run(async () => {
      const saved = profiles(this.requireDocument().data);
      if (!Object.hasOwn(saved, name)) { throw new Error("The named workspace no longer exists: " + name); }
      const layout = copyViewData(saved[name], 256);
      const views = layout.views == null ? {} : copyViewData(layout.views, 256);
      views["named-workspaces"] = { ...copyViewData(views["named-workspaces"]), active: name };
      layout.views = views;
      await this.app.workspace.changeLayout(layout);
    });
  }

  async rename(value: string, nextValue: string): Promise<void> {
    const name = workspaceName(value);
    const next = workspaceName(nextValue);
    await this.run(async () => {
      const document = this.requireDocument();
      const data = copyViewData(document.data, 256);
      const saved = profiles(data);
      if (!Object.hasOwn(saved, name)) { throw new Error("The named workspace no longer exists: " + name); }
      if (name !== next && Object.hasOwn(saved, next)) { throw new Error("Another workspace already uses this name."); }
      const layout = saved[name];
      delete saved[name];
      Object.defineProperty(saved, next, { value: layout, enumerable: true, writable: true, configurable: true });
      data.workspaces = saved;
      this.document = await this.app.configuration.write(document, data);
      if (this.active === name) { this.app.workspace.setViewOptions("named-workspaces", { active: next }); }
      await this.app.workspace.flushLayout();
    });
  }

  async remove(value: string): Promise<void> {
    const name = workspaceName(value);
    await this.run(async () => {
      const document = this.requireDocument();
      const data = copyViewData(document.data, 256);
      const saved = profiles(data);
      if (!Object.hasOwn(saved, name)) { throw new Error("The named workspace no longer exists: " + name); }
      delete saved[name];
      data.workspaces = saved;
      this.document = await this.app.configuration.write(document, data);
      if (this.active === name) { this.app.workspace.setViewOptions("named-workspaces", { active: null }); }
      await this.app.workspace.flushLayout();
    });
  }

  async importOriginal(value: string, target: string, overwrite = false): Promise<void> {
    workspaceName(value);
    const source = value, name = workspaceName(target), review = this.transfer;
    await this.run(async () => {
      await this.checkReview(review, "import");
      const saved = profiles(review!.original.data);
      if (!Object.hasOwn(saved, source)) { throw new Error("The original workspace no longer exists."); }
      const imported = importObsidianWorkspace(saved[source]);
      await this.validate(imported.layout, review!);
      const data = copyViewData(review!.local.data, 256), local = profiles(data);
      if (Object.hasOwn(local, name) && !overwrite) { throw new Error("This workspace already exists. Select Replace existing workspace to overwrite it."); }
      Object.defineProperty(local, name, { value: { ...imported.layout, obsidianImport: { name: source, layout: imported.original } }, enumerable: true, writable: true, configurable: true });
      data.workspaces = local;
      this.document = await this.app.configuration.write(review!.local, data);
      this.transfer = null;
    });
  }

  async exportOriginal(target: string, overwrite = false): Promise<void> {
    const name = workspaceName(target), review = this.transfer;
    await this.run(async () => {
      await this.checkReview(review, "export");
      const saved = profiles(review!.local.data), source = review!.name!;
      if (!Object.hasOwn(saved, source)) { throw new Error("The saved workspace no longer exists."); }
      const layout = copyViewData(saved[source], 256);
      await this.validate(layout, review!);
      const data = copyViewData(review!.original.data, 256), originals = profiles(data);
      if (Object.hasOwn(originals, name) && !overwrite) { throw new Error("This Obsidian workspace already exists. Select Replace existing workspace to overwrite it."); }
      const retained = copyViewData(layout.obsidianImport, 256);
      const template = Object.hasOwn(originals, name) ? originals[name] : retained.layout ?? {};
      Object.defineProperty(originals, name, { value: exportObsidianWorkspace(layout as unknown as WorkspaceLayout, template), enumerable: true, writable: true, configurable: true });
      data.workspaces = originals;
      await this.app.configuration.write(review!.original, data);
      this.transfer = null;
    });
  }

  private async validate(layout: unknown, review: TransferReview): Promise<void> {
    await requestJson(`/api/workspace/validate?root=${encodeURIComponent(review.local.root)}`, "POST", layout);
    if (this.transfer !== review || this.document !== review.local || !this.app.core.isEnabled(this.id)) {
      throw new Error("The workspace review was closed or changed before applying it.");
    }
  }

  private async checkReview(review: TransferReview | null, kind: TransferReview["kind"]): Promise<void> {
    if (!review || review !== this.transfer || review.kind !== kind || review.local !== this.requireDocument()) {
      throw new Error("Open a fresh workspace import/export review before applying it.");
    }
    const current = await this.app.configuration.read("workspaces");
    if (current.root !== review.original.root || current.version !== review.original.version) {
      throw new Error("Obsidian workspaces changed on disk. Close and reopen the review; no profiles were overwritten.");
    }
    const local = await this.app.configuration.read(this.configurationId);
    if (local.root !== review.local.root || local.version !== review.local.version || review !== this.transfer) {
      throw new Error("Saved workspaces changed. Close and reopen the review before applying it.");
    }
  }

  async openTransfer(kind: TransferReview["kind"], name?: string): Promise<void> {
    await this.run(async () => {
      const local = this.requireDocument();
      if (kind === "export" && (!name || !Object.hasOwn(profiles(local.data), name))) { throw new Error("Choose a saved workspace to export."); }
      const original = await this.app.configuration.read("workspaces");
      profiles(original.data);
      this.modal?.close();
      const review: TransferReview = { original, local, kind, name };
      this.transfer = review;
      const modal = new Modal(this.app).setTitle(kind === "import" ? "Import Obsidian workspace" : "Export saved workspace to Obsidian");
      this.modal = modal;
      modal.modalEl.dataset.coreDialog = "workspace-" + kind;
      modal.onClose = () => { if (this.modal === modal) { this.modal = null; } if (this.transfer === review) { this.transfer = null; } };
      const scope = document.createElement("p");
      scope.textContent = kind === "import"
        ? "Copy a named layout from Obsidian. Importing does not change the current panes or the original profiles. Load the copied layout from Manage workspaces."
        : "Export this saved layout to Obsidian's named profiles. Review the destination name before writing. Other profiles and their active selection are preserved.";
      const form = document.createElement("form");
      const source = document.createElement("select");
      source.dataset.workspaceSource = "";
      for (const name of Object.keys(profiles(original.data)).sort((a, b) => a.localeCompare(b))) {
        const option = document.createElement("option"); option.value = name; option.textContent = name; source.append(option);
      }
      const label = (title: string, control: HTMLElement): HTMLLabelElement => { const label = document.createElement("label"); label.append(title, control); return label; };
      if (kind === "import") { form.append(label("Original workspace", source)); }
      const input = document.createElement("input"); input.dataset.workspaceTarget = "";
      input.value = kind === "import" ? source.value : name!;
      const replace = document.createElement("input"); replace.type = "checkbox"; replace.dataset.workspaceTransferOverwrite = "";
      const replaceLabel = label("Replace existing workspace", replace); replaceLabel.className = "workspace-overwrite";
      const preview = document.createElement("div"); preview.dataset.workspaceTransferPreview = ""; preview.setAttribute("aria-live", "polite");
      const apply = document.createElement("button"); apply.type = "submit"; apply.dataset.workspaceTransferApply = ""; apply.textContent = kind === "import" ? "Import layout" : "Export saved layout";
      const describe = (): void => {
        preview.replaceChildren(); apply.disabled = false;
        try {
          if (kind === "import") {
            if (!source.options.length) { throw new Error("No named Obsidian workspaces were found in this vault."); }
            const converted = importObsidianWorkspace(profiles(original.data)[source.value]);
            const summary = document.createElement("p"); summary.textContent = `${converted.leaves} panes. Source/Reading modes, tabs, pins and sidebar state will be copied. Unavailable views retain their saved data.`; preview.append(summary);
            for (const message of converted.warnings) { const note = document.createElement("p"); note.textContent = message; preview.append(note); }
          } else {
            const summary = document.createElement("p"); summary.textContent = "Saved workspace: " + name + ". Current unsaved layout changes are not included. Original view data, floating windows and other unsupported preferences are retained where available."; preview.append(summary);
          }
        } catch (error) { preview.textContent = error instanceof Error ? error.message : String(error); apply.disabled = true; }
      };
      source.addEventListener("change", () => { input.value = source.value; replace.checked = false; describe(); });
      form.append(label("Destination workspace name", input), replaceLabel, preview, apply);
      form.addEventListener("submit", event => {
        event.preventDefault(); if (apply.disabled || modal.contentEl.inert) { return; }
        modal.contentEl.inert = true;
        const operation = kind === "import" ? this.importOriginal(source.value, input.value, replace.checked) : this.exportOriginal(input.value, replace.checked);
        operation.then(() => { if (this.modal === modal) { this.open(); } }, reportError).finally(() => { modal.contentEl.inert = false; });
      });
      const back = document.createElement("button"); back.type = "button"; back.textContent = "Back to saved workspaces"; back.dataset.workspaceTransferBack = ""; back.addEventListener("click", () => this.open());
      modal.contentEl.append(scope, form, back); describe(); modal.open(); input.focus();
    });
  }

  open(): void {
    if (!this.app.core.isEnabled(this.id) || this.app.core.busy || this.busy) { throw new Error("Wait for Workspaces to finish loading."); }
    this.modal?.close();
    const modal = new Modal(this.app).setTitle("Manage workspaces");
    modal.modalEl.dataset.coreDialog = "workspaces";
    modal.modalEl.setAttribute("aria-label", "Manage workspaces");
    modal.onClose = () => { if (this.modal === modal) { this.modal = null; } };
    this.modal = modal;
    const render = (): void => {
      modal.contentEl.replaceChildren();
      const scope = document.createElement("p");
      scope.textContent = "Save layouts for this vault, or import and export named Obsidian workspaces.";
      const form = document.createElement("form");
      const label = document.createElement("label");
      label.textContent = "Workspace name";
      const input = document.createElement("input");
      input.dataset.workspaceName = "";
      input.value = this.active ?? "";
      label.append(input);
      const replaceLabel = document.createElement("label");
      replaceLabel.className = "workspace-overwrite";
      const replace = document.createElement("input");
      replace.type = "checkbox";
      replace.dataset.workspaceOverwrite = "";
      replaceLabel.append(replace, "Replace existing workspace");
      const save = document.createElement("button");
      save.type = "submit";
      save.dataset.namedWorkspaceAction = "save";
      save.textContent = "Save current workspace";
      const version = this.requireDocument().version;
      const perform = (action: () => Promise<void>): void => {
        modal.contentEl.inert = true;
        this.app.core.run(async () => {
          if (this.modal !== modal || this.requireDocument().version !== version) { throw new Error("Saved workspaces changed while this dialog was open. Close and reopen it before editing."); }
          await action();
        }).then(() => { if (this.modal === modal) { render(); } }, reportError).finally(() => { modal.contentEl.inert = false; });
      };
      form.append(label, replaceLabel, save);
      form.addEventListener("submit", event => { event.preventDefault(); perform(() => this.save(input.value, replace.checked)); });
      const list = document.createElement("div");
      list.className = "named-workspace-list";
      for (const name of this.names) {
        const row = document.createElement("div");
        row.className = "named-workspace-row";
        row.dataset.namedWorkspace = name;
        const title = document.createElement("strong");
        title.textContent = name + (this.active === name ? " (active)" : "");
        row.append(title);
        const button = (action: string, title: string, callback: () => Promise<void>): void => {
          const control = document.createElement("button");
          control.type = "button";
          control.dataset.namedWorkspaceAction = action;
          control.textContent = title;
          control.addEventListener("click", () => perform(callback));
          row.append(control);
        };
        button("load", "Load", () => this.load(name));
        button("export", "Export to Obsidian", () => this.openTransfer("export", name));
        button("rename", "Rename to name above", () => this.rename(name, input.value));
        button("remove", "Remove saved layout", () => this.remove(name));
        list.append(row);
      }
      const refresh = document.createElement("button");
      refresh.type = "button";
      refresh.textContent = "Reload profiles from disk";
      refresh.dataset.namedWorkspaceAction = "reload";
      refresh.addEventListener("click", () => perform(() => this.reload()));
      const importButton = document.createElement("button"); importButton.type = "button"; importButton.textContent = "Import Obsidian workspace"; importButton.dataset.namedWorkspaceAction = "import";
      importButton.addEventListener("click", () => perform(() => this.openTransfer("import")));
      modal.contentEl.append(scope, form, list, refresh, importButton);
    };
    render();
    modal.open();
    modal.contentEl.querySelector<HTMLInputElement>("input")?.focus();
  }
}
