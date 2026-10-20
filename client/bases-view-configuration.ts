import { isAlias, isMap, isScalar, isSeq, parseDocument, visit, type Node } from "yaml";
import type { App } from "./app";
import { BaseDocument, baseProperty, supportedBaseView, type BaseSort } from "./bases-model";
import type { BaseViewManagementAuthority, BaseViewPlan } from "./bases-view-management";
import type { TFile } from "./vault";

export const MAX_BASE_CONFIG_COLUMNS = 64;
export const MAX_BASE_CONFIG_SORTS = 16;
export interface BaseViewConfiguration { order: string[]; sort: BaseSort[]; limit: number | null }
export interface BaseViewConfigurationDraft { order: string[]; sort: BaseSort[]; limit: string }
export interface BaseViewConfigurationPlan extends BaseViewPlan {
  readonly changes: readonly Readonly<{ field: "order" | "sort" | "limit"; before: string; after: string }>[];
  readonly edits: readonly Readonly<{ from: number; to: number; insert: string }>[];
}

const identity = (key: string): string => { const property = baseProperty(key); return property.kind + "." + property.name; };
/** Repeated imported keys cannot identify which entry's opaque settings to keep. */
export function assertBaseViewSortOwnership(sort: readonly BaseSort[]): void {
  const keys = new Set<string>();
  for (const item of sort) {
    const key = identity(item.property);
    if (keys.has(key)) { throw new Error("This saved view repeats a sort property, including its note. spelling. Choose the intended entries and their settings in Edit base source before configuring this view. Its existing configuration is kept."); }
    keys.add(key);
  }
}
function property(key: string): void {
  if (typeof key !== "string" || /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(key)) { throw new Error("Enter a supported property identifier without malformed Unicode."); }
  baseProperty(key);
}
export function validateBaseViewConfiguration(draft: BaseViewConfigurationDraft): BaseViewConfiguration {
  if (!draft || !Array.isArray(draft.order) || draft.order.length < 1 || draft.order.length > MAX_BASE_CONFIG_COLUMNS) { throw new Error("Keep between 1 and 64 displayed properties."); }
  const columns = new Set<string>();
  for (const key of draft.order) { property(key); const canonical = identity(key); if (columns.has(canonical)) { throw new Error("Displayed properties must be distinct: “" + key + "” is repeated, including its note. spelling."); } columns.add(canonical); }
  if (!Array.isArray(draft.sort) || draft.sort.length > MAX_BASE_CONFIG_SORTS) { throw new Error("Use at most 16 sort keys."); }
  const sorts = new Set<string>();
  for (const item of draft.sort) {
    if (!item || item.direction !== "ASC" && item.direction !== "DESC") { throw new Error("Each sort key needs an ASC or DESC direction."); }
    property(item.property); const canonical = identity(item.property);
    if (sorts.has(canonical)) { throw new Error("Sort properties must be distinct: “" + item.property + "” is repeated."); } sorts.add(canonical);
  }
  if (typeof draft.limit !== "string" || draft.limit !== "" && !/^\d{1,5}$/.test(draft.limit)) { throw new Error("Leave the limit blank for no limit, or enter a whole number from 0 to 10,000. Zero shows no rows."); }
  const limit = draft.limit === "" ? null : Number(draft.limit);
  if (limit !== null && (!Number.isSafeInteger(limit) || limit > 10000)) { throw new Error("The view limit must be from 0 to 10,000. Zero shows no rows."); }
  return { order: [...draft.order], sort: draft.sort.map(item => ({ ...item })), limit };
}

function refuse(field?: string): Error { return new Error((field ? "The “" + field + "” field" : "This views layout") + " needs source editing. Configuration supports explicit named view mappings and unambiguous, unanchored field values; comments inside a changed collection are kept by refusing its replacement."); }
function same(first: unknown, second: unknown, seen = new WeakMap<object, WeakSet<object>>()): boolean {
  if (Object.is(first, second)) { return true; }
  if (!first || !second || typeof first !== "object" || typeof second !== "object" || Array.isArray(first) !== Array.isArray(second)) { return false; }
  const prior = seen.get(first); if (prior?.has(second)) { return true; } if (prior) { prior.add(second); } else { seen.set(first, new WeakSet([second])); }
  const keys = Object.keys(first);
  return keys.length === Object.keys(second).length && keys.every(key => Object.hasOwn(second, key) && same((first as Record<string, unknown>)[key], (second as Record<string, unknown>)[key], seen));
}
function splice(source: string, edits: readonly { from: number; to: number; insert: string }[]): string {
  let result = source, end = source.length;
  for (const edit of [...edits].sort((a, b) => b.from - a.from || b.to - a.to)) {
    if (edit.from < 0 || edit.to < edit.from || edit.to > end) { throw refuse(); }
    result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to); end = edit.from;
  }
  return result;
}
function unsafe(node: Node, field: string): void {
  let invalid = false;
  visit(node, { Node(_key, item) { if (isAlias(item) || item.tag || "anchor" in item && item.anchor) { invalid = true; } } });
  const walk = (token: unknown): void => {
    if (!token || typeof token !== "object") { return; }
    const value = token as Record<string, unknown>;
    if (value.type === "comment" && typeof value.offset === "number" && node.range && value.offset >= node.range[0] && value.offset < node.range[1]) { invalid = true; }
    for (const child of Object.values(value)) { if (Array.isArray(child)) { child.forEach(walk); } else if (child && typeof child === "object") { walk(child); } }
  };
  walk(node.srcToken); if (invalid) { throw refuse(field); }
}

/** Only changed field spans are replaced. Unrelated YAML is never serialized. */
export function planBaseViewConfiguration(source: string, selected: string, draft: BaseViewConfigurationDraft): BaseViewConfigurationPlan {
  const model = new BaseDocument(source), bom = source.startsWith("\ufeff") ? 1 : 0, body = source.slice(bom);
  const document = parseDocument(body, { keepSourceTokens: true, uniqueKeys: true, intAsBigInt: true }), sequence = document.get("views", true);
  if (!isMap(document.contents) || document.contents.anchor || !isSeq(sequence) || sequence.anchor || sequence.srcToken?.type !== "block-seq") { throw refuse(); }
  const names = new Set<string>();
  for (const view of model.views) { const name = view.name.normalize("NFKC").toLowerCase(); if (names.has(name)) { throw new Error("These named views are ambiguous after Unicode normalization or letter case. Give them distinct names in source first."); } names.add(name); }
  const index = model.views.findIndex(view => view.name === selected), current = model.views[index], node = sequence.items[index];
  if (!current) { throw new Error("The selected named view changed. Choose its current view before reviewing configuration."); }
  if (!supportedBaseView(current.type)) { throw new Error("Visual configuration supports saved Table, List and Cards views. The unsupported view is retained; edit its source explicitly."); }
  assertBaseViewSortOwnership(current.sort);
  const next = validateBaseViewConfiguration(draft);
  if (!isMap(node) || node.anchor || !node.range || node.srcToken?.type !== "block-map" || node.srcToken.indent > 64 || isAlias(node.get("name", true))) { throw refuse(); }
  const data = document.toJS({ maxAliasCount: 32 }) as { views: Record<string, unknown>[] }, original = data.views[index];
  const replacement = { ...original }, edits: { from: number; to: number; insert: string }[] = [], changes: { field: "order" | "sort" | "limit"; before: string; after: string }[] = [], additions: string[] = [];
  const eolAt = (at: number): string => { const line = body.indexOf("\n", at); return line >= 0 ? body[line - 1] === "\r" ? "\r\n" : "\n" : body.includes("\r\n") ? "\r\n" : "\n"; };
  const set = (field: "order" | "sort" | "limit", text: string, expected: unknown): void => {
    replacement[field] = expected;
    const value = node.get(field, true);
    if (value === undefined && !node.has(field)) { additions.push(" ".repeat(node.srcToken!.type === "block-map" ? node.srcToken!.indent : 0) + field + ": " + text + eolAt(node.range![2] - 1)); return; }
    if (!value || isAlias(value) || !value.range || value.range[1] <= value.range[0]) { throw refuse(field); }
    unsafe(value, field);
    // Block collections own their final line break; keep that separator before the next field.
    const ending = body.slice(value.range[0], value.range[1]).match(/\r?\n$/)?.[0] ?? "";
    edits.push({ from: value.range[0], to: value.range[1], insert: text + (ending && !text.endsWith("\n") ? ending : "") });
  };
  if (!same(current.order, next.order)) {
    set("order", JSON.stringify(next.order), next.order);
    changes.push({ field: "order", before: current.order.map(key => JSON.stringify(key)).join(" → "), after: next.order.map(key => JSON.stringify(key)).join(" → ") });
  }
  if (!same(current.sort, next.sort)) {
    const value = node.get("sort", true), old = Array.isArray(original.sort) ? original.sort as Record<string, unknown>[] : [];
    const pairs = next.sort.map(item => { const at = current.sort.findIndex(prior => identity(prior.property) === identity(item.property)); const prior = at >= 0 ? old[at] : undefined; return { item, at, data: prior ? { ...prior, ...(current.sort[at].property !== item.property ? { property: item.property } : {}), ...(current.sort[at].direction !== item.direction ? { direction: item.direction } : {}) } : { property: item.property, direction: item.direction } }; });
    let text: string;
    if (isSeq(value) && value.items.length) {
      unsafe(value, "sort");
      const block = value.srcToken?.type === "block-seq", indent = block ? " ".repeat(value.srcToken!.type === "block-seq" ? value.srcToken!.indent : 0) : "", eol = eolAt(value.range![0]);
      const tokens = value.srcToken?.type === "block-seq" ? value.srcToken.items.filter(item => item.value !== undefined) : [];
      const items = pairs.map(({ item, at }) => {
        if (at < 0) { return block ? "- property: " + JSON.stringify(item.property) + eol + indent + "  direction: " + item.direction + eol : "{property: " + JSON.stringify(item.property) + ", direction: " + item.direction + "}"; }
        const mapping = value.items[at]; if (!isMap(mapping) || !mapping.range || !mapping.srcToken || !["block-map", "flow-collection"].includes(mapping.srcToken.type)) { throw refuse("sort"); }
        const indicator = block ? tokens[at]?.start.find(token => token.type === "seq-item-ind") : null;
        if (block && (!indicator || body.slice(body.lastIndexOf("\n", indicator.offset - 1) + 1, indicator.offset) !== indent)) { throw refuse("sort"); }
        const start = indicator?.offset ?? mapping.range[0], end = block ? mapping.range[2] : mapping.range[1], local: { from: number; to: number; insert: string }[] = [];
        const update = (key: "property" | "direction", target: string): void => {
          const scalar = mapping.get(key, true);
          if (key === "direction" && current.sort[at].direction === target) { return; }
          if (isScalar(scalar) && scalar.value === target) { return; }
          if (!scalar && key === "direction" && target === "ASC" && !mapping.has(key)) { return; }
          if (!scalar && key === "direction" && !mapping.has(key)) {
            if (mapping.srcToken?.type === "block-map") { local.push({ from: end - start, to: end - start, insert: (body[end - 1] === "\n" ? "" : eol) + indent + "  direction: " + target + eol }); }
            else { local.push({ from: mapping.range![1] - start - 1, to: mapping.range![1] - start - 1, insert: ", direction: " + target }); } return;
          }
          if (!isScalar(scalar) || !scalar.range || scalar.range[0] === scalar.range[1]) { throw refuse("sort"); }
          local.push({ from: scalar.range[0] - start, to: scalar.range[1] - start, insert: JSON.stringify(target) });
        };
        update("property", item.property); update("direction", item.direction);
        return splice(body.slice(start, end), local);
      });
      if (!items.length) { text = "[]"; }
      else if (block) { text = items.map((item, at) => (at ? indent : "") + item + (!item.endsWith("\n") && at < items.length - 1 ? eol : "")).join(""); }
      else { text = "[" + items.join(", ") + "]"; }
    } else { text = JSON.stringify(pairs.map(pair => pair.data)); }
    set("sort", text, pairs.map(pair => pair.data));
    const description = (sort: BaseSort[]): string => sort.length ? sort.map(item => JSON.stringify(item.property) + " " + item.direction).join(" → ") : "No sort keys";
    changes.push({ field: "sort", before: description(current.sort), after: description(next.sort) });
  }
  if (current.limit !== next.limit) {
    set("limit", next.limit === null ? "null" : String(next.limit), next.limit === null ? null : BigInt(next.limit));
    const describe = (limit: number | null): string => limit === null ? "No limit" : limit === 0 ? "0 (show no rows)" : String(limit);
    changes.push({ field: "limit", before: describe(current.limit), after: describe(next.limit) });
  }
  if (!changes.length) { throw new Error("Change at least one displayed property, sort key or limit before reviewing."); }
  if (additions.length) {
    const at = node.range[2]; if (at < body.length && body[at - 1] !== "\n") { throw refuse(); }
    edits.push({ from: at, to: at, insert: (body[at - 1] === "\n" ? "" : eolAt(at)) + additions.join("") });
  }
  const expected = { ...data, views: data.views.map((view, at) => at === index ? replacement : view) }, output = source.slice(0, bom) + splice(body, edits);
  const actual = parseDocument(output.slice(bom), { uniqueKeys: true, intAsBigInt: true }).toJS({ maxAliasCount: 32 });
  if (!same(expected, actual)) { throw new Error("This edit would change other YAML, unknown sort settings or alias ownership. Configure this view explicitly in source."); }
  new BaseDocument(output);
  const exact = edits.map(edit => Object.freeze({ ...edit, from: edit.from + bom, to: edit.to + bom })).sort((a, b) => a.from - b.from), first = exact[0].from, last = Math.max(...exact.map(edit => edit.to));
  return Object.freeze({ source: output, selected, names: Object.freeze(model.views.map(view => view.name)), description: `Configure only the displayed properties, sort keys and limit of “${selected}” (${current.type}). Matching notes, grouping, summaries, presentation and shared settings are kept. Removed sort keys remove their associated sort settings.`, changes: Object.freeze(changes.map(change => Object.freeze(change))), edits: Object.freeze(exact), edit: Object.freeze({ from: first, to: last, insert: output.slice(first, output.length - (source.length - last)) }) });
}

/** The same clean owner/version/BOM proof used for named view management, before any commit. */
export class BaseViewConfigurationReview {
  readonly plan: BaseViewConfigurationPlan;
  private readonly path: string;
  private readonly root: string;
  private readonly baseline: { version: string; content: string; hasBom: boolean };
  private closed = false;
  private started = false;
  attempted = false;
  completed = false;
  applying = false;
  constructor(private readonly app: App, private readonly file: TFile, source: string, selected: string, draft: BaseViewConfigurationDraft, private readonly authority: BaseViewManagementAuthority) {
    app.vault.assertWritable("modify", file.path); this.path = file.path; this.root = app.vault.rootPath ?? "";
    const saved = authority.savedSource();
    if (!saved || saved.file.path !== this.path || saved.content !== source) { throw new Error("Save or reload the current base before configuring its view. Existing unsaved source is retained."); }
    this.baseline = { version: saved.version, content: saved.content, hasBom: Boolean(saved.hasBom) }; this.guard(); this.plan = planBaseViewConfiguration(source, selected, draft);
  }
  close(): void { this.closed = true; }
  private guard(): void {
    this.app.vault.assertWritable("modify", this.path); const saved = this.authority.savedSource();
    if (this.closed || !this.root || this.root !== this.app.vault.rootPath || this.app.changingVault || this.app.workspace.isChangingFiles || this.file.path !== this.path
      || this.file.extension.toLowerCase() !== "base" || this.app.vault.getFileByPath(this.path) !== this.file || !this.authority.current() || !saved || saved.file.path !== this.path
      || saved.version !== this.baseline.version || saved.content !== this.baseline.content || Boolean(saved.hasBom) !== this.baseline.hasBom) {
      throw new Error("The base, saved source or configuration owner changed. Cancel and review the current named view again.");
    }
  }
  async apply(): Promise<void> {
    if (this.started) { throw new Error("This configuration review was already applied or attempted. Start a fresh review of the current base."); }
    this.started = true; this.guard(); this.applying = true;
    try {
      const actual = await this.app.vault.readDocument(this.path); this.guard();
      if (actual.file.path !== this.path || actual.version !== this.baseline.version || actual.content !== this.baseline.content || Boolean(actual.hasBom) !== this.baseline.hasBom) {
        throw new Error("The saved base changed on disk. No configuration edit was applied. Reload it and start a fresh review.");
      }
      this.attempted = true; await this.authority.save(this.plan); this.completed = true;
    } finally { this.applying = false; }
  }
}
