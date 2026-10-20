import { isMap, isScalar, parseDocument, visit, type Document } from "yaml";
import { BaseEvaluator, baseDisplay, baseEqual, compareBaseValues, isBaseDate, isBaseLink, parseBaseExpression, type BaseFile, type EvaluationBudget } from "./bases-expression";
import { builtinSummaries, builtinSummaryNames, summaryFormula, summaryKind, summaryName, type BaseSummaryKind } from "./bases-summaries";
import { baseGroupIdentity } from "./bases-group-state";
import { baseGroupOrderIdentity, readBaseGroupOrderValues, type BaseGroupOrderValue } from "./bases-group-order-values";
import { baseCardCover, type BaseCardCover, type BaseCardsOptions } from "./bases-cards";
import { readBaseTableOptions, type BaseTableOptions } from "./bases-table";
export type { BaseCardCover, BaseCardsOptions } from "./bases-cards";
export type { BaseFile } from "./bases-expression";

type Filter = { expression: ReturnType<typeof parseBaseExpression> } | { operator: "and" | "or" | "not"; children: Filter[] };
export interface BaseSort { property: string; direction: "ASC" | "DESC" }
export interface BaseListOptions { markers: "bullet" | "number" | "none"; indentProperties: boolean; separator: string }
export const MAX_BASE_LIST_SEPARATOR = 256;
export interface BaseView { index: number; name: string; type: string; order: string[]; filter: Filter | null; sort: BaseSort[]; groupBy: BaseSort | null; groupOrder: readonly BaseGroupOrderValue[] | null; groupOrderIssue: string | null; limit: number | null; summaries: ReadonlyMap<string, string>; list: BaseListOptions | null; cards: BaseCardsOptions | null; table: BaseTableOptions | null; warnings: string[] }
export interface BaseCell { text: string; error?: string; link?: string; empty?: boolean; exportNumber?: true }
export interface BaseSummaryCell extends BaseCell { name: string }
export interface BaseColumn { key: string; label: string; summaryKind: BaseSummaryKind }
export interface BaseRow { path: string; cells: BaseCell[]; group: string; groupKey: string; listNumber?: number; cover?: BaseCardCover | null }
export interface BaseResult { columns: BaseColumn[]; rows: BaseRow[]; total: number; matched: number; page: number; pages: number; groupProperty: string | null; summaries: (BaseSummaryCell | null)[]; groups: { key: string; identity: string | null; label: string; count: number; renderEmpty?: true; summaries?: (BaseSummaryCell | null)[] }[]; errors: string[]; warnings: string[]; exported?: true }
export interface BaseQuery { text: string; files: BaseFile[]; context: BaseFile; view: string; search: string; page: number; now?: number; export?: true }
export interface BaseRequest extends BaseQuery { serial: number }
export type BaseResponse = { serial: number; result: BaseResult } | { serial: number; error: string };

export function supportedBaseView(type: string): boolean { return type === "table" || type === "list" || type === "cards"; }
/** Empty configured groups are presentation headers, never files, exported rows or summary inputs. */
export function baseGroupRenderRows(result: BaseResult): (BaseRow & { emptyGroup?: true })[] {
  if (!result.groups.some(group => group.renderEmpty)) { return result.rows; }
  const byGroup = new Map<string, BaseRow[]>();
  for (const row of result.rows) { const rows = byGroup.get(row.groupKey) ?? []; rows.push(row); byGroup.set(row.groupKey, rows); }
  return result.groups.flatMap(group => group.renderEmpty ? [{ path: "", cells: [], group: group.label, groupKey: group.key, emptyGroup: true as const }] : byGroup.get(group.key) ?? []);
}
export function baseListCellVisible(cell: BaseCell): boolean { return !cell.error && !cell.empty; }
export function baseListRowVisible(cells: BaseCell[], options: BaseListOptions): boolean { return options.indentProperties ? Boolean(cells[0] && baseListCellVisible(cells[0])) : cells.some(baseListCellVisible); }
function listOptions(view: Record<string, unknown>, warnings: string[]): BaseListOptions {
  const markers = view.markers ?? "bullet", indent = view.indentProperties ?? false, separator = view.separator ?? ", ";
  if (!["bullet", "number", "none"].includes(String(markers)) || typeof markers !== "string") { warnings.push("Unsupported List markers are retained; bullets are used."); }
  if (typeof indent !== "boolean") { warnings.push("Unsupported List indentation is retained; inline properties are used."); }
  const validSeparator = typeof separator === "string" && separator.length <= MAX_BASE_LIST_SEPARATOR && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(separator);
  if (!validSeparator) { warnings.push("Unsupported List separator is retained; comma-separated properties are used. Separators support at most 256 characters."); }
  return { markers: typeof markers === "string" && ["bullet", "number", "none"].includes(markers) ? markers as BaseListOptions["markers"] : "bullet", indentProperties: indent === true, separator: validSeparator ? separator || ", " : ", " };
}
function cardsOptions(view: Record<string, unknown>, warnings: string[]): BaseCardsOptions {
  const boundedNumber = (key: string, fallback: number, minimum: number, maximum: number): number => {
    const original = view[key];
    if (original == null) { return fallback; }
    const value = typeof original === "bigint" && original >= BigInt(Math.ceil(minimum)) && original <= BigInt(Math.floor(maximum)) ? Number(original) : original;
    if (typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum) { return value; }
    warnings.push(`Unsupported Cards ${key} is retained; ${fallback} is used. Supported values range from ${minimum} to ${maximum}.`); return fallback;
  };
  let image = "";
  if (view.image != null && view.image !== "") {
    try {
      if (typeof view.image !== "string") { throw new Error(); }
      const property = baseProperty(view.image);
      if (property.kind === "file" && property.name !== "file") { throw new Error(); }
      image = view.image;
    } catch { warnings.push("Unsupported Cards image property is retained; covers are hidden. Choose a note/formula property or file.file."); }
  }
  const imageFit = view.imageFit ?? "";
  if (imageFit !== "" && imageFit !== "contain") { warnings.push("Unsupported Cards imageFit is retained; cover fit is used."); }
  return { cardSize: boundedNumber("cardSize", 200, 50, 800), image, imageFit: imageFit === "contain" ? "contain" : "", imageAspectRatio: boundedNumber("imageAspectRatio", 1, 0.25, 2.5) };
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) { throw new Error(message); }
  return value as Record<string, unknown>;
}
function text(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096 || value.includes("\0")) { throw new Error(message); }
  return value;
}
export function baseProperty(key: string): { kind: "file" | "formula" | "note"; name: string } {
  const match = /^(file|formula|note)\.(.+)$/.exec(key);
  const kind = match ? match[1] as "file" | "formula" | "note" : "note";
  const name = match ? match[2] : key;
  if (!name.trim() || name.length > 256 || /[\x00-\x1f\x7f]/.test(name) || ["constructor", "__proto__", "prototype"].includes(name)) { throw new Error("Unsupported Bases property name: " + name); }
  return { kind, name };
}
function filter(value: unknown, depth = 0): Filter | null {
  if (value == null) { return null; }
  if (depth > 24) { throw new Error("Filter nesting exceeds 24 levels."); }
  if (typeof value === "string") { return { expression: parseBaseExpression(value) }; }
  const object = record(value, "Filters must be expressions or and/or/not objects.");
  const keys = Object.keys(object);
  if (keys.length !== 1 || !["and", "or", "not"].includes(keys[0])) { throw new Error("A filter object needs exactly one and/or/not key."); }
  const operator = keys[0] as "and" | "or" | "not";
  const children = object[operator];
  if (!Array.isArray(children) || children.length > 128) { throw new Error("Filter groups need at most 128 conditions."); }
  return { operator, children: children.map(value => { const result = filter(value, depth + 1); if (!result) { throw new Error("A filter condition cannot be null."); } return result; }) };
}
function sortedProperty(value: unknown): BaseSort {
  const object = record(value, "Sorting/grouping needs a property and direction.");
  const property = text(object.property, "Choose a property for sorting/grouping.");
  baseProperty(property);
  const direction = object.direction ?? "ASC";
  if (direction !== "ASC" && direction !== "DESC") { throw new Error("Sort directions must be ASC or DESC."); }
  return { property, direction };
}
function canonical(key: string): string { const property = baseProperty(key); return property.kind + "." + property.name; }

export class BaseDocument {
  readonly views: BaseView[];
  readonly filter: Filter | null;
  readonly formulas = new Map<string, ReturnType<typeof parseBaseExpression>>();
  readonly formulaErrors = new Map<string, string>();
  readonly summaryFormulas = new Map<string, ReturnType<typeof parseBaseExpression>>();
  readonly summaryErrors = new Map<string, string>();
  private readonly labels = new Map<string, string>();
  private readonly doc: Document.Parsed;
  private readonly bom: string;
  private readonly eol: string;

  constructor(readonly source: string) {
    if (typeof source !== "string" || source.length > 1024 * 1024) { throw new Error("A base must contain at most 1 MiB of YAML."); }
    this.bom = source.startsWith("\ufeff") ? "\ufeff" : "";
    this.eol = source.includes("\r\n") ? "\r\n" : "\n";
    this.doc = parseDocument(source.slice(this.bom.length), { uniqueKeys: true, keepSourceTokens: true, intAsBigInt: true });
    if (this.doc.errors.length || this.doc.warnings.length) { throw new Error("Invalid or unsupported base YAML: " + [...this.doc.errors, ...this.doc.warnings].map(error => error.message).join("\n")); }
    if (!isMap(this.doc.contents)) { throw new Error("A base must be a YAML object containing views."); }
    const data = record(this.doc.toJS({ maxAliasCount: 32 }), "A base must be a YAML object.");
    this.filter = filter(data.filters);
    if (data.formulas != null) {
      const formulas = record(data.formulas, "Formulas must map names to expression strings.");
      if (Object.keys(formulas).length > 128) { throw new Error("A base supports at most 128 formulas."); }
      for (const [name, source] of Object.entries(formulas)) {
        baseProperty("formula." + name);
        try { this.formulas.set(name, parseBaseExpression(text(source, "Formula definitions must be expression strings."))); }
        catch (error) { this.formulaErrors.set(name, error instanceof Error ? error.message : String(error)); }
      }
    }
    if (data.properties != null) {
      const properties = record(data.properties, "Property configuration must be an object.");
      for (const [name, value] of Object.entries(properties)) {
        const label = record(value, "Property display configuration must be an object.").displayName;
        if (label != null) { this.labels.set(canonical(name), text(label, "Property display names must be strings.")); }
      }
    }
    if (data.summaries != null) {
      const definitions = record(data.summaries, "Custom summaries must map names to formula strings.");
      if (Object.keys(definitions).length > 128) { throw new Error("A base supports at most 128 custom summaries."); }
      for (const [name, source] of Object.entries(definitions)) {
        summaryName(name);
        try { this.summaryFormulas.set(name, summaryFormula(source)); }
        catch (error) { this.summaryErrors.set(name, error instanceof Error ? error.message : String(error)); }
      }
    }
    const views = data.views ?? [{ type: "table", name: "Table" }];
    if (!Array.isArray(views) || !views.length || views.length > 64) { throw new Error("A base needs between 1 and 64 named views."); }
    const names = new Set<string>();
    this.views = views.map((value, index) => {
      const view = record(value, "Every base view must be a YAML object.");
      const name = text(view.name, "Every base view needs a name.");
      if (names.has(name)) { throw new Error("Base view names must be unique: " + name); } names.add(name);
      const type = text(view.type, "Every base view needs a type.");
      const order = view.order ?? ["file.name"];
      if (!Array.isArray(order) || !order.length || order.length > 64 || order.some(key => typeof key !== "string")) { throw new Error("A view needs between 1 and 64 displayed properties."); }
      const properties = order.map(key => { baseProperty(key); return String(key); });
      if (new Set(properties.map(canonical)).size !== properties.length) { throw new Error("A view cannot contain duplicate displayed properties."); }
      const sorts = view.sort ?? [];
      if (!Array.isArray(sorts) || sorts.length > 16) { throw new Error("A view supports at most 16 sort properties."); }
      const limit = view.limit == null ? null : typeof view.limit === "bigint" && view.limit >= 0n && view.limit <= 10000n ? Number(view.limit) : view.limit;
      if (limit !== null && (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 0 || limit > 10000)) { throw new Error("A view limit must be an integer from 0 to 10,000."); }
      const summaries = new Map<string, string>();
      if (view.summaries != null) {
        const assignments = record(view.summaries, "View summaries must map properties to summary names.");
        if (Object.keys(assignments).length > 128) { throw new Error("A view supports at most 128 summary assignments."); }
        for (const [key, value] of Object.entries(assignments)) {
          const property = canonical(key);
          if (summaries.has(property)) { throw new Error("A view cannot contain duplicate summary properties: " + property); }
          summaries.set(property, summaryName(value));
        }
      }
      const commonKeys = new Set(["type", "name", "order", "filters", "sort", "groupBy", "groupOrder", "limit", "summaries", ...(type === "list" ? ["markers", "indentProperties", "separator"] : type === "cards" ? ["cardSize", "image", "imageFit", "imageAspectRatio"] : [])]);
      const presentationSettings = type === "list" || type === "cards" ? Object.keys(view).filter(key => !commonKeys.has(key)) : [];
      const viewLabel = type === "cards" ? "Cards" : "List";
      let groupOrder: BaseGroupOrderValue[] | null = null, groupOrderIssue: string | null = null;
      if (Object.hasOwn(view, "groupOrder")) { try { groupOrder = readBaseGroupOrderValues(view.groupOrder); } catch (error) { groupOrderIssue = error instanceof Error ? error.message : String(error); } }
      const warnings = [groupOrderIssue ?? "", Object.hasOwn(view, "groupOrder") && view.groupBy == null ? "groupOrder is retained but inactive without groupBy. Choose a grouping property or edit base source." : "",
        presentationSettings.length ? "Unrecognized " + viewLabel + " view settings are retained but not implemented: " + presentationSettings.slice(0, 16).map(key => key.slice(0, 120)).join(", ") + (presentationSettings.length > 16 ? ", …" : "") + "." : ""].filter(Boolean);
      const list = type === "list" ? listOptions(view, warnings) : null;
      const cards = type === "cards" ? cardsOptions(view, warnings) : null;
      const table = type === "table" ? readBaseTableOptions(view, warnings) : null;
      return {
        index, name, type, order: properties, filter: filter(view.filters), sort: sorts.map(sortedProperty),
        groupBy: view.groupBy == null ? null : sortedProperty(view.groupBy), groupOrder, groupOrderIssue, limit, summaries,
        list, cards, table, warnings,
      };
    });
  }
  view(name: string): BaseView { return this.views.find(view => view.name === name) ?? this.views[0]; }
  label(key: string): string { return this.labels.get(canonical(key)) ?? baseProperty(key).name; }
  summary(view: string, property: string): string | null { return this.view(view).summaries.get(canonical(property)) ?? null; }
  setListOptions(viewName: string, options: BaseListOptions): string {
    const view = this.view(viewName);
    if (view.type !== "list") { throw new Error("Choose a List view to change its presentation."); }
    const warnings: string[] = []; listOptions({ ...options }, warnings);
    if (warnings.length) { throw new Error(warnings.join(" ")); }
    const document = this.doc.clone();
    for (const key of ["markers", "indentProperties", "separator"] as const) { document.setIn(["views", view.index, key], options[key]); }
    return this.serialize(document);
  }
  setCardsOptions(viewName: string, options: BaseCardsOptions): string {
    const view = this.view(viewName);
    if (view.type !== "cards") { throw new Error("Choose a Cards view to change its presentation."); }
    if (!options || typeof options.cardSize !== "number" || typeof options.imageAspectRatio !== "number" || typeof options.image !== "string" || typeof options.imageFit !== "string") { throw new Error("Cards settings need a numeric size and ratio, an image property and an image fit."); }
    const warnings: string[] = []; cardsOptions({ ...options }, warnings);
    if (warnings.length) { throw new Error(warnings.join(" ")); }
    const document = this.doc.clone();
    for (const key of ["cardSize", "image", "imageFit", "imageAspectRatio"] as const) {
      const path = ["views", view.index, key], previous = document.getIn(path, true), prior = isScalar(previous) ? previous.value : undefined;
      document.setIn(path, options[key]);
      if ((key === "cardSize" || key === "imageAspectRatio") && !Object.is(typeof prior === "bigint" ? Number(prior) : prior, options[key])) {
        // YAML updates existing Scalar.value in place but retains its old source.
        // Retire only this changed numeric token; unrelated and equal values keep their exact spellings.
        const updated = document.getIn(path, true); if (isScalar(updated)) { updated.source = undefined; }
      }
    }
    return this.serialize(document);
  }
  setSummary(viewName: string, property: string, name: string | null, custom?: { name: string; formula: string }): string {
    const view = this.view(viewName), key = canonical(property);
    if (!view.order.some(column => canonical(column) === key)) { throw new Error("Choose a displayed column to summarize."); }
    if (name !== null) { summaryName(name); }
    if (custom) {
      summaryName(custom.name); summaryFormula(custom.formula);
      if (custom.name !== name || builtinSummaryNames.has(custom.name) || this.summaryFormulas.has(custom.name) || this.summaryErrors.has(custom.name)) {
        throw new Error("Choose a new custom summary name. Edit existing definitions in the base source.");
      }
    }
    const document = this.doc.clone();
    if (!document.has("views")) { document.set("views", [{ type: "table", name: "Table" }]); }
    const assignments = document.getIn(["views", view.index, "summaries"]);
    if (assignments != null && !isMap(assignments)) { throw new Error("Edit this aliased summary configuration in the base source."); }
    if (isMap(assignments)) {
      for (const item of [...assignments.items]) { if (canonical(String(item.key)) === key) { assignments.delete(item.key); } }
    }
    if (name !== null) { document.setIn(["views", view.index, "summaries", property], name); }
    else if (isMap(assignments) && !assignments.items.length) { document.deleteIn(["views", view.index, "summaries"]); }
    if (custom) { document.setIn(["summaries", custom.name], custom.formula); }
    return this.serialize(document);
  }
  setView(name: string, key: "sort" | "groupBy", value: unknown): string {
    const index = this.view(name).index;
    // Clone the parsed AST; unsupported keys, comments, anchors and numeric lexemes stay owned by YAML nodes.
    const document = this.doc.clone();
    if (!document.has("views")) { document.set("views", [{ type: "table", name: "Table" }]); }
    if (value === null) { document.deleteIn(["views", index, key]); }
    else { document.setIn(["views", index, key], value); }
    return this.serialize(document);
  }
  private serialize(document: Document): string {
    const sources = new WeakMap<object, { value: unknown; source: string }>();
    visit(document, { Scalar(_key, node) {
      if ((typeof node.value === "number" || typeof node.value === "bigint") && node.source !== undefined) { sources.set(node, { value: node.value, source: node.source }); }
    } });
    const schema = document.schema.clone();
    schema.tags = schema.tags.map(tag => {
      const stringify = tag.stringify;
      if (!["tag:yaml.org,2002:int", "tag:yaml.org,2002:float"].includes(tag.tag) || !stringify) { return tag; }
      return { ...tag, stringify(item, context, onComment, onChompKeep) {
        const original = sources.get(item);
        return original && Object.is(item.value, original.value) ? original.source : stringify(item, context, onComment, onChompKeep);
      } };
    });
    document.schema = schema;
    const output = this.bom + document.toString({ lineWidth: 0 }).replace(/\r?\n/g, this.eol);
    new BaseDocument(output);
    return output;
  }
}

function matches(value: Filter | null, evaluator: BaseEvaluator, depth = 0): boolean {
  if (!value) { return true; }
  if (depth > 24) { throw new Error("Filter nesting exceeds 24 levels."); }
  if ("expression" in value) { return Boolean(evaluator.evaluate(value.expression)); }
  if (value.operator === "or") { return value.children.some(child => matches(child, evaluator, depth + 1)); }
  if (value.operator === "not") { return !value.children.some(child => matches(child, evaluator, depth + 1)); }
  return value.children.every(child => matches(child, evaluator, depth + 1));
}

export function queryBase(query: BaseQuery): BaseResult {
  if (query.export !== undefined && query.export !== true) { throw new Error("Invalid Bases export mode."); }
  if (query.files.length > 10000) { throw new Error("Bases currently supports at most 10,000 files per query."); }
  const document = new BaseDocument(query.text);
  const view = document.view(query.view);
  if (!supportedBaseView(view.type)) { throw new Error(`The ${view.type} view is retained but not implemented. Choose a table, list or cards view or edit its source.`); }
  if (view.groupBy && view.groupOrderIssue) { throw new Error(view.groupOrderIssue + " Its source was preserved; no automatic group order was substituted."); }
  const manual = view.groupBy && view.groupOrder !== null ? new Map(view.groupOrder.map((value, index) => [baseGroupOrderIdentity(value), index])) : null;
  const files = new Map(query.files.map(file => [file.path, file]));
  const budget: EvaluationBudget = { remaining: 1000000 };
  const now = query.now ?? Date.now();
  const errors: string[] = [];
  const propertyExpressions = new Map<string, ReturnType<typeof parseBaseExpression>>();
  const keys = [...new Set([...view.order, ...view.sort.map(sort => sort.property), ...(view.groupBy ? [view.groupBy.property] : []), ...(view.cards?.image ? [view.cards.image] : [])])];
  for (const key of keys) {
    const property = baseProperty(key);
    propertyExpressions.set(key, parseBaseExpression(property.kind + "[" + JSON.stringify(property.name) + "]"));
  }
  const rows: { path: string; cells: BaseCell[]; values: Map<string, unknown>; failures: Map<string, string>; group: unknown; groupKey: string }[] = [];
  const issue = (message: string): void => { if (errors.length < 50) { errors.push(message); } };
  for (const file of files.values()) {
    const evaluator = new BaseEvaluator(file, query.context, document.formulas, files, budget, now);
    try { if (!matches(document.filter, evaluator) || !matches(view.filter, evaluator)) { continue; } }
    catch (error) { issue(file.path + ": " + (error instanceof Error ? error.message : String(error))); if (budget.remaining < 0) { throw error; } continue; }
    const values = new Map<string, unknown>();
    const failures = new Map<string, string>();
    for (const key of keys) {
      try {
        const property = baseProperty(key);
        if (property.kind === "formula" && document.formulaErrors.has(property.name)) { throw new Error(document.formulaErrors.get(property.name)); }
        values.set(key, evaluator.evaluate(propertyExpressions.get(key)!));
      } catch (error) { const message = error instanceof Error ? error.message : String(error); failures.set(key, message); issue(file.path + " / " + key + ": " + message); if (budget.remaining < 0) { throw error; } }
    }
    const cells = view.order.map(key => {
      if (failures.has(key)) { return { text: "#ERROR", error: failures.get(key) } satisfies BaseCell; }
      const value = values.get(key);
      try { return { text: baseDisplay(value), ...(query.export && typeof value === "number" && Number.isFinite(value) ? { exportNumber: true as const } : {}), ...(value == null || value === "" || Array.isArray(value) && !value.length ? { empty: true } : {}), ...(isBaseLink(value) ? { link: value.path } : key === "file.name" || key === "file.basename" || key === "file.path" ? { link: file.path } : {}) }; }
      catch (error) { const message = error instanceof Error ? error.message : String(error); failures.set(key, message); issue(file.path + " / " + key + ": " + message); return { text: "#ERROR", error: message }; }
    });
    const search = query.search.trim().toLowerCase().slice(0, 1024);
    if (search && !cells.some(cell => cell.text.toLowerCase().includes(search))) { continue; }
    const group = view.groupBy ? values.get(view.groupBy.property) : null;
    if (group !== null && typeof group === "object" && !isBaseDate(group) && !isBaseLink(group)) { throw new Error("Grouping structured/list properties is not implemented. Choose a scalar, date or link property."); }
    if (manual && (isBaseDate(group) || isBaseLink(group))) { throw new Error("Manual groupOrder for date or link group values is not implemented. Literal string group values stay distinct from dates and links; edit this view in base source or remove groupOrder for automatic grouping."); }
    if (manual && !manual.has(baseGroupOrderIdentity(group))) { continue; }
    rows.push({ path: file.path, values, failures, cells, group, groupKey: "" });
  }
  rows.sort((left, right) => {
    if (view.groupBy) {
      const group = manual ? manual.get(baseGroupOrderIdentity(left.group))! - manual.get(baseGroupOrderIdentity(right.group))! : compareBaseValues(left.group, right.group);
      if (group) { return group * (!manual && view.groupBy.direction === "DESC" ? -1 : 1); }
    }
    for (const sort of view.sort) { const value = compareBaseValues(left.values.get(sort.property), right.values.get(sort.property)); if (value) { return value * (sort.direction === "DESC" ? -1 : 1); } }
    return left.path.localeCompare(right.path, "en", { numeric: true });
  });
  const matched = rows.length;
  const limited = view.limit == null ? rows : rows.slice(0, view.limit);
  if (query.export && (limited.length > 2000 || (limited.length + 1) * view.order.length > 100000)) { throw new Error("Export supports at most 2,000 rows and 100,000 cells. Narrow the view or its limit; no partial export was produced."); }
  const columns: BaseColumn[] = view.order.map(key => ({ key, label: document.label(key), summaryKind: summaryKind(limited.find(row => row.values.get(key) != null)?.values.get(key)) }));
  const summarize = (entries: typeof limited, scope: string): (BaseSummaryCell | null)[] => columns.map(column => {
    const name = document.summary(view.name, column.key);
    if (name === null) { return null; }
    try {
      if (document.summaryErrors.has(name)) { throw new Error(document.summaryErrors.get(name)); }
      const definition = document.summaryFormulas.get(name);
      const firstValue = entries.find(row => row.values.get(column.key) != null)?.values.get(column.key);
      const kind = summaryKind(firstValue);
      const builtin = builtinSummaries(kind).get(name) ?? (firstValue == null
        ? builtinSummaries("number").get(name) ?? builtinSummaries("date").get(name) ?? builtinSummaries("boolean").get(name) : undefined);
      if (!definition && !builtin) { throw new Error("Unknown summary or incompatible column type: " + name + "."); }
      if (entries.some(row => row.failures.has(column.key))) { throw new Error("Some values could not be evaluated. Fix the column's cell errors before summarizing it."); }
      const values = entries.map(row => row.values.get(column.key) ?? null);
      const evaluator = new BaseEvaluator(query.context, query.context, new Map(), files, budget, now);
      const value = evaluator.evaluateSummary(definition ?? parseBaseExpression(builtin!), values);
      if (value != null && typeof value === "object" && !isBaseDate(value) && !isBaseLink(value)) { throw new Error("A summary must return a single scalar, date or link value."); }
      return { name, text: value == null ? "No value" : baseDisplay(value) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issue(scope + " / " + column.key + " / " + name + ": " + message);
      return { name, text: "#ERROR", error: message };
    }
  });
  const groups: { key: string; value: unknown; label: string; count: number; start: number }[] = [];
  if (manual) {
    let start = 0;
    for (const [index, value] of view.groupOrder!.entries()) {
      const key = "group-" + index, identity = baseGroupOrderIdentity(value);
      let count = 0;
      while (start + count < limited.length && baseGroupOrderIdentity(limited[start + count].group) === identity) { limited[start + count].groupKey = key; count++; }
      groups.push({ key, value, label: baseDisplay(value) || "No value", count, start }); start += count;
    }
  } else if (view.groupBy) {
    for (const [index, row] of limited.entries()) {
      const prior = groups.at(-1);
      if (prior && baseEqual(prior.value, row.group)) { prior.count++; row.groupKey = prior.key; }
      else { row.groupKey = "group-" + groups.length; groups.push({ key: row.groupKey, value: row.group, label: baseDisplay(row.group) || "No value", count: 1, start: index }); }
    }
  }
  const pages = Math.max(1, Math.ceil(limited.length / 100));
  const page = Number.isSafeInteger(query.page) ? Math.max(0, Math.min(pages - 1, query.page)) : 0;
  const visible = query.export ? limited : limited.slice(page * 100, page * 100 + 100), visibleGroups = new Set(visible.map(row => row.groupKey));
  const summaries = summarize(limited, "All rows");
  const listNumbers = new Map<typeof limited[number], number>();
  if (view.list) {
    let groupKey: string | null = null, number = 0;
    for (const row of limited) { if (row.groupKey !== groupKey) { groupKey = row.groupKey; number = 0; } if (baseListRowVisible(row.cells, view.list)) { listNumbers.set(row, ++number); } }
  }
  return {
    columns, summaries, ...(query.export ? { exported: true as const } : {}),
    rows: visible.map(row => ({ path: row.path, cells: row.cells, group: view.groupBy ? baseDisplay(row.group) || "No value" : "", groupKey: row.groupKey, ...(view.list ? { listNumber: listNumbers.get(row) ?? 0 } : {}),
      ...(view.cards ? { cover: view.cards.image ? row.failures.has(view.cards.image) ? { kind: "error" as const, message: row.failures.get(view.cards.image)! } : baseCardCover(row.values.get(view.cards.image)) : null } : {}),
    })),
    total: limited.length, matched, page, pages, groupProperty: view.groupBy ? canonical(view.groupBy.property) : null, groups: groups.map(group => ({ key: group.key, identity: baseGroupIdentity(group.value), label: group.label, count: group.count,
      ...(manual && !group.count && (query.export || page === Math.min(pages - 1, Math.floor(group.start / 100))) ? { renderEmpty: true as const } : {}),
      ...(groups.length > 1 && (visibleGroups.has(group.key) || manual && !group.count && (query.export || page === Math.min(pages - 1, Math.floor(group.start / 100)))) ? { summaries: summarize(limited.slice(group.start, group.start + group.count), "Group " + group.label) } : {}),
    })), errors,
    warnings: [...view.warnings, ...[...document.formulaErrors].map(([name, error]) => "Formula " + name + ": " + error)],
  };
}
