import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { history, undo, redo } from "@codemirror/commands";

test("CodeMirror history restores the seeded text with its native undo and redo carets", () => {
  const original = "Keep this text, selection and undo through theme changes.\n";
  let state = EditorState.create({ doc: original, extensions: [history()] });
  state = state.update({ changes: { from: 0, insert: "Unsaved " }, selection: { anchor: 2, head: 9 } }).state;
  const edited = state.doc.toString(), selected = state.selection.main;
  assert.deepEqual([selected.from, selected.to], [2, 9]);
  let current = state;
  const run = command => { assert.equal(command({ state: current, dispatch: transaction => { current = transaction.state; } }), true); };
  run(undo);
  assert.equal(current.doc.toString(), original);
  const afterUndo = current.selection.main;
  assert.deepEqual([afterUndo.from, afterUndo.to], [0, 0]);
  run(redo);
  assert.equal(current.doc.toString(), edited);
  const afterRedo = current.selection.main;
  assert.deepEqual([afterRedo.from, afterRedo.to], [8, 8]);
});
