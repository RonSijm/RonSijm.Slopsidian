/** Local table presentation only. These values never enter .base or note YAML. */
export const MAX_BASE_GROUP_SCOPES = 32;
export const MAX_BASE_GROUP_FOLDS = 512;
export const MAX_BASE_GROUP_IDENTITY = 4_096;
export const MAX_BASE_GROUP_STATE_CHARACTERS = 65_536;

export interface BaseGroupScope { file: string; view: string; property: string }
interface BaseGroupFoldContext extends BaseGroupScope { values: string[] }
export interface BaseGroupFoldState { version: 1; contexts: BaseGroupFoldContext[] }

const empty = (): BaseGroupFoldState => ({ version: 1, contexts: [] });
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value));

/** An exact typed encoding, rather than a label, ordinal or collision-prone hash. */
export function baseGroupIdentity(value: unknown): string | null {
  let tuple: unknown[];
  if (value == null) { tuple = ["none"]; }
  else if (typeof value === "string" || typeof value === "boolean") { tuple = [typeof value, value]; }
  else if (number(value)) { tuple = ["number", Object.is(value, -0) ? 0 : value]; }
  else if (value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const kind = descriptors.kind?.value;
    if (kind === "base-date" && number(descriptors.milliseconds?.value)) { tuple = ["date", descriptors.milliseconds.value]; }
    else if (kind === "base-link" && typeof descriptors.path?.value === "string") { tuple = ["link", descriptors.path.value]; }
    else { return null; }
  } else { return null; }
  const identity = "g1:" + JSON.stringify(tuple);
  // Long values remain visible and expanded; they never enlarge saved view state.
  return identity.length <= MAX_BASE_GROUP_IDENTITY ? identity : null;
}

function validIdentity(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_BASE_GROUP_IDENTITY || !value.startsWith("g1:")) { return false; }
  try {
    const tuple = JSON.parse(value.slice(3));
    if (!Array.isArray(tuple)) { return false; }
    const [type, item] = tuple;
    const candidate = type === "none" && tuple.length === 1 ? null
      : tuple.length !== 2 ? undefined
      : (type === "string" && typeof item === "string" || type === "boolean" && typeof item === "boolean" || type === "number" && number(item)) ? item
      : type === "date" && number(item) ? { kind: "base-date", milliseconds: item }
      : type === "link" && typeof item === "string" ? { kind: "base-link", path: item }
      : undefined;
    return candidate !== undefined && baseGroupIdentity(candidate) === value;
  } catch { return false; }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) { throw new Error("Invalid saved Bases group folds."); }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some(descriptor => !Object.hasOwn(descriptor, "value"))) { throw new Error("Invalid saved Bases group folds."); }
  return value as Record<string, unknown>;
}
function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) { throw new Error("Invalid saved Bases group folds."); }
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) { throw new Error("Invalid saved Bases group folds."); }
  }
  return value;
}
function scope(value: unknown, inline = false): BaseGroupScope {
  const entry = record(value);
  for (const key of ["file", "view", "property"] as const) {
    if (typeof entry[key] !== "string" || !entry[key].trim() || entry[key].length > 4_096 || /[\x00-\x1f\x7f]/.test(entry[key])) { throw new Error("Invalid saved Bases group fold scope."); }
  }
  const current = { file: entry.file as string, view: entry.view as string, property: entry.property as string };
  if (current.file.startsWith("/") || current.file.includes("\\") || current.file.split("/").some(part => !part || part === "." || part === "..") || !(inline ? /\.md$/i : /\.base$/i).test(current.file)) { throw new Error("Invalid saved Bases group fold file."); }
  if (!/^(?:file|note|formula)\.[^\x00-\x1f\x7f]+$/.test(current.property)) { throw new Error("Invalid saved Bases grouping property."); }
  return current;
}
const sameScope = (left: BaseGroupScope, right: BaseGroupScope): boolean => left.file === right.file && left.view === right.view && left.property === right.property;

/** Validate completely before a view may retarget or replace any current folds. */
export function readBaseGroupFoldState(value: unknown): BaseGroupFoldState {
  return readGroupState(value, false);
}
function readGroupState(value: unknown, inline: boolean): BaseGroupFoldState {
  if (value === undefined) { return empty(); }
  const state = record(value);
  if (state.version !== 1) { throw new Error("Invalid saved Bases group folds."); }
  const savedContexts = array(state.contexts, MAX_BASE_GROUP_SCOPES);
  let total = 0;
  const contexts: BaseGroupFoldContext[] = [];
  for (const item of savedContexts) {
    const entry = record(item), current = scope(entry, inline);
    const savedValues = array(entry.values, MAX_BASE_GROUP_FOLDS);
    if (contexts.some(entry => sameScope(entry, current)) || !savedValues.length || savedValues.some(value => !validIdentity(value))) { throw new Error("Invalid saved Bases group fold values."); }
    const values = savedValues as string[];
    total += values.length;
    if (total > MAX_BASE_GROUP_FOLDS || new Set(values).size !== values.length) { throw new Error("Invalid saved Bases group fold values."); }
    contexts.push({ ...current, values: [...values] });
  }
  const result: BaseGroupFoldState = { version: 1, contexts };
  if (JSON.stringify(result).length > MAX_BASE_GROUP_STATE_CHARACTERS) { throw new Error("Saved Bases group folds exceed their supported size."); }
  return result;
}

/** Each view owns a separate store; absent groups retain intent across filtering. */
export class BaseGroupFolds {
  private state: BaseGroupFoldState;
  /** Inline stores remain owned by a single fenced render; no standalone state is imported. */
  constructor(value?: unknown, private readonly inline = false) { this.state = readGroupState(value, inline); }
  serialize(): BaseGroupFoldState { return readGroupState(this.state, this.inline); }
  has(current: BaseGroupScope, identity: string): boolean { return this.state.contexts.find(entry => sameScope(entry, current))?.values.includes(identity) ?? false; }
  toggle(current: BaseGroupScope, identity: string): boolean {
    const checked = scope(current, this.inline);
    if (!validIdentity(identity)) { throw new Error("This group value cannot retain a fold preference."); }
    const next = this.serialize();
    let entry = next.contexts.find(entry => sameScope(entry, checked));
    const collapsed = !entry?.values.includes(identity);
    if (collapsed) {
      if (!entry) { entry = { ...checked, values: [] }; next.contexts.push(entry); }
      entry.values.push(identity);
    } else {
      entry!.values.splice(entry!.values.indexOf(identity), 1);
      if (!entry!.values.length) { next.contexts.splice(next.contexts.indexOf(entry!), 1); }
    }
    // A refused over-budget change leaves the current map intact.
    this.state = readGroupState(next, this.inline);
    return collapsed;
  }
}
