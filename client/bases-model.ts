import { isMap, parseDocument, visit, type Document } from "yaml";
import { BaseEvaluator, baseDisplay, baseEqual, compareBaseValues, isBaseDate, isBaseLink, parseBaseExpression, type BaseFile, type EvaluationBudget } from "./bases-expression";
import { builtinSummaries, builtinSummaryNames, summaryFormula, summaryKind, summaryName, type BaseSummaryKind } from "./bases-summaries";
export type { BaseFile } from "./bases-expression";

type Filter = { expression: ReturnType<typeof parseBaseExpression> } | { operator: "and" | "or" | "not"; children: Filter[] };
export interface BaseSort { property: string; direction: "ASC" | "DESC" }
export interface BaseView { index: number; name: string; type: string; order: string[]; filter: Filter | null; sort: BaseSort[]; groupBy: BaseSort | null; limit: number | null; summaries: ReadonlyMap<string, string>; warnings: string[] }
export interface BaseCell { text: string; error?: string; link?: string }
export interface BaseSummaryCell extends BaseCell { name: string }
export interface BaseColumn { key: string; label: string; summaryKind: BaseSummaryKind }
export interface BaseRow { path: string; cells: BaseCell[]; group: string; groupKey: string }
export interface BaseResult { columns: BaseColumn[]; rows: BaseRow[]; total: number; matched: number; page: number; pages: number; summaries: (BaseSummaryCell | null)[]; groups: { key: string; label: string; count: number; summaries?: (BaseSummaryCell | null)[] }[]; errors: string[]; warnings: string[] }
export interface BaseQuery { text: string; files: BaseFile[]; context: BaseFile; view: string; search: string; page: number; now?: number }
export interface BaseRequest extends BaseQuery { serial: number }
export type BaseResponse = { serial: number; result: BaseResult } | { serial: number; error: string };

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
      if (!Array.isArray(order) || !order.length || order.length > 64 || order.some(key => typeof key !== "string")) { throw new Error("A table needs between 1 and 64 property columns."); }
      const properties = order.map(key => { baseProperty(key); return String(key); });
      if (new Set(properties.map(canonical)).size !== properties.length) { throw new Error("A table cannot contain duplicate property columns."); }
      const sorts = view.sort ?? [];
      if (!Array.isArray(sorts) || sorts.length > 16) { throw new Error("A table supports at most 16 sort properties."); }
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
      return {
        index, name, type, order: properties, filter: filter(view.filters), sort: sorts.map(sortedProperty),
        groupBy: view.groupBy == null ? null : sortedProperty(view.groupBy), limit, summaries,
        warnings: [Object.hasOwn(view, "groupOrder") ? "Explicit group ordering/visibility is retained but not implemented." : ""].filter(Boolean),
      };
    });
  }
  view(name: string): BaseView { return this.views.find(view => view.name === name) ?? this.views[0]; }
  label(key: string): string { return this.labels.get(canonical(key)) ?? baseProperty(key).name; }
  summary(view: string, property: string): string | null { return this.view(view).summaries.get(canonical(property)) ?? null; }
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
  if (query.files.length > 10000) { throw new Error("Bases currently supports at most 10,000 files per query."); }
  const document = new BaseDocument(query.text);
  const view = document.view(query.view);
  if (view.type !== "table") { throw new Error(`The ${view.type} view is retained but not implemented. Choose a table view or edit its source.`); }
  const files = new Map(query.files.map(file => [file.path, file]));
  const budget: EvaluationBudget = { remaining: 1000000 };
  const now = query.now ?? Date.now();
  const errors: string[] = [];
  const propertyExpressions = new Map<string, ReturnType<typeof parseBaseExpression>>();
  const keys = [...new Set([...view.order, ...view.sort.map(sort => sort.property), ...(view.groupBy ? [view.groupBy.property] : [])])];
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
      try { return { text: baseDisplay(value), ...(isBaseLink(value) ? { link: value.path } : key === "file.name" || key === "file.basename" || key === "file.path" ? { link: file.path } : {}) }; }
      catch (error) { const message = error instanceof Error ? error.message : String(error); failures.set(key, message); issue(file.path + " / " + key + ": " + message); return { text: "#ERROR", error: message }; }
    });
    const search = query.search.trim().toLowerCase().slice(0, 1024);
    if (search && !cells.some(cell => cell.text.toLowerCase().includes(search))) { continue; }
    const group = view.groupBy ? values.get(view.groupBy.property) : null;
    if (group !== null && typeof group === "object" && !isBaseDate(group) && !isBaseLink(group)) { throw new Error("Grouping structured/list properties is not implemented. Choose a scalar, date or link property."); }
    rows.push({ path: file.path, values, failures, cells, group, groupKey: "" });
  }
  rows.sort((left, right) => {
    if (view.groupBy) { const group = compareBaseValues(left.group, right.group); if (group) { return group * (view.groupBy.direction === "DESC" ? -1 : 1); } }
    for (const sort of view.sort) { const value = compareBaseValues(left.values.get(sort.property), right.values.get(sort.property)); if (value) { return value * (sort.direction === "DESC" ? -1 : 1); } }
    return left.path.localeCompare(right.path, "en", { numeric: true });
  });
  const matched = rows.length;
  const limited = view.limit == null ? rows : rows.slice(0, view.limit);
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
  if (view.groupBy) {
    for (const [index, row] of limited.entries()) {
      const prior = groups.at(-1);
      if (prior && baseEqual(prior.value, row.group)) { prior.count++; row.groupKey = prior.key; }
      else { row.groupKey = "group-" + groups.length; groups.push({ key: row.groupKey, value: row.group, label: baseDisplay(row.group) || "No value", count: 1, start: index }); }
    }
  }
  const pages = Math.max(1, Math.ceil(limited.length / 100));
  const page = Number.isSafeInteger(query.page) ? Math.max(0, Math.min(pages - 1, query.page)) : 0;
  const visible = limited.slice(page * 100, page * 100 + 100), visibleGroups = new Set(visible.map(row => row.groupKey));
  const summaries = summarize(limited, "All rows");
  return {
    columns, summaries,
    rows: visible.map(row => ({ path: row.path, cells: row.cells, group: view.groupBy ? baseDisplay(row.group) || "No value" : "", groupKey: row.groupKey })),
    total: limited.length, matched, page, pages, groups: groups.map(group => ({ key: group.key, label: group.label, count: group.count,
      ...(groups.length > 1 && visibleGroups.has(group.key) ? { summaries: summarize(limited.slice(group.start, group.start + group.count), "Group " + group.label) } : {}),
    })), errors,
    warnings: [...view.warnings, ...[...document.formulaErrors].map(([name, error]) => "Formula " + name + ": " + error)],
  };
}
