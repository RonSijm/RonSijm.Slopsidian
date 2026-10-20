/** Linked workspace groups: leaves that share a group identifier follow one another's file navigation. */
export const GROUPS_VIEW_ID = "workspace-groups";
export const GROUP_ID = /^[a-zA-Z0-9_-]{1,64}$/;

export interface GroupLinks {
  /** Leaf identifier to group identifier. Only live leaves survive a save; unknown sibling keys are preserved. */
  links: Map<string, string>;
  extras: Record<string, unknown>;
}

export interface GroupMember {
  id: string;
  pinned: boolean;
  busy: boolean;
  deferred: boolean;
  /** Whether the live view can open the source file itself ("file"), accepts the linked hook ("hook") or neither. */
  follow: "file" | "hook" | "none";
}

export interface LinkedPlan { navigate: string[]; hook: string[]; skipped: { id: string; reason: string }[] }

export interface LinkedResult {
  group: string;
  source: string;
  path: string;
  navigated: string[];
  notified: string[];
  skipped: { id: string; reason: string }[];
  failed: { id: string; message: string }[];
}

export function newGroupId(): string {
  return "g" + crypto.randomUUID().replaceAll("-", "").slice(0, 16);
}

export function parseGroups(value: unknown, report: (message: string) => void = () => {}): GroupLinks {
  const result: GroupLinks = { links: new Map(), extras: {} };
  if (value === undefined || value === null) { return result; }
  if (typeof value !== "object" || Array.isArray(value)) { report("Linked-group data was not an object and was ignored."); return result; }
  const { links, ...extras } = value as Record<string, unknown>;
  result.extras = structuredClone(extras);
  if (links === undefined) { return result; }
  if (!links || typeof links !== "object" || Array.isArray(links)) { report("Linked-group links were not an object and were ignored."); return result; }
  let dropped = 0;
  for (const [leaf, group] of Object.entries(links)) {
    if (!GROUP_ID.test(leaf) || typeof group !== "string" || !GROUP_ID.test(group)) { dropped++; continue; }
    result.links.set(leaf, group);
  }
  if (dropped) { report(`${dropped} malformed linked-group ${dropped === 1 ? "entry was" : "entries were"} ignored.`); }
  return result;
}

/** Group data to persist: only live leaves with a shared group, preserving opaque sibling keys. */
export function serializeGroups(links: ReadonlyMap<string, string>, live: ReadonlySet<string>, extras: Record<string, unknown>): Record<string, unknown> {
  const counts = new Map<string, number>();
  for (const [leaf, group] of links) { if (live.has(leaf)) { counts.set(group, (counts.get(group) ?? 0) + 1); } }
  const kept = Object.fromEntries([...links].filter(([leaf, group]) => live.has(leaf) && counts.get(group)! > 1));
  return { ...structuredClone(extras), links: kept };
}

export function groupMembers(links: ReadonlyMap<string, string>, group: string): string[] {
  return [...links].filter(([, value]) => value === group).map(([leaf]) => leaf);
}

/** Decide, before any follower changes, which members navigate, receive the hook, or are refused. */
export function planLinkedNavigation(source: string, members: readonly GroupMember[]): LinkedPlan {
  const plan: LinkedPlan = { navigate: [], hook: [], skipped: [] };
  for (const member of members) {
    if (member.id === source) { continue; }
    if (member.pinned) { plan.skipped.push({ id: member.id, reason: "pinned" }); }
    else if (member.busy) { plan.skipped.push({ id: member.id, reason: "busy" }); }
    else if (member.deferred) { plan.skipped.push({ id: member.id, reason: "unavailable provider" }); }
    else if (member.follow === "file") { plan.navigate.push(member.id); }
    else if (member.follow === "hook") { plan.hook.push(member.id); }
    else { plan.skipped.push({ id: member.id, reason: "view does not follow linked navigation" }); }
  }
  return plan;
}
