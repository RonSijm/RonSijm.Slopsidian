import { isScalar } from "yaml";
import { sameValue } from "./markdown";
import { multilineText } from "./multiline-properties";
import { MAX_STRUCTURED_SCALAR_TEXT, checkedStructuredPropertySnapshot, replaceStructuredPropertyScalarSource, replaceStructuredPropertyValue, reviewedStructuredPropertySource, type StructuredPropertyPath, type StructuredTextEditor } from "./structured-properties";

export interface StructuredMultilinePlan {
  readonly source: string; readonly result: string; readonly before: string; readonly after: string;
  readonly from: number; readonly to: number; readonly sourceBefore: string; readonly sourceAfter: string;
  readonly requiresReview: boolean;
  readonly name: string; readonly path: StructuredPropertyPath;
}
export interface StructuredMultilineEditor extends StructuredTextEditor { reviewed(value: string): StructuredMultilinePlan | null }
const plans = new WeakSet<StructuredMultilinePlan>();
const refused = (): Error => new Error("This nested text cannot be reviewed safely here. Review its current YAML in Source.");
const exactText = (value: string): string => {
  if (typeof value !== "string" || value.length > MAX_STRUCTURED_SCALAR_TEXT || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) { throw new Error("Use at most 4,096 decoded characters without control characters for nested text."); }
  return value;
};

/** The displayed replacement is the same proven CST splice used by Apply.
 * Edited block scalars become double-quoted YAML; untouched tokens stay exact. */
export function planStructuredPropertyMultiline(source: string, name: string, path: StructuredPropertyPath, after: string): StructuredMultilinePlan {
  exactText(after);
  path = (checkedStructuredPropertySnapshot({ path }) as { path: StructuredPropertyPath }).path;
  if (!Array.isArray(path)) { throw refused(); }
  const proof = reviewedStructuredPropertySource(source, name), key = JSON.stringify(path);
  const leaf = proof.leaves.find(item => JSON.stringify(item.path) === key), node = proof.target.getIn([...path], true);
  if (!leaf || typeof leaf.value !== "string" || !isScalar(node) || !node.srcToken || leaf.from >= leaf.to) { throw refused(); }
  const next = replaceStructuredPropertyValue(proof.value, path, leaf.value, after);
  const result = replaceStructuredPropertyScalarSource(source, name, path, after);
  const remaining = source.length - leaf.to, sourceBefore = source.slice(leaf.from, leaf.to), sourceAfter = result.slice(leaf.from, result.length - remaining);
  if (result.slice(0, leaf.from) !== source.slice(0, leaf.from) || result.slice(result.length - remaining) !== source.slice(leaf.to)) { throw refused(); }
  const final = reviewedStructuredPropertySource(result, name);
  if (!sameValue(final.value, next)) { throw refused(); }
  const plan = Object.freeze({ source, result, before: leaf.value, after, from: leaf.from, to: leaf.to, sourceBefore, sourceAfter, name, path: Object.freeze([...path]),
    requiresReview: node.srcToken.type === "block-scalar" || /[\r\n]/.test(sourceBefore) || /[\r\n]/.test(leaf.value) || /[\r\n]/.test(after) });
  plans.add(plan); return plan;
}

/** Only the selected scalar may differ in the discarded serialization. Empty
 * commented blocks are one such yaml stringifier edge; the exact reviewed CST
 * splice is independently reparsed against all original frontmatter values. */
export function preserveStructuredPropertyMultilineSource(updated: string, original: string, plan: StructuredMultilinePlan): string {
  if (!plans.has(plan) || original !== plan.source) { throw refused(); }
  const before = reviewedStructuredPropertySource(original, plan.name), candidate = reviewedStructuredPropertySource(updated, plan.name);
  const key = JSON.stringify(plan.path), old = before.leaves.find(leaf => JSON.stringify(leaf.path) === key), serialized = candidate.leaves.find(leaf => JSON.stringify(leaf.path) === key);
  if (!old || !serialized || old.value !== plan.before || original.slice(plan.from, plan.to) !== plan.sourceBefore) { throw refused(); }
  const expected = replaceStructuredPropertyValue(before.value, plan.path, old.value, plan.after);
  const corrected = replaceStructuredPropertyValue(candidate.value, plan.path, serialized.value, plan.after);
  if (!sameValue(expected, corrected) || plan.result !== original.slice(0, plan.from) + plan.sourceAfter + original.slice(plan.to)) { throw refused(); }
  const complete = candidate.doc.toJS({ maxAliasCount: 50 });
  Object.defineProperty(complete, plan.name, { value: corrected, enumerable: true, writable: true, configurable: true });
  const final = reviewedStructuredPropertySource(plan.result, plan.name);
  if (!sameValue(final.value, expected) || !sameValue(complete, final.doc.toJS({ maxAliasCount: 50 }))) { throw refused(); }
  return plan.result;
}

/** JSON spelling exposes CR, LF and every trailing newline without rendering YAML/HTML. */
export function structuredTextNewlines(value: string): string {
  const crlf = (value.match(/\r\n/g) ?? []).length, cr = (value.match(/\r(?!\n)/g) ?? []).length, lf = (value.match(/(?<!\r)\n/g) ?? []).length;
  const trailing = value.match(/[\r\n]+$/)?.[0] ?? "";
  return `${value.length} UTF-16 units; LF ${lf}, CRLF ${crlf}, CR ${cr}; trailing newline text ${JSON.stringify(trailing)}.`;
}

export function createStructuredMultilineEditor(document: Document, options: {
  value: string; label: string; current: () => boolean; refresh: () => void; error: (message: string) => void;
  plan: (value: string) => StructuredMultilinePlan;
}): StructuredMultilineEditor {
  exactText(options.value);
  const initialPlan = options.plan(options.value), element = document.createElement("div"), input = document.createElement("textarea");
  const formatLabel = document.createElement("label"), format = document.createElement("select"), help = document.createElement("p"), button = document.createElement("button"), review = document.createElement("div");
  element.className = "metadata-structured-multiline"; element.dataset.propertyStructuredMultiline = "";
  input.rows = 4; input.maxLength = MAX_STRUCTURED_SCALAR_TEXT * 6 + 2;
  formatLabel.textContent = "Text representation "; format.dataset.propertyStructuredTextFormat = ""; format.setAttribute("aria-label", "Text representation for " + options.label);
  for (const [value, label] of [["lines", "Lines (LF)"], ["escaped", "Escaped text (JSON string)"]]) { const option = document.createElement("option"); option.value = value; option.textContent = label; format.append(option); }
  formatLabel.append(format); help.className = "metadata-multiline-help"; help.dataset.propertyStructuredTextHelp = "";
  button.type = "button"; button.textContent = "Review multiline text"; button.dataset.propertyStructuredTextReview = "";
  review.className = "metadata-structured-text-review"; review.dataset.propertyStructuredTextReviewed = ""; review.setAttribute("aria-live", "polite"); review.hidden = true;
  element.append(formatLabel, input, help, button, review);
  let mode = "lines", lineValue = options.value, reviewed: StructuredMultilinePlan | null = null, disposed = false, locked = false, composing = false;
  const value = (): string => {
    if (mode === "escaped") {
      let result: unknown; try { result = JSON.parse(input.value); } catch { throw new Error('Enter one JSON string, including its double quotes. Use \\n for LF and \\r for CR.'); }
      if (typeof result !== "string") { throw new Error("Escaped text must decode to a string."); }
      return exactText(result);
    }
    if (lineValue.includes("\r")) { if (input.value !== multilineText(lineValue)) { throw new Error("Choose Escaped text to edit a value containing carriage returns exactly."); } return lineValue; }
    return exactText(input.value);
  };
  const required = (next: string): boolean => initialPlan.requiresReview || /[\r\n]/.test(next);
  const changed = (): void => {
    reviewed = null; review.hidden = true; review.replaceChildren();
    let next: string; try { next = value(); } catch { next = options.value; }
    button.hidden = !required(next);
    help.textContent = mode === "lines" && lineValue.includes("\r")
      ? "This value contains carriage returns. Lines is a read-only LF display; choose Escaped text to edit the exact decoded string."
      : (mode === "escaped" ? "Edit one JSON string. Escapes preserve exact CR, LF and trailing newlines. " : "Enter adds LF. Trailing blank lines are part of the value. ")
        + (required(next) ? "Review multiline text before Apply. Edited text uses double-quoted YAML with explicit escapes; comments remain." : "Type and value remain a draft until Apply.");
  };
  const show = (next: string): void => { input.readOnly = mode === "lines" && next.includes("\r"); input.value = mode === "escaped" ? JSON.stringify(next) : multilineText(next); input.rows = Math.min(8, Math.max(4, input.value.split("\n").length + 1)); };
  format.value = mode; show(options.value); changed();
  format.addEventListener("change", () => {
    if (disposed || locked || composing || !options.current() || !["lines", "escaped"].includes(format.value)) { format.value = mode; return; }
    try { const next = value(); mode = format.value; lineValue = next; show(next); changed(); options.error(""); options.refresh(); input.focus(); }
    catch (issue) { format.value = mode; options.error(issue instanceof Error ? issue.message : String(issue)); }
  });
  button.addEventListener("click", () => {
    if (disposed || locked || composing) { return; }
    if (!options.current()) { options.error("The note or nested property owner changed. Cancel this draft and review the current source."); return; }
    try {
      const plan = options.plan(value()); reviewed = plan; review.replaceChildren();
      for (const [label, text, key] of [["Before decoded text", JSON.stringify(plan.before), "before"], ["After decoded text", JSON.stringify(plan.after), "after"], ["Before scalar YAML", plan.sourceBefore, "source-before"], ["After scalar YAML", plan.sourceAfter, "source-after"]]) {
        const title = document.createElement("strong"), pre = document.createElement("pre"); title.textContent = label; pre.textContent = text; pre.dataset.propertyStructuredTextPart = key; review.append(title, pre);
      }
      const detail = document.createElement("p"); detail.textContent = `Before: ${structuredTextNewlines(plan.before)} After: ${structuredTextNewlines(plan.after)} Only the shown scalar range changes. Apply value changes this property.`;
      review.append(detail); review.hidden = false; help.textContent = "Reviewed exact decoded text and scalar YAML. Apply value changes this property; any further edit requires a fresh review."; options.error(""); options.refresh();
    } catch (issue) { changed(); options.error(issue instanceof Error ? issue.message : String(issue)); }
  });
  input.addEventListener("compositionstart", () => { if (!disposed && input.isConnected) { composing = true; changed(); } });
  input.addEventListener("compositionend", () => { if (!disposed && input.isConnected) { composing = false; changed(); options.refresh(); } });
  return { element, input, value, changed, linksAllowed: () => { try { return mode === "lines" && !input.readOnly && !/[\r\n]/.test(value()); } catch { return false; } },
    reviewed(expected) { return reviewed && Object.is(reviewed.after, expected) ? reviewed : null; },
    update(next) { exactText(next); lineValue = next; show(next); changed(); },
    assert(expected) {
      if (disposed || !Object.is(value(), expected)) { throw new Error("The text draft changed after review. Review multiline text again before Apply."); }
      if (required(expected) && (!reviewed || !Object.is(reviewed.after, expected) || reviewed.source !== initialPlan.source)) { throw new Error("Review multiline text before applying this change. The note has not been changed."); }
    },
    lock(value) { locked = value; format.disabled = button.disabled = value; },
    dispose() { disposed = true; reviewed = null; element.remove(); }
  };
}
