import moment from "moment";
import type { App } from "./app";
import { copyViewData, jsonNumberIdentity, type VaultConfigurationDocument } from "./contracts";
import { Events } from "./events";

export const propertyTypes = ["text", "multitext", "number", "checkbox", "date", "datetime", "aliases", "tags"] as const;
export type PropertyType = typeof propertyTypes[number];
export interface PropertyInfo { name: string; widget: string; occurrences: number }
const fixedTypes: Readonly<Record<string, PropertyType>> = { aliases: "aliases", cssclasses: "multitext", tags: "tags" };

export function propertyName(value: string): string {
  const name = value;
  if (!name.trim() || name.length > 256 || /[\x00-\x1f\x7f]/.test(name)) { throw new Error("Enter a property name of 1 to 256 characters without control characters."); }
  return name;
}

export function inferPropertyType(value: unknown): string {
  if (typeof value === "boolean") { return "checkbox"; }
  if (typeof value === "number") { return "number"; }
  if (Array.isArray(value)) { return value.every(item => typeof item === "string") ? "multitext" : "unknown"; }
  if (value != null && typeof value !== "string") { return "unknown"; }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && moment(value, "YYYY-MM-DD", true).isValid()) { return "date"; }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value) && moment.parseZone(value, moment.ISO_8601, true).isValid()) { return "datetime"; }
  return "text";
}

export function parsePropertyValue(type: string, text: string, checked = false): unknown {
  if (type === "checkbox") { return checked; }
  if (["multitext", "aliases", "tags"].includes(type)) {
    return text.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  }
  if (type === "number") {
    const value = Number(text);
    if (!text.trim() || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim()) || !Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new Error("Enter a finite number that JavaScript can represent safely.");
    }
    if (jsonNumberIdentity(text.trim()) !== jsonNumberIdentity(JSON.stringify(value))) { throw new Error("This number would lose precision. Use a text property to retain its exact digits."); }
    return value;
  }
  if (type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !moment(text, "YYYY-MM-DD", true).isValid()) { throw new Error("Use a valid YYYY-MM-DD date."); }
    return text;
  }
  if (type === "datetime") {
    if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(text) || !moment.parseZone(text, moment.ISO_8601, true).isValid()) {
      throw new Error("Use a valid ISO date and time.");
    }
    return text;
  }
  if (type === "text") { return text; }
  throw new Error("Editing this property type is not implemented; its original YAML was preserved: " + type);
}

function registry(data: Record<string, unknown>): Record<string, string> {
  const value = data.types === undefined ? {} : data.types;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some(type => typeof type !== "string")) {
    throw new Error("Property types must be an object mapping property names to type names.");
  }
  return value as Record<string, string>;
}

export class MetadataTypeManager extends Events {
  private document: VaultConfigurationDocument | null = null;
  private readonly assigned = new Map<string, string>();
  private pending: Promise<void> = Promise.resolve();

  constructor(readonly app: App) {
    super();
    app.metadataCache.on("finished", () => this.trigger("changed"));
  }

  async initialize(): Promise<void> {
    const document = await this.app.configuration.read("types");
    this.accept(document);
  }

  accept(document: VaultConfigurationDocument): void {
    if (document.root !== this.app.vault.rootPath || document.id !== "types") { throw new Error("Property types belong to a different vault or configuration."); }
    const types = registry(document.data);
    this.document = document;
    this.assigned.clear();
    for (const [name, type] of Object.entries(types)) {
      const key = name.toLowerCase();
      if (!this.assigned.has(key)) { this.assigned.set(key, type); }
    }
    this.trigger("changed");
  }

  private requireDocument(): VaultConfigurationDocument {
    if (!this.document || this.document.root !== this.app.vault.rootPath) { throw new Error("Load this vault's property types before editing them."); }
    return this.document;
  }

  getAssignedWidget(name: string): string | null {
    const key = name.toLowerCase();
    if (Object.hasOwn(fixedTypes, key)) { return fixedTypes[key]; }
    this.requireDocument();
    return this.assigned.get(key) ?? null;
  }

  getAllProperties(): Record<string, PropertyInfo> {
    const result: Record<string, PropertyInfo> = Object.create(null);
    for (const entry of this.app.metadataCache.getDocuments()) {
      if (entry.document.file.extension.toLowerCase() !== "md") { continue; }
      for (const [name, value] of Object.entries(entry.cache.frontmatter ?? {})) {
        const key = name.toLowerCase();
        const widget = this.getAssignedWidget(name) ?? inferPropertyType(value);
        const prior = result[key];
        result[key] = prior ? { ...prior, occurrences: prior.occurrences + 1, widget: prior.widget === widget ? widget : "unknown" } : { name, widget, occurrences: 1 };
      }
    }
    return result;
  }

  getPropertyInfo(name: string): PropertyInfo {
    return this.getAllProperties()[name.toLowerCase()] ?? { name, widget: this.getAssignedWidget(name) ?? "text", occurrences: 0 };
  }

  private change(name: string, type: string | null): Promise<void> {
    const key = propertyName(name);
    if (Object.hasOwn(fixedTypes, key.toLowerCase())) { return Promise.reject(new Error("The built-in aliases, tags and cssclasses types cannot be changed.")); }
    if (type !== null && !propertyTypes.some(value => value === type)) { return Promise.reject(new Error("Assigning this property type is not implemented: " + type)); }
    const root = this.app.vault.rootPath;
    const action = async (): Promise<void> => {
      if (root !== this.app.vault.rootPath || this.app.changingVault) { throw new Error("The vault changed before its property types could be updated."); }
      const document = this.requireDocument();
      const data = copyViewData(document.data, 256);
      const types = registry(data);
      const matches = Object.keys(types).filter(name => name.toLowerCase() === key.toLowerCase());
      for (const name of matches) { delete types[name]; }
      if (type !== null) { Object.defineProperty(types, matches[0] ?? key, { value: type, enumerable: true, writable: true, configurable: true }); }
      data.types = types;
      this.accept(await this.app.configuration.write(document, data));
    };
    const operation = this.pending.then(action, action);
    this.pending = operation;
    return this.app.workspace.track(operation);
  }

  setType(name: string, type: string): Promise<void> { return this.change(name, type); }
  unsetType(name: string): Promise<void> { return this.change(name, null); }
}
