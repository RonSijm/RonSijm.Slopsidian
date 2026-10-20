import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { indexUiWaits } from "../tools/github-index-ui-scenarios.mjs";

// Builds the fake page the generated in-page expressions read; absent controls are simply omitted.
function page({ state = null, status = null, prepare = null, cancelDisabled = null, held = null, metadata = null, dialog = false, app = undefined } = {}) {
  const elements = {
    "[data-github-index-state]": state === null ? null : { dataset: { githubIndexState: state } },
    "[data-github-index-status]": status === null ? null : { textContent: status },
    "[data-github-index-prepare]": prepare === null ? null : { textContent: prepare },
    "[data-github-index-cancel]": cancelDisabled === null ? null : { disabled: cancelDisabled },
    "[data-github-offline-dialog] [data-github-index-prepare]": dialog ? {} : null,
  };
  const document = { querySelector: selector => elements[selector] ?? null, getElementById: id => id === "metadata-status" && metadata !== null ? { textContent: metadata } : null };
  return vm.createContext({ document, window: { __indexHold: held === null ? undefined : { held } }, app });
}
const run = (expression, context) => vm.runInContext(expression, context);

test("every shared index UI wait compiles", () => {
  for (const [name, source] of Object.entries(indexUiWaits)) {
    const expression = typeof source === "function" ? source("mount:id") : source;
    assert.doesNotThrow(() => new vm.Script(expression), name);
  }
});

test("state waits tolerate absent controls and distinguish partial, refused and complete", () => {
  const absent = page();
  for (const name of ["initial", "cancelled", "missing", "corrupt", "complete"]) assert.equal(run(indexUiWaits[name], absent), false, name + " on absent controls");
  assert.equal(run(indexUiWaits.dialog, absent), false);
  assert.equal(run(indexUiWaits.dialog, page({ dialog: true })), true);
  assert.equal(run(indexUiWaits.initial, page({ state: "none" })), true);
  assert.equal(run(indexUiWaits.initial, page({ state: "running" })), false);

  const cancelled = page({ state: "partial", status: "Index cancelled after 1 of 3 notes.", prepare: "Resume index" });
  assert.equal(run(indexUiWaits.cancelled, cancelled), true);
  assert.equal(run(indexUiWaits.cancelled, page({ state: "partial", status: "Index cancelled", prepare: "Prepare index" })), false);
  assert.equal(run(indexUiWaits.cancelled, page({ state: "running", status: "cancelled", prepare: "Resume index" })), false);
  assert.equal(run(indexUiWaits.cancelled, page({ state: "partial", status: null, prepare: "Resume index" })), false);

  const missing = page({ state: "refused", status: "Not cached: Index C.md" });
  assert.equal(run(indexUiWaits.missing, missing), true);
  assert.equal(run(indexUiWaits.corrupt, missing), false);
  assert.equal(run(indexUiWaits.missing, page({ state: "partial", status: "Not cached: Index C.md" })), false);
  const corrupt = page({ state: "refused", status: "Corrupt: Index C.md" });
  assert.equal(run(indexUiWaits.corrupt, corrupt), true);
  assert.equal(run(indexUiWaits.missing, corrupt), false);

  assert.equal(run(indexUiWaits.complete, page({ state: "complete", status: "Complete: 3 of 3 notes verified" })), true);
  assert.equal(run(indexUiWaits.complete, page({ state: "partial", status: "3 of 3 notes" })), false);
  assert.equal(run(indexUiWaits.complete, page({ state: "complete", status: "1 of 3 notes" })), false);
});

test("hold, cancel, metadata, mount and note waits evaluate against partial page states", () => {
  assert.equal(run(indexUiWaits.held, page({ held: 1, status: "Verifying 1 of 3 notes…" })), true);
  assert.equal(run(indexUiWaits.held, page({ held: 0, status: "Verifying 1 of 3 notes…" })), false);
  assert.equal(run(indexUiWaits.held, page({ held: 1, status: null })), false);
  assert.equal(run(indexUiWaits.cancelRegistered, page({ cancelDisabled: true })), true);
  assert.equal(run(indexUiWaits.cancelRegistered, page({ cancelDisabled: false })), false);
  assert.equal(run(indexUiWaits.completeMetadata, page({ metadata: "GitHub · read-only · complete index: 3 notes" })), true);
  assert.equal(run(indexUiWaits.completeMetadata, page({ metadata: "partial index: 1/3 notes loaded" })), false);

  const app = { githubVaults: { state: () => ({ cached: true }) }, vault: { rootPath: "mount:id" }, workspace: { getActiveFile: () => ({ path: "Index A.md" }) } };
  assert.equal(run(indexUiWaits.mount("mount:id"), page({ app })), true);
  assert.equal(run(indexUiWaits.mount("other"), page({ app })), false);
  assert.equal(run(indexUiWaits.mount("mount:id"), page()), false);
  assert.equal(run(indexUiWaits.note, page({ app })), true);
  assert.equal(run(indexUiWaits.note, page({ app: { workspace: { getActiveFile: () => null } } })), false);
});
