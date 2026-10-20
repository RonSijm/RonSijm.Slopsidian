import type { App } from "./app";
import { MAX_COMPLETION_CANDIDATES, MAX_COMPLETION_RESULTS, MAX_COMPLETION_SOURCE, MAX_COMPLETION_SUBPATHS, MAX_COMPLETION_VALUE_CHARACTERS, MAX_COMPLETION_VALUE_DOCUMENTS, MAX_COMPLETION_VALUE_LENGTH, MAX_COMPLETION_VALUES, builtinCompletionTrigger, createNoteCompletion, headingCompletionSubpath, linkCompletions, propertyValueCompletions, subpathCompletions, type LinkCompletionSource } from "./builtin-suggestion-model";
import { parseLinktext, resolveSubpath, subpathIdentity } from "./links";
import { headingAuthoringCompletion, planHeadingCreation, type HeadingAuthoringChoice } from "./heading-authoring";
import { parseMarkdown, validTag, type CachedMetadata, type LinkCache } from "./markdown";
import type { TFile } from "./vault";
import { inferPropertyType } from "./property-types";

let nextListId = 0;

interface PropertyChoiceSource {
  value: string;
  sourceText: string;
  root: string;
  file: TFile;
  sourcePath: string;
  property: string;
  query: string;
  displayText?: string;
}
export interface PropertyKnownValueChoice extends PropertyChoiceSource {
  kind: "value";
  contributor: TFile;
  contributorText: string;
}
interface PropertyTargetChoice extends PropertyChoiceSource {
  target: TFile;
  targetPath: string;
  targetText: string;
  linktext: string;
  alias?: string;
  linkFormat: string | undefined;
}
export interface PropertyLinkChoice extends PropertyTargetChoice { kind: "link" }
export interface PropertySubpathChoice extends PropertyTargetChoice {
  kind: "subpath";
  subpath: string;
  subpathKind: "heading" | "block";
  from: number;
  to: number;
}
export type PropertyValueChoice = PropertyKnownValueChoice | PropertyLinkChoice | PropertySubpathChoice;
export interface PropertyNoteCreateChoice extends PropertyChoiceSource {
  kind: "create-note";
  name: string;
  path: string;
  preferences: readonly (readonly [string, unknown])[];
  sourceSession: ReturnType<App["workspace"]["sessions"]["get"]>;
}
export interface PropertyHeadingCreateChoice extends PropertyTargetChoice {
  kind: "create-heading";
  heading: HeadingAuthoringChoice;
  widget: "text" | "multitext";
  existing: readonly string[];
  preferences: readonly (readonly [string, unknown])[];
  sourceSession: ReturnType<App["workspace"]["sessions"]["get"]>;
  targetSession: ReturnType<App["workspace"]["sessions"]["get"]>;
}
export type PropertySuggestionChoice = PropertyValueChoice | PropertyNoteCreateChoice | PropertyHeadingCreateChoice;
const creationPreferences = ["newFileLocation", "newFileFolderPath", "newLinkFormat", "useMarkdownLinks"] as const;

export function propertySuggestionSource(app: App, file: TFile): string | null {
  if (file.vault !== app.vault || app.vault.getFileByPath(file.path) !== file) { return null; }
  const entry = app.metadataCache.getDocument(file.path), session = app.workspace.sessions.get(file.path);
  if (entry?.missing || session && (session.originRoot !== app.vault.rootPath || session.isReloading)) { return null; }
  const text = session?.text ?? entry?.text;
  return text !== undefined && text.length <= MAX_COMPLETION_SOURCE ? text : null;
}

function safeWikiPart(value: string): boolean {
  return value.length <= MAX_COMPLETION_VALUE_LENGTH && Boolean(value.trim()) && !/[\[\]#|\\\x00-\x1f\x7f]/.test(value);
}

/** Properties edits a whole value, so a display label can be separated before
 * asking the shared body-editor completion parser to inspect its destination. */
function propertyWikiQuery(value: string): { query: string; displayText?: string } | null {
  if (value.length > 256 || !value.startsWith("[[") || /[\\\x00-\x1f\x7f\u2028\u2029]/.test(value) || /[\uD800-\uDFFF]/u.test(value)) { return null; }
  const closed = value.endsWith("]]"), body = value.slice(2, closed ? -2 : undefined), parts = body.split("|");
  if (parts.length > 2 || /[\[\]]/.test(body)) { return null; }
  const displayText = parts[1];
  if (displayText !== undefined && (!displayText || displayText !== displayText.trim())) { return null; }
  return { query: "[[" + parts[0] + (closed ? "]]" : ""), ...(displayText === undefined ? {} : { displayText }) };
}
function propertyWikiLink(destination: string, displayText?: string): string {
  return "[[" + destination + (displayText === undefined ? "" : "|" + displayText) + "]]";
}
function linkReference(link: string): LinkCache {
  const location = { line: 0, ch: 0, offset: 0 };
  return { kind: "frontmatter", link, original: "[[" + link + "]]", position: { start: location, end: location } };
}

function propertyLinkEnvironment(app: App): { linkFormat: string | undefined; inventory: TFile[] } | null {
  let linkFormat: unknown, markdownLinks: unknown, inventory: TFile[];
  try {
    linkFormat = app.vault.getConfig("newLinkFormat"); markdownLinks = app.vault.getConfig("useMarkdownLinks"); inventory = app.vault.getFiles();
  } catch { return null; }
  if (linkFormat !== undefined && linkFormat !== "shortest" && linkFormat !== "relative" && linkFormat !== "absolute") { return null; }
  if (markdownLinks !== undefined && typeof markdownLinks !== "boolean") { return null; }
  // fileToLinktext must see the complete inventory to prove its spelling. Refuse
  // oversized inventories/paths before the shared resolver normalizes or hashes.
  if (inventory.length > MAX_COMPLETION_CANDIDATES) { return null; }
  let inventoryCharacters = 0;
  for (const target of inventory) {
    if (target.path.length > MAX_COMPLETION_VALUE_LENGTH || (inventoryCharacters += target.path.length) > MAX_COMPLETION_SOURCE) { return null; }
  }
  return { linkFormat, inventory };
}

export interface PropertyWikiValue { target: TFile; targetPath: string; targetText: string; linktext: string; label: string }

/** A whole existing scalar/list wiki value, never an instruction to create a note. */
export function propertyWikiValue(app: App, file: TFile, property: string, value: string, index?: number): PropertyWikiValue | null {
  try {
    if (value.length > MAX_COMPLETION_VALUE_LENGTH || !/^\[\[[^\[\]\r\n]+\]\]$/.test(value) || /[\\\x00-\x1f\x7f]/.test(value)) { return null; }
    const source = propertySuggestionSource(app, file), environment = propertyLinkEnvironment(app);
    if (source === null || !environment) { return null; }
    const sourceCache = parseMarkdown(source), current = sourceCache.frontmatter?.[property];
    const widget = app.metadataTypeManager.getAssignedWidget(property) ?? inferPropertyType(current);
    if (sourceCache.errors.length || widget !== "text" && widget !== "multitext" || (index === undefined ? current !== value : !Number.isSafeInteger(index) || index < 0 || !Array.isArray(current) || current[index] !== value)) { return null; }
    const raw = value.slice(2, -2), parts = raw.split("|");
    if (parts.length > 2 || parts[1] !== undefined && !parts[1].trim()) { return null; }
    const reference = parseLinktext(parts[0]);
    if (reference.path !== "" && !safeWikiPart(reference.path) || reference.subpath.length > MAX_COMPLETION_VALUE_LENGTH) { return null; }
    const resolved = reference.path === "" ? { file, ambiguous: false } : app.metadataCache.resolveReference(linkReference(reference.path), file.path);
    const alias = !resolved && reference.path ? exactPropertyAlias(app, environment.inventory, reference.path) : null, target = resolved?.file ?? alias?.target;
    if (!target || resolved?.ambiguous || target.extension.toLowerCase() !== "md" || target.vault !== app.vault || app.vault.getFileByPath(target.path) !== target || !safeWikiPart(target.path)) { return null; }
    const targetText = propertySuggestionSource(app, target);
    if (targetText === null) { return null; }
    const cache = parseMarkdown(targetText);
    if (cache.errors.length || boundedSubpathCache(cache) === null || reference.subpath && !resolveSubpath(cache, reference.subpath)) { return null; }
    // Canonical vault paths make alias-only values navigable without allowing
    // the general link controller to mistake an alias for a missing note.
    return { target, targetPath: target.path, targetText, linktext: target.path + reference.subpath, label: parts[1] ?? parts[0] };
  } catch { return null; }
}

/** Replace precisely one ordinary list member; duplicates and stale indexes refuse. */
export function replacePropertyListValue(values: readonly string[], index: number, value: string): string[] {
  if (!Array.isArray(values) || values.length > MAX_COMPLETION_VALUES || !Number.isSafeInteger(index) || index < 0 || index >= values.length
    || values.some(item => typeof item !== "string" || item.length > MAX_COMPLETION_VALUE_LENGTH)
    || values.reduce((length, item) => length + item.length, 0) > MAX_COMPLETION_VALUE_CHARACTERS
    || !value.trim() || value !== value.trim() || value.length > MAX_COMPLETION_VALUE_LENGTH || /[\r\n\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
    || values.some((item, position) => position !== index && item === value)) { throw new Error("Enter a distinct, nonempty single-line value for the current list item."); }
  return values.map((item, position) => position === index ? value : item);
}

/** A separate explicit action; existing known-value enumeration remains noncreating. */
export function propertyNoteCreationChoice(app: App, file: TFile, property: string, widget: string, existing: readonly string[], query: string, ownedMutation = false): PropertyNoteCreateChoice | null {
  try {
    const root = app.vault.rootPath, sourceText = propertySuggestionSource(app, file);
    if (!root || sourceText === null || file.extension.toLowerCase() !== "md" || !property || property.length > 256 || /[\x00-\x1f\x7f]/.test(property)
      || widget !== "text" && widget !== "multitext" || query.length > 256 || !query.startsWith("[[") || app.vault.readOnly || app.changingVault
      || !ownedMutation && app.workspace.isChangingFiles || app.workspace.isChangingLayout || app.core.busy || !app.core.isEnabled("properties")) { return null; }
    const source = parseMarkdown(sourceText), values = source.frontmatter;
    if (source.errors.length || !values || !Object.hasOwn(values, property)
      || (app.metadataTypeManager.getAssignedWidget(property) ?? inferPropertyType(values[property])) !== widget) { return null; }
    const wiki = propertyWikiQuery(query);
    if (!wiki) { return null; }
    const cursor = wiki.query.endsWith("]]") ? wiki.query.length - 2 : wiki.query.length, trigger = builtinCompletionTrigger(wiki.query, cursor);
    if (!trigger || trigger.kind !== "link" || trigger.from !== 0 || trigger.to !== wiki.query.length) { return null; }
    const path = app.fileManager.getNewNotePath(trigger.query, file.path, true), selected = createNoteCompletion(wiki.query, cursor, trigger, path, file.path);
    const environment = propertyLinkEnvironment(app);
    if (!selected || !environment || app.vault.getAbstractFileByPathInsensitive(path) || app.metadataCache.resolveReference(linkReference(selected.name), file.path)) { return null; }
    const value = propertyWikiLink(selected.name, wiki.displayText);
    if (existing.length > MAX_COMPLETION_VALUES || existing.some(item => item.length > MAX_COMPLETION_VALUE_LENGTH)
      || existing.reduce((total, item) => total + item.length, 0) > MAX_COMPLETION_VALUE_CHARACTERS || existing.includes(value)) { return null; }
    for (const item of existing) {
      if (!item.startsWith("[[") || !item.endsWith("]]")) { continue; }
      const spelling = item.slice(2, -2).split("|", 1)[0];
      try { if (safeWikiPart(spelling) && app.fileManager.getNewNotePath(spelling, file.path, true).toLowerCase() === path.toLowerCase()) { return null; } }
      catch { /* An unsupported existing attachment cannot name this new Markdown note. */ }
    }
    // Creation requires a complete absence proof, unlike the bounded ranked list.
    const notes = environment.inventory.filter(target => target.extension.toLowerCase() === "md");
    if (notes.length > MAX_COMPLETION_VALUE_DOCUMENTS) { return null; }
    const names = new Set([selected.name.toLowerCase(), selected.name.replace(/\.md$/i, "").toLowerCase()]);
    let parsedCharacters = 0, aliases = 0, characters = 0;
    for (const target of notes) {
      const entry = app.metadataCache.getDocument(target.path), text = propertySuggestionSource(app, target);
      if (!entry || entry.missing || text === null) { return null; }
      let cache = entry.cache;
      if (text !== entry.text) {
        if ((parsedCharacters += text.length) > MAX_COMPLETION_SOURCE) { return null; }
        cache = parseMarkdown(text);
      }
      if (cache.errors.length) { return null; }
      if (!cache.frontmatter) { continue; }
      let aliasKey: string | undefined, keys = 0;
      for (const key in cache.frontmatter) {
        if (++keys > MAX_COMPLETION_VALUES) { return null; }
        if (Object.hasOwn(cache.frontmatter, key) && /^aliases$/i.test(key)) { aliasKey = key; break; }
      }
      if (aliasKey === undefined) { continue; }
      const raw = cache.frontmatter[aliasKey], items = Array.isArray(raw) ? raw : [raw];
      if (items.length > MAX_COMPLETION_VALUES - aliases) { return null; }
      aliases += items.length;
      for (const alias of items) {
        if (typeof alias !== "string") { continue; }
        if (alias.length > MAX_COMPLETION_VALUE_LENGTH || (characters += alias.length) > MAX_COMPLETION_VALUE_CHARACTERS) { return null; }
        if (names.has(alias.trim().toLowerCase())) { return null; }
      }
    }
    return { kind: "create-note", name: selected.name, path, value, sourceText, root, file, sourcePath: file.path, property, query, displayText: wiki.displayText,
      preferences: creationPreferences.map(key => [key, app.vault.getConfig(key)] as const), sourceSession: app.workspace.sessions.get(file.path) };
  } catch { return null; }
}

export interface PropertyNoteCreationOptions {
  widget: string;
  existing: readonly string[];
  query: string;
  current: () => boolean;
  commit: (value: string, guard: (content: string) => void, transform?: (updated: string, original: string) => string) => Promise<boolean>;
  kept: (path: string) => void;
  acknowledgedFailure?: (error: unknown) => void;
  ownMutation?: (pending: boolean) => void;
}

/** Explicit target creation, separate from ordinary known-subpath and missing-note choices. */
export function propertyHeadingCreationChoice(app: App, file: TFile, property: string, widget: string, existing: readonly string[], query: string, ownedMutation = false): PropertyHeadingCreateChoice | null {
  try {
    const root = app.vault.rootPath, sourceText = propertySuggestionSource(app, file);
    if (!root || sourceText === null || file.extension.toLowerCase() !== "md" || !property || property.length > 256 || /[\x00-\x1f\x7f]/.test(property)
      || widget !== "text" && widget !== "multitext" || query.length > 256 || /[\x00-\x1f\x7f]/.test(query)
      || app.vault.readOnly || app.changingVault || !ownedMutation && app.workspace.isChangingFiles || app.workspace.isChangingLayout || app.core.busy || !app.core.isEnabled("properties")) { return null; }
    const source = parseMarkdown(sourceText), values = source.frontmatter;
    if (source.errors.length || !values || !Object.hasOwn(values, property)
      || (app.metadataTypeManager.getAssignedWidget(property) ?? inferPropertyType(values[property])) !== widget) { return null; }
    const wiki = propertyWikiQuery(query);
    if (!wiki) { return null; }
    const cursor = wiki.query.endsWith("]]") ? wiki.query.length - 2 : wiki.query.length, trigger = builtinCompletionTrigger(wiki.query, cursor), environment = propertyLinkEnvironment(app);
    if (!environment || !trigger || trigger.kind !== "heading" || trigger.from !== 0 || trigger.to !== wiki.query.length || trigger.linkpath !== "" && !safeWikiPart(trigger.linkpath ?? "")
      || existing.length > MAX_COMPLETION_VALUES || existing.some(value => typeof value !== "string" || value.length > MAX_COMPLETION_VALUE_LENGTH)
      || existing.reduce((total, value) => total + value.length, 0) > MAX_COMPLETION_VALUE_CHARACTERS) { return null; }
    // Literal resolution takes precedence; an alias requires the complete
    // bounded inventory proof and is then stored through a canonical spelling.
    const resolve = propertyDestinations(app, file, environment.inventory), destination = resolve(trigger.linkpath ?? ""), target = destination?.target;
    if (!target || !safeWikiPart(target.path) || target.extension.toLowerCase() !== "md"
      || target.vault !== app.vault || app.vault.getFileByPath(target.path) !== target) { return null; }
    const entry = app.metadataCache.getDocument(target.path), targetText = propertySuggestionSource(app, target), targetSession = app.workspace.sessions.get(target.path);
    if (!entry || entry.missing || targetText === null || target !== file && entry.text !== targetText
      || targetSession && (target !== file && targetSession.dirty || targetSession.isSaving || targetSession.isReloading || targetSession.originRoot !== root || targetSession.text !== targetText)) { return null; }
    const heading = headingAuthoringCompletion(wiki.query, cursor, trigger, target.path, targetText);
    if (!heading) { return null; }
    const linktext = trigger.linkpath === "" ? "" : app.metadataCache.fileToLinktext(target, file.path, true), value = propertyWikiLink(linktext + "#" + heading.subpath, wiki.displayText ?? destination?.alias);
    const resolved = linktext === "" ? { file, ambiguous: false } : app.metadataCache.resolveReference(linkReference(linktext), file.path);
    if (linktext !== "" && !safeWikiPart(linktext) || value.length > MAX_COMPLETION_VALUE_LENGTH || resolved?.file !== target || resolved.ambiguous || existing.includes(value)) { return null; }
    for (const item of existing) {
      if (!item.startsWith("[[") || !item.endsWith("]]")) { continue; }
      const spelling = item.slice(2, -2).split("|", 1)[0], hash = spelling.indexOf("#");
      if (hash < 0 || subpathIdentity(spelling.slice(hash + 1)) !== subpathIdentity(heading.subpath)) { continue; }
      const prior = resolve(spelling.slice(0, hash));
      if (prior?.target === target) { return null; }
    }
    return { kind: "create-heading", heading, widget, existing: [...existing], value, sourceText, root, file, sourcePath: file.path, property, query,
      target, targetPath: target.path, targetText, targetSession, sourceSession: app.workspace.sessions.get(file.path), linktext, alias: destination?.alias, displayText: wiki.displayText, linkFormat: environment.linkFormat,
      preferences: creationPreferences.map(key => [key, app.vault.getConfig(key)] as const) };
  } catch { return null; }
}

/** Acknowledge the normal optimistic target write, release its lock, then enter the guarded YAML queue. */
export async function createPropertyHeading(app: App, choice: PropertyHeadingCreateChoice, options: PropertyNoteCreationOptions): Promise<boolean> {
  const destinationCurrent = (): boolean => {
    try {
      const wiki = propertyWikiQuery(choice.query), environment = propertyLinkEnvironment(app);
      if (!wiki || !environment) { return false; }
      const cursor = wiki.query.endsWith("]]") ? wiki.query.length - 2 : wiki.query.length, trigger = builtinCompletionTrigger(wiki.query, cursor);
      if (!trigger || trigger.kind !== "heading") { return false; }
      const target = propertyDestinations(app, choice.file, environment.inventory)(trigger.linkpath ?? "");
      return Boolean(target && target.target === choice.target && target.alias === choice.alias && wiki.displayText === choice.displayText);
    } catch { return false; }
  };
  if (choice.target === choice.file) {
    const current = (content = propertySuggestionSource(app, choice.file)): boolean => options.current() && choice.root === app.vault.rootPath && !app.changingVault && !app.vault.readOnly
      && !app.workspace.isChangingFiles && !app.workspace.isChangingLayout && !app.core.busy && app.core.isEnabled("properties")
      && choice.file.path === choice.sourcePath && choice.targetPath === choice.sourcePath && choice.file.vault === app.vault && app.vault.getFileByPath(choice.sourcePath) === choice.file
      && content === choice.sourceText && propertySuggestionSource(app, choice.file) === choice.sourceText && choice.targetText === choice.sourceText
      && options.query === choice.query && options.widget === choice.widget && JSON.stringify(options.existing) === JSON.stringify(choice.existing)
      && destinationCurrent()
      && app.workspace.sessions.get(choice.sourcePath) === choice.sourceSession && choice.targetSession === choice.sourceSession
      && (!choice.sourceSession || choice.sourceSession.originRoot === choice.root && !choice.sourceSession.isReloading && !choice.sourceSession.isSaving && choice.sourceSession.text === choice.sourceText)
      && choice.preferences.length === creationPreferences.length && choice.preferences.every(([key, value], index) => key === creationPreferences[index] && app.vault.getConfig(key) === value);
    const guard = (content = propertySuggestionSource(app, choice.file)): void => {
      const fresh = current(content) && propertyHeadingCreationChoice(app, choice.file, choice.property, options.widget, options.existing, options.query);
      if (!fresh || fresh.target !== choice.file || fresh.targetText !== choice.sourceText || fresh.value !== choice.value || JSON.stringify(fresh.heading) !== JSON.stringify(choice.heading)) {
        throw new Error("This same-note property heading choice changed. Review the current note and property before creating headings.");
      }
    };
    guard();
    const transform = (updated: string, original: string): string => {
      guard(original);
      const wiki = propertyWikiQuery(choice.query), cursor = wiki ? wiki.query.endsWith("]]") ? wiki.query.length - 2 : wiki.query.length : 0;
      const trigger = wiki && builtinCompletionTrigger(wiki.query, cursor);
      const fresh = wiki && trigger && headingAuthoringCompletion(wiki.query, cursor, trigger, choice.sourcePath, updated);
      if (!fresh || fresh.subpath !== choice.heading.subpath || fresh.preview !== choice.heading.preview || fresh.level !== choice.heading.level
        || JSON.stringify(fresh.parents) !== JSON.stringify(choice.heading.parents) || JSON.stringify(fresh.newHeadings) !== JSON.stringify(choice.heading.newHeadings)) {
        throw new Error("The same-note heading destination changed during the property edit. No headings were created.");
      }
      const plan = planHeadingCreation(updated, fresh), cache = parseMarkdown(plan.text);
      if (cache.errors.length || plan.createdHeadings.some(heading => resolveSubpath(cache, "#" + heading.subpath)?.start.offset !== heading.from)) {
        throw new Error("The combined property and heading edit did not resolve to its reviewed destination.");
      }
      return plan.text;
    };
    return options.commit(choice.value, guard, transform);
  }
  const plan = planHeadingCreation(choice.targetText, choice.heading);
  let acknowledged = false, notified = false;
  const kept = (): void => { if (acknowledged && !notified) { notified = true; options.kept(choice.targetPath); } };
  const current = (content = propertySuggestionSource(app, choice.file)): boolean => options.current() && choice.root === app.vault.rootPath && !app.changingVault && !app.vault.readOnly
    && !app.workspace.isChangingLayout && !app.core.busy && app.core.isEnabled("properties") && choice.file.path === choice.sourcePath
    && choice.file.vault === app.vault && app.vault.getFileByPath(choice.sourcePath) === choice.file && content === choice.sourceText && options.query === choice.query
    && propertyWikiQuery(choice.query)?.displayText === choice.displayText
    && options.widget === choice.widget && JSON.stringify(options.existing) === JSON.stringify(choice.existing)
    && destinationCurrent()
    && app.workspace.sessions.get(choice.sourcePath) === choice.sourceSession
    && (!choice.sourceSession || choice.sourceSession.originRoot === choice.root && !choice.sourceSession.isReloading && choice.sourceSession.text === choice.sourceText)
    && choice.target.path === choice.targetPath && choice.target.vault === app.vault && app.vault.getFileByPath(choice.targetPath) === choice.target
    && app.workspace.sessions.get(choice.targetPath) === choice.targetSession
    && (!choice.targetSession || choice.targetSession.originRoot === choice.root && !choice.targetSession.isSaving && !choice.targetSession.isReloading && !choice.targetSession.dirty
      && choice.targetSession.text === (acknowledged ? plan.text : choice.targetText))
    && propertySuggestionSource(app, choice.target) === (acknowledged ? plan.text : choice.targetText)
    && choice.preferences.length === creationPreferences.length && choice.preferences.every(([key, value], index) => key === creationPreferences[index] && app.vault.getConfig(key) === value)
    && (app.metadataTypeManager.getAssignedWidget(choice.property) ?? inferPropertyType(parseMarkdown(choice.sourceText).frontmatter?.[choice.property])) === choice.widget;
  const reviewed = (ownedMutation = false): boolean => {
    if (!current()) { return false; }
    const fresh = propertyHeadingCreationChoice(app, choice.file, choice.property, options.widget, options.existing, options.query, ownedMutation);
    return Boolean(fresh && fresh.target === choice.target && fresh.targetPath === choice.targetPath && fresh.targetText === choice.targetText
      && fresh.linktext === choice.linktext && fresh.value === choice.value && JSON.stringify(fresh.heading) === JSON.stringify(choice.heading));
  };
  if (!reviewed()) { throw new Error("This property heading choice changed. Type again to review the current target."); }
  options.ownMutation?.(true);
  let written: Awaited<ReturnType<App["fileManager"]["assignMarkdownSubpath"]>>;
  try {
    written = await app.fileManager.assignMarkdownSubpath(choice.target, choice.targetText, content => planHeadingCreation(content, choice.heading).text,
      { guard: () => reviewed(true), written: () => { acknowledged = true; } });
  } catch (error) { kept(); if (acknowledged) { options.acknowledgedFailure?.(error); } throw error; }
  finally { options.ownMutation?.(false); }
  try {
    const guard = (content = propertySuggestionSource(app, choice.file)): void => {
      const entry = app.metadataCache.getDocument(choice.targetPath), cache = entry && parseMarkdown(entry.text);
      const destination = app.metadataCache.resolveReference(linkReference(choice.linktext), choice.sourcePath);
      if (!current(content) || app.workspace.isChangingFiles || written.content !== plan.text || !entry || entry.missing || entry.text !== plan.text || !cache
        || plan.createdHeadings.some(heading => resolveSubpath(cache, "#" + heading.subpath)?.start.offset !== heading.from)
        || app.metadataCache.fileToLinktext(choice.target, choice.sourcePath, true) !== choice.linktext || destination?.file !== choice.target || destination.ambiguous) {
        throw new Error("The created headings or their property field changed. Review the target and property before linking them.");
      }
    };
    guard(); const accepted = await options.commit(choice.value, guard);
    if (!accepted) { kept(); }
    return accepted;
  } catch (error) { kept(); throw error; }
}

/** Create first, release its mutation lock, then use the ordinary guarded YAML queue. */
export async function createPropertyNote(app: App, choice: PropertyNoteCreateChoice, options: PropertyNoteCreationOptions): Promise<boolean> {
  const session = choice.sourceSession;
  const current = (content = propertySuggestionSource(app, choice.file)): boolean => options.current() && choice.root === app.vault.rootPath && !app.changingVault && !app.vault.readOnly
    && !app.workspace.isChangingLayout && !app.core.busy && app.core.isEnabled("properties") && choice.file.path === choice.sourcePath
    && choice.file.vault === app.vault && app.vault.getFileByPath(choice.sourcePath) === choice.file && content === choice.sourceText && options.query === choice.query
    && propertyWikiQuery(choice.query)?.displayText === choice.displayText
    && app.workspace.sessions.get(choice.sourcePath) === session && (!session || session.originRoot === choice.root && !session.isReloading && session.text === choice.sourceText)
    && choice.preferences.length === creationPreferences.length && choice.preferences.every(([key, value], index) => key === creationPreferences[index] && app.vault.getConfig(key) === value)
    && (app.metadataTypeManager.getAssignedWidget(choice.property) ?? inferPropertyType(parseMarkdown(choice.sourceText).frontmatter?.[choice.property])) === options.widget;
  const reviewed = (ownedMutation = false): boolean => {
    if (!current()) { return false; }
    const fresh = propertyNoteCreationChoice(app, choice.file, choice.property, options.widget, options.existing, options.query, ownedMutation);
    return Boolean(fresh && fresh.name === choice.name && fresh.path === choice.path && fresh.value === choice.value && fresh.sourceText === choice.sourceText);
  };
  if (!reviewed()) { throw new Error("This property creation choice changed. Type again to review the current destination."); }
  let acknowledged: TFile | null = null, notified = false;
  const kept = (): void => { if (acknowledged && !notified) { notified = true; options.kept(choice.path); } };
  let created: TFile;
  options.ownMutation?.(true);
  try {
    created = await app.fileManager.createLinkedNote(choice.name, choice.sourcePath, { expectedPath: choice.path, guard: () => reviewed(true), created: file => { acknowledged = file; } });
  } catch (error) {
    kept(); if (acknowledged) { options.acknowledgedFailure?.(error); } throw error;
  } finally { options.ownMutation?.(false); }
  try {
    const link = (): string => {
      if (!current() || app.workspace.isChangingFiles || created.path !== choice.path || created.vault !== app.vault || app.vault.getFileByPath(choice.path) !== created) {
        throw new Error("The created note or its property field changed. No property link was inserted.");
      }
      const spelling = app.metadataCache.fileToLinktext(created, choice.sourcePath, true);
      if (!safeWikiPart(spelling)) { throw new Error("The created note has no safe property link spelling."); }
      const destination = app.metadataCache.resolveReference(linkReference(spelling), choice.sourcePath);
      if (!destination || destination.ambiguous || destination.file !== created) { throw new Error("The created note no longer resolves uniquely."); }
      const value = propertyWikiLink(spelling, choice.displayText);
      if (options.existing.includes(value)) { throw new Error("This property already contains the created note's link."); }
      return value;
    };
    const value = link(), guard = (content: string): void => {
      if (!current(content) || link() !== value) { throw new Error("This property field changed before the created note could be linked."); }
    };
    const accepted = await options.commit(value, guard);
    if (!accepted) { kept(); }
    return accepted;
  } catch (error) { kept(); throw error; }
}

/** Explicit [[ intent: whole-value links to indexed notes, never a create action. */
function propertyLinkChoices(app: App, file: TFile, property: string, widget: string, existing: readonly string[], query: string, sourceText: string, root: string): PropertyLinkChoice[] {
  try {
  if (widget !== "text" && widget !== "multitext") { return []; }
  const wiki = propertyWikiQuery(query);
  if (!wiki) { return []; }
  const search = wiki.query.endsWith("]]") ? wiki.query.slice(2, -2) : wiki.query.slice(2);
  if (/[\[\]#^|\\\x00-\x1f\x7f]/.test(search)) { return []; }
  const environment = propertyLinkEnvironment(app);
  if (!environment) { return []; }
  const { linkFormat } = environment;
  const resolve = propertyDestinations(app, file, environment.inventory);
  const existingTargets = new Set<TFile>();
  let existingCharacters = 0;
  if (existing.length > MAX_COMPLETION_VALUES) { return []; }
  for (const value of existing) {
    if (value.length > MAX_COMPLETION_VALUE_LENGTH || (existingCharacters += value.length) > MAX_COMPLETION_VALUE_CHARACTERS) { return []; }
    if (!value.startsWith("[[") || !value.endsWith("]]")) { continue; }
    const path = value.slice(2, -2).split("|", 1)[0];
    if (!safeWikiPart(path)) { continue; }
    const destination = resolve(path);
    if (destination) { existingTargets.add(destination.target); }
  }
  const candidates: LinkCompletionSource[] = [], sources = new Map<string, { target: TFile; targetText: string }>();
  let parsedCharacters = 0, inspectedAliases = 0, candidateCharacters = 0;
  scan: for (const entry of app.metadataCache.getDocuments().slice(0, MAX_COMPLETION_VALUE_DOCUMENTS)) {
    const path = entry.document.file.path;
    if (!safeWikiPart(path)) { continue; }
    if (candidateCharacters + path.length > MAX_COMPLETION_VALUE_CHARACTERS) { break; }
    candidateCharacters += path.length;
    const target = app.vault.getFileByPath(path);
    if (!target || target.extension.toLowerCase() !== "md" || target.vault !== app.vault || entry.missing || existingTargets.has(target)) { continue; }
    const targetText = propertySuggestionSource(app, target);
    if (targetText === null) { continue; }
    let cache = entry.cache;
    if (targetText !== entry.text) {
      if (parsedCharacters + targetText.length > MAX_COMPLETION_SOURCE) { continue; }
      parsedCharacters += targetText.length; cache = parseMarkdown(targetText);
    }
    const aliases: string[] = [];
    if (!cache.errors.length && cache.frontmatter) {
      // Match parseFrontMatterAliases' case-insensitive aliases key, without
      // mapping/trimming unbounded cached arrays or strings first.
      let key: string | undefined, inspectedKeys = 0;
      for (const name in cache.frontmatter) {
        if (++inspectedKeys > MAX_COMPLETION_VALUES) { break; }
        if (name.length <= 256 && /^aliases$/i.test(name) && Object.hasOwn(cache.frontmatter, name)) { key = name; break; }
      }
      if (key !== undefined) {
        const raw = cache.frontmatter[key], items = Array.isArray(raw) ? raw : [raw];
        for (let index = 0; index < Math.min(items.length, 32) && inspectedAliases < MAX_COMPLETION_VALUES; index++) {
          inspectedAliases++;
          const item: unknown = items[index];
          if (typeof item !== "string" || item.length > MAX_COMPLETION_VALUE_LENGTH) { continue; }
          if (candidateCharacters + item.length > MAX_COMPLETION_VALUE_CHARACTERS) { break scan; }
          candidateCharacters += item.length;
          const alias = item.trim();
          if (safeWikiPart(alias)) { aliases.push(alias); }
        }
      }
    }
    candidates.push({ path, aliases }); sources.set(path, { target, targetText });
  }
  return linkCompletions(search, candidates).flatMap(choice => {
    const source = sources.get(choice.path);
    if (!source) { return []; }
    try {
      const linktext = app.metadataCache.fileToLinktext(source.target, file.path, true);
      if (!safeWikiPart(linktext)) { return []; }
      const destination = app.metadataCache.resolveReference(linkReference(linktext), file.path);
      if (!destination || destination.ambiguous || destination.file !== source.target) { return []; }
      const value = propertyWikiLink(linktext, wiki.displayText ?? choice.alias);
      if (value.length > MAX_COMPLETION_VALUE_LENGTH || existing.includes(value)) { return []; }
      return [{ kind: "link" as const, ...source, targetPath: source.target.path, value, linktext, alias: choice.alias, displayText: wiki.displayText, linkFormat, sourceText, root, file, sourcePath: file.path, property, query }];
    } catch { return []; }
  }).slice(0, MAX_COMPLETION_RESULTS);
  } catch { return []; }
}

/** The shared heading resolver inspects complete names. Bound cached metadata
 * before its normalization/Set work rather than truncating away ambiguity. */
function boundedSubpathCache(cache: CachedMetadata): number | null {
  if (cache.headings.length > MAX_COMPLETION_SUBPATHS) { return null; }
  let inspected = cache.headings.length, characters = 0;
  for (const heading of cache.headings) {
    if (heading.heading.length > MAX_COMPLETION_VALUE_LENGTH || (characters += heading.heading.length) > MAX_COMPLETION_VALUE_CHARACTERS) { return null; }
  }
  for (const id in cache.blocks) {
    if (!Object.hasOwn(cache.blocks, id)) { continue; }
    if (++inspected > MAX_COMPLETION_SUBPATHS || id.length > MAX_COMPLETION_VALUE_LENGTH
      || (characters += id.length) > MAX_COMPLETION_VALUE_CHARACTERS) { return null; }
  }
  return characters;
}

interface PropertyAliasSource { target: TFile; targetText: string; cache: CachedMetadata; alias: string }

/** A ranked/partial picker cannot prove a unique alias. Inspect every supported
 * note and decline if any budget or unknown current text makes that proof incomplete. */
function propertyAliasInventory(app: App, inventory: readonly TFile[]): Map<string, PropertyAliasSource | null> | null {
  const notes = inventory.filter(file => file.extension.toLowerCase() === "md" && /\.md$/i.test(file.path));
  if (notes.length > MAX_COMPLETION_VALUE_DOCUMENTS) { return null; }
  let parsedCharacters = 0, candidateCharacters = 0, inspectedAliases = 0;
  const aliases = new Map<string, PropertyAliasSource | null>();
  for (const target of notes) {
    if (candidateCharacters + target.path.length > MAX_COMPLETION_VALUE_CHARACTERS) { return null; }
    candidateCharacters += target.path.length;
    if (!safeWikiPart(target.path)) { continue; }
    if (target.vault !== app.vault || app.vault.getFileByPath(target.path) !== target) { return null; }
    const entry = app.metadataCache.getDocument(target.path), targetText = propertySuggestionSource(app, target);
    if (!entry || entry.missing || targetText === null) { return null; }
    let cache = entry.cache;
    if (targetText !== entry.text) {
      if (parsedCharacters + targetText.length > MAX_COMPLETION_SOURCE) { return null; }
      parsedCharacters += targetText.length; cache = parseMarkdown(targetText);
    }
    if (cache.errors.length) { return null; }
    if (!cache.frontmatter) { continue; }
    let aliasKey: string | undefined, inspectedKeys = 0;
    for (const name in cache.frontmatter) {
      if (++inspectedKeys > MAX_COMPLETION_VALUES) { return null; }
      if (name.length <= 256 && /^aliases$/i.test(name) && Object.hasOwn(cache.frontmatter, name)) { aliasKey = name; break; }
    }
    if (aliasKey === undefined) { continue; }
    const raw = cache.frontmatter[aliasKey], items: readonly unknown[] = Array.isArray(raw) ? raw : [raw];
    if (items.length > 32 || inspectedAliases + items.length > MAX_COMPLETION_VALUES) { return null; }
    inspectedAliases += items.length;
    for (const item of items) {
      if (typeof item !== "string") { continue; }
      if (item.length > MAX_COMPLETION_VALUE_LENGTH || candidateCharacters + item.length > MAX_COMPLETION_VALUE_CHARACTERS) { return null; }
      candidateCharacters += item.length;
      const value = item.trim();
      if (!safeWikiPart(value)) { continue; }
      const previous = aliases.get(value);
      if (previous === null || previous && previous.target !== target) { aliases.set(value, null); }
      else { aliases.set(value, { target, targetText, cache, alias: value }); }
    }
  }
  return aliases;
}
function exactPropertyAlias(app: App, inventory: readonly TFile[], alias: string): PropertyAliasSource | null {
  return propertyAliasInventory(app, inventory)?.get(alias) ?? null;
}

/** One lazy complete alias snapshot per synchronous proof, shared by every
 * existing list value instead of rescanning every note for every spelling. */
function propertyDestinations(app: App, file: TFile, inventory: readonly TFile[]): (path: string) => { target: TFile; alias?: string } | null {
  let aliases: Map<string, PropertyAliasSource | null> | null | undefined;
  return path => {
    if (!path) { return { target: file }; }
    if (!safeWikiPart(path)) { return null; }
    const resolved = app.metadataCache.resolveReference(linkReference(path), file.path);
    if (resolved) { return resolved.ambiguous ? null : { target: resolved.file }; }
    if (aliases === undefined) { aliases = propertyAliasInventory(app, inventory); }
    if (aliases === null) { throw new Error("The property alias inventory is incomplete. Review the current destinations."); }
    const match = aliases.get(path);
    return match ? { target: match.target, alias: match.alias } : null;
  };
}

function propertySubpathChoices(app: App, file: TFile, property: string, widget: string, existing: readonly string[], query: string, sourceText: string, root: string): PropertySubpathChoice[] {
  if (widget !== "text" && widget !== "multitext" || /[\x00-\x1f\x7f]/.test(query)) { return []; }
  const wiki = propertyWikiQuery(query);
  if (!wiki) { return []; }
  const cursor = wiki.query.endsWith("]]") ? wiki.query.length - 2 : wiki.query.length, trigger = builtinCompletionTrigger(wiki.query, cursor);
  if (!trigger || trigger.from !== 0 || trigger.to !== wiki.query.length || (trigger.kind !== "heading" && trigger.kind !== "block")) { return []; }
  const linkpath = trigger.linkpath ?? "";
  if (linkpath !== "" && !safeWikiPart(linkpath)) { return []; }
  const environment = propertyLinkEnvironment(app);
  if (!environment || existing.length > MAX_COMPLETION_VALUES) { return []; }
  let existingCharacters = 0;
  for (const value of existing) {
    if (value.length > MAX_COMPLETION_VALUE_LENGTH || (existingCharacters += value.length) > MAX_COMPLETION_VALUE_CHARACTERS) { return []; }
  }
  try {
    const resolve = propertyDestinations(app, file, environment.inventory);
    const destination = app.metadataCache.resolveReference(linkReference(linkpath), file.path);
    if (destination?.ambiguous) { return []; }
    let target = destination?.file, alias: string | undefined, aliasSource: PropertyAliasSource | null = null;
    if (!target && linkpath) {
      aliasSource = exactPropertyAlias(app, environment.inventory, linkpath);
      if (!aliasSource) { return []; }
      target = aliasSource.target; alias = aliasSource.alias;
    }
    if (!target || !safeWikiPart(target.path) || target.extension.toLowerCase() !== "md" || target.vault !== app.vault || app.vault.getFileByPath(target.path) !== target) { return []; }
    const entry = app.metadataCache.getDocument(target.path), targetText = propertySuggestionSource(app, target);
    if (!entry || entry.missing || targetText === null) { return []; }
    if (aliasSource && aliasSource.targetText !== targetText) { return []; }
    const cache = aliasSource?.cache ?? (targetText === entry.text ? entry.cache : parseMarkdown(targetText));
    const cacheCharacters = boundedSubpathCache(cache);
    if (cacheCharacters === null) { return []; }
    let proofCharacters = 0;
    const resolvePosition = (subpath: string): ReturnType<typeof resolveSubpath> => {
      // A heading proof normalizes complete cached names. Bound aggregate work
      // across existing list members and final choices, not just each input.
      proofCharacters += subpath.length + (subpath.startsWith("#^") ? 0 : cacheCharacters);
      if (proofCharacters > MAX_COMPLETION_SOURCE) { throw new Error("This property section list exceeds its completion proof budget."); }
      return resolveSubpath(cache, subpath);
    };
    const linktext = linkpath === "" ? "" : app.metadataCache.fileToLinktext(target, file.path, true);
    if (linktext !== "" && !safeWikiPart(linktext)) { return []; }
    const existingPositions = new Set<string>();
    for (const value of existing) {
      if (!value.startsWith("[[") || !value.endsWith("]]")) { continue; }
      const link = value.slice(2, -2).split("|", 1)[0], hash = link.indexOf("#");
      if (hash < 0) { continue; }
      const existingPath = link.slice(0, hash);
      if (existingPath && !safeWikiPart(existingPath)) { continue; }
      const resolved = resolve(existingPath);
      if (!resolved || resolved.target !== target) { continue; }
      const position = resolvePosition(link.slice(hash));
      if (position) { existingPositions.add(`${position.type}:${position.start.offset}:${position.end.offset}`); }
    }
    return subpathCompletions(trigger, target.path, targetText, cache).flatMap(selected => {
      const subpath = selected.kind === "heading" ? "#" + headingCompletionSubpath(selected) : "#^" + selected.id;
      const value = propertyWikiLink(linktext + subpath, wiki.displayText ?? alias);
      if (value.length > MAX_COMPLETION_VALUE_LENGTH || /[\x00-\x1f\x7f]/.test(value) || existing.includes(value)) { return []; }
      const resolved = app.metadataCache.resolveReference(linkReference(linktext + subpath), file.path), position = resolvePosition(subpath);
      if (!resolved || resolved.ambiguous || resolved.file !== target || !position || position.type !== selected.kind || position.start.offset !== selected.from || position.end.offset !== selected.to
        || existingPositions.has(`${position.type}:${position.start.offset}:${position.end.offset}`)) { return []; }
      return [{ kind: "subpath" as const, target, targetPath: target.path, targetText, linktext, alias, subpath, subpathKind: selected.kind, from: selected.from, to: selected.to,
        value, sourceText, root, file, sourcePath: file.path, property, query, displayText: wiki.displayText, linkFormat: environment.linkFormat }];
    });
  } catch { return []; }
}

/** Same-key strings, or explicit known-note [[ links. No coercion or network reads. */
export function propertyValueChoices(app: App, file: TFile, property: string, widget: string, existing: readonly string[], query: string): PropertyValueChoice[] {
  const root = app.vault.rootPath, sourceText = propertySuggestionSource(app, file);
  if (!root || sourceText === null || file.extension.toLowerCase() !== "md" || !property || property.length > 256 || /[\x00-\x1f\x7f]/.test(property)
    || query.length > 256 || !["text", "multitext", "aliases", "tags"].includes(widget)
    || app.vault.readOnly || app.changingVault || app.workspace.isChangingFiles || app.workspace.isChangingLayout || !app.core.isEnabled("properties")) { return []; }
  if (query.startsWith("[[")) {
    const wiki = propertyWikiQuery(query);
    if (!wiki) { return []; }
    return wiki.query.includes("#") ? propertySubpathChoices(app, file, property, widget, existing, query, sourceText, root) : propertyLinkChoices(app, file, property, widget, existing, query, sourceText, root);
  }
  const tags = widget === "tags", normalize = (value: string): string => tags ? value.trim().replace(/^#/, "") : value;
  const sources = new Map<string, { contributor: TFile; contributorText: string }>(), values: unknown[] = [];
  let parsedCharacters = 0, inspected = 0, candidateCharacters = 0;
  scan: for (const entry of app.metadataCache.getDocuments().slice(0, MAX_COMPLETION_VALUE_DOCUMENTS)) {
    const contributor = app.vault.getFileByPath(entry.document.file.path);
    if (!contributor || contributor === file || contributor.extension.toLowerCase() !== "md" || entry.missing || contributor.vault !== app.vault) { continue; }
    const text = propertySuggestionSource(app, contributor);
    if (text === null) { continue; }
    let cache = entry.cache;
    if (text !== entry.text) {
      if (parsedCharacters + text.length > MAX_COMPLETION_SOURCE) { continue; }
      parsedCharacters += text.length; cache = parseMarkdown(text);
    }
    if (cache.errors.length || !cache.frontmatter || !Object.hasOwn(cache.frontmatter, property)) { continue; }
    const value = cache.frontmatter[property], items: unknown[] = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (++inspected > MAX_COMPLETION_VALUES) { break scan; }
      // Bound work before trimming/tag validation and Map hashing. Cached data
      // can contain oversized values even when its source was already indexed.
      if (typeof item === "string") {
        if (item.length > MAX_COMPLETION_VALUE_LENGTH) { continue; }
        if (candidateCharacters + item.length > MAX_COMPLETION_VALUE_CHARACTERS) { break scan; }
        candidateCharacters += item.length;
      }
      const candidate = typeof item === "string" ? normalize(item) : item;
      values.push(candidate);
      if (typeof candidate === "string" && (!tags || validTag(candidate)) && !sources.has(candidate)) { sources.set(candidate, { contributor, contributorText: text }); }
    }
  }
  return propertyValueCompletions({ kind: "property-value", property, from: 0, to: 0, query: normalize(query), existingValues: existing.map(normalize) }, values)
    .flatMap(choice => {
      const source = sources.get(choice.value);
      return source ? [{ kind: "value" as const, ...source, value: choice.value, sourceText, root, file, sourcePath: file.path, property, query }] : [];
    }).slice(0, MAX_COMPLETION_RESULTS);
}

/** The same assertion runs at pointer/key acceptance and after the write queue's asynchronous reads. */
export function assertPropertyValueChoice(app: App, choice: PropertyValueChoice, widget: string, existing: readonly string[], query: string, content = propertySuggestionSource(app, choice.file)): void {
  if (choice.root !== app.vault.rootPath || choice.sourcePath !== choice.file.path || choice.query !== query || content !== choice.sourceText
    || !propertyValueChoices(app, choice.file, choice.property, widget, existing, query).some(current => current.value === choice.value && (current.kind !== "value" && choice.kind !== "value"
      ? current.target === choice.target && current.targetPath === choice.targetPath && current.targetText === choice.targetText && current.linktext === choice.linktext && current.alias === choice.alias && current.linkFormat === choice.linkFormat
        && (current.kind === "link" && choice.kind === "link" || current.kind === "subpath" && choice.kind === "subpath" && current.subpath === choice.subpath && current.subpathKind === choice.subpathKind && current.from === choice.from && current.to === choice.to)
      : current.kind === "value" && choice.kind === "value" && current.contributor === choice.contributor && current.contributorText === choice.contributorText))) {
    throw new Error("This property suggestion changed. Type again to review the current values.");
  }
}

export interface PropertyValueSuggestionOptions {
  input: HTMLInputElement;
  container: HTMLElement;
  current: (ownedCreationMutation?: boolean) => boolean;
  choices: (query: string) => PropertySuggestionChoice[];
  accept: (choice: PropertySuggestionChoice, query: string, current: () => boolean) => Promise<boolean>;
  preserveOwnedOnBlur?: () => boolean;
  error: (message: string) => void;
}

/** Inline, owner-bound listbox; retaining a detached choice can never dispatch another write. */
export class PropertyValueSuggestions {
  private choices: PropertySuggestionChoice[] = [];
  private readonly items = new Map<PropertySuggestionChoice, HTMLElement>();
  private query = "";
  private selected = -1;
  private generation = 0;
  private composing = false;
  private choosing = false;
  private creating = false;
  private consumedCreationQuery: string | null = null;
  private disposed = false;
  private readonly list: HTMLDivElement;
  private readonly abort: AbortController;
  private readonly document: Document;
  constructor(private readonly options: PropertyValueSuggestionOptions) {
    const document = options.input.ownerDocument;
    this.document = document;
    this.abort = new (document.defaultView?.AbortController ?? AbortController)();
    this.list = document.createElement("div"); this.list.dataset.propertyValueSuggestions = "true";
    this.list.id = `properties-value-suggestions-${++nextListId}`;
    this.list.className = "suggestion-container mod-property-value"; this.list.setAttribute("role", "listbox");
    this.list.setAttribute("aria-label", "Known values or notes for this property");
    Object.assign(this.list.style, { position: "static", width: "100%", boxSizing: "border-box", minWidth: "0", maxHeight: "12rem", overflowY: "auto", overflowX: "hidden", flex: "1 0 100%" });
    options.container.append(this.list); this.list.hidden = true;
    options.input.setAttribute("aria-autocomplete", "list"); options.input.setAttribute("aria-expanded", "false");
    options.input.setAttribute("aria-controls", this.list.id);
    const on = (type: string, listener: EventListener): void => options.input.addEventListener(type, listener, { signal: this.abort.signal, capture: type === "keydown" });
    on("input", event => {
      if (this.composing || (event as InputEvent).isComposing) { return; }
      if (this.options.input.value !== this.consumedCreationQuery) { this.consumedCreationQuery = null; }
      this.show();
    });
    on("focus", () => { if (!this.composing && !this.choosing) { this.show(); } });
    on("blur", () => { if (!(this.choosing && this.creating && this.options.preserveOwnedOnBlur?.())) { this.close(); } });
    on("compositionstart", () => { this.composing = true; this.close(); });
    on("compositionend", () => {
      this.composing = false;
      if (this.options.input.value !== this.consumedCreationQuery) { this.consumedCreationQuery = null; }
    });
    on("keydown", event => {
      const key = event as KeyboardEvent;
      if (this.composing || key.isComposing || key.keyCode === 229 || key.defaultPrevented) { return; }
      if (!this.available()) { this.close(); return; }
      if (key.key === "Escape" && this.isOpen) { key.preventDefault(); key.stopImmediatePropagation(); this.close(); return; }
      if (key.key === "Escape") { this.consumedCreationQuery = null; }
      if ((key.key === "ArrowDown" || key.key === "ArrowUp") && this.isOpen) {
        key.preventDefault(); key.stopImmediatePropagation();
        this.selected = (this.selected + (key.key === "ArrowDown" ? 1 : this.selected < 0 ? 0 : -1) + this.choices.length) % this.choices.length;
        this.paint(); return;
      }
      if ((key.key === "Enter" || key.key === "Tab") && this.isOpen && this.selected >= 0) {
        key.preventDefault(); key.stopImmediatePropagation(); void this.choose(this.choices[this.selected], this.generation); return;
      }
      if (key.key === "Enter" && this.consumedCreationQuery !== null && this.options.input.value === this.consumedCreationQuery) { key.preventDefault(); key.stopImmediatePropagation(); }
    });
  }
  get isOpen(): boolean { return !this.list.hidden && this.choices.length > 0; }
  get accepting(): boolean { return this.choosing && !this.disposed; }
  get suppressBlurCommit(): boolean { return this.choosing || this.consumedCreationQuery !== null && this.options.input.value === this.consumedCreationQuery; }
  private owned(): boolean {
    const ownedCreationMutation = this.choosing && this.creating && Boolean(this.options.preserveOwnedOnBlur?.());
    return !this.disposed && this.options.input.ownerDocument === this.document && this.options.container.ownerDocument === this.document && this.list.ownerDocument === this.document
      && this.options.input.isConnected && this.options.container.isConnected && this.list.isConnected && this.options.container.contains(this.list) && this.options.current(ownedCreationMutation);
  }
  private available(): boolean { return this.owned() && !this.options.input.disabled && !this.options.input.readOnly; }
  show(): void {
    this.close();
    if (!this.available() || this.composing || this.choosing) { return; }
    this.query = this.options.input.value; this.choices = this.options.choices(this.query);
    if (!this.choices.length) { return; }
    this.list.hidden = false; this.options.input.setAttribute("aria-expanded", "true");
    const generation = this.generation;
    for (const [index, choice] of this.choices.entries()) {
      const item = this.list.ownerDocument.createElement("button"); item.type = "button";
      item.id = `${this.list.id}-option-${index}`;
      item.className = "suggestion-item"; item.dataset.propertyValueChoice = choice.value;
      if (choice.displayText !== undefined) { item.dataset.propertyDisplayText = choice.displayText; }
      item.setAttribute("role", "option"); item.setAttribute("aria-selected", "false"); item.tabIndex = -1;
      item.textContent = choice.kind === "create-note" ? "Create note: " + choice.name : choice.kind === "create-heading"
        ? choice.heading.newHeadings ? "Create heading chain: " + choice.heading.newHeadings.map(heading => heading.heading).join(" → ") : "Create heading: " + choice.heading.heading : choice.value;
      if (choice.kind === "create-note") {
        item.dataset.propertyCreateNote = choice.path;
        item.title = "Create a new empty note at " + choice.path + "\nThen set this property to " + choice.value + ". Undo keeps the created note.";
        const destination = this.document.createElement("small"); destination.textContent = choice.path + (choice.displayText === undefined ? "" : "\n" + choice.value);
        Object.assign(destination.style, { display: "block", whiteSpace: "normal", overflowWrap: "anywhere", opacity: "0.75" }); item.append(destination);
      } else if (choice.kind === "create-heading") {
        item.dataset.propertyCreateHeading = choice.targetPath; item.dataset.propertyHeadingSubpath = choice.heading.subpath;
        item.title = "Create headings in " + choice.targetPath + "#" + choice.heading.subpath + "\n" + choice.heading.preview
          + "\n" + choice.value + (choice.target === choice.file ? "\nSet this property to a wiki link in the same edit. Undo removes the link and new headings together." : "\nThen set this property to a wiki link. Undo keeps the target headings.");
        const destination = this.document.createElement("small"); destination.textContent = choice.targetPath + "#" + choice.heading.subpath + "\n" + choice.heading.preview
          + (choice.displayText === undefined && choice.alias === undefined ? "" : "\n" + choice.value);
        Object.assign(destination.style, { display: "block", whiteSpace: "pre-line", overflowWrap: "anywhere", opacity: "0.75" }); item.append(destination);
      } else if (choice.kind === "link" || choice.kind === "subpath") {
        item.dataset.propertyLinkTarget = choice.targetPath;
        if (choice.alias !== undefined) { item.dataset.propertyLinkAlias = choice.alias; }
        if (choice.kind === "subpath") { item.dataset.propertySubpath = choice.subpath; item.dataset.propertySubpathKind = choice.subpathKind; }
        const destination = choice.targetPath + (choice.kind === "subpath" ? choice.subpath : "");
        const description = (choice.alias === undefined ? destination : `Alias ${choice.alias} → ${destination}`)
          + (choice.displayText === undefined ? "" : ` — Display: ${choice.displayText}`);
        item.title = description + "\n" + choice.value;
        const context = this.document.createElement("small"); context.textContent = description;
        Object.assign(context.style, { display: "block", whiteSpace: "normal", overflowWrap: "anywhere", opacity: "0.75" }); item.append(context);
      }
      Object.assign(item.style, { width: "100%", whiteSpace: "normal", overflowWrap: "anywhere", textAlign: "start", display: "block", height: "auto" });
      item.addEventListener("pointerdown", event => { event.preventDefault(); });
      item.addEventListener("mousedown", event => { event.preventDefault(); });
      item.addEventListener("click", () => { void this.choose(choice, generation); });
      item.addEventListener("pointermove", () => { if (item.isConnected && item.parentElement === this.list && this.list.contains(item) && generation === this.generation && this.available()) { this.selected = index; this.paint(); } });
      this.items.set(choice, item);
      this.list.append(item);
    }
  }
  private paint(): void {
    for (const [index, element] of [...this.list.children].entries()) {
      element.classList.toggle("is-selected", index === this.selected); element.setAttribute("aria-selected", String(index === this.selected));
      if (index === this.selected) { this.options.input.setAttribute("aria-activedescendant", element.id); element.scrollIntoView?.({ block: "nearest" }); }
    }
  }
  private async choose(choice: PropertySuggestionChoice, generation: number): Promise<void> {
    const item = this.items.get(choice);
    if (!this.available() || !item?.isConnected || item.ownerDocument !== this.document || item.parentElement !== this.list || !this.list.contains(item)
      || this.choosing || this.composing || generation !== this.generation || !this.isOpen || this.options.input.value !== this.query || !this.choices.includes(choice)) { return; }
    const query = this.query;
    // An explicit Create consumes this prefix even when its later source save
    // fails. Blurring it after Undo must not queue it again as a literal value.
    if (choice.kind === "create-note" || choice.kind === "create-heading") { this.consumedCreationQuery = query; }
    this.choosing = true; this.creating = choice.kind === "create-note" || choice.kind === "create-heading"; this.close();
    const acceptedGeneration = this.generation;
    const current = (): boolean => this.owned() && this.choosing && this.generation === acceptedGeneration && this.options.input.value === query;
    try { await this.options.accept(choice, query, current); }
    catch (error) { if (!this.disposed && this.options.container.isConnected) { this.options.error(error instanceof Error ? error.message : String(error)); } }
    finally { this.choosing = false; this.creating = false; }
  }
  close(): void { this.generation++; this.choices = []; this.items.clear(); this.selected = -1; this.list.hidden = true; this.list.replaceChildren(); this.options.input.setAttribute("aria-expanded", "false"); this.options.input.removeAttribute("aria-activedescendant"); }
  dispose(): void { this.disposed = true; this.close(); this.abort.abort(); this.options.input.removeAttribute("aria-controls"); this.list.remove(); }
}
