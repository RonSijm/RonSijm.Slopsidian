import moment from "moment";
import type { App, Command } from "./app";
import type { CorePlugins } from "./core-plugins";
import { HostError } from "./contracts";
import { element, reportError } from "./dom";
import { iconButton } from "./icons";
import type { Editor } from "./editor";
import type { MarkdownView } from "./workspace";
import { Notice } from "./ui";
import { TFile, TFolder } from "./vault";

export function expandTemplate(content: string, title: string, now: moment.Moment, dateFormat = "YYYY-MM-DD", timeFormat = "HH:mm"): string {
  return content.replace(/\{\{\s*(title|date|time)(?::([^}\r\n]+))?\s*\}\}/g, (literal, variable: string, format: string | undefined) => {
    if (variable === "title") {
      return format ? literal : title;
    }
    return now.format(format?.trim() || (variable === "date" ? dateFormat : timeFormat));
  });
}

export class CoreNotes {
  private closePicker: (() => void) | null = null;

  constructor(private readonly app: App) {}

  register(core: CorePlugins): void {
    const register = (id: string, commands: Command[], cleanup?: () => void): void => {
      core.register(id, () => {
        const scoped = commands.map(command => {
          const callback = command.callback;
          const editorCallback = command.editorCallback;
          return {
            ...command,
            callback: callback ? () => core.run(callback) : undefined,
            editorCallback: editorCallback ? (editor: Editor, view: MarkdownView) => core.run(() => editorCallback(editor, view)) : undefined,
          };
        });
        const symbols: Record<string, string> = { "daily-notes": "calendar", templates: "file", "zk-prefixer": "new-note", "random-note": "dice" };
        const ribbon = iconButton(symbols[id], commands[0].name, () => this.app.commands.execute(commands[0].id).catch(reportError));
        ribbon.dataset.coreRibbon = id;
        const parent = element("core-ribbon");
        const removeCommands = this.app.commands.install(scoped);
        parent.appendChild(ribbon);
        return () => {
          removeCommands();
          ribbon.remove();
          cleanup?.();
        };
      });
    };
    register("daily-notes", [
      { id: "daily-notes", name: "Open today's daily note", callback: () => this.openDaily() },
      ...([-1, 1] as const).map(direction => ({
        id: direction < 0 ? "daily-notes:goto-prev" : "daily-notes:goto-next",
        name: direction < 0 ? "Open previous daily note" : "Open next daily note",
        checkCallback: (checking: boolean) => {
          if (!this.currentDailyDate()) {
            return false;
          }
          if (!checking) {
            core.run(() => this.navigateDaily(direction)).catch(reportError);
          }
          return true;
        },
      })),
    ]);
    register("templates", [
      { id: "templates:insert-template", name: "Insert template", editorCallback: () => this.chooseTemplate() },
      { id: "templates:insert-current-date", name: "Insert current date", editorCallback: editor => editor.replaceSelection(moment().format(this.option("templates", "dateFormat", "YYYY-MM-DD"))) },
      { id: "templates:insert-current-time", name: "Insert current time", editorCallback: editor => editor.replaceSelection(moment().format(this.option("templates", "timeFormat", "HH:mm"))) },
    ], () => this.closePicker?.());
    register("zk-prefixer", [
      { id: "zk-prefixer", name: "Create new unique note", callback: () => this.createUnique() },
      { id: "zk-prefixer:insert-unique-link", name: "Insert unique note link", editorCallback: editor => editor.replaceSelection(`[[${this.uniqueName(editor.getSelection())}]]`) },
    ]);
    register("random-note", [{ id: "random-note", name: "Open random note", callback: () => this.openRandom() }]);
  }

  cancelPrompts(): void { this.closePicker?.(); }

  private option(id: string, key: string, fallback = ""): string {
    const value = this.app.core.state(id).settings[key];
    if (typeof value !== "string") {
      throw new Error(`Invalid ${id} setting: ${key}`);
    }
    return value || fallback;
  }

  private requireEnabled(id: string): void {
    if (!this.app.core.isEnabled(id)) {
      throw new Error(`Enable ${id} before using it.`);
    }
  }

  private folder(id: string): string {
    const path = this.option(id, "folder").replaceAll("\\", "/").replace(/\/+$/, "");
    if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFolder)) {
      throw new Error(`The configured folder does not exist: ${path || "/"}`);
    }
    return path ? path + "/" : "";
  }

  private templateFile(path: string): TFile {
    const normalized = path.replaceAll("\\", "/");
    const direct = this.app.vault.getAbstractFileByPath(normalized.endsWith(".md") ? normalized : normalized + ".md");
    if (direct instanceof TFile && direct.extension.toLowerCase() === "md") {
      return direct;
    }
    const candidates = this.app.vault.getMarkdownFiles().filter(file => file.basename.toLocaleLowerCase() === normalized.replace(/\.md$/i, "").toLocaleLowerCase());
    if (candidates.length !== 1) {
      throw new Error(`The template ${path} is ${candidates.length ? "ambiguous; use its full vault path" : "missing"}.`);
    }
    return candidates[0];
  }

  private async initialContent(id: string, title: string, now: moment.Moment): Promise<string> {
    const template = this.option(id, "template");
    return template ? expandTemplate(await this.app.vault.read(this.templateFile(template)), title, now) : "";
  }

  async openDaily(): Promise<void> {
    this.requireEnabled("daily-notes");
    await this.app.saveAll();
    await this.app.vault.refresh();
    const now = moment();
    const title = now.format(this.option("daily-notes", "format", "YYYY-MM-DD")).trim();
    const path = this.folder("daily-notes") + title + ".md";
    const known = this.app.vault.getFiles().find(file => file.path.toLocaleLowerCase() === path.toLocaleLowerCase());
    if (known) {
      await this.app.openFile(known.path);
      return;
    }
    const content = await this.initialContent("daily-notes", title, now);
    try {
      await this.app.vault.create(path, content);
    } catch (error) {
      if (!(error instanceof HostError) || error.status !== 409) {
        throw error;
      }
      await this.app.vault.refresh();
      if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFile)) {
        throw error;
      }
    }
    await this.app.openFile(path);
  }

  private dailyDate(path: string): moment.Moment | null {
    const prefix = this.folder("daily-notes");
    if (!path.startsWith(prefix) || !path.toLowerCase().endsWith(".md")) {
      return null;
    }
    const date = moment(path.slice(prefix.length, -3), this.option("daily-notes", "format", "YYYY-MM-DD"), true);
    return date.isValid() ? date : null;
  }

  private currentDailyDate(): moment.Moment | null {
    if (!this.app.core.isEnabled("daily-notes")) {
      return null;
    }
    const folder = this.option("daily-notes", "folder");
    if (!(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
      return null;
    }
    const file = this.app.workspace.getActiveFile();
    return file ? this.dailyDate(file.path) : null;
  }

  async navigateDaily(direction: -1 | 1): Promise<void> {
    this.requireEnabled("daily-notes");
    const current = this.currentDailyDate();
    if (!current) {
      throw new Error("Open a daily note before navigating by date.");
    }
    await this.app.saveAll();
    await this.app.vault.refresh();
    const candidates = this.app.vault.getMarkdownFiles().map(file => ({ file, date: this.dailyDate(file.path) }))
      .filter((item): item is { file: TFile; date: moment.Moment } => item.date !== null && (item.date.valueOf() - current.valueOf()) * direction > 0);
    candidates.sort((left, right) => (left.date.valueOf() - right.date.valueOf()) * direction);
    if (!candidates.length) {
      new Notice(direction < 0 ? "No previous daily note found." : "No next daily note found.");
      return;
    }
    await this.app.openFile(candidates[0].file.path);
  }

  uniqueName(suffix = ""): string {
    const now = moment();
    const format = this.option("zk-prefixer", "format", "YYYYMMDDHHmm");
    const base = now.format(format);
    const taken = (name: string): boolean => this.app.vault.getFiles().some(file => file.name.toLocaleLowerCase().startsWith(name.toLocaleLowerCase()));
    const initial = base + (suffix ? " " + suffix : "");
    if (!taken(initial)) {
      return initial;
    }
    const units = ["minute", "hour", "day", "week", "month", "year"] as const;
    const step = units.find(unit => now.clone().add(1, unit).format(format) !== base);
    if (step) {
      for (let attempt = 0; attempt <= this.app.vault.getFiles().length; attempt++) {
        const next = now.add(1, step).format(format);
        if (!taken(next)) {
          return next;
        }
      }
    }
    throw new Error("The configured unique prefix format cannot produce an unused note name.");
  }

  async createUnique(): Promise<void> {
    this.requireEnabled("zk-prefixer");
    await this.app.saveAll();
    await this.app.vault.refresh();
    const folder = this.folder("zk-prefixer");
    for (let attempt = 0; attempt < 10; attempt++) {
      const title = this.uniqueName();
      const path = folder + title + ".md";
      const content = await this.initialContent("zk-prefixer", title, moment());
      try {
        await this.app.vault.create(path, content);
      } catch (error) {
        if (!(error instanceof HostError) || error.status !== 409) {
          throw error;
        }
        await this.app.vault.refresh();
        continue;
      }
      await this.app.openFile(path);
      return;
    }
    throw new Error("Other writers repeatedly occupied the generated unique note paths. No existing note was overwritten.");
  }

  async openRandom(): Promise<void> {
    this.requireEnabled("random-note");
    await this.app.saveAll();
    await this.app.vault.refresh();
    const files = this.app.vault.getMarkdownFiles();
    if (!files.length) {
      new Notice("There are no Markdown notes in this vault.");
      return;
    }
    await this.app.openFile(files[Math.floor(Math.random() * files.length)].path);
  }

  private async insertTemplate(file: TFile): Promise<void> {
    const leaf = this.app.workspace.activeLeaf;
    const session = leaf.session;
    if (!session) {
      throw new Error("Open a Markdown note before inserting a template.");
    }
    await this.app.saveAll();
    const source = await this.app.vault.read(file);
    if (leaf.session !== session) {
      throw new Error("The target note changed while the template was loading.");
    }
    const title = session.document.file.basename;
    const content = expandTemplate(source, title, moment(), this.option("templates", "dateFormat", "YYYY-MM-DD"), this.option("templates", "timeFormat", "HH:mm"));
    this.app.markdownView.editor.replaceSelection(content);
    this.app.markdownView.editor.focus();
  }

  private async chooseTemplate(): Promise<void> {
    this.requireEnabled("templates");
    const configured = this.option("templates", "folder");
    if (!configured) {
      throw new Error("Set a template folder in Settings > Core plugins > Templates first.");
    }
    await this.app.vault.refresh();
    const prefix = this.folder("templates");
    const files = this.app.vault.getMarkdownFiles().filter(file => file.path.startsWith(prefix));
    if (!files.length) {
      throw new Error("The configured template folder contains no Markdown templates.");
    }
    this.closePicker?.();
    await new Promise<void>((resolve, reject) => {
      const dialog = document.createElement("dialog");
      dialog.id = "template-picker";
      dialog.className = "picker-dialog";
      const title = document.createElement("h2");
      title.className = "prompt-title";
      title.textContent = "Insert template";
      const input = document.createElement("input");
      input.className = "prompt-input";
      input.setAttribute("aria-label", "Find a template");
      const results = document.createElement("div");
      results.className = "suggestion-container";
      let visible: TFile[] = [];
      let selected = 0;
      let disposed = false;
      const dispose = (): void => {
        if (disposed) {
          return;
        }
        disposed = true;
        dialog.close();
        dialog.remove();
        this.closePicker = null;
      };
      const cancel = (): void => {
        dispose();
        resolve();
      };
      this.closePicker = cancel;
      const choose = (file: TFile): void => {
        if (disposed) {
          return;
        }
        dispose();
        this.insertTemplate(file).then(resolve, reject);
      };
      const render = (): void => {
        visible = files.filter(file => file.path.toLocaleLowerCase().includes(input.value.toLocaleLowerCase()));
        selected = Math.min(selected, Math.max(0, visible.length - 1));
        results.replaceChildren();
        visible.forEach((file, index) => {
          const button = document.createElement("button");
          button.className = "suggestion-item";
          button.classList.toggle("is-selected", index === selected);
          button.dataset.templatePath = file.path;
          button.textContent = file.path.slice(prefix.length, -3);
          button.addEventListener("click", () => choose(file));
          results.appendChild(button);
        });
        if (!visible.length) {
          results.textContent = "No templates found.";
        }
      };
      input.addEventListener("input", () => { selected = 0; render(); });
      input.addEventListener("keydown", event => {
        if (event.key === "Enter" && visible[selected]) {
          event.preventDefault();
          choose(visible[selected]);
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          selected = Math.max(0, Math.min(visible.length - 1, selected + (event.key === "ArrowDown" ? 1 : -1)));
          render();
        }
      });
      dialog.addEventListener("cancel", cancel);
      dialog.addEventListener("close", () => {
        if (!disposed) {
          cancel();
        }
      });
      dialog.append(title, input, results);
      element("desktop-overlays").appendChild(dialog);
      render();
      dialog.showModal();
      input.focus();
    });
  }
}
