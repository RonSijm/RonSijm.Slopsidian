import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Public plugin calls against the real shared editor; included in --editor-chrome on both hosts. */
export async function checkEditorPublicApi({ directory, evaluate, command, wait, report }) {
  const path = "Editor public API/Facade.md";
  const text = ["# Public editor API", "alpha", "", "λambda word", "## Section", ...Array.from({ length: 100 }, (_, index) => `Body ${index} preserves a real scroll range.`), "# Last", "end", ""].join("\r\n");
  const original = Buffer.from("\ufeff" + text), layout = await evaluate("app.workspace.getLayout()");
  await evaluate("app.saveAll()");
  await mkdir(join(directory, "Editor public API"), { recursive: true });
  await writeFile(join(directory, path), original, { flag: "wx" });
  await evaluate(`(async()=>{await app.vault.refresh();await app.openFile(${JSON.stringify(path)});app.workspace.activeLeaf.view.setEditingMode("source")})()`);
  await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(path)}&&app.workspace.activeLeaf.view.getEditingMode()==="source"`, "public editor API fixture opened");
  const results = await evaluate(`(()=>{
    const editor=app.editor, view=app.workspace.activeLeaf.view, original=editor.getValue(), results={};
    editor.refresh();editor.focus();results.focus=editor.hasFocus();editor.blur();results.blur=!editor.hasFocus();
    editor.setLine(1,"changed");results.line=editor.getLine(1);editor.undo();results.lineUndo=editor.getValue()===original;editor.redo();results.lineRedo=editor.getLine(1)==="changed";
    editor.setSelection({line:3,ch:6},{line:3,ch:0});results.selection=editor.somethingSelected()&&editor.getSelection()==="λambda";
    results.word=editor.wordAt({line:3,ch:2});results.noWord=editor.wordAt({line:2,ch:0});
    editor.setSelections([{anchor:{line:3,ch:6},head:{line:1,ch:0}}]);
    const before=editor.getValue(), reads=[], writes=[];let changes=0;
    const ref=app.workspace.on("editor-change",changed=>{if(changed===editor)changes++});
    try{editor.processLines((line,text)=>{reads.push(line);return text.toUpperCase()},(line,text,value)=>{writes.push(line);return {from:{line,ch:0},to:{line,ch:text.length},text:value}})}finally{app.workspace.offref(ref)}
    results.processing={reads,writes,changes,text:editor.getLine(1)+"|"+editor.getLine(3)};
    const processed=editor.getValue();editor.undo();results.processUndo=editor.getValue()===before;editor.redo();results.processRedo=editor.getValue()===processed;
    editor.setCursor(0);editor.exec("foldAll");results.folded=editor.getFoldInfo().folds.length>0;editor.exec("unfoldAll");results.unfolded=editor.getFoldInfo().folds.length===0;
    editor.exec("toggleFold");results.toggleFold=editor.getFoldInfo().folds.length>0;editor.exec("toggleFold");results.toggleUnfold=editor.getFoldInfo().folds.length===0;
    editor.exec("goEnd");results.end=editor.getCursor().line===editor.lastLine();editor.exec("goStart");results.start=editor.getCursor().line===0&&editor.getCursor().ch===0;
    editor.setCursor(1);editor.exec("indentMore");results.indented=/^ +CHANGED$/.test(editor.getLine(1));editor.exec("indentLess");results.unindented=editor.getLine(1)==="CHANGED";
    editor.exec("swapLineDown");results.moved=editor.getLine(2)==="CHANGED";editor.exec("swapLineUp");results.returned=editor.getLine(1)==="CHANGED";
    editor.setCursor(1,0);editor.processLines(()=>true,line=>({from:{line,ch:0},text:"- "}));results.prefix=editor.getCursor().ch===2&&editor.getLine(1)==="- CHANGED";
    editor.scrollIntoView({from:{line:4,ch:0},to:{line:15,ch:0}},true);
    return results;
  })()`);
  assert.deepEqual(results, {
    focus: true, blur: true, line: "changed", lineUndo: true, lineRedo: true, selection: true,
    word: { from: { line: 3, ch: 0 }, to: { line: 3, ch: 6 } }, noWord: null,
    processing: { reads: [1, 3], writes: [1, 3], changes: 1, text: "CHANGED|ΛAMBDA WORD" },
    processUndo: true, processRedo: true, folded: true, unfolded: true, toggleFold: true, toggleUnfold: true,
    end: true, start: true, indented: true, unindented: true, moved: true, returned: true, prefix: true,
  });
  // Let the preceding cursor/fold/range scroll requests reach layout before independently testing manual scrollTo.
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
  await evaluate("(()=>{app.editor.scrollTo(null,120);return true})()");
  await wait("app.editor.getScrollInfo().top>=100", "public scrollTo uses the real shared title/properties/note scroller");
  assert.equal(await evaluate("app.editor.getScrollInfo().top===app.workspace.activeLeaf.view.contentEl.scrollTop"), true);
  await evaluate("app.editor.scrollTo(0,0)");
  await wait("app.editor.getScrollInfo().top===0", "public scrollTo can return to the start of the note");
  // Physical typing after the API batch must still use the live editor and history.
  await evaluate("app.editor.setCursor(1,2);app.editor.focus()");
  await command("Page.bringToFront");
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "x", code: "KeyX", windowsVirtualKeyCode: 88, text: "x", unmodifiedText: "x" });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "x", code: "KeyX", windowsVirtualKeyCode: 88 });
  await wait('app.editor.getLine(1)==="- xCHANGED"', "real typing after processLines and command dispatch");
  await evaluate("app.editor.undo()");
  await wait('app.editor.getLine(1)==="- CHANGED"', "public undo removes only the physical edit");
  await evaluate("app.editor.redo()");
  await wait('app.editor.getLine(1)==="- xCHANGED"', "public redo restores the physical edit");
  await evaluate("app.saveAll()");
  const expected = text.replace("alpha\r\n", "- xCHANGED\r\n").replace("λambda word", "ΛAMBDA WORD");
  assert.deepEqual(await readFile(join(directory, path)), Buffer.from("\ufeff" + expected));
  await evaluate(`app.workspace.changeLayout(${JSON.stringify(layout)})`);
  await evaluate("app.workspace.flushLayout()");
  const message = "Public Editor helpers use the live owner/focus/scroller, Unicode words, real command/fold/history operations, unique read-before-write selected-line batches and one-step undo/redo; physical typing and exact BOM/CRLF saving remain working.";
  report.checks.push(message); console.log("PASS " + message);
}
