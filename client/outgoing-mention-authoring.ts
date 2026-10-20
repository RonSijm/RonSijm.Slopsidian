import type { App } from "./app";
import { EditorView } from "@codemirror/view";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { markdownParseSource, outgoingMentions, parseMarkdown, plainMarkdown, type CachedMetadata, type LinkCache, type SourceRange, type UnlinkedTarget } from "./markdown";
import type { TFile } from "./vault";
import type { MarkdownView } from "./workspace";

export class OutgoingMentionError extends Error {}
const changed = (): never => { throw new OutgoingMentionError("The note, mention, destination or view changed. No link was inserted. Choose the current mention again."); };
const MAX_SOURCE = 1_000_000, MAX_LABEL = 4_096;

function percentComments(text: string, ignored: readonly SourceRange[]): SourceRange[] {
  let opener = -1, blocked = 0; const ranges: SourceRange[] = [];
  for (const marker of text.matchAll(/%%/g)) {
    let slashes = 0; for (let index = marker.index - 1; index >= 0 && text[index] === "\\"; index--) { slashes++; }
    while (blocked < ignored.length && ignored[blocked].to <= marker.index) { blocked++; }
    if (slashes % 2 || ignored[blocked] && ignored[blocked].from < marker.index + 2) { continue; }
    if (opener < 0) { opener = marker.index; }
    else { ranges.push({ from: opener, to: marker.index + 2 }); opener = -1; }
  }
  if (opener >= 0) { ranges.push({ from: opener, to: text.length }); } return ranges;
}

function blockedRanges(text: string, cache: CachedMetadata, comments: readonly SourceRange[], tree = markdownLanguage.parser.parse(markdownParseSource(text))): SourceRange[] {
  const ranges = [...cache.ignored, ...comments, ...cache.sections.filter(section => section.type === "table").map(section => ({ from: section.position.start.offset, to: section.position.end.offset })),
    ...Object.values(cache.blocks).map(block => ({ from: block.idPosition.start.offset, to: block.idPosition.end.offset })),
    ...cache.tags.map(tag => ({ from: tag.position.start.offset, to: tag.position.end.offset })),
    ...cache.footnoteRefs.map(note => ({ from: note.position.start.offset, to: note.position.end.offset })),
    ...cache.footnotes.map(note => ({ from: note.labelPosition.start.offset, to: note.labelPosition.end.offset }))];
  tree.iterate({ enter(node) {
    if (/(?:Mark|Marker)$/.test(node.name) || ["Escape", "HorizontalRule", "LinkReference", "LinkLabel", "URL", "LinkTitle"].includes(node.name)) { ranges.push({ from: node.from, to: node.to }); }
  } });
  // Callout types/fold signs and the renderer's additional inline delimiters
  // are source syntax even where the generic Markdown tree has no such node.
  for (const match of text.matchAll(/^[ \t]*(?:>[ \t]*)+\[![^\]\r\n]+\][+-]?[ \t]*/gm)) { ranges.push({ from: match.index, to: match.index + match[0].length }); }
  for (const match of text.matchAll(/==|~~/g)) { ranges.push({ from: match.index, to: match.index + 2 }); }
  ranges.sort((a, b) => a.from - b.from || a.to - b.to); const merged: SourceRange[] = [];
  for (const range of ranges) { const last = merged.at(-1); if (last && range.from <= last.to) { last.to = Math.max(last.to, range.to); } else { merged.push({ ...range }); } }
  return merged;
}

function topology(tree: ReturnType<typeof markdownLanguage.parser.parse>, range: SourceRange, delta = 0): readonly (readonly [string, number, number])[] {
  const result: [string, number, number][] = [], structural = /^(?:Document|Paragraph|Blockquote|BulletList|OrderedList|ListItem|Task|Table|TableHeader|TableRow|TableCell|HorizontalRule|FencedCode|CodeBlock|HTMLBlock|LinkReference|(?:ATX|Setext)Heading[1-6])$/;
  tree.iterate({ enter(node) {
    if (node.from >= range.from && node.to <= range.to && !structural.test(node.name)) { return false; }
    result.push([node.name, node.from + (node.from >= range.to ? delta : 0), node.to + (node.to >= range.to ? delta : 0)]);
  } }); return result;
}
function blocked(ranges: readonly SourceRange[], range: SourceRange): boolean {
  let low = 0, high = ranges.length;
  while (low < high) { const middle = (low + high) >>> 1; if (ranges[middle].to <= range.from) { low = middle + 1; } else { high = middle; } }
  return low < ranges.length && ranges[low].from < range.to;
}

/** Shared render-time syntax eligibility for live editors and explicit visible-open intents. */
export function outgoingMentionProseRanges(text: string, cache: CachedMetadata): readonly SourceRange[] | null {
  if (text.length > MAX_SOURCE || cache.errors.length) { return null; }
  return blockedRanges(text, cache, percentComments(text, cache.ignored));
}
export function outgoingMentionRangeSupported(text: string, ranges: readonly SourceRange[], range: SourceRange): boolean {
  return Number.isInteger(range.from) && Number.isInteger(range.to) && range.from >= 0 && range.to > range.from
    && range.to <= text.length && range.to - range.from <= MAX_LABEL && !blocked(ranges, range);
}

export interface OutgoingMentionPlan extends SourceRange { insert: string; text: string; reference: LinkCache }

/** Recheck the exact existing match and prove that the insertion creates only one complete link. */
export function planOutgoingMentionLink(text: string, sourcePath: string, target: UnlinkedTarget, range: SourceRange, insert: string): OutgoingMentionPlan {
  if (typeof text !== "string" || text.length > MAX_SOURCE || typeof insert !== "string" || insert.length > 32_768
    || !Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 0 || range.to <= range.from || range.to > text.length) { return changed(); }
  const label = text.slice(range.from, range.to), cache = parseMarkdown(text), syntax = markdownLanguage.parser.parse(markdownParseSource(text));
  if (label.length > MAX_LABEL || /[\r\n\x00-\x1f\x7f]/.test(label) || cache.errors.length || blocked(blockedRanges(text, cache, percentComments(text, cache.ignored), syntax), range)) { return changed(); }
  const rawAliases = target.cache?.frontmatter?.aliases, aliases = Array.isArray(rawAliases) ? rawAliases : typeof rawAliases === "string" ? [rawAliases] : [];
  if (aliases.length > 32 || aliases.some(alias => typeof alias === "string" && alias.length > MAX_LABEL)) { return changed(); }
  const names = [target.basename, ...aliases].filter((name): name is string => typeof name === "string" && Boolean(name.trim()));
  // The matcher merges overlapping aliases. A union of two names is not itself
  // an authorable occurrence unless it is also a complete destination name.
  if (!names.some(name => new RegExp("^(?:" + name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")$", "iu").test(label))
    || !outgoingMentions(text, cache, sourcePath, [target]).some(item => item.matches.some(match => match.from === range.from && match.to === range.to))) { return changed(); }
  const linked = parseMarkdown(insert), reference = linked.links[0];
  const display = reference?.kind === "markdown" ? reference.displayText?.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1") : reference?.displayText;
  if (linked.errors.length || linked.links.length !== 1 || linked.embeds.length || !reference || display !== label
    || reference.position.start.offset !== 0 || reference.position.end.offset !== insert.length) { return changed(); }
  const next = text.slice(0, range.from) + insert + text.slice(range.to), after = parseMarkdown(next), delta = insert.length - (range.to - range.from);
  const added = after.links.find(link => link.position.start.offset === range.from && link.position.end.offset === range.from + insert.length);
  const unchanged = (old: LinkCache, actual: LinkCache | undefined): boolean => Boolean(actual && old.kind === actual.kind && old.link === actual.link && old.original === actual.original
    && old.position.start.offset + (old.position.start.offset >= range.to ? delta : 0) === actual.position.start.offset
    && old.position.end.offset + (old.position.end.offset >= range.to ? delta : 0) === actual.position.end.offset);
  const retained = after.links.filter(link => link !== added);
  if (!added || added.original !== insert || after.links.length !== cache.links.length + 1 || after.embeds.length !== cache.embeds.length
    || cache.links.some((link, index) => !unchanged(link, retained[index])) || cache.embeds.some((link, index) => !unchanged(link, after.embeds[index]))
    || after.errors.length || JSON.stringify(topology(syntax, range, delta)) !== JSON.stringify(topology(markdownLanguage.parser.parse(markdownParseSource(next)), { from: range.from, to: range.from + insert.length }))
    || cache.headings.length !== after.headings.length || cache.headings.some((heading, index) => heading.level !== after.headings[index].level || plainMarkdown(heading.heading) !== plainMarkdown(after.headings[index].heading))
    || JSON.stringify(Object.keys(cache.blocks)) !== JSON.stringify(Object.keys(after.blocks))) { return changed(); }
  return { from: range.from, to: range.to, insert, text: next, reference: added };
}

export interface OutgoingMentionAuthority {
  app: App; root: string; file: TFile; path: string; text: string;
  view: MarkdownView; session: NonNullable<MarkdownView["session"]>; document: NonNullable<MarkdownView["savedDocument"]>;
  editor: MarkdownView["editor"]; cm: MarkdownView["editor"]["cm"]; savedVersion: string; savedText: string; savedBom: boolean;
  cmDocument: MarkdownView["editor"]["cm"]["state"]["doc"]; mode: string; editingMode: string;
  preferences: readonly (readonly [string, unknown])[];
}
export interface OutgoingMentionEnvironment extends OutgoingMentionAuthority { cache: CachedMetadata; blocked: readonly SourceRange[] }
export interface OutgoingMentionReview extends OutgoingMentionEnvironment {
  target: TFile; targetPath: string; targetText: string; targetVersion: string; targetSavedText: string; targetBom: boolean; range: SourceRange;
}
export interface OutgoingMentionChoice extends OutgoingMentionReview { plan: OutgoingMentionPlan }

function sourceCurrent(app: App, file: TFile, text: string, view: MarkdownView): boolean {
  const session = view.session;
  return !app.vault.readOnly && !app.changingVault && !app.core.busy && app.core.isEnabled("outgoing-link")
    && !app.workspace.isChangingFiles && !app.workspace.isChangingLayout && file.vault === app.vault && app.vault.getFileByPath(file.path) === file
    && view.isLoaded && view.file === file && view.leaf.view === view && view.getMode() === "source" && Boolean(view.editor.cm.dom.isConnected)
    && !view.editor.cm.composing && !view.editor.cm.state.readOnly && view.editor.cm.state.facet(EditorView.editable)
    && Boolean(session && app.workspace.sessions.get(file.path) === session && session.originRoot === app.vault.rootPath
      && !session.isReloading && !session.isSaving && session.text === text && view.editor.getValue() === text);
}

/** A lightweight lifetime witness. Same text/version alone does not identify an editor or saved document. */
export function outgoingMentionAuthority(app: App, file: TFile, text: string, view: MarkdownView | null): OutgoingMentionAuthority | null {
  try {
    const root = app.vault.rootPath;
    if (!root || !view || file.extension.toLowerCase() !== "md" || text.length > MAX_SOURCE || !sourceCurrent(app, file, text, view)) { return null; }
    const session = view.session!, document = view.savedDocument;
    if (!document || document.file.path !== file.path) { return null; }
    const preferences = ["newLinkFormat", "useMarkdownLinks"].map(key => [key, app.vault.getConfig(key)] as const);
    const markdown = app.vault.getConfig("useMarkdownLinks"), format = app.vault.getConfig("newLinkFormat");
    if (markdown !== undefined && typeof markdown !== "boolean" || format !== undefined && (typeof format !== "string" || !["shortest", "relative", "absolute"].includes(format))) { return null; }
    return { app, root, file, path: file.path, text, view, session, document, editor: view.editor, cm: view.editor.cm, savedVersion: document.version, savedText: document.content, savedBom: document.hasBom === true,
      cmDocument: view.editor.cm.state.doc, mode: view.getMode(), editingMode: view.getEditingMode(), preferences };
  } catch { return null; }
}

export function sameOutgoingMentionAuthority(left: OutgoingMentionAuthority | null, right: OutgoingMentionAuthority | null): boolean {
  if (!left || !right) { return left === right; }
  return left.app === right.app && left.root === right.root && left.file === right.file && left.path === right.path && left.text === right.text
    && left.view === right.view && left.session === right.session && left.document === right.document && left.editor === right.editor && left.cm === right.cm
    && left.cmDocument === right.cmDocument && left.savedVersion === right.savedVersion && left.savedText === right.savedText && left.savedBom === right.savedBom
    && left.mode === right.mode && left.editingMode === right.editingMode && left.preferences.length === right.preferences.length
    && left.preferences.every(([key, value], index) => right.preferences[index][0] === key && right.preferences[index][1] === value);
}

/** Consume a witness synchronously in its renderer; no per-row source parsing or second editor snapshot. */
export function outgoingMentionEnvironmentFor(authority: OutgoingMentionAuthority | null): OutgoingMentionEnvironment | null {
  if (!authority) { return null; }
  try {
    const { app, file, text } = authority, entry = app.metadataCache.getDocument(file.path);
    const cache = entry && !entry.missing && entry.text === text ? entry.cache : parseMarkdown(text);
    return cache.errors.length ? null : { ...authority, cache, blocked: blockedRanges(text, cache, percentComments(text, cache.ignored)) };
  } catch { return null; }
}

/** One source snapshot per rendered pane, shared by every cheap row witness. */
export function outgoingMentionEnvironment(app: App, file: TFile, text: string, view: MarkdownView | null): OutgoingMentionEnvironment | null {
  return outgoingMentionEnvironmentFor(outgoingMentionAuthority(app, file, text, view));
}

/** Render-time eligibility only; complete link planning happens on activation. */
export function outgoingMentionReview(environment: OutgoingMentionEnvironment | null, target: TFile | null, range: SourceRange): OutgoingMentionReview | null {
  if (!environment || !target || target === environment.file || target.extension.toLowerCase() !== "md" || target.vault !== environment.app.vault
    || environment.app.vault.getFileByPath(target.path) !== target || !Number.isInteger(range.from) || !Number.isInteger(range.to)
    || range.from < 0 || range.to <= range.from || range.to > environment.text.length || range.to - range.from > MAX_LABEL
    || blocked(environment.blocked, range)) { return null; }
  const entry = environment.app.metadataCache.getDocument(target.path);
  if (!entry || entry.missing || entry.cache.errors.length) { return null; }
  return { ...environment, target, targetPath: target.path, targetText: entry.text, targetVersion: entry.document.version,
    targetSavedText: entry.document.content, targetBom: entry.document.hasBom === true, range: { from: range.from, to: range.to } };
}

export function reviewedOutgoingMentionPlan(review: OutgoingMentionReview): OutgoingMentionPlan {
  const { app, target, text } = review, entry = app.metadataCache.getDocument(review.targetPath);
  if (!entry || entry.missing || entry.text !== review.targetText || entry.document.version !== review.targetVersion) { return changed(); }
  const insert = app.fileManager.generateMarkdownLink(target, review.path, "", text.slice(review.range.from, review.range.to));
  const plan = planOutgoingMentionLink(text, review.path, { path: target.path, basename: target.basename, cache: entry.cache }, review.range, insert);
  const destination = app.metadataCache.resolveReference(plan.reference, review.path);
  if (!destination || destination.ambiguous || destination.file !== target) { return changed(); } return plan;
}

/** Closed notes and Reading views remain reveal-only; this does not open or save a hidden editor. */
export function outgoingMentionChoice(app: App, file: TFile, text: string, target: TFile | null, range: SourceRange, view: MarkdownView | null): OutgoingMentionChoice | null {
  try { const review = outgoingMentionReview(outgoingMentionEnvironment(app, file, text, view), target, range); return review ? { ...review, plan: reviewedOutgoingMentionPlan(review) } : null; }
  catch { return null; }
}

/** The same live-owner guard is shared by single and reviewed bulk actions. */
export function outgoingMentionReviewCurrent(choice: OutgoingMentionReview, owned: () => boolean): boolean {
  const { app, view, session, target } = choice;
  return owned() && app.vault.rootPath === choice.root && choice.file.path === choice.path && target.path === choice.targetPath
    && view.editor === choice.editor && view.editor.cm === choice.cm && choice.document.version === choice.savedVersion
    && choice.document.content === choice.savedText && (choice.document.hasBom === true) === choice.savedBom
    && sourceCurrent(app, choice.file, choice.text, view) && view.session === session && view.savedDocument === choice.document
    && view.editor.cm.state.doc === choice.cmDocument && view.getMode() === choice.mode && view.getEditingMode() === choice.editingMode
    && app.vault.getFileByPath(choice.targetPath) === target && choice.preferences.every(([key, value]) => app.vault.getConfig(key) === value);
}

/** Read-only authority is rechecked inside the action, including for forced-enabled stale controls. */
export async function linkOutgoingMention(choice: OutgoingMentionReview, owned: () => boolean): Promise<void> {
  const { app, view } = choice;
  const current = (): boolean => outgoingMentionReviewCurrent(choice, owned);
  if (!current()) { return changed(); }
  const plan = reviewedOutgoingMentionPlan(choice);
  // These checked reads never overwrite a dirty buffer. A later physical race
  // still encounters the normal optimistic source-save guard.
  const [disk, targetDisk] = await Promise.all([app.vault.readDocument(choice.path), app.vault.readDocument(choice.targetPath)]);
  if (!current() || disk.version !== choice.savedVersion || disk.content !== choice.savedText || (disk.hasBom === true) !== choice.savedBom
    || targetDisk.version !== choice.targetVersion || targetDisk.content !== choice.targetSavedText || (targetDisk.hasBom === true) !== choice.targetBom) { return changed(); }
  const fresh = reviewedOutgoingMentionPlan(choice);
  if (fresh.insert !== plan.insert || fresh.text !== plan.text || !current()) { return changed(); }
  view.editor.replaceExpected(choice.text, plan.from, plan.to, plan.insert, "input.link-mention");
  if (view.editor.getValue() !== plan.text) { throw new OutgoingMentionError("The editor did not accept the link exactly. Review the note and its Undo history."); }
  app.metadataCache.updateOpenDocuments();
}
