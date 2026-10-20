import type { App } from "./app";
import { attachmentPath, recordingFolder } from "./audio-paths";
import type { VaultConfigurationDocument } from "./contracts";
import { SettingTab, type SettingDefinitionItem } from "./settings";

export function validateFileSetting(key: string, value: unknown): void {
  if (key === "newFileLocation") {
    if (!["root", "current", "folder"].includes(String(value)) || typeof value !== "string") { throw new Error("Choose root, current or folder for new notes."); }
  } else if (key === "newLinkFormat") {
    if (!["shortest", "relative", "absolute"].includes(String(value)) || typeof value !== "string") { throw new Error("Choose shortest, relative or absolute link paths."); }
  } else if (key === "trashOption") {
    if (!["local", "system"].includes(String(value)) || typeof value !== "string") { throw new Error("Choose vault trash or system trash for deleted files."); }
  } else if (key === "useMarkdownLinks") {
    if (typeof value !== "boolean") { throw new Error("The Markdown link preference must be Boolean."); }
  } else if (key === "newFileFolderPath") {
    if (typeof value !== "string") { throw new Error("The new-note folder must be a vault path."); }
    if (value !== "/") { attachmentPath(value); }
  } else if (key === "attachmentFolderPath") {
    if (typeof value !== "string") { throw new Error("The attachment folder must be a vault path."); }
    recordingFolder(value, "Folder/Note.md");
  } else { throw new Error("This Files and links setting is not supported: " + key); }
}

export class FileSettings extends SettingTab {
  private document: VaultConfigurationDocument | null = null;
  private writes: Promise<void> = Promise.resolve();
  private saving = 0;
  private unwatch: (() => void) | null = null;

  constructor(app: App) {
    super(app);
    this.containerEl.dataset.fileSettings = "";
    app.registerLeaveGuard(() => this.closeSettings());
  }

  async open(container: HTMLElement): Promise<void> {
    await this.closeSettings();
    this.document = await this.app.configuration.read("app");
    container.replaceChildren(this.containerEl);
    this.unwatch = this.app.configuration.watch("app", accepted => this.adopt(accepted), error => console.error(error));
    await this.showSettings();
  }

  override async closeSettings(): Promise<void> {
    this.unwatch?.(); this.unwatch = null;
    await super.closeSettings();
  }

  private adopt(accepted: VaultConfigurationDocument): void {
    if (!this.unwatch || !this.containerEl.isConnected || this.saving > 0 || this.containerEl.contains(document.activeElement)) { return; }
    if (accepted.root !== this.app.vault.rootPath || accepted.root !== this.document?.root) { return; }
    this.document = accepted;
    this.update();
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    validateFileSetting(key, value);
    const root = this.app.vault.rootPath;
    const save = async (): Promise<void> => {
      const previous = this.document;
      if (!previous || previous.root !== root || root !== this.app.vault.rootPath || this.app.changingVault || !this.containerEl.isConnected) {
        throw new Error("These Files and links settings belong to an inactive vault or page.");
      }
      this.saving++;
      try { this.document = await this.app.configuration.write(previous, { ...previous.data, [key]: value }); } finally { this.saving--; }
    };
    const operation = this.writes.then(save, save);
    this.writes = operation;
    await operation;
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    const valid = (key: string) => (value: string): string | void => {
      try { validateFileSetting(key, value); } catch (error) { return error instanceof Error ? error.message : String(error); }
    };
    return [
      { type: "group", heading: "New notes", items: [
        { name: "Default location for new notes", desc: "Applies to bare note names in New note, Quick switcher and missing links. Explicit folder paths keep their destination.", control: { type: "dropdown", key: "newFileLocation", options: { root: "Vault root", current: "Same folder as the current note", folder: "Specified folder" } } },
        { name: "New note folder", desc: "An existing vault folder, or / for the root. A missing folder falls back to the vault root.", control: { type: "folder", key: "newFileFolderPath", includeRoot: true, disabled: () => this.app.vault.getConfig("newFileLocation") !== "folder", validate: valid("newFileFolderPath") } },
      ] },
      { type: "group", heading: "Links and attachments", items: [
        { name: "New link format", desc: "Used by shared file-link generation and Note composer. Paths remain destination-safe when names are ambiguous.", control: { type: "dropdown", key: "newLinkFormat", options: { shortest: "Shortest path when possible", relative: "Relative path to file", absolute: "Absolute path in vault" } } },
        { name: "Use Markdown links", desc: "Shared link generation uses [text](path) instead of [[path]]. Existing links are not rewritten.", control: { type: "toggle", key: "useMarkdownLinks" } },
        { name: "Attachment folder", desc: "Use / for the root, ./ for the note's folder, ./Attachments for a note-relative subfolder, or a vault folder path. Applies to Attach files and Audio recorder.", control: { type: "text", key: "attachmentFolderPath", validate: valid("attachmentFolderPath") } },
      ] },
      { type: "group", heading: "Deleted files", items: [
        { name: "Deleted files", desc: "Used by the Move current file to trash command. System trash uses the Windows Recycle Bin and is only available in the Windows native host; other hosts refuse it without deleting anything.", control: { type: "dropdown", key: "trashOption", options: { local: "Move to vault .trash", system: "Move to system trash (Windows Recycle Bin)" } } },
      ] },
      { name: "Reload Files and links settings", desc: "Discard this page's old version and read external app.json changes. Existing note bytes are not changed.", action: async () => {
        await Promise.allSettled([this.writes]);
        this.document = await this.app.configuration.read("app");
        this.update();
      } },
    ];
  }
}
