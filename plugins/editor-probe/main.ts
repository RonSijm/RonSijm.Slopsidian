import { FileSystemAdapter, Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, ViewUpdate, type DecorationSet } from "@codemirror/view";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function decorate(view: EditorView): DecorationSet {
  const ranges = new RangeSetBuilder<Decoration>();
  const text = view.state.doc.toString();
  for (const match of text.matchAll(/\bTODO\b/g)) {
    ranges.add(match.index, match.index + 4, Decoration.mark({ class: "prototype-todo" }));
  }
  return ranges.finish();
}

export default class EditorProbe extends Plugin {
  onload(): void {
    let modifications = 0;
    const status = this.addStatusBarItem();
    status.setText("Modify events: 0");
    this.registerEvent(this.app.vault.on("modify", () => {
      modifications++;
      status.setText(`Modify events: ${modifications}`);
    }));
    this.registerEditorExtension(ViewPlugin.fromClass(class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = decorate(view); }
      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = decorate(update.view);
        }
      }
    }, { decorations: instance => instance.decorations }));
    this.addCommand({
      id: "open-in-tab",
      name: "Open active note in a new WorkspaceLeaf tab",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
          throw new Error("Open a note before creating a workspace tab.");
        }
        const leaf = this.app.workspace.getLeaf("tab");
        if (!(leaf instanceof WorkspaceLeaf)) {
          throw new Error("The host did not supply its shared WorkspaceLeaf class.");
        }
        await leaf.openFile(file);
        new Notice("WorkspaceLeaf opened the note in a new tab.");
      },
    });
    this.addCommand({
      id: "read-through-node",
      name: "Read active note through Node",
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        const adapter = this.app.vault.adapter;
        if (!file || !(adapter instanceof FileSystemAdapter)) {
          throw new Error("A desktop vault and active file are required.");
        }
        const content = readFileSync(join(adapter.getBasePath(), file.path), "utf8");
        new Notice(`Node read succeeded: ${Buffer.byteLength(content, "utf8")} bytes`);
      },
    });
  }
}
