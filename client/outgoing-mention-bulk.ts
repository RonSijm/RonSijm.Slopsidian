import { outgoingMentions, parseMarkdown, type SourceRange } from "./markdown";
import { OutgoingMentionError, outgoingMentionReview, outgoingMentionReviewCurrent, planOutgoingMentionLink, reviewedOutgoingMentionPlan, type OutgoingMentionEnvironment, type OutgoingMentionReview } from "./outgoing-mention-authoring";
import { openOutgoingMentionInSource, outgoingMentionIntentAuthority, outgoingMentionIntentReview, sameOutgoingMentionIntentAuthority, type OutgoingMentionIntentReview } from "./outgoing-mention-intent";
import type { TFile } from "./vault";

export const OUTGOING_MENTION_BULK_LIMIT = 32;
type TargetEntry = NonNullable<ReturnType<OutgoingMentionReview["app"]["metadataCache"]["getDocument"]>>;
export interface OutgoingMentionBulkCandidate {
  readonly choice: OutgoingMentionReview;
  readonly ranges: readonly SourceRange[];
  readonly choices: readonly OutgoingMentionReview[];
  readonly targetDocument: TargetEntry["document"];
  readonly targetCache: TargetEntry["cache"];
  readonly targetCacheProof: string;
  readonly unavailable: string | null;
}
export interface OutgoingMentionBulkSourceCandidate {
  readonly kind: "visible-source";
  readonly choice: OutgoingMentionIntentReview;
  readonly ranges: readonly SourceRange[];
  readonly choices: readonly OutgoingMentionIntentReview[];
  readonly sourceCacheProof: string;
  readonly targetDocument: TargetEntry["document"];
  readonly targetCache: TargetEntry["cache"];
  readonly targetCacheProof: string;
  readonly unavailable: string | null;
}
export type OutgoingMentionBulkActionCandidate = OutgoingMentionBulkCandidate | OutgoingMentionBulkSourceCandidate;
export const isOutgoingMentionBulkSourceCandidate = (candidate: OutgoingMentionBulkActionCandidate): candidate is OutgoingMentionBulkSourceCandidate => "kind" in candidate && candidate.kind === "visible-source";
export interface OutgoingMentionBulkChange extends SourceRange { readonly insert: string; readonly label: string }
export interface OutgoingMentionBulkReview {
  readonly candidate: OutgoingMentionBulkCandidate;
  readonly changes: readonly OutgoingMentionBulkChange[];
  readonly text: string;
  readonly omitted: number;
}
interface ReviewState { phase: "review" | "applying" | "closed"; candidate: OutgoingMentionBulkCandidate; changes: readonly OutgoingMentionBulkChange[]; text: string; omitted: number; origin?: () => boolean }
const reviews = new WeakMap<OutgoingMentionBulkReview, ReviewState>();
const changed = (): never => { throw new OutgoingMentionError("The note, mentions, destination or review changed. No links were inserted. Review the current mentions again."); };
const sameRanges = (left: readonly SourceRange[], right: readonly SourceRange[]): boolean => left.length === right.length && left.every((range, index) => range.from === right[index].from && range.to === right[index].to);

/** Cheap group witness only. Rendering never generates links or performs transport. */
export function outgoingMentionBulkCandidate(environment: OutgoingMentionEnvironment | null, target: TFile | null, matches: readonly SourceRange[]): OutgoingMentionBulkCandidate | null {
  if (!environment || !target || !matches.length) { return null; }
  const ranges = matches.map(range => Object.freeze({ from: range.from, to: range.to }));
  if (ranges.some((range, index) => !Number.isInteger(range.from) || !Number.isInteger(range.to) || range.to <= range.from || index > 0 && range.from < ranges[index - 1].to)) { return null; }
  const choices = ranges.map(range => outgoingMentionReview(environment, target, range)).filter((choice): choice is OutgoingMentionReview => Boolean(choice))
    .map(choice => Object.freeze({ ...choice, range: Object.freeze({ ...choice.range }), preferences: Object.freeze(choice.preferences.map(pair => Object.freeze([...pair] as const))) }));
  if (!choices.length) { return null; }
  const entry = environment.app.metadataCache.getDocument(target.path);
  if (!entry || entry.missing) { return null; }
  return Object.freeze({ choice: choices[0], ranges: Object.freeze(ranges), choices: Object.freeze(choices), targetDocument: entry.document, targetCache: entry.cache,
    targetCacheProof: JSON.stringify(entry.cache), unavailable: choices.length > OUTGOING_MENTION_BULK_LIMIT ? "Review up to 32 supported mentions at once. Link individual occurrences first; this group will not be shortened automatically." : null });
}

/** A closed/Reading group is only an intent to show Source. It cannot author or allocate an editor while rendering. */
export function outgoingMentionBulkSourceCandidate(environment: Parameters<typeof outgoingMentionIntentReview>[0], target: TFile | null, matches: readonly SourceRange[]): OutgoingMentionBulkSourceCandidate | null {
  if (!environment || !target || !matches.length) { return null; }
  const ranges = matches.map(range => Object.freeze({ from: range.from, to: range.to }));
  if (ranges.some((range, index) => !Number.isInteger(range.from) || !Number.isInteger(range.to) || range.to <= range.from || index > 0 && range.from < ranges[index - 1].to)) { return null; }
  const choices = ranges.map(range => outgoingMentionIntentReview(environment, target, range)).filter((choice): choice is OutgoingMentionIntentReview => Boolean(choice))
    .map(choice => Object.freeze({ ...choice, range: Object.freeze({ ...choice.range }), preferences: Object.freeze(choice.preferences.map(pair => Object.freeze([...pair] as const))) }));
  if (!choices.length) { return null; }
  const entry = environment.app.metadataCache.getDocument(target.path);
  if (!entry || entry.missing) { return null; }
  return Object.freeze({ kind: "visible-source", choice: choices[0], ranges: Object.freeze(ranges), choices: Object.freeze(choices), sourceCacheProof: JSON.stringify(environment.cache),
    targetDocument: entry.document, targetCache: entry.cache, targetCacheProof: JSON.stringify(entry.cache),
    unavailable: choices.length > OUTGOING_MENTION_BULK_LIMIT ? "Review up to 32 supported mentions at once. Link individual occurrences first; this group will not be shortened automatically." : null });
}

function sourceCandidateCacheCurrent(candidate: OutgoingMentionBulkSourceCandidate): boolean {
  const choice = candidate.choice, target = choice.app.metadataCache.getDocument(choice.targetPath);
  return Boolean(target && !target.missing && target.document === candidate.targetDocument && target.cache === candidate.targetCache
    && JSON.stringify(target.cache) === candidate.targetCacheProof && JSON.stringify(choice.cache) === candidate.sourceCacheProof);
}

/** Show the original note visibly, then prepare the normal literal review against that exact new live owner. */
export async function prepareOutgoingMentionBulkInSource(candidate: OutgoingMentionBulkSourceCandidate, owned: () => boolean): Promise<OutgoingMentionBulkReview> {
  if (candidate.unavailable) { throw new OutgoingMentionError(candidate.unavailable); }
  const original = candidate.choice, authority = outgoingMentionIntentAuthority(original.app, original.file, original.text);
  const matches = outgoingMentions(original.text, parseMarkdown(original.text), original.path, [{ path: original.targetPath, basename: original.target.basename, cache: candidate.targetCache }])[0]?.matches ?? [];
  if (!owned() || !sourceCandidateCacheCurrent(candidate) || !sameOutgoingMentionIntentAuthority(original, authority) || !sameRanges(candidate.ranges, matches)) { return changed(); }
  const handoff = await openOutgoingMentionInSource(original, () => owned() && sourceCandidateCacheCurrent(candidate));
  const live = outgoingMentionBulkCandidate(handoff.choice, original.target, candidate.ranges);
  const lease = (): boolean => owned() && sourceCandidateCacheCurrent(candidate) && handoff.lease();
  if (!live || !handoff.current() || !lease() || live.targetDocument !== candidate.targetDocument || live.targetCache !== candidate.targetCache
    || live.targetCacheProof !== candidate.targetCacheProof) { return changed(); }
  const review = await prepareOutgoingMentionBulk(live, () => lease() && handoff.current());
  const state = reviews.get(review)!;
  if (!lease() || !handoff.current()) { state.phase = "closed"; return changed(); }
  state.origin = lease;
  handoff.view.focus();
  return review;
}

function candidateCurrent(candidate: OutgoingMentionBulkCandidate, owned: () => boolean): boolean {
  try {
    const choice = candidate.choice;
    if (!outgoingMentionReviewCurrent(choice, owned) || choice.document.file.path !== choice.path) { return false; }
    const target = choice.app.metadataCache.getDocument(choice.targetPath);
    return Boolean(target && !target.missing && target.document === candidate.targetDocument && target.cache === candidate.targetCache
      && JSON.stringify(target.cache) === candidate.targetCacheProof && target.text === choice.targetText && target.document.file.path === choice.targetPath
      && target.document.version === choice.targetVersion && target.document.content === choice.targetSavedText && (target.document.hasBom === true) === choice.targetBom);
  } catch { return false; }
}

async function physicalCurrent(candidate: OutgoingMentionBulkCandidate, owned: () => boolean): Promise<boolean> {
  if (!candidateCurrent(candidate, owned)) { return false; }
  const choice = candidate.choice;
  const [source, target] = await Promise.all([choice.app.vault.readDocument(choice.path), choice.app.vault.readDocument(choice.targetPath)]);
  return candidateCurrent(candidate, owned) && source.file.path === choice.path && source.version === choice.savedVersion && source.content === choice.savedText && (source.hasBom === true) === choice.savedBom
    && target.file.path === choice.targetPath && target.version === choice.targetVersion && target.content === choice.targetSavedText && (target.hasBom === true) === choice.targetBom;
}

function plan(candidate: OutgoingMentionBulkCandidate): { changes: readonly OutgoingMentionBulkChange[]; text: string; omitted: number } {
  const choice = candidate.choice, target = { path: choice.targetPath, basename: choice.target.basename, cache: candidate.targetCache };
  const matches = outgoingMentions(choice.text, parseMarkdown(choice.text), choice.path, [target])[0]?.matches ?? [];
  if (!sameRanges(candidate.ranges, matches) || candidate.unavailable) { return changed(); }
  const changes: OutgoingMentionBulkChange[] = [];
  for (const review of candidate.choices) {
    try {
      const planned = reviewedOutgoingMentionPlan(review);
      changes.push(Object.freeze({ from: planned.from, to: planned.to, insert: planned.insert, label: choice.text.slice(planned.from, planned.to) }));
    } catch (error) {
      // The match finder can merge overlapping aliases or include unsupported
      // grammar. Those exact ranges remain literal and are counted in review.
      if (!(error instanceof OutgoingMentionError)) { throw error; }
    }
  }
  if (!changes.length || changes.length > OUTGOING_MENTION_BULK_LIMIT) { throw new OutgoingMentionError("There are no complete, supported mentions to link in this group. Use the individual mention controls."); }
  // Prove the combined result as well as each original range. Descending edits
  // retain original offsets, and each proof preserves the preceding topology.
  let text = choice.text;
  for (const change of [...changes].reverse()) { text = planOutgoingMentionLink(text, choice.path, target, change, change.insert).text; }
  return { changes: Object.freeze(changes), text, omitted: candidate.ranges.length - changes.length };
}

/** Preparation reads current physical bases and creates a literal review; it does not edit or save. */
export async function prepareOutgoingMentionBulk(candidate: OutgoingMentionBulkCandidate, owned: () => boolean): Promise<OutgoingMentionBulkReview> {
  if (candidate.unavailable) { throw new OutgoingMentionError(candidate.unavailable); }
  if (!await physicalCurrent(candidate, owned)) { return changed(); }
  const result = plan(candidate);
  if (!candidateCurrent(candidate, owned)) { return changed(); }
  const review = Object.freeze({ candidate, ...result });
  reviews.set(review, { phase: "review", candidate, ...result }); return review;
}

/** A held review cannot renew its source, target, preference or editor lease. */
export function outgoingMentionBulkReviewCurrent(review: OutgoingMentionBulkReview, owned: () => boolean): boolean {
  const state = reviews.get(review);
  return state?.phase === "review" && (!state.origin || state.origin()) && candidateCurrent(review.candidate, owned);
}
export function cancelOutgoingMentionBulk(review: OutgoingMentionBulkReview): void { const state = reviews.get(review); if (state) { state.phase = "closed"; } }

/** All reviewed edits enter the original shared editor in one isolated Undo step. */
export async function applyOutgoingMentionBulk(review: OutgoingMentionBulkReview, owned: () => boolean): Promise<void> {
  const state = reviews.get(review);
  const original = (): boolean => owned() && (!state?.origin || state.origin());
  if (!state || state.phase !== "review" || !candidateCurrent(state.candidate, original)) { return changed(); }
  state.phase = "applying";
  const current = (): boolean => state.phase === "applying" && candidateCurrent(state.candidate, original);
  try {
    if (!await physicalCurrent(state.candidate, current)) { return changed(); }
    const fresh = plan(state.candidate);
    if (!current() || fresh.text !== state.text || fresh.omitted !== state.omitted || JSON.stringify(fresh.changes) !== JSON.stringify(state.changes)) { return changed(); }
    const { choice } = state.candidate;
    choice.editor.replaceExpectedChanges(choice.text, state.changes, "input.link-mentions");
    if (choice.editor.getValue() !== state.text) { throw new OutgoingMentionError("The editor did not accept every reviewed link exactly. Review the note and its Undo history."); }
    choice.app.metadataCache.updateOpenDocuments();
  } finally { state.phase = "closed"; }
}
