import moment from "moment";

export interface BaseFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  stat: { ctime: number; mtime: number; size: number };
  properties: Record<string, unknown>;
  types?: Record<string, string>;
  tags: string[];
  links: string[];
  metadataError?: string;
}
export interface BaseDate { kind: "base-date"; milliseconds: number }
export interface BaseLink { kind: "base-link"; path: string; display: string }
interface FileValue { kind: "base-file"; file: BaseFile }
interface FormulasValue { kind: "base-formulas" }
export type BaseValue = unknown;
type Expression = { type: "literal"; value: unknown } | { type: "name"; name: string }
  | { type: "list"; items: Expression[] } | { type: "member"; object: Expression; key: Expression }
  | { type: "call"; callee: Expression; args: Expression[] } | { type: "unary"; op: string; operand: Expression }
  | { type: "binary"; op: string; left: Expression; right: Expression };
interface Token { type: "name" | "value" | "symbol" | "end"; text: string; value?: unknown; offset: number }
export interface EvaluationBudget { remaining: number }

const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const precedence: Readonly<Record<string, number>> = { "||": 1, "&&": 2, "==": 3, "!=": 3, ">": 4, "<": 4, ">=": 4, "<=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };
const own = (value: object, key: string): unknown => Object.hasOwn(value, key) ? Reflect.get(value, key) : null;
const tagged = (value: unknown, kind: string): boolean => value !== null && typeof value === "object" && own(value, "kind") === kind;
export const isBaseDate = (value: unknown): value is BaseDate => tagged(value, "base-date");
export const isBaseLink = (value: unknown): value is BaseLink => tagged(value, "base-link");
const fileValue = (file: BaseFile): FileValue => ({ kind: "base-file", file });
const dateValue = (milliseconds: number): BaseDate => ({ kind: "base-date", milliseconds });

function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)) {
    throw new Error("Expected a finite, safely representable number.");
  }
  return value;
}
function string(value: unknown): string {
  if (typeof value !== "string") { throw new Error("Expected a string."); }
  if (value.length > 65536) { throw new Error("A formula string exceeds 65,536 characters."); }
  return value;
}
function scalarText(value: unknown): string {
  if (value == null) { return ""; }
  if (isBaseDate(value)) { return moment(value.milliseconds).format("YYYY-MM-DD HH:mm:ss"); }
  if (isBaseLink(value)) { return value.display; }
  if (["string", "number", "boolean"].includes(typeof value)) { return string(String(value)); }
  throw new Error("This structured value cannot be converted to text.");
}
function tokens(source: string): Token[] {
  if (typeof source !== "string" || source.length > 4096) { throw new Error("A formula must be a string of at most 4,096 characters."); }
  const result: Token[] = [];
  let position = 0;
  while (position < source.length) {
    if (/\s/.test(source[position])) { position++; continue; }
    const offset = position;
    const quote = source[position];
    if (quote === "'" || quote === '"') {
      position++;
      let value = "";
      while (position < source.length && source[position] !== quote) {
        let character = source[position++];
        if (character === "\\") {
          character = source[position++];
          const escapes: Record<string, string> = { n: "\n", r: "\r", t: "\t", "\\": "\\", '"': '"', "'": "'", b: "\b", f: "\f" };
          if (character === "u" && /^[a-f\d]{4}$/i.test(source.slice(position, position + 4))) { value += String.fromCharCode(parseInt(source.slice(position, position + 4), 16)); position += 4; continue; }
          if (!Object.hasOwn(escapes, character)) { throw new Error("Unsupported string escape at character " + position + "."); }
          character = escapes[character];
        }
        value += character;
      }
      if (source[position++] !== quote) { throw new Error("Unclosed string at character " + offset + "."); }
      result.push({ type: "value", text: source.slice(offset, position), value, offset });
    } else {
      const number = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(position));
      const name = /^[a-zA-Z_$][\w$]*/.exec(source.slice(position));
      const operator = /^(?:&&|\|\||==|!=|<=|>=|[+\-*/%<>()\[\].,!])/.exec(source.slice(position));
      if (number) { position += number[0].length; result.push({ type: "value", text: number[0], value: finite(Number(number[0])), offset }); }
      else if (name) {
        position += name[0].length;
        if (forbidden.has(name[0])) { throw new Error("This identifier is unavailable in Bases: " + name[0]); }
        result.push(["true", "false", "null"].includes(name[0]) ? { type: "value", text: name[0], value: name[0] === "null" ? null : name[0] === "true", offset } : { type: "name", text: name[0], offset });
      } else if (operator) { position += operator[0].length; result.push({ type: "symbol", text: operator[0], offset }); }
      else { throw new Error("Unsupported formula syntax at character " + offset + ": " + source.slice(offset, offset + 12)); }
    }
    if (result.length > 1024) { throw new Error("A formula exceeds 1,024 tokens."); }
  }
  result.push({ type: "end", text: "", offset: position });
  return result;
}

export function parseBaseExpression(source: string): Expression {
  const input = tokens(source);
  let index = 0;
  const peek = (): Token => input[index];
  const consume = (symbol: string): void => { if (peek().text !== symbol) { throw new Error(`Expected ${symbol} at character ${peek().offset}.`); } index++; };
  function expression(minimum = 0, depth = 0): Expression {
    if (depth > 48) { throw new Error("Formula nesting exceeds 48 levels."); }
    const token = input[index++];
    let left: Expression;
    if (token.type === "value") { left = { type: "literal", value: token.value }; }
    else if (token.type === "name") { left = { type: "name", name: token.text }; }
    else if (["!", "-", "+"].includes(token.text)) { left = { type: "unary", op: token.text, operand: expression(7, depth + 1) }; }
    else if (token.text === "(") { left = expression(0, depth + 1); consume(")"); }
    else if (token.text === "[") {
      const items: Expression[] = [];
      if (peek().text !== "]") { do { if (items.length) { consume(","); } items.push(expression(0, depth + 1)); if (items.length > 128) { throw new Error("Formula lists have at most 128 literal elements."); } } while (peek().text === ","); }
      consume("]"); left = { type: "list", items };
    } else { throw new Error("Expected a value at character " + token.offset + "."); }
    while (true) {
      const next = peek().text;
      if (next === ".") {
        index++;
        const key = input[index++];
        if (key.type !== "name") { throw new Error("Expected a property name after the dot."); }
        left = { type: "member", object: left, key: { type: "literal", value: key.text } };
      } else if (next === "[") { index++; const key = expression(0, depth + 1); consume("]"); left = { type: "member", object: left, key }; }
      else if (next === "(") {
        index++;
        const args: Expression[] = [];
        if (peek().text !== ")") { do { if (args.length) { consume(","); } args.push(expression(0, depth + 1)); if (args.length > 32) { throw new Error("Functions have at most 32 arguments."); } } while (peek().text === ","); }
        consume(")"); left = { type: "call", callee: left, args };
      } else {
        const rank = precedence[next];
        if (rank === undefined || rank < minimum) { break; }
        index++;
        left = { type: "binary", op: next, left, right: expression(rank + 1, depth + 1) };
      }
    }
    return left;
  }
  const result = expression();
  if (peek().type !== "end") { throw new Error("Unexpected formula syntax at character " + peek().offset + "."); }
  return result;
}

export function baseEqual(left: unknown, right: unknown, depth = 0): boolean {
  if (depth > 32) { throw new Error("A value is nested too deeply to compare."); }
  if (left == null && right == null) { return true; }
  if (isBaseDate(left) && isBaseDate(right)) { return left.milliseconds === right.milliseconds; }
  if (isBaseLink(left) && isBaseLink(right)) { return left.path === right.path; }
  if (Array.isArray(left) && Array.isArray(right)) { return left.length === right.length && left.every((value, index) => baseEqual(value, right[index], depth + 1)); }
  return left === right;
}
export function compareBaseValues(left: unknown, right: unknown): number {
  if (left == null) { return right == null ? 0 : 1; }
  if (right == null) { return -1; }
  if (isBaseDate(left) && isBaseDate(right)) { return left.milliseconds - right.milliseconds; }
  if (typeof left === "number" && typeof right === "number") { return finite(left) - finite(right); }
  if (typeof left === "boolean" && typeof right === "boolean") { return Number(left) - Number(right); }
  return baseDisplay(left).localeCompare(baseDisplay(right), "en", { numeric: true });
}
export function baseDisplay(value: unknown, depth = 0): string {
  if (depth > 8) { return "Structured value"; }
  if (value == null) { return ""; }
  if (Array.isArray(value)) { return value.slice(0, 128).map(item => baseDisplay(item, depth + 1)).join(", ").slice(0, 2000); }
  if (isBaseDate(value)) { return moment(value.milliseconds).format("YYYY-MM-DD HH:mm:ss"); }
  if (isBaseLink(value)) { return String(value.display).slice(0, 2000); }
  if (typeof value === "object") { return "Structured value"; }
  if (typeof value === "number") { finite(value); }
  return String(value).slice(0, 2000);
}

export class BaseEvaluator {
  private readonly cache = new Map<string, unknown>();
  private readonly visiting = new Set<string>();
  private summaryValues: readonly unknown[] | null = null;
  private readonly bindings: ReadonlyMap<string, unknown>[] = [];
  constructor(readonly file: BaseFile, private readonly context: BaseFile, private readonly formulas: ReadonlyMap<string, Expression>, private readonly files: ReadonlyMap<string, BaseFile>, private readonly budget: EvaluationBudget, private readonly now: number) {}

  evaluateSummary(ast: Expression, values: readonly unknown[]): unknown {
    if (values.length > 10000) { throw new Error("A summary supports at most 10,000 values."); }
    this.summaryValues = values;
    try { return this.evaluate(ast); }
    finally { this.summaryValues = null; this.bindings.length = 0; }
  }

  private spend(amount: number): void {
    this.budget.remaining -= amount;
    if (this.budget.remaining < 0) { throw new Error("Bases query exceeded its evaluation budget."); }
  }

  private list(value: unknown[]): void {
    const limit = this.summaryValues === null ? 1024 : 10000;
    if (value.length > limit) { throw new Error(`Formula lists exceed ${limit.toLocaleString("en")} elements.`); }
    this.spend(value.length);
  }

  property(key: string): unknown {
    const property = /^(file|note|formula)\.(.+)$/.exec(key);
    const ast = parseBaseExpression((property?.[1] ?? "note") + "[" + JSON.stringify(property?.[2] ?? key) + "]");
    return this.evaluate(ast);
  }
  private note(file: BaseFile): Record<string, unknown> {
    if (file.metadataError) { throw new Error("This note's metadata is unavailable: " + file.metadataError); }
    return file.properties;
  }
  private noteProperty(file: BaseFile, key: string): unknown {
    const value = own(this.note(file), key);
    const type = file.types?.[key.toLowerCase()];
    if (value != null && ["date", "datetime"].includes(type ?? "")) { return this.date(string(value)); }
    if (typeof value === "number") { finite(value); }
    return value;
  }
  private date(value: string): BaseDate {
    const parsed = moment(value, moment.ISO_8601, true);
    if (!parsed.isValid()) { throw new Error("Invalid date: " + value); }
    return dateValue(parsed.valueOf());
  }
  private member(object: unknown, key: unknown): unknown {
    if (typeof key !== "string" && typeof key !== "number") { throw new Error("A property key must be a string or number."); }
    const name = String(key);
    if (forbidden.has(name)) { throw new Error("This property is unavailable in Bases: " + name); }
    if (tagged(object, "base-formulas")) {
      if (this.cache.has(name)) { return this.cache.get(name); }
      if (this.visiting.has(name)) { throw new Error("Circular formula reference: " + name); }
      const formula = this.formulas.get(name);
      if (!formula) { throw new Error("Unknown formula: " + name); }
      this.visiting.add(name);
      try { const value = this.evaluate(formula); this.cache.set(name, value); return value; }
      finally { this.visiting.delete(name); }
    }
    if (tagged(object, "base-file")) {
      const file = (object as FileValue).file;
      if (name === "file") { return object; }
      if (name === "note" || name === "properties") { return this.note(file); }
      if (name === "ext") { return file.extension; }
      if (["name", "basename", "path"].includes(name)) { return own(file, name); }
      if (name === "folder") { return file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : ""; }
      if (name === "size") { return finite(file.stat.size); }
      if (name === "ctime" || name === "mtime") { return file.stat[name] > 0 ? dateValue(file.stat[name]) : null; }
      if (name === "tags") { return file.tags.map(tag => tag.replace(/^#/, "")); }
      if (name === "links") { return file.links.map(path => ({ kind: "base-link", path, display: path.replace(/\.md$/i, "") } satisfies BaseLink)); }
      throw new Error("Unsupported file field: " + name);
    }
    if (isBaseDate(object)) {
      const date = moment(object.milliseconds);
      const fields: Record<string, number> = { year: date.year(), month: date.month() + 1, day: date.date(), hour: date.hour(), minute: date.minute(), second: date.second(), millisecond: date.millisecond() };
      if (Object.hasOwn(fields, name)) { return fields[name]; }
      throw new Error("Unsupported date field: " + name);
    }
    if ((Array.isArray(object) || typeof object === "string") && name === "length") { return object.length; }
    if (Array.isArray(object)) { return /^\d+$/.test(name) ? object[Number(name)] ?? null : null; }
    if (object === this.file.properties) { return this.noteProperty(this.file, name); }
    if (object === this.context.properties) { return this.noteProperty(this.context, name); }
    return object && typeof object === "object" ? own(object, name) : null;
  }
  evaluate(ast: Expression, depth = 0): unknown {
    if (--this.budget.remaining < 0 || depth > 96) { throw new Error("Bases query exceeded its evaluation budget."); }
    const run = (value: Expression): unknown => this.evaluate(value, depth + 1);
    switch (ast.type) {
      case "literal": return ast.value;
      case "list": return ast.items.map(run);
      case "name":
        for (let index = this.bindings.length - 1; index >= 0; index--) {
          if (this.bindings[index].has(ast.name)) { return this.bindings[index].get(ast.name); }
        }
        if (this.summaryValues !== null) { return ast.name === "values" ? this.summaryValues : null; }
        if (ast.name === "file") { return fileValue(this.file); }
        if (ast.name === "note") { return this.note(this.file); }
        if (ast.name === "this") { return fileValue(this.context); }
        if (ast.name === "formula") { return { kind: "base-formulas" } satisfies FormulasValue; }
        return this.noteProperty(this.file, ast.name);
      case "member": return this.member(run(ast.object), run(ast.key));
      case "unary": { const value = run(ast.operand); return ast.op === "!" ? !value : ast.op === "-" ? -finite(value) : finite(value); }
      case "binary": {
        const left = run(ast.left);
        if (ast.op === "&&") { return left ? run(ast.right) : left; }
        if (ast.op === "||") { return left || run(ast.right); }
        const right = run(ast.right);
        if (ast.op === "==") { return baseEqual(left, right); }
        if (ast.op === "!=") { return !baseEqual(left, right); }
        if ([">", ">=", "<", "<="].includes(ast.op)) {
          if (!(typeof left === "number" && typeof right === "number" || typeof left === "string" && typeof right === "string" || isBaseDate(left) && isBaseDate(right))) { throw new Error("Compare matching numbers, strings or dates."); }
          const comparison = typeof left === "string" && typeof right === "string" ? left < right ? -1 : left > right ? 1 : 0 : compareBaseValues(left, right);
          return ast.op === ">" ? comparison > 0 : ast.op === ">=" ? comparison >= 0 : ast.op === "<" ? comparison < 0 : comparison <= 0;
        }
        if (isBaseDate(left) && isBaseDate(right) && ast.op === "-") { return left.milliseconds - right.milliseconds; }
        if (this.summaryValues !== null && (left == null || right == null)) { return null; }
        if (isBaseDate(left) && typeof right === "string" && ["+", "-"].includes(ast.op)) {
          const duration = /^([+-]?\d+(?:\.\d+)?)\s*(y|years?|M|months?|w|weeks?|d|days?|h|hours?|m|minutes?|s|seconds?)$/.exec(right);
          if (!duration) { throw new Error("Use a supported date duration, such as 7d or 1 month."); }
          const units: Record<string, moment.unitOfTime.DurationConstructor> = { y: "years", M: "months", w: "weeks", d: "days", h: "hours", m: "minutes", s: "seconds" };
          const unit = units[duration[2]] ?? duration[2] as moment.unitOfTime.DurationConstructor;
          const result = moment(left.milliseconds).add(Number(duration[1]) * (ast.op === "-" ? -1 : 1), unit);
          if (!result.isValid()) { throw new Error("Date arithmetic is outside its supported range."); }
          return dateValue(result.valueOf());
        }
        if (ast.op === "+" && (typeof left === "string" || typeof right === "string")) { return string(scalarText(left) + scalarText(right)); }
        const a = finite(left), b = finite(right);
        return finite(ast.op === "+" ? a + b : ast.op === "-" ? a - b : ast.op === "*" ? a * b : ast.op === "/" ? a / b : a % b);
      }
      case "call": {
        if (ast.callee.type === "name" && ast.callee.name === "if") {
          if (ast.args.length < 2 || ast.args.length > 3) { throw new Error("if() needs two or three arguments."); }
          return run(ast.args[0]) ? run(ast.args[1]) : ast.args[2] ? run(ast.args[2]) : null;
        }
        if (ast.callee.type === "member") {
          const value = run(ast.callee.object), name = string(run(ast.callee.key));
          if (Array.isArray(value) && ["filter", "map", "reduce"].includes(name)) {
            if (ast.args.length !== (name === "reduce" ? 2 : 1)) { throw new Error(name + "() has an invalid argument count."); }
            this.list(value);
            let accumulator = name === "reduce" ? run(ast.args[1]) : null;
            const result: unknown[] = [];
            for (const [index, item] of value.entries()) {
              this.bindings.push(new Map<string, unknown>([["value", item], ["index", index], ["acc", accumulator]]));
              let next: unknown;
              try { next = run(ast.args[0]); }
              finally { this.bindings.pop(); }
              if (name === "reduce") { accumulator = next; }
              else if (name === "map") { result.push(next); }
              else if (next) { result.push(item); }
            }
            return name === "reduce" ? accumulator : result;
          }
          return this.method(value, name, ast.args.map(run));
        }
        const args = ast.args.map(run);
        if (ast.callee.type === "name") { return this.global(ast.callee.name, args); }
        throw new Error("Only supported Bases functions can be called.");
      }
    }
  }
  private global(name: string, args: unknown[]): unknown {
    const first = args[0];
    if (name === "now" && !args.length) { return dateValue(this.now); }
    if (name === "today" && !args.length) { return dateValue(moment(this.now).startOf("day").valueOf()); }
    if (name === "date" && args.length === 1) { return this.date(string(first)); }
    if (name === "number" && args.length === 1) {
      if (isBaseDate(first)) { return first.milliseconds; }
      if (!["number", "boolean", "string"].includes(typeof first) || typeof first === "string" && !first.trim()) { throw new Error("number() needs a numeric value."); }
      return finite(Number(first));
    }
    if (name === "list" && args.length === 1) { return Array.isArray(first) ? first : [first]; }
    if (["min", "max"].includes(name) && args.length) { return name === "min" ? Math.min(...args.map(finite)) : Math.max(...args.map(finite)); }
    if (name === "link" && args.length >= 1 && args.length <= 2) {
      const path = tagged(first, "base-file") ? (first as FileValue).file.path : string(first).replace(/^\[\[|\]\]$/g, "");
      if (/^[a-z][\w+.-]*:/i.test(path) && !/^https?:\/\//i.test(path)) { throw new Error("Unsupported link scheme."); }
      const [target, alias] = path.split("|");
      return { kind: "base-link", path: target, display: args[1] == null ? alias ?? target.replace(/\.md$/i, "") : scalarText(args[1]) } satisfies BaseLink;
    }
    throw new Error("Unsupported function or argument count: " + name + "().");
  }
  private method(value: unknown, name: string, args: unknown[]): unknown {
    const first = args[0];
    if (forbidden.has(name)) { throw new Error("This method is unavailable in Bases."); }
    if (Array.isArray(value)) { this.list(value); }
    if (this.summaryValues !== null && value == null && ["round", "toFixed", "format"].includes(name)) { return null; }
    if (name === "isEmpty" && !args.length) { return value == null || value === "" || Array.isArray(value) && !value.length; }
    if (name === "isTruthy" && !args.length) { return Boolean(value); }
    if (name === "toString" && !args.length) { return scalarText(value); }
    if (name === "isType" && args.length === 1) {
      return first === "null" ? value == null : first === "list" ? Array.isArray(value) : first === "date" ? isBaseDate(value) : first === "link" ? isBaseLink(value) : typeof value === first;
    }
    if (tagged(value, "base-file")) {
      const file = (value as FileValue).file;
      if (name === "hasTag" && args.length === 1) { const tag = string(first).replace(/^#/, ""); return file.tags.some(value => value.replace(/^#/, "") === tag || value.replace(/^#/, "").startsWith(tag + "/")); }
      if (name === "inFolder" && args.length === 1) { const folder = string(first).replace(/^\/+|\/+$/g, ""); return !folder || file.path.startsWith(folder + "/"); }
      if (name === "hasProperty" && args.length === 1) { return Object.hasOwn(this.note(file), string(first)); }
      if (name === "hasLink" && args.length === 1) {
        const target = tagged(first, "base-file") ? (first as FileValue).file.path : isBaseLink(first) ? first.path : string(first).replace(/^\[\[|\]\]$/g, "");
        const matches = [...this.files.keys()].filter(path => path === target || path.replace(/\.md$/i, "") === target || path.split("/").at(-1)?.replace(/\.md$/i, "") === target);
        return matches.length === 1 ? file.links.includes(matches[0]) : file.links.includes(target);
      }
      if (name === "asLink" && args.length <= 1) { return { kind: "base-link", path: file.path, display: first == null ? file.basename : scalarText(first) } satisfies BaseLink; }
    }
    if (isBaseDate(value)) {
      if (name === "format" && args.length === 1) { return string(moment(value.milliseconds).format(string(first))); }
      if (name === "date" && !args.length) { return dateValue(moment(value.milliseconds).startOf("day").valueOf()); }
      if (name === "time" && !args.length) { return moment(value.milliseconds).format("HH:mm:ss"); }
    }
    if (typeof value === "number") {
      const number = finite(value);
      if (["abs", "floor", "ceil"].includes(name) && !args.length) { return Math[name as "abs" | "floor" | "ceil"](number); }
      if (["round", "toFixed"].includes(name) && args.length <= 1) {
        const digits = first == null ? 0 : finite(first);
        if (!Number.isInteger(digits) || digits < 0 || digits > 12) { throw new Error("Use 0 to 12 decimal places."); }
        return name === "toFixed" ? number.toFixed(digits) : finite(Number(number.toFixed(digits)));
      }
    }
    if (typeof value === "string") {
      const text = string(value);
      if (["lower", "upper", "trim"].includes(name) && !args.length) { return name === "lower" ? text.toLowerCase() : name === "upper" ? text.toUpperCase() : text.trim(); }
      if (["startsWith", "endsWith", "contains"].includes(name) && args.length === 1) { const query = string(first); return name === "contains" ? text.includes(query) : name === "startsWith" ? text.startsWith(query) : text.endsWith(query); }
      if (name === "split" && args.length === 1) { const result = text.split(string(first)); if (result.length > 1024) { throw new Error("Formula lists exceed 1,024 elements."); } return result; }
      if (name === "replace" && args.length === 2) { return string(text.replaceAll(string(first), string(args[1]))); }
      if (name === "slice" && args.length >= 1 && args.length <= 2) { return text.slice(finite(first), args[1] == null ? undefined : finite(args[1])); }
    }
    if (Array.isArray(value) || typeof value === "string") {
      if (Array.isArray(value)) { this.spend(value.length * Math.max(1, args.length)); }
      const includes = (item: unknown): boolean => typeof value === "string" ? value.includes(string(item)) : value.some(entry => baseEqual(entry, item));
      if (name === "contains" && args.length === 1) { return includes(first); }
      if (name === "containsAny") { return args.some(includes); }
      if (name === "containsAll") { return args.every(includes); }
    }
    if (Array.isArray(value)) {
      if (["sum", "mean", "min", "max", "median", "stddev"].includes(name) && !args.length) {
        const numbers = value.filter((item): item is number => typeof item === "number").map(finite);
        if (!numbers.length) { return null; }
        if (name === "min" || name === "max") { return name === "min" ? Math.min(...numbers) : Math.max(...numbers); }
        if (name === "median") {
          this.spend(Math.ceil(numbers.length * Math.log2(numbers.length + 1)));
          numbers.sort((a, b) => a - b);
          const middle = Math.floor(numbers.length / 2);
          return numbers.length % 2 ? numbers[middle] : finite(numbers[middle - 1] / 2 + numbers[middle] / 2);
        }
        const sum = numbers.reduce((total, item) => finite(total + item), 0);
        // The pinned reference divides mean by the input-list length, including null/non-number values.
        if (name === "sum" || name === "mean") { return name === "sum" ? sum : finite(sum / value.length); }
        const mean = sum / numbers.length;
        const variance = numbers.reduce((total, item) => total + (item - mean) ** 2 / numbers.length, 0);
        return finite(Math.sqrt(variance));
      }
      if (["earliest", "latest"].includes(name) && !args.length) {
        const dates = value.flatMap(item => {
          if (isBaseDate(item)) { const milliseconds = finite(item.milliseconds); if (!moment(milliseconds).isValid()) { throw new Error("Invalid date in summary values."); } return [milliseconds]; }
          if (typeof item === "string") { const date = moment(item, moment.ISO_8601, true); return date.isValid() ? [date.valueOf()] : []; }
          return [];
        });
        return dates.length ? dateValue(name === "earliest" ? Math.min(...dates) : Math.max(...dates)) : null;
      }
      if (name === "join" && args.length <= 1) { return string(value.map(scalarText).join(first == null ? "," : string(first))); }
      if (name === "slice" && args.length >= 1 && args.length <= 2) { return value.slice(finite(first), args[1] == null ? undefined : finite(args[1])); }
      if (name === "reverse" && !args.length) { return [...value].reverse(); }
      if (name === "sort" && !args.length) { this.spend(Math.ceil(value.length * Math.log2(value.length + 1))); return [...value].sort(compareBaseValues); }
      if (name === "unique" && !args.length) {
        const objects = new WeakMap<object, number>(); let next = 0;
        const key = (item: unknown, depth = 0): unknown => {
          this.spend(1);
          if (depth > 32) { throw new Error("A value is nested too deeply to compare."); }
          if (item == null) { return ["null"]; }
          if (isBaseDate(item)) { return ["date", item.milliseconds]; }
          if (isBaseLink(item)) { return ["link", item.path]; }
          if (Array.isArray(item)) { return ["list", item.map(child => key(child, depth + 1))]; }
          if (typeof item === "object") { if (!objects.has(item)) { objects.set(item, next++); } return ["object", objects.get(item)]; }
          if (typeof item === "number") { finite(item); }
          return [typeof item, item];
        };
        const seen = new Set<string>();
        return value.filter(item => { const identity = JSON.stringify(key(item)); if (seen.has(identity)) { return false; } seen.add(identity); return true; });
      }
    }
    throw new Error("Unsupported method or value type: " + name + "().");
  }
}
