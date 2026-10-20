import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
let directory, searchPaneState, sortedSearchResults, SearchTask;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true }); directory = await mkdtemp(join(root, ".runtime/search-panes-tests-"));
  await build({ entryPoints: [join(root, "client/search-pane-model.ts"), join(root, "client/search-task.ts")], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  ({ searchPaneState, sortedSearchResults } = await import(pathToFileURL(join(directory, "search-pane-model.mjs")).href));
  ({ SearchTask } = await import(pathToFileURL(join(directory, "search-task.mjs")).href));
});
after(async () => { if (directory) { assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/search-panes-tests-[^/]+$/); await rm(directory, { recursive: true }); } });
class FakeWorker {
  onmessage = null; onerror = null; stopped = 0; requests = [];
  postMessage(value) { this.requests.push(value); }
  terminate() { this.stopped++; }
  send(data) { this.onmessage?.({ data }); }
}
const query = { query: "needle", options: { matchCase: false }, documents: [] };
function fixture(current = () => true) {
  const workers = [], completed = [], errors = [], task = new SearchTask(() => { const worker = new FakeWorker(); workers.push(worker); return worker; });
  return { workers, completed, errors, task, run: () => task.run(query, current, results => completed.push(results), error => errors.push(error)) };
}

test("original Search state gains independent defaults and detached fold exceptions", () => {
  const input = { query: "tag:#garden", matchingCase: true, sortOrder: "byModifiedTime", collapsedFiles: ["λ.md", "λ.md"], opaque: { keep: [1] } }, before = structuredClone(input);
  const state = searchPaneState(input); assert.deepEqual(input, before); assert.deepEqual(state.collapsedFiles, ["λ.md"]); assert.deepEqual(state.expandedFiles, []);
  state.collapsedFiles.push("Other.md"); assert.deepEqual(input, before);
  assert.deepEqual(searchPaneState({}), { query: "", matchingCase: false, explainSearch: false, collapseAll: false, extraContext: false, sortOrder: "alphabetical", collapsedFiles: [], expandedFiles: [] });
});
test("malformed state is rejected before controls change, including null values, prototype keys and unsafe paths", () => {
  for (const state of [{ query: null }, { query: "x".repeat(16385) }, { matchingCase: 1 }, { explainSearch: "false" }, { collapseAll: null }, { extraContext: [] }, { sortOrder: "constructor" }, { sortOrder: null }, { collapsedFiles: null }, { expandedFiles: Array(4097).fill("a.md") }, ...["", "../a", "/a", ".obsidian/a", "a//b", "a\\b", "a\u0000b"].map(path => ({ collapsedFiles: [path] }))]) { assert.throws(() => searchPaneState(state)); }
  assert.equal(searchPaneState({ query: '<img src=x onerror="throw 1">' }).query, '<img src=x onerror="throw 1">');
});
test("result ordering handles natural paths, timestamps, stable name ties and absent/nonfinite stats without mutating results", () => {
  const results = ["Note 10.md", "Note 2.md", "A.md"].map(path => ({ path, matches: [] })), original = structuredClone(results);
  const stats = { "Note 10.md": { mtime: 10, ctime: 30 }, "Note 2.md": { mtime: 20, ctime: 10 }, "A.md": { mtime: 20, ctime: 20 } }, names = sort => sortedSearchResults(results, sort, p => stats[p]).map(r => r.path);
  assert.deepEqual(names("alphabetical"), ["A.md", "Note 2.md", "Note 10.md"]); assert.deepEqual(names("alphabeticalReverse"), ["Note 10.md", "Note 2.md", "A.md"]);
  assert.deepEqual(names("byModifiedTime"), ["A.md", "Note 2.md", "Note 10.md"]); assert.deepEqual(names("byModifiedTimeReverse"), ["Note 10.md", "A.md", "Note 2.md"]);
  assert.deepEqual(names("byCreatedTime"), ["Note 10.md", "A.md", "Note 2.md"]); assert.deepEqual(names("byCreatedTimeReverse"), ["Note 2.md", "A.md", "Note 10.md"]);
  assert.deepEqual(sortedSearchResults(results, "byModifiedTime", p => p === "A.md" ? { mtime: Infinity, ctime: NaN } : undefined), sortedSearchResults(results, "alphabetical", () => undefined));
  assert.deepEqual(results, original);
});
test("a cold worker gets a separate startup deadline and completes inside its full query budget", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const f = fixture(); f.run(); const worker = f.workers[0];
  t.mock.timers.tick(2300); assert.deepEqual(f.errors, []); assert.deepEqual(worker.requests, []);
  worker.send({ ready: true }); assert.equal(worker.requests.length, 1); assert.equal(worker.requests[0].query, "needle");
  t.mock.timers.tick(1999); worker.send({ id: worker.requests[0].id, results: [{ path: "A.md", matches: [{ from: 1, to: 2 }] }] });
  assert.equal(f.completed.length, 1); assert.equal(worker.stopped, 1); assert.equal(worker.onmessage, null); t.mock.timers.tick(20000); assert.deepEqual(f.errors, []);
});
test("startup and runaway-query timeouts terminate the worker, and repeated readiness cannot extend a running query", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const startup = fixture(); startup.run(); t.mock.timers.tick(9999); assert.deepEqual(startup.errors, []);
  t.mock.timers.tick(1); assert.match(startup.errors[0], /ready within ten seconds/); assert.equal(startup.workers[0].stopped, 1);
  const query = fixture(); query.run(); const worker = query.workers[0]; worker.send({ ready: true }); t.mock.timers.tick(1500); worker.send({ ready: true }); t.mock.timers.tick(500);
  assert.equal(worker.requests.length, 1); assert.match(query.errors[0], /two-second limit/); assert.equal(worker.stopped, 1);
});
test("superseded and cancelled callbacks cannot update another query or leave its worker running", () => {
  const f = fixture(); f.run(); const first = f.workers[0], retained = first.onmessage; first.send({ ready: true }); f.run(); const second = f.workers[1];
  retained({ data: { id: first.requests[0].id, results: [{ path: "Stale.md", matches: [] }] } }); assert.deepEqual(f.completed, []); assert.equal(second.stopped, 0);
  second.send({ ready: true }); second.send({ id: -1, results: [] }); assert.deepEqual(f.completed, []);
  const callback = second.onmessage; f.task.cancel(); callback({ data: { id: second.requests[0].id, results: [] } }); assert.deepEqual(f.completed, []); assert.equal(second.stopped, 1);
});
test("lost view/root ownership discards completion and terminates the owned worker", () => {
  let current = true; const f = fixture(() => current); f.run(); const worker = f.workers[0]; worker.send({ ready: true }); current = false;
  worker.send({ id: worker.requests[0].id, results: [{ path: "Old vault.md", matches: [] }] }); assert.equal(worker.stopped, 1); assert.deepEqual(f.completed, []); assert.deepEqual(f.errors, []);
});
test("worker construction, transfer and execution failures surface actionable inline errors with cleanup", () => {
  const failures = []; new SearchTask(() => { throw Error("denied"); }).run(query, () => true, () => assert.fail(), m => failures.push(m)); assert.match(failures[0], /could not start: denied/);
  const f = fixture(); f.run(); const worker = f.workers[0]; worker.postMessage = () => { throw Error("clone failed"); }; worker.send({ ready: true }); assert.match(f.errors[0], /could not accept the query: clone failed/); assert.equal(worker.stopped, 1);
  f.run(); const second = f.workers[1]; let prevented = false; second.onerror({ message: "load failed", preventDefault() { prevented = true; } }); assert.equal(prevented, true); assert.match(f.errors[1], /engine failed: load failed/); assert.equal(second.stopped, 1);
  f.run(); f.workers[2].send(null); assert.match(f.errors[2], /invalid response/); assert.equal(f.workers[2].stopped, 1);
});
