import { isMap, isScalar, isSeq, parseDocument, visit } from "yaml";
import type { App } from "./app";
import type { VaultDocument } from "./contracts";
import type { TFile } from "./vault";
import { BaseDocument, supportedBaseView } from "./bases-model";

export const MAX_BASE_VIEW_NAME = 128;
export type BaseManagedViewType = "table" | "list" | "cards";
export type BaseViewChange = { kind: "add"; name: string; type: BaseManagedViewType }
  | { kind: "duplicate" | "rename"; name: string }
  | { kind: "move"; direction: -1 | 1 } | { kind: "remove" };
export interface BaseViewPlan {
  readonly source: string;
  readonly selected: string;
  readonly description: string;
  readonly names: readonly string[];
  readonly edit: Readonly<{ from: number; to: number; insert: string }>;
}
export interface BaseViewManagementAuthority {
  current(): boolean;
  savedSource(): VaultDocument | null;
  save(plan: BaseViewPlan): Promise<void>;
}

function refuse(): Error { return new Error("This views layout needs source editing. Use an explicit block sequence of named view mappings with ordinary single-line names."); }
function nameIdentity(name: string): string { return name.normalize("NFKC").toLowerCase(); }
function checkedName(name: string): string {
  if (typeof name !== "string" || !name || name.trim() !== name || name.length > MAX_BASE_VIEW_NAME
    || /[\x00-\x1f\x7f-\x9f\u2028\u2029]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(name)) {
    throw new Error("Choose a view name of 1–128 characters without surrounding whitespace, line breaks or control characters.");
  }
  return name;
}
function sameData(first: unknown, second: unknown, seen = new WeakMap<object, WeakSet<object>>()): boolean {
  if (Object.is(first, second)) { return true; }
  if (!first || !second || typeof first !== "object" || typeof second !== "object" || Array.isArray(first) !== Array.isArray(second)) { return false; }
  const prior = seen.get(first); if (prior?.has(second)) { return true; }
  if (prior) { prior.add(second); } else { seen.set(first, new WeakSet([second])); }
  const left = Object.keys(first), right = Object.keys(second);
  return left.length === right.length && left.every(key => Object.hasOwn(second, key)
    && sameData((first as Record<string, unknown>)[key], (second as Record<string, unknown>)[key], seen));
}

/** Splice proved CST spans. The serializer never rewrites untouched YAML tokens. */
export function planBaseViewChange(source: string, selected: string, change: BaseViewChange): BaseViewPlan {
  const model = new BaseDocument(source), bom = source.startsWith("\ufeff") ? 1 : 0, body = source.slice(bom);
  const document = parseDocument(body, { uniqueKeys: true, keepSourceTokens: true, intAsBigInt: true });
  const sequence = document.get("views", true), token = isSeq(sequence) ? sequence.srcToken : undefined;
  const items = token?.type === "block-seq" ? token.items.filter(item => item.value !== undefined) : [];
  if (!isSeq(sequence) || sequence.anchor || token?.type !== "block-seq" || items.length !== model.views.length
    || !Number.isSafeInteger(token.indent) || token.indent < 0 || token.indent > 64) { throw refuse(); }
  const names = new Set<string>();
  for (const view of model.views) {
    checkedName(view.name); const identity = nameIdentity(view.name);
    if (names.has(identity)) { throw new Error("These view names are ambiguous after Unicode normalization or letter case. Give them distinct names in the base source first."); }
    names.add(identity);
  }
  const index = model.views.findIndex(view => view.name === selected);
  if (index < 0) { throw new Error("The selected named view changed. Choose its current view before reviewing a change."); }
  const indent = " ".repeat(token.indent), eol = source.includes("\r\n") ? "\r\n" : "\n";
  let previousEnd = -1;
  const entries = sequence.items.map((node, at) => {
    const item = items[at], indicator = item.start.find(part => part.type === "seq-item-ind");
    if (!isMap(node) || !node.range || !indicator || indicator.source !== "-" || !node.srcToken || !["block-map", "flow-collection"].includes(node.srcToken.type)) { throw refuse(); }
    const line = body.lastIndexOf("\n", indicator.offset - 1) + 1, to = node.range[2];
    if (body.slice(line, indicator.offset) !== indent || line < previousEnd || to <= line || to > body.length
      || to !== body.length && body[to - 1] !== "\n") { throw refuse(); }
    const from = at === 0 ? line : previousEnd;
    const leading = body.slice(from, line);
    if (!/^(?:[ \t]*(?:#[^\r\n]*)?\r?\n)*$/.test(leading)) { throw refuse(); }
    const ambiguous = item.start.some(part => part.type === "comment" && part.offset < indicator.offset && part.indent !== token.indent);
    const name = node.get("name", true), cst = isScalar(name) ? name.srcToken : undefined;
    if (!isScalar(name) || typeof name.value !== "string" || !name.range || !cst || !["scalar", "single-quoted-scalar", "double-quoted-scalar"].includes(cst.type)
      || !("source" in cst) || cst.offset !== name.range[0] || body.slice(name.range[0], name.range[1]) !== cst.source || /[\r\n]/.test(cst.source)) { throw refuse(); }
    previousEnd = to;
    return { node, from, to, ambiguous, name, nameFrom: name.range[0], nameTo: name.range[1] };
  });
  const entry = entries[index];
  if (entry.node.anchor || entry.name.anchor) { throw new Error("An anchored view or name may have other owners. Manage it explicitly in the base source."); }
  const expected = structuredClone(document.toJS({ maxAliasCount: 32 })) as { views: Record<string, unknown>[] };
  const freshName = (value: string, rename = false): string => {
    checkedName(value); const identity = nameIdentity(value);
    if (model.views.some((view, at) => (!rename || at !== index) && nameIdentity(view.name) === identity)) {
      throw new Error("That view name already exists, including Unicode or case-only matches. Choose a distinct name.");
    }
    return value;
  };
  let from: number, to: number, insert: string, next = selected, description: string;
  switch (change.kind) {
    case "add": {
      if (!supportedBaseView(change.type)) { throw new Error("New views support Table, List or Cards."); }
      if (model.views.length >= 64) { throw new Error("A base supports at most 64 views. Remove a view before adding another."); }
      const name = freshName(change.name), last = entries.at(-1)!;
      from = to = last.to;
      insert = (body[from - 1] === "\n" ? "" : eol) + indent + "- type: " + change.type + eol + indent + "  name: " + JSON.stringify(name) + eol + indent + "  order: [file.name]" + eol;
      expected.views.push({ type: change.type, name, order: ["file.name"] }); next = name;
      description = `Add ${change.type === "table" ? "Table" : change.type === "list" ? "List" : "Cards"} view “${name}” at the end with the explicit file.name column. Shared base filters, formulas and property settings still apply.`;
      break;
    }
    case "duplicate": {
      if (model.views.length >= 64) { throw new Error("A base supports at most 64 views. Remove a view before duplicating another."); }
      const name = freshName(change.name); let anchored = false;
      visit(entry.node, { Node(_key, node) { if ("anchor" in node && node.anchor) { anchored = true; } } });
      if (anchored) { throw new Error("This view contains anchors. Duplicate it in source with explicit new anchor names so other configuration keeps its owners."); }
      if (entry.ambiguous) { throw new Error("A leading comment has ambiguous ownership. Duplicate this view in the base source."); }
      const copy = body.slice(entry.from, entry.nameFrom) + JSON.stringify(name) + body.slice(entry.nameTo, entry.to);
      from = to = entry.to; insert = (body[from - 1] === "\n" ? "" : eol) + copy;
      if (insert[insert.length - 1] !== "\n" && from < body.length) { insert += eol; }
      expected.views.splice(index + 1, 0, { ...structuredClone(expected.views[index]), name }); next = name;
      description = `Duplicate “${selected}” as “${name}” immediately after it, retaining its type and every configured filter, column, sort, group, summary and presentation setting, including unknown settings.`;
      break;
    }
    case "rename": {
      const name = freshName(change.name, true);
      if (name === selected) { throw new Error("Enter a different view name."); }
      from = entry.nameFrom; to = entry.nameTo; insert = JSON.stringify(name); expected.views[index].name = name; next = name;
      description = `Rename “${selected}” to “${name}”. Existing links or embeds using the old view name are kept and may need an explicit source edit. Local group folds remain scoped to their existing names.`;
      break;
    }
    case "move": {
      if (change.direction !== -1 && change.direction !== 1) { throw new Error("Choose Move earlier or Move later."); }
      const other = index + change.direction, low = Math.min(index, other), first = entries[low], second = entries[low + 1];
      if (!entries[other]) { throw new Error("This view is already at the beginning or end of the view list."); }
      if (first.ambiguous || second.ambiguous || first.to !== second.from || body[first.to - 1] !== "\n" || body[second.to - 1] !== "\n") {
        throw new Error("These view boundaries or comments have ambiguous ownership. Reorder them in the base source with complete lines.");
      }
      from = first.from; to = second.to; insert = body.slice(second.from, second.to) + body.slice(first.from, first.to);
      [expected.views[index], expected.views[other]] = [expected.views[other], expected.views[index]];
      description = `Move “${selected}” one position ${change.direction === -1 ? "earlier" : "later"}, retaining each view's complete configuration.`;
      break;
    }
    case "remove": {
      if (model.views.length === 1) { throw new Error("Keep at least one view. Add a view before removing this last view."); }
      if (entry.ambiguous) { throw new Error("A leading comment has ambiguous ownership. Remove this view in the base source."); }
      from = entry.from; to = entry.to; insert = ""; expected.views.splice(index, 1); next = String(expected.views[Math.min(index, expected.views.length - 1)].name);
      description = `Remove only view “${selected}”. Its configuration is removed from this base; matching notes, shared base settings and links or embeds are kept.`;
      break;
    }
    default: throw new Error("Choose a supported view-management operation.");
  }
  const output = source.slice(0, from + bom) + insert + source.slice(to + bom), result = new BaseDocument(output);
  const actual = parseDocument(output.slice(bom), { uniqueKeys: true, intAsBigInt: true }).toJS({ maxAliasCount: 32 });
  if (!sameData(expected, actual)) { throw new Error("This edit would change other YAML or alias ownership. Review this configuration in the base source."); }
  return Object.freeze({ source: output, selected: next, description, names: Object.freeze(result.views.map(view => view.name)), edit: Object.freeze({ from: from + bom, to: to + bom, insert }) });
}

/** Bind an explicit review to a clean pane and prove its physical source before the ordinary save pipeline. */
export class BaseViewManagementReview {
  readonly plan: BaseViewPlan;
  readonly path: string;
  private readonly root: string;
  private readonly baseline: { version: string; content: string; hasBom: boolean };
  private closed = false;
  private started = false;
  attempted = false;
  completed = false;
  applying = false;
  constructor(private readonly app: App, private readonly file: TFile, source: string, selected: string, change: BaseViewChange, private readonly authority: BaseViewManagementAuthority) {
    app.vault.assertWritable("modify", file.path);
    this.path = file.path; this.root = app.vault.rootPath ?? "";
    const saved = authority.savedSource();
    if (!saved || saved.file.path !== this.path || saved.content !== source) { throw new Error("Save or reload the current base before managing its views. Existing unsaved source is retained."); }
    this.baseline = { version: saved.version, content: saved.content, hasBom: Boolean(saved.hasBom) };
    this.guard(); this.plan = planBaseViewChange(source, selected, change);
  }
  close(): void { this.closed = true; }
  private guard(): void {
    this.app.vault.assertWritable("modify", this.path);
    const current = this.authority.savedSource();
    if (this.closed || !this.root || this.root !== this.app.vault.rootPath || this.app.changingVault || this.app.workspace.isChangingFiles
      || this.file.path !== this.path || this.file.extension.toLowerCase() !== "base" || this.app.vault.getFileByPath(this.path) !== this.file || !this.authority.current()
      || !current || current.file.path !== this.path || current.version !== this.baseline.version || current.content !== this.baseline.content || Boolean(current.hasBom) !== this.baseline.hasBom) {
      throw new Error("The base, saved source or review owner changed. Cancel and review the current named view again.");
    }
  }
  async apply(): Promise<void> {
    if (this.started) { throw new Error("This review was already applied or attempted. Inspect the current base before starting a fresh review."); }
    this.started = true; this.guard(); this.applying = true;
    try {
      const actual = await this.app.vault.readDocument(this.path); this.guard();
      if (actual.file.path !== this.path || actual.version !== this.baseline.version || actual.content !== this.baseline.content || Boolean(actual.hasBom) !== this.baseline.hasBom) {
        throw new Error("The saved base changed on disk. No view edit was applied. Reload it and start a fresh review.");
      }
      this.attempted = true; await this.authority.save(this.plan); this.completed = true;
    } finally { this.applying = false; }
  }
}
