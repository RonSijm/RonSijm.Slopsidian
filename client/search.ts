import { allTags, mergeRanges, type CachedMetadata, type SourceRange } from "./markdown";

export interface SearchDocument { path: string; text: string; cache: CachedMetadata }
export interface SearchResult { path: string; matches: SourceRange[] }
export interface SearchOptions { matchCase: boolean }
export interface SearchRequest { id: number; query: string; documents: SearchDocument[]; options: SearchOptions }
export type SearchResponse = { ready: true } | { id: number; results?: SearchResult[]; error?: string };
interface Match { matched: boolean; ranges: SourceRange[] }
interface Value { text: string; regex: boolean; flags: string }
type Predicate = (document: SearchDocument) => Match;
type Token = { kind: "term"; field: string; value: Value; property?: string; offset: number } | { kind: "and" | "or" | "not" | "(" | ")"; offset: number };

export class SearchQueryError extends Error {}

function valueAt(query: string, offset: number, property = false): { value: Value; end: number } {
  const first = query[offset];
  if (first === '"' || first === "'") {
    let value = "";
    for (let index = offset + 1; index < query.length; index++) {
      if (query[index] === "\\" && index + 1 < query.length && (query[index + 1] === first || query[index + 1] === "\\")) {
        value += query[++index];
      } else if (query[index] === first) {
        return { value: { text: value, regex: false, flags: "" }, end: index + 1 };
      } else {
        value += query[index];
      }
    }
    throw new SearchQueryError(`Unclosed quoted text at column ${offset + 1}.`);
  }
  if (first === "/") {
    let escaped = false;
    let characterClass = false;
    for (let index = offset + 1; index < query.length; index++) {
      const character = query[index];
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "[") {
        characterClass = true;
      } else if (character === "]") {
        characterClass = false;
      } else if (character === "/" && !characterClass) {
        const flags = /^[a-z]*/i.exec(query.slice(index + 1))![0];
        return { value: { text: query.slice(offset + 1, index), regex: true, flags }, end: index + 1 + flags.length };
      }
    }
    throw new SearchQueryError(`Unclosed regular expression at column ${offset + 1}.`);
  }
  let value = "";
  let index = offset;
  for (; index < query.length; index++) {
    const character = query[index];
    if (property ? character === "]" : /[\s()]/.test(character)) {
      break;
    }
    if (character === "\\" && index + 1 < query.length && /[\s()[\]\\]/.test(query[index + 1])) {
      value += query[++index];
    } else {
      value += character;
    }
  }
  return { value: { text: value.trim(), regex: false, flags: "" }, end: index };
}

function tokens(query: string): Token[] {
  const result: Token[] = [];
  let index = 0;
  while (index < query.length) {
    if (/\s/.test(query[index])) {
      index++;
      continue;
    }
    const offset = index;
    if (query[index] === "(" || query[index] === ")") {
      result.push({ kind: query[index] === "(" ? "(" : ")", offset });
      index++;
      continue;
    }
    if (query[index] === "-") {
      result.push({ kind: "not", offset });
      index++;
      continue;
    }
    if (query[index] === "[") {
      index++;
      while (/\s/.test(query[index] ?? "") && index < query.length) {
        index++;
      }
      let key = "";
      if (query[index] === '"' || query[index] === "'") {
        const parsed = valueAt(query, index);
        key = parsed.value.text;
        index = parsed.end;
      } else {
        const start = index;
        while (index < query.length && query[index] !== ":" && query[index] !== "]") {
          index++;
        }
        key = query.slice(start, index).trim();
      }
      while (index < query.length && /\s/.test(query[index])) {
        index++;
      }
      if (!key) {
        throw new SearchQueryError(`A property name is required at column ${offset + 1}.`);
      }
      let value: Value = { text: "", regex: false, flags: "" };
      let field = "property-exists";
      if (query[index] === ":") {
        index++;
        while (index < query.length && /\s/.test(query[index])) {
          index++;
        }
        const parsed = valueAt(query, index, true);
        value = parsed.value;
        index = parsed.end;
        field = "property";
      }
      while (index < query.length && /\s/.test(query[index])) {
        index++;
      }
      if (query[index] !== "]") {
        throw new SearchQueryError(`Unclosed property query at column ${offset + 1}.`);
      }
      result.push({ kind: "term", field, property: key, value, offset });
      index++;
      continue;
    }
    const prefix = /^([a-z][a-z-]*):/i.exec(query.slice(index));
    const field = prefix?.[1].toLowerCase() ?? "content";
    if (prefix) {
      index += prefix[0].length;
    }
    const quoted = query[index] === '"' || query[index] === "'" || query[index] === "/";
    const parsed = valueAt(query, index);
    index = parsed.end;
    if (!prefix && !quoted && ["AND", "OR", "NOT"].includes(parsed.value.text)) {
      const kind = parsed.value.text.toLowerCase();
      result.push({ kind: kind === "and" ? "and" : kind === "or" ? "or" : "not", offset });
    } else {
      if (!parsed.value.text) {
        throw new SearchQueryError(`A search value is required at column ${offset + 1}.`);
      }
      result.push({ kind: "term", field, value: parsed.value, offset });
    }
  }
  return result;
}

function regexp(value: Value, options: SearchOptions): RegExp {
  const text = value.regex ? value.text : value.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (/[^gimsu]/.test(value.flags) || new Set(value.flags).size !== value.flags.length) {
    throw new SearchQueryError("Regular-expression flags must be unique and use only g, i, m, s or u.");
  }
  const flags = new Set("g" + value.flags + (options.matchCase ? "" : "i"));
  try {
    return new RegExp(text, [...flags].join(""));
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    throw new SearchQueryError("Invalid regular expression: " + error.message);
  }
}

function rangesFor(regex: RegExp, text: string): SourceRange[] {
  regex.lastIndex = 0;
  const result: SourceRange[] = [];
  for (const match of text.matchAll(regex)) {
    result.push({ from: match.index, to: match.index + match[0].length });
  }
  return result;
}

function values(value: unknown, seen = new WeakSet<object>()): unknown[] {
  if (value === null || typeof value !== "object") {
    return [value];
  }
  if (seen.has(value)) {
    return [];
  }
  seen.add(value);
  return Object.values(value).flatMap(entry => values(entry, seen));
}

function term(token: Extract<Token, { kind: "term" }>, options: SearchOptions): Predicate {
  const { field, value } = token;
  if (!["content", "path", "file", "tag", "property", "property-exists"].includes(field)) {
    throw new SearchQueryError(`Unknown search operator "${field}" at column ${token.offset + 1}.`);
  }
  const regex = regexp(value, options);
  if (field === "content") {
    return document => {
      const ranges = rangesFor(regex, document.text);
      return { matched: ranges.length > 0, ranges };
    };
  }
  if (field === "path" || field === "file") {
    return document => ({ matched: rangesFor(regex, field === "path" ? document.path : document.path.split("/").at(-1)!).length > 0, ranges: [] });
  }
  if (field === "tag") {
    const wanted = value.text.replace(/^#/, "").toLowerCase();
    return document => {
      const matches = (tag: string): boolean => value.regex ? rangesFor(regex, tag).length > 0 : tag.slice(1).toLowerCase() === wanted || tag.slice(1).toLowerCase().startsWith(wanted + "/");
      const found = allTags(document.cache).some(matches);
      const ranges = document.cache.tags.filter(entry => matches(entry.tag)).map(entry => ({ from: entry.position.start.offset, to: entry.position.end.offset }));
      if (found && !ranges.length && document.cache.frontmatterPosition) {
        ranges.push({ from: document.cache.frontmatterPosition.start.offset, to: document.cache.frontmatterPosition.end.offset });
      }
      return { matched: found, ranges };
    };
  }
  const comparison = !value.regex ? /^(>=|<=|!=|>|<|=)\s*(-?(?:\d+(?:\.\d*)?|\.\d+))$/.exec(value.text) : null;
  return document => {
    const properties = document.cache.frontmatter;
    const key = properties ? Object.keys(properties).find(key => key.toLowerCase() === token.property?.toLowerCase()) : undefined;
    if (!properties || key === undefined) {
      return { matched: false, ranges: [] };
    }
    let matched = field === "property-exists";
    if (comparison) {
      const bound = Number(comparison[2]);
      matched = values(properties[key]).some(entry => {
        if (typeof entry !== "number") {
          return false;
        }
        if (comparison[1] === ">=") { return entry >= bound; }
        if (comparison[1] === "<=") { return entry <= bound; }
        if (comparison[1] === ">") { return entry > bound; }
        if (comparison[1] === "<") { return entry < bound; }
        if (comparison[1] === "!=") { return entry !== bound; }
        return entry === bound;
      });
    } else if (field === "property") {
      matched = values(properties[key]).some(entry => {
        if (!value.regex && ["true", "false", "null"].includes(value.text.toLowerCase())) {
          return entry === JSON.parse(value.text.toLowerCase());
        }
        return rangesFor(regex, String(entry)).length > 0;
      });
    }
    const position = document.cache.frontmatterPosition;
    return { matched, ranges: matched && position ? [{ from: position.start.offset, to: position.end.offset }] : [] };
  };
}

export function compileSearch(query: string, options: SearchOptions = { matchCase: false }): Predicate {
  const input = tokens(query);
  let cursor = 0;
  const unary = (): Predicate => {
    const token = input[cursor++];
    if (!token) {
      throw new SearchQueryError("The query ends before its expression is complete.");
    }
    if (token.kind === "not") {
      const child = unary();
      return document => ({ matched: !child(document).matched, ranges: [] });
    }
    if (token.kind === "(") {
      const child = disjunction();
      if (input[cursor]?.kind !== ")") {
        throw new SearchQueryError(`Unclosed parentheses at column ${token.offset + 1}.`);
      }
      cursor++;
      return child;
    }
    if (token.kind !== "term") {
      throw new SearchQueryError(`Expected a search expression at column ${token.offset + 1}.`);
    }
    return term(token, options);
  };
  const conjunction = (): Predicate => {
    let left = unary();
    while (cursor < input.length && input[cursor].kind !== ")" && input[cursor].kind !== "or") {
      if (input[cursor].kind === "and") {
        cursor++;
      }
      const first = left;
      const right = unary();
      left = document => {
        const a = first(document);
        if (!a.matched) {
          return a;
        }
        const b = right(document);
        return { matched: b.matched, ranges: b.matched ? [...a.ranges, ...b.ranges] : [] };
      };
    }
    return left;
  };
  const disjunction = (): Predicate => {
    let left = conjunction();
    while (input[cursor]?.kind === "or") {
      cursor++;
      const first = left;
      const right = conjunction();
      left = document => {
        const a = first(document);
        const b = right(document);
        return { matched: a.matched || b.matched, ranges: [...(a.matched ? a.ranges : []), ...(b.matched ? b.ranges : [])] };
      };
    }
    return left;
  };
  if (!input.length) {
    return () => ({ matched: false, ranges: [] });
  }
  const predicate = disjunction();
  if (cursor !== input.length) {
    throw new SearchQueryError(`Unexpected closing parentheses at column ${input[cursor].offset + 1}.`);
  }
  return predicate;
}

export function searchDocuments(documents: readonly SearchDocument[], query: string, options: SearchOptions = { matchCase: false }): SearchResult[] {
  const predicate = compileSearch(query, options);
  const result: SearchResult[] = [];
  for (const document of documents) {
    const match = predicate(document);
    if (match.matched) {
      result.push({ path: document.path, matches: mergeRanges(match.ranges) });
    }
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}
