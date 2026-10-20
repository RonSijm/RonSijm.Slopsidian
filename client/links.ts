import { isEscaped, updateFrontmatter, type CachedMetadata, type LinkCache, type Loc } from "./markdown";

export interface LinkTarget { path: string; subpath: string }
export interface LinkDestination<T> { file: T; ambiguous: boolean; candidates: T[] }

export interface OutgoingLink<T> {
  reference: LinkCache;
  target: LinkTarget | null;
  destination: T | null;
  ambiguous: boolean;
  occurrences: number;
  error: string | null;
}

export function outgoingLinks<T extends { path: string }>(cache: CachedMetadata, resolve: (link: LinkCache, source: string) => LinkDestination<T> | null, sourcePath: string): OutgoingLink<T>[] {
  const result = new Map<string, OutgoingLink<T>>();
  const references = [...cache.links, ...cache.embeds, ...cache.frontmatterLinks].sort((left, right) => left.position.start.offset - right.position.start.offset);
  for (const reference of references) {
    const uri = reference.kind === "markdown" || reference.kind === "reference";
    let target: LinkTarget | null = null;
    let destination: LinkDestination<T> | null = null;
    let error: string | null = null;
    try {
      target = parseLinktext(reference.link, uri);
      destination = resolve(reference, sourcePath);
    } catch (issue) {
      if (!(issue instanceof URIError)) {
        throw issue;
      }
      error = `Invalid URL encoding in "${reference.link}": ${issue.message}`;
    }
    const key = JSON.stringify([error, destination?.file.path ?? target?.path ?? reference.link, target?.subpath ?? ""]);
    const prior = result.get(key);
    if (prior) {
      prior.occurrences++;
    } else {
      result.set(key, { reference, target, destination: destination?.file ?? null, ambiguous: destination?.ambiguous ?? false, occurrences: 1, error });
    }
  }
  return [...result.values()];
}

export class LinkCreationError extends Error {}

export function newLinkedNotePath(target: LinkTarget, sourcePath: string): string {
  if (!target.path.trim() || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target.path)) {
    throw new LinkCreationError("A missing heading or external URL cannot be created as a note.");
  }
  const relative = /^(?:\.{1,2})[\\/]/.test(target.path);
  const path = normalizeVaultPath((relative && parentPath(sourcePath) ? parentPath(sourcePath) + "/" : "") + target.path);
  if (!path || path.split("/").some(part => part.startsWith(".") || part.length > 255 || /[. ]$|[<>:"|?*\x00-\x1f]/.test(part) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])($|\.)/i.test(part))) {
    throw new LinkCreationError("The linked note needs a valid path inside the vault.");
  }
  const name = path.split("/").at(-1)!;
  if (name.includes(".") && !/\.md$/i.test(name)) {
    throw new LinkCreationError("Use an explicit .md extension for a new note with dots; missing attachments cannot be created as notes.");
  }
  return /\.md$/i.test(path) ? path : path + ".md";
}

export function parseLinktext(linktext: string, uri = false): LinkTarget {
  let boundary = -1;
  for (let index = 0; index < linktext.length; index++) {
    if (linktext[index] === "#" && (index === 0 || linktext[index - 1] !== "\\")) {
      boundary = index;
      break;
    }
  }
  const path = boundary < 0 ? linktext : linktext.slice(0, boundary);
  const subpath = boundary < 0 ? "" : linktext.slice(boundary);
  return {
    path: uri ? decodeURIComponent(path) : path.replace(/\\([|#\]])/g, "$1"),
    subpath: uri ? decodeURIComponent(subpath) : subpath.replace(/\\([|#\]])/g, "$1"),
  };
}

export function parentPath(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

export function normalizeVaultPath(path: string): string | null {
  const result: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      if (!result.length) {
        return null;
      }
      result.pop();
    } else if (part.includes("\0")) {
      return null;
    } else {
      result.push(part);
    }
  }
  return result.join("/");
}

export function relativeVaultPath(source: string, target: string): string {
  const folder = parentPath(source).split("/").filter(Boolean);
  const result = target.split("/");
  while (folder.length && result.length && folder[0].toLowerCase() === result[0].toLowerCase()) {
    folder.shift();
    result.shift();
  }
  return [...folder.map(() => ".."), ...result].join("/");
}

export function createLinkResolver<T extends { path: string }>(files: readonly T[]): (linktext: string, sourcePath: string, uri?: boolean) => LinkDestination<T> | null {
  const byPath = new Map<string, T[]>();
  const byName = new Map<string, T[]>();
  for (const file of files) {
    const path = file.path.toLowerCase();
    const filename = path.split("/").at(-1)!;
    byPath.set(path, [...byPath.get(path) ?? [], file]);
    byName.set(filename, [...byName.get(filename) ?? [], file]);
  }
  return (linktext: string, sourcePath: string, uri = false): LinkDestination<T> | null => {
  const target = parseLinktext(linktext, uri);
  if (!target.path) {
    const file = byPath.get(sourcePath.toLowerCase())?.[0];
    return file ? { file, ambiguous: false, candidates: [file] } : null;
  }
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target.path)) {
    return null;
  }
  const folder = parentPath(sourcePath);
  const explicitRelative = /^(?:\.{1,2})[\\/]/.test(target.path);
  const explicitRoot = target.path.startsWith("/");
  const candidates = (path: string): T[] => {
    const paths = [path, path.toLowerCase().endsWith(".md") ? path : `${path}.md`].map(value => value.toLowerCase());
    return paths.flatMap(candidate => byPath.get(candidate) ?? []).filter((file, index, entries) => entries.indexOf(file) === index);
  };
  const asRelative = normalizeVaultPath((folder ? folder + "/" : "") + target.path);
  const asRoot = normalizeVaultPath(target.path);
  if (explicitRelative) {
    const found = asRelative === null ? [] : candidates(asRelative);
    return found.length ? { file: found[0], ambiguous: found.length > 1, candidates: found } : null;
  }
  const paths = explicitRoot || target.path.includes("/") ? [asRoot, asRelative] : [asRelative, asRoot];
  for (const path of paths) {
    const found = path === null ? [] : candidates(path);
    if (found.length) {
      return { file: found[0], ambiguous: found.length > 1, candidates: found };
    }
  }
  if (explicitRoot || target.path.includes("/")) {
    return null;
  }
  const name = target.path.toLowerCase();
  const possible = [...byName.get(name) ?? [], ...byName.get(name + ".md") ?? []];
  const distance = (path: string): number => {
    const source = folder.split("/").filter(Boolean);
    const destination = parentPath(path).split("/").filter(Boolean);
    let common = 0;
    while (common < source.length && common < destination.length && source[common].toLowerCase() === destination[common].toLowerCase()) {
      common++;
    }
    return source.length + destination.length - common * 2;
  };
  possible.sort((left, right) => distance(left.path) - distance(right.path) || left.path.localeCompare(right.path));
  const closest = possible.filter(file => distance(file.path) === distance(possible[0]?.path ?? ""));
  return possible.length ? { file: possible[0], ambiguous: closest.length > 1, candidates: closest } : null;
  };
}

export function resolveLink<T extends { path: string }>(files: readonly T[], linktext: string, sourcePath: string, uri = false): LinkDestination<T> | null {
  return createLinkResolver(files)(linktext, sourcePath, uri);
}

export function fileLinktext(files: readonly { path: string }[], path: string, sourcePath: string, omitMdExtension = true): string {
  const markdown = omitMdExtension && /\.md$/i.test(path);
  const name = path.split("/").at(-1)!;
  const candidates = new Set([markdown ? name.slice(0, -3) : name, markdown ? path.slice(0, -3) : path, path]);
  const resolve = createLinkResolver(files);
  for (const candidate of candidates) {
    const destination = resolve(candidate, sourcePath);
    if (destination?.file.path === path && !destination.ambiguous) { return candidate; }
  }
  throw new Error("The file has no unambiguous supported link text: " + path);
}

export function linkDestination<T extends { path: string }>(files: readonly T[], link: LinkCache, sourcePath: string): LinkDestination<T> | null {
  return resolveLink(files, link.link, sourcePath, link.kind === "markdown" || link.kind === "reference");
}

export function rewriteFileLinks(content: string, cache: CachedMetadata, files: readonly { path: string }[], sourcePath: string, oldPath: string, newPath: string): string {
  return rewriteLinks(content, cache, files, sourcePath, sourcePath === oldPath ? newPath : sourcePath, { oldPath, newPath });
}

export function relocateMarkdownLinks(content: string, cache: CachedMetadata, files: readonly { path: string }[], sourcePath: string, destinationPath: string): string {
  return rewriteLinks(content, cache, files, sourcePath, destinationPath);
}

export function rewriteSectionLinks(content: string, cache: CachedMetadata, files: readonly { path: string }[], sourcePath: string, oldPath: string, newPath: string, subpaths: readonly string[], destinationPath = sourcePath): string {
  return rewriteLinks(content, cache, files, sourcePath, destinationPath, { oldPath, newPath, subpaths });
}

export function subpathIdentity(value: string): string {
  const subpath = value.replace(/^#/, "");
  return subpath.startsWith("^") ? subpath : subpath.normalize("NFC").trim().toLowerCase().replace(/[*_`]/g, "").replace(/\s+/g, " ");
}

function rewriteLinks(content: string, cache: CachedMetadata, files: readonly { path: string }[], sourcePath: string, nextSource: string, rename?: { oldPath: string; newPath: string; subpaths?: readonly string[] }): string {
  const changingFolder = parentPath(sourcePath).toLowerCase() !== parentPath(nextSource).toLowerCase();
  const before = createLinkResolver(files);
  const paths = files.map(file => rename && !rename.subpaths && file.path === rename.oldPath ? rename.newPath : file.path);
  if (rename?.subpaths) { paths.push(rename.newPath); }
  const after = createLinkResolver([...new Set(paths)].map(path => ({ path })));
  const edits = new Map<string, { from: number; to: number; text: string }>();
  const properties = new Map<string, { path: (string | number)[]; replacements: Map<string, string> }>();
  const wiki = (value: string): string => value.replace(/([\\|#\]])/g, "\\$1");
  for (const reference of [...cache.links, ...cache.embeds, ...cache.frontmatterLinks]) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference.link)) { continue; }
    const uri = reference.kind === "markdown" || reference.kind === "reference";
    let destination: LinkDestination<{ path: string }> | null;
    try { destination = before(reference.link, sourcePath, uri); }
    catch (error) {
      if (!(error instanceof URIError)) { throw error; }
      if (changingFolder) { throw new Error("Correct invalid URL encoding before moving its content: " + reference.original); }
      continue;
    }
    const target = parseLinktext(reference.link, uri);
    if (!destination) {
      if (changingFolder && target.path && !target.path.startsWith("/")) {
        throw new Error("Resolve this unresolved link or give it an explicit vault-root path before moving its content: " + reference.original);
      }
      continue;
    }
    const retarget = rename && destination.file.path === rename.oldPath && (!rename.subpaths || rename.subpaths.some(subpath => subpathIdentity(subpath) === subpathIdentity(target.subpath)));
    const expected = retarget ? rename.newPath : destination.file.path;
    const next = after(reference.link, nextSource, uri);
    const movedRelative = uri && sourcePath !== nextSource && target.path && !target.path.startsWith("/");
    const renamedTarget = retarget && target.path;
    if (destination.ambiguous && !movedRelative && !destination.candidates.some(file => file.path === rename?.oldPath) && next?.ambiguous
      && destination.candidates.length === next.candidates.length && destination.candidates.every(file => next.candidates.some(candidate => candidate.path === file.path))) { continue; }
    if (!movedRelative && !renamedTarget && next?.file.path === expected && !next.ambiguous) { continue; }
    if (destination.ambiguous) { throw new Error("Use an explicit path for this ambiguous link before moving its content: " + reference.original); }
    let rewritten: string;
    if (uri) {
      let path = target.path.startsWith("/") ? "/" + expected : relativeVaultPath(nextSource, expected);
      if (!path.startsWith("/") && !path.startsWith("../") && !path.startsWith("./")) { path = "./" + path; }
      rewritten = path.split("/").map(part => encodeURIComponent(part)).join("/") + (target.subpath ? "#" + encodeURIComponent(target.subpath.slice(1)) : "");
    } else {
      let path = /^(?:\.{1,2})[\\/]/.test(target.path) ? relativeVaultPath(nextSource, expected) : (target.path.startsWith("/") ? "/" : "") + expected;
      if (/^(?:\.{1,2})[\\/]/.test(target.path) && !path.startsWith("../")) { path = "./" + path; }
      if (/\.md$/i.test(path) && !/\.md$/i.test(target.path)) { path = path.slice(0, -3); }
      const subpath = target.subpath ? "#" + wiki(target.subpath.slice(1)) : "";
      rewritten = wiki(path) + subpath;
      const resolved = after(rewritten, nextSource);
      if (resolved?.file.path !== expected || resolved.ambiguous) {
        const absolute = /\.md$/i.test(expected) && !/\.md$/i.test(target.path) ? expected.slice(0, -3) : expected;
        rewritten = "/" + wiki(absolute) + subpath;
      }
    }
    const resolved = after(rewritten, nextSource, uri);
    if (resolved?.file.path !== expected || resolved.ambiguous) { throw new Error("A rewritten reference could not be resolved safely: " + reference.original); }
    if (reference.kind === "frontmatter") {
      if (!reference.propertyPath?.length) { throw new Error("This frontmatter reference has no editable property path."); }
      const key = JSON.stringify(reference.propertyPath);
      const entry = properties.get(key) ?? { path: reference.propertyPath, replacements: new Map<string, string>() };
      const from = reference.original.indexOf("[[") + 2;
      let to = reference.original.length - 2;
      for (let index = from; index < to; index++) { if (reference.original[index] === "|" && !isEscaped(reference.original, index)) { to = index; break; } }
      entry.replacements.set(reference.original, reference.original.slice(0, from) + rewritten + reference.original.slice(to));
      properties.set(key, entry);
    } else {
      const range = reference.targetPosition;
      if (!range) { throw new Error("This link has no supported editable source range: " + reference.original); }
      const key = `${range.start.offset}:${range.end.offset}`;
      const previous = edits.get(key);
      if (previous && previous.text !== rewritten) { throw new Error("Shared link destinations cannot be rewritten consistently."); }
      edits.set(key, { from: range.start.offset, to: range.end.offset, text: rewritten });
    }
  }
  let result = replaceSourceRanges(content, [...edits.values()]);
  if (properties.size) {
    result = updateFrontmatter(result, values => {
      for (const entry of properties.values()) {
        let parent: unknown = values;
        for (const key of entry.path.slice(0, -1)) {
          if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key)) { throw new Error("A linked property changed while planning the content move."); }
          parent = Reflect.get(parent, key);
        }
        const key = entry.path.at(-1)!;
        if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key)) { throw new Error("A linked property is missing."); }
        const value: unknown = Reflect.get(parent, key);
        if (typeof value !== "string") { throw new Error("A linked property no longer contains text."); }
        const ranges: { from: number; to: number; text: string }[] = [];
        for (const [original, replacement] of entry.replacements) {
          for (let from = value.indexOf(original); from >= 0; from = value.indexOf(original, from + original.length)) { ranges.push({ from, to: from + original.length, text: replacement }); }
        }
        Reflect.set(parent, key, replaceSourceRanges(value, ranges));
      }
    });
  }
  return result;
}

function replaceSourceRanges(content: string, edits: { from: number; to: number; text: string }[]): string {
  let boundary = content.length;
  for (const edit of edits.sort((left, right) => right.from - left.from)) {
    if (edit.from < 0 || edit.to < edit.from || edit.to > boundary) { throw new Error("Reference edit ranges overlap or extend beyond their source."); }
    content = content.slice(0, edit.from) + edit.text + content.slice(edit.to);
    boundary = edit.from;
  }
  return content;
}

export function resolveSubpath(cache: CachedMetadata, subpath: string): { type: "heading" | "block"; start: Loc; end: Loc } | null {
  const value = subpath.replace(/^#/, "");
  if (value.startsWith("^")) {
    const block = cache.blocks[value.slice(1)];
    return block ? { type: "block", start: block.position.start, end: block.position.end } : null;
  }
  const heading = cache.headings.find(entry => subpathIdentity(entry.heading) === subpathIdentity(value));
  return heading ? { type: "heading", start: heading.position.start, end: heading.position.end } : null;
}
