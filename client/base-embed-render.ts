import type { App } from "./app";
import { allTags } from "./markdown";
import { inferPropertyType } from "./property-types";
import { baseProperty, type BaseCell, type BaseColumn, type BaseFile } from "./bases-model";

/** One bounded metadata snapshot shared by standalone and embedded Bases queries. */
export function baseQueryFiles(app: App): BaseFile[] {
  const files = app.vault.getFiles();
  if (files.length > 10000) { throw new Error("Bases currently supports at most 10,000 files per query."); }
  let remaining = 8 * 1024 * 1024;
  return files.map(file => {
    const indexed = app.metadataCache.getDocument(file.path);
    const original = indexed?.cache.frontmatter ?? {};
    const properties: Record<string, unknown> = Object.create(null);
    let propertyBudget = 4096;
    const copy = (value: unknown, depth = 0): unknown => {
      remaining -= 16;
      if (remaining < 0) { throw new Error("Bases metadata exceeds the supported 8 MiB query input limit."); }
      if (--propertyBudget < 0 || depth > 24) { throw new Error("A note's properties exceed the supported size/nesting limit."); }
      if (typeof value === "string") { remaining -= value.length * 2; if (value.length > 65536) { throw new Error("A property string exceeds 65,536 characters."); } }
      if (Array.isArray(value)) { if (value.length > 1024) { throw new Error("A property list exceeds 1,024 values."); } return value.map(item => copy(item, depth + 1)); }
      if (value && typeof value === "object") { return Object.fromEntries(Object.entries(value).map(([key, item]) => { remaining -= key.length * 2 + 16; return [key, copy(item, depth + 1)]; })); }
      return value;
    };
    let metadataError = indexed?.cache.errors.join("\n") || (file.extension.toLowerCase() === "md" && !indexed ? "The Markdown file has not been indexed." : "");
    try { for (const [key, value] of Object.entries(original)) { remaining -= key.length * 2 + 32; properties[key] = copy(value); } }
    catch (error) { metadataError = error instanceof Error ? error.message : String(error); }
    const tags = indexed ? allTags(indexed.cache) : [];
    const links = indexed?.outgoing.flatMap(reference => reference.destination ? [reference.destination.path] : []) ?? [];
    remaining -= file.path.length * 2 + 128 + [...tags, ...links].reduce((size, value) => size + value.length * 2 + 16, 0);
    if (remaining < 0) { throw new Error("Bases metadata exceeds the supported 8 MiB query input limit."); }
    const localTypes = Object.fromEntries(Object.keys(properties).map(key => [key.toLowerCase(), app.metadataTypeManager.getAssignedWidget(key) ?? inferPropertyType(properties[key])]));
    return {
      path: file.path, name: file.name, basename: file.basename, extension: file.extension, stat: { ...file.stat },
      properties, types: localTypes, tags, links, ...(metadataError ? { metadataError } : {}),
    };
  });
}

export interface BaseValueActions {
  current(node: HTMLButtonElement): boolean;
  open(link: string): void;
  /** Absent in a read-only embed: values remain literal text, with no mutation controls. */
  edit?(path: string, property: string): void;
  readOnly?: boolean;
}

/** Literal values and link/error presentation are shared by every Bases surface. */
export function renderBaseValue(container: HTMLElement, column: BaseColumn, path: string, value: BaseCell, actions: BaseValueActions): void {
  const doc = container.ownerDocument ?? document;
  if (value.error) { container.textContent = "#ERROR"; container.title = value.error; container.classList.add("bases-cell-error"); return; }
  if (value.link) {
    const button = doc.createElement("button"); button.type = "button"; button.className = "bases-file-link"; button.textContent = value.text || value.link; button.dataset.basesLink = value.link;
    button.addEventListener("click", () => { if (actions.current(button)) { actions.open(value.link!); } }); container.append(button);
  } else if (actions.edit && baseProperty(column.key).kind === "note" && /\.md$/i.test(path)) {
    const button = doc.createElement("button"); button.type = "button"; button.className = "bases-cell-edit"; button.textContent = value.text || "—"; button.setAttribute("aria-label", "Edit " + column.label + " in " + path); button.disabled = actions.readOnly === true;
    button.addEventListener("click", () => { if (!button.disabled && actions.current(button)) { actions.edit!(path, baseProperty(column.key).name); } }); container.append(button);
  } else { container.textContent = value.text || "—"; }
}
