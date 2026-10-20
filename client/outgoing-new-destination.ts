import type { App } from "./app";
import type { VaultDocument } from "./contracts";
import { outgoingMentions, parseMarkdown, type SourceRange } from "./markdown";
import { outgoingMentionEnvironmentFor, outgoingMentionProseRanges, outgoingMentionRangeSupported, planOutgoingMentionLink, type OutgoingMentionAuthority } from "./outgoing-mention-authoring";
import { applyOutgoingMentionBulk, cancelOutgoingMentionBulk, outgoingMentionBulkCandidate, outgoingMentionBulkReviewCurrent, prepareOutgoingMentionBulk, type OutgoingMentionBulkReview } from "./outgoing-mention-bulk";
import { newDestinationInteractive, newDestinationSourceAvailable, newDestinationSourceCurrent, newDestinationSourceUnchanged, showNewDestinationSource, type NewDestinationSource } from "./outgoing-new-destination-source";
import type { TFile } from "./vault";
import type { WorkspaceLeaf } from "./workspace";

export const NEW_DESTINATION_SOURCE_LIMIT = 262_144;
export const NEW_DESTINATION_MENTION_LIMIT = 32;
const preferenceKeys = ["newFileLocation", "newFileFolderPath", "newLinkFormat", "useMarkdownLinks"] as const;
export interface NewDestinationCandidate {
  readonly source: NewDestinationSource; readonly name: string; readonly path: string; readonly basename: string;
  readonly preferences: readonly (readonly [string, unknown])[]; readonly matches: readonly SourceRange[]; readonly ranges: readonly SourceRange[]; readonly omitted: number;
}
export interface NewDestinationReview { readonly candidate: NewDestinationCandidate; readonly source: OutgoingMentionAuthority }
export interface NewDestinationLinks { readonly review: NewDestinationReview; readonly bulk: OutgoingMentionBulkReview; readonly created: TFile }
type Phase = "create" | "creating" | "links" | "applying" | "closed";
interface ReviewState { phase: Phase; revoked: boolean; owned: () => boolean; unwatch: () => void; attempted: boolean; receipt: VaultDocument | null; links?: NewDestinationLinks }
const issued = new WeakSet<NewDestinationCandidate>(), consumed = new WeakSet<NewDestinationCandidate>(), states = new WeakMap<NewDestinationReview, ReviewState>();
const changed = (): never => { throw new Error("The source, missing destination, preferences or review changed. Choose New destination again."); };
const sameRanges = (left: readonly SourceRange[], right: readonly SourceRange[]): boolean => left.length === right.length && left.every((range, index) => range.from === right[index].from && range.to === right[index].to);
const absent = (candidate: NewDestinationCandidate): boolean => !candidate.source.app.vault.getAbstractFileByPath(candidate.path)
  && !candidate.source.app.vault.getAllLoadedFiles().some(file => file.path.toLowerCase() === candidate.path.toLowerCase());
const preferencesCurrent = (candidate: NewDestinationCandidate): boolean => candidate.preferences.every(([key, value]) => candidate.source.app.vault.getConfig(key) === value)
  && candidate.source.app.fileManager.getNewNotePath(candidate.name, candidate.source.path, true) === candidate.path;

/** A cached named proposal only; no target object, modal, owner or transport is allocated. */
export function outgoingNewDestinationCandidate(app: App, file: TFile, text: string, name: string): NewDestinationCandidate | null {
  if (!newDestinationInteractive(app)) { return null; }
  if (text.length > NEW_DESTINATION_SOURCE_LIMIT) { throw new Error("New-destination review supports source notes up to 262,144 UTF-16 code units."); }
  const available = newDestinationSourceAvailable(app, file, text);
  if (!available) { return null; }
  const source = Object.freeze({ ...available, preferences: Object.freeze(available.preferences.map(pair => Object.freeze([...pair] as const))),
    ...("kind" in available ? { peers: Object.freeze(available.peers.map(peer => Object.freeze({ ...peer }))) } : {}) });
  if (typeof name !== "string" || !name.trim() || name.length > 4096 || /[\r\n\x00-\x1f\x7f]/.test(name)) { throw new Error("Enter a bounded Markdown note name or path."); }
  const path = app.fileManager.getNewNotePath(name, file.path, true), basename = path.split("/").at(-1)!.replace(/\.md$/i, "");
  const preferences = Object.freeze(preferenceKeys.map(key => Object.freeze([key, app.vault.getConfig(key)] as const)));
  const settings = new Map(preferences);
  if (!["root", "current", "folder"].includes(settings.get("newFileLocation") as string) || typeof settings.get("newFileFolderPath") !== "string"
    || !["shortest", "relative", "absolute"].includes(settings.get("newLinkFormat") as string) || typeof settings.get("useMarkdownLinks") !== "boolean") {
    throw new Error("Choose supported new-note placement and wiki or Markdown link preferences before reviewing a new destination.");
  }
  const cache = parseMarkdown(text), target = { path, basename, cache: null }, blocked = outgoingMentionProseRanges(text, cache);
  if (!blocked) { return null; }
  const matches = outgoingMentions(text, cache, file.path, [target])[0]?.matches ?? [];
  const escape = (value: string): string => value.replace(/([\\|#\]])/g, "\\$1");
  const ranges = matches.filter(range => {
    if (!outgoingMentionRangeSupported(text, blocked, range)) { return false; }
    try { planOutgoingMentionLink(text, file.path, target, range, `[[${escape(path)}|${escape(text.slice(range.from, range.to))}]]`); return true; } catch { return false; }
  });
  if (!ranges.length) { throw new Error("This note has no supported literal mention of the new note's basename. Code, links, comments and unsupported syntax stay literal."); }
  if (ranges.length > NEW_DESTINATION_MENTION_LIMIT) { throw new Error("Review at most 32 supported mentions. This group will not be silently shortened."); }
  const candidate = Object.freeze({ source, name, path, basename, preferences,
    matches: Object.freeze(matches.map(range => Object.freeze({ ...range }))), ranges: Object.freeze(ranges.map(range => Object.freeze({ ...range }))), omitted: matches.length - ranges.length });
  if (!absent(candidate)) { throw new Error("That destination already exists, including a case-only path match. Use the existing-destination actions instead."); }
  const parent = path.slice(0, path.lastIndexOf("/"));
  if (path.includes("/") && !app.vault.getFolderByPath(parent)) { throw new Error("Choose an existing folder for the new destination."); }
  issued.add(candidate); return candidate;
}

/** Explicitly show normal Source and review the absent path/ranges, without creating or saving. */
export async function prepareOutgoingNewDestination(candidate: NewDestinationCandidate, owned: () => boolean, pane?: WorkspaceLeaf): Promise<NewDestinationReview> {
  const initial = (): boolean => owned() && newDestinationInteractive(candidate.source.app) && preferencesCurrent(candidate) && absent(candidate) && newDestinationSourceUnchanged(candidate.source);
  if (!issued.has(candidate) || consumed.has(candidate) || !initial()) { return changed(); }
  consumed.add(candidate);
  const app = candidate.source.app;
  let revoked = false, state: ReviewState | undefined;
  const unwatch = app.configuration.watch("app", () => { revoked = true; if (state) { state.revoked = true; } });
  try {
    if (await app.vault.adapter.exists(candidate.path) || revoked || !initial()) { return changed(); }
    const source = await showNewDestinationSource(candidate.source, () => !revoked && initialDuringOpening(), pane);
    function initialDuringOpening(): boolean { return owned() && newDestinationInteractive(app) && preferencesCurrent(candidate) && absent(candidate); }
    if (revoked || !initialDuringOpening() || !newDestinationSourceCurrent(source) || await app.vault.adapter.exists(candidate.path)
      || revoked || !initialDuringOpening() || !newDestinationSourceCurrent(source)) { return changed(); }
    const reviewedSource = Object.freeze({ ...source, preferences: Object.freeze(source.preferences.map(pair => Object.freeze([...pair] as const))) });
    const review = Object.freeze({ candidate, source: reviewedSource });
    state = { phase: "create", revoked: false, owned, unwatch, attempted: false, receipt: null }; states.set(review, state);
    return review;
  } catch (error) { unwatch(); throw error; }
}

function current(review: NewDestinationReview, ownedMutation = false): boolean {
  const state = states.get(review), candidate = review.candidate;
  return Boolean(state && state.phase !== "closed" && !state.revoked && state.owned() && preferencesCurrent(candidate)
    && newDestinationSourceCurrent(review.source, ownedMutation) && (state.receipt || absent(candidate)));
}
export function outgoingNewDestinationReviewCurrent(review: NewDestinationReview): boolean {
  const state = states.get(review);
  return Boolean(state && (state.phase === "create" || state.phase === "links") && current(review)
    && (!state.links || outgoingMentionBulkReviewCurrent(state.links.bulk, () => current(review))));
}
export function outgoingNewDestinationReceipt(review: NewDestinationReview): { attempted: boolean; document: VaultDocument | null } {
  const state = states.get(review); return { attempted: state?.attempted === true, document: state?.receipt ? structuredClone(state.receipt) : null };
}
export function cancelOutgoingNewDestination(review: NewDestinationReview): void {
  const state = states.get(review); if (!state) { return; }
  state.phase = "closed"; state.unwatch(); if (state.links) { cancelOutgoingMentionBulk(state.links.bulk); }
}

/** Create one real empty note; the next literal review alone can authorize source links. */
export async function createOutgoingNewDestination(review: NewDestinationReview): Promise<NewDestinationLinks> {
  const state = states.get(review);
  if (!state || state.phase !== "create" || !current(review)) { return changed(); }
  const { candidate, source } = review, app = source.app;
  state.phase = "creating";
  try {
    const [disk, exists] = await Promise.all([app.vault.readDocument(source.path), app.vault.adapter.exists(candidate.path)]);
    if (!current(review) || exists || disk.file.path !== source.path || disk.version !== source.savedVersion || disk.content !== source.savedText || (disk.hasBom === true) !== source.savedBom) { return changed(); }
    const created = await app.fileManager.createReviewedLinkedNote(candidate.name, source.path, { expectedPath: candidate.path,
      guard: ownedMutation => state.phase === "creating" && current(review, ownedMutation), attempting: () => { state.attempted = true; },
      acknowledged: document => { state.receipt = structuredClone(document); } });
    if (!current(review) || !state.receipt || state.receipt.file.path !== candidate.path || state.receipt.content !== "" || !state.receipt.version
      || created.path !== candidate.path || app.vault.getFileByPath(candidate.path) !== created) { return changed(); }
    const target = app.metadataCache.getDocument(candidate.path);
    if (!target || target.missing || target.text !== "" || target.document.version !== state.receipt.version || target.document.content !== ""
      || (target.document.hasBom === true) !== (state.receipt.hasBom === true)) { return changed(); }
    const bulkCandidate = outgoingMentionBulkCandidate(outgoingMentionEnvironmentFor(source), created, candidate.matches);
    if (!bulkCandidate || bulkCandidate.unavailable) { return changed(); }
    const bulk = await prepareOutgoingMentionBulk(bulkCandidate, () => state.phase === "creating" && current(review));
    if (!current(review) || !sameRanges(candidate.ranges, bulk.changes) || bulk.omitted !== candidate.omitted) { cancelOutgoingMentionBulk(bulk); return changed(); }
    const links = Object.freeze({ review, bulk, created }); state.links = links; state.phase = "links"; return links;
  } catch (error) { cancelOutgoingNewDestination(review); throw error; }
}
export async function applyOutgoingNewDestination(links: NewDestinationLinks): Promise<void> {
  const state = states.get(links.review);
  if (!state || state.links !== links || state.phase !== "links" || !outgoingNewDestinationReviewCurrent(links.review)) { return changed(); }
  state.phase = "applying";
  try { await applyOutgoingMentionBulk(links.bulk, () => state.phase === "applying" && current(links.review)); }
  finally { cancelOutgoingNewDestination(links.review); }
}
