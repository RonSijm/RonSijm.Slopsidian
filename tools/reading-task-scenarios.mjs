import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify, root = "app.workspace.activeLeaf.view.previewEl", marked = '.markdown-preview-view[data-reading-tasks-probe="true"]';
const taskSelector = line => marked + ` input[data-reading-task-line=${q(String(line))}]`;
const invoke = (fn, ...args) => `(${fn.toString()})(${args.map(q).join(",")})`;
const bytes = text => Buffer.from("\ufeff" + text);
const configBytes = value => Buffer.from("\ufeff" + JSON.stringify(value, null, 2).replaceAll("\n", "\r\n") + "\r\n");
const pass = (report, message) => { report.checks.push(message); console.log("PASS " + message); };
function taskState() {
  const view = app.workspace.activeLeaf.view, root = view.previewEl;
  return { file: view.file?.path, mode: view.getMode(), text: view.editor.getValue(), dirty: view.isDirty, disposed: view.currentMode.tasks?.isDisposed,
    inputs: [...root.querySelectorAll('input[type="checkbox"]')].map(input => ({ line: input.dataset.readingTaskLine ?? null, checked: input.checked, disabled: input.disabled,
      owned: input.closest(".markdown-preview-view") === root, visible: input.checkVisibility(), label: input.getAttribute("aria-label"), focused: root.ownerDocument.activeElement === input })),
    focus: root.ownerDocument.activeElement?.outerHTML.slice(0, 500) };
}
function taskStyleState(selector) {
  const root = document.querySelector(selector); if (!root) throw Error("Missing task styling root");
  const tasks = [...root.querySelectorAll('input[type="checkbox"]')].map(input => {
    const item = input.closest("li"), scope = input.closest(".markdown-preview-view"), quote = item?.closest("blockquote"), normal = getComputedStyle(scope ?? root).color;
    const outerDecoratedAncestor = Boolean(scope?.parentElement?.closest(".reading-task-label"));
    const ambient = quote && quote.closest(".markdown-preview-view") === scope ? getComputedStyle(quote).color : normal;
    const probe = document.createElement("span"); probe.style.color = getComputedStyle(scope ?? root).getPropertyValue("--text-muted").trim();
    const muted = probe.style.color, labels = input.parentElement.querySelectorAll(':scope > .reading-task-label');
    const ancestors = []; for (let node = input.parentElement; node && node !== scope; node = node.parentElement) ancestors.push({ tag: node.tagName, decoration: getComputedStyle(node).textDecorationLine });
    const styles = [...labels].map(label => ({ color: getComputedStyle(label).color, decoration: getComputedStyle(label).textDecorationLine, text: label.textContent }));
    return { line: input.dataset.readingTaskLine ?? null, checked: input.checked, disabled: input.disabled, main: scope === root,
      normal, ambient, muted, outerDecoratedAncestor, itemColor: item && getComputedStyle(item).color, styles,
      valid: !outerDecoratedAncestor && Boolean(item) && item.classList.contains("is-checked") === input.checked && labels.length > 0 && getComputedStyle(item).color === ambient
        && ancestors.every(node => !node.decoration.includes("line-through"))
        && styles.every(style => style.decoration === (input.checked ? "line-through" : "none") && style.color === (input.checked ? muted : ambient)) };
  });
  return { valid: tasks.length > 0 && tasks.every(task => task.valid), tasks };
}
async function styles(tools, label, selector = marked) {
  const result = await tools.evaluate(invoke(taskStyleState, selector)); assert.equal(result.valid, true, label + ": " + JSON.stringify(result));
  (tools.report.taskStylingProof ??= []).push({ label, ...result }); return result;
}
async function reading(tools, path, count) {
  await tools.evaluate(`(async()=>{if(app.workspace.getActiveFile()?.path!==${q(path)})await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("preview",false);await app.workspace.activeLeaf.view.currentMode.whenReady();${root}.dataset.readingTasksProbe="true"})()`);
  await tools.wait(`app.workspace.getActiveFile()?.path===${q(path)}&&app.workspace.activeLeaf.view.getMode()==="preview"&&Boolean(app.workspace.activeLeaf.view.currentMode.tasks)&&${root}.querySelectorAll('input[data-reading-task-line]').length===${count}`, "original mapped Reading task inputs installed in the current view");
}
async function exact(tools, path, text, physical = false) {
  assert.equal(await tools.evaluate("app.editor.getValue()"), text);
  if (physical) assert.deepEqual(await readFile(join(tools.directory, path)), bytes(text));
}
async function ready(tools, text, line, checked, focus = false) {
  await tools.wait(`app.editor.getValue()===${q(text)}&&(()=>{const r=${root},input=r.querySelector('input[data-reading-task-line="${line}"]');return Boolean(input)&&input.checked===${checked}&&!input.disabled${focus ? "&&r.ownerDocument.activeElement===input" : ""}})()`, "task edit rerenders to exact source and " + (focus ? "retains checkbox focus" : "current checked state"));
}
async function pointer(tools, line, expected, checked) {
  const selector = taskSelector(line);
  await tools.evaluate(`${root}.querySelector('input[data-reading-task-line="${line}"]').scrollIntoView({block:"center"})`);
  await tools.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
  await tools.evaluate("(()=>{globalThis.__readingTaskSelection={editor:app.editor,cm:app.editor.cm,selection:app.editor.cm.state.selection}})()");
  await tools.click(selector); await ready(tools, expected, line, checked, true);
  assert.equal(await tools.evaluate("app.editor===__readingTaskSelection.editor&&app.editor.cm===__readingTaskSelection.cm&&app.editor.cm.state.selection.eq(__readingTaskSelection.selection)"), true, "task marker editing retains the source editor and its selection");
}
async function space(tools, line, expected, checked) {
  await tools.command("Page.bringToFront");
  assert.equal(await tools.evaluate(`(()=>{const r=${root},input=r.querySelector('input[data-reading-task-line="${line}"]');if(!input||input.disabled)throw Error("Missing enabled Reading task for Space");input.scrollIntoView({block:"center"});input.focus({preventScroll:true});return r.ownerDocument.activeElement===input})()`), true);
  const event = { key: " ", code: "Space", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32, modifiers: 0 };
  await tools.command("Input.dispatchKeyEvent", { type: "keyDown", ...event, text: " ", unmodifiedText: " " });
  await tools.command("Input.dispatchKeyEvent", { type: "keyUp", ...event }); await ready(tools, expected, line, checked, true);
}

/** Real main Reading task edits share the current editor and normal guarded saving. */
export async function checkReadingTasks(tools) {
  const { directory, evaluate, command, click, press, wait, report, restart, afterReload, capture } = tools;
  const folder = "Reading task editing", path = folder + "/Tasks.md", embedded = folder + "/Embedded.md", other = folder + "/Other.md";
  const text = ["---", 'opaque: "Retain task λ 中文"', "count: 1.50", "---", "# Reading tasks λ", "", "- [ ] Parent taskneedle λ before ![](Embedded.md) after", "  - [x] Child taskneedle 😀", "    - [ ] Grandchild taskneedle Ω", "  - Ordinary child **bold prose**", "- [X] Other task", "", "1. [ ] Ordered task", "   1. [x] Ordered child", "2. Following item", "", "- [ ] Loose task **bold λ** and *italic Ω* `code` [[Other]]", "", "  Continuation paragraph remains exact.", "", "> - [x] Quoted parent", ">   - [ ] Quoted task", "", "```md", "- [ ] Literal task", "```", "", "![[Embedded]]", "", "# After", "", "- [ ] Last task", "", "Untouched body 😀.", ""].join("\r\n");
  const embeddedText = "# Embedded tasks\r\n\r\n- [x] Embedded parent\r\n  - [ ] Embedded task\r\n", otherText = "# Other task owner\r\n\r\nOther note stays exact.\r\n";
  const lines = text.split("\r\n"), line = value => lines.indexOf(value), parent = lines.findIndex(value => value.startsWith("- [ ] Parent taskneedle λ")), child = line("  - [x] Child taskneedle 😀"), upper = line("- [X] Other task"), ordered = line("1. [ ] Ordered task"), orderedChild = line("   1. [x] Ordered child"), loose = lines.findIndex(value => value.startsWith("- [ ] Loose task")), ordinary = line("  - Ordinary child **bold prose**"), last = line("- [ ] Last task"), heading = line("# Reading tasks λ");
  const count = 8, configPath = join(directory, ".obsidian", "app.json");
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()"), originalConfig = await readFile(configPath), config = JSON.parse(originalConfig.toString("utf8").replace(/^\ufeff/, ""));
  const fixture = { ...config, markdownAutosave: false, foldHeading: true, foldIndent: true };
  await mkdir(join(directory, folder), { recursive: true });
  for (const [name, source] of [[path, text], [embedded, embeddedText], [other, otherText]]) await writeFile(join(directory, name), bytes(source), { flag: "wx" });
  const reset = async () => {
    await evaluate(`(async()=>{await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode("source",false);const editor=app.editor;if(editor.getValue()!==${q(text)})editor.replaceExpected(editor.getValue(),0,editor.getValue().length,${q(text)},"input.reading-task-fixture");await app.saveAll()})()`);
    await reading(tools, path, count); await exact(tools, path, text, true);
  };
  let stage = "initial original-task ownership";
  try {
    await writeFile(configPath, configBytes(fixture)); await evaluate("(async()=>{await app.configuration.read('app');app.markdownAutosave.configure();await app.vault.refresh();await app.metadataCache.refresh()})()");
    await evaluate(`(()=>{const api=app.plugins.modules.obsidian,p=globalThis.__readingTaskStyleProbe={api,clicks:0,loads:0,unloads:0};p.processor=(element,context)=>{if(context.sourcePath!==${q(path)})return;const item=element.querySelector('li[data-source-line="${loose}"]');if(!item)return;const button=document.createElement('button');button.type='button';button.textContent='Task plugin';button.dataset.readingTaskStylePlugin='';item.append(button);const child=new api.MarkdownRenderChild(button);child.onload=()=>p.loads++;child.onunload=()=>p.unloads++;child.registerDomEvent(button,'click',()=>p.clicks++);context.addChild(child)};api.MarkdownPreviewRenderer.registerPostProcessor(p.processor,10)})()`);
    await reset(); await styles(tools, "initial unchecked parent and checked descendants");
    const initial = await evaluate(invoke(taskState)), owned = initial.inputs.filter(input => input.owned && input.line !== null);
    assert.equal(owned.length, count); assert.ok(owned.every(input => !input.disabled && input.label));
    assert.ok(initial.inputs.some(input => input.owned && input.line === null && input.disabled), "quoted task remains disabled and unowned");
    assert.ok(initial.inputs.some(input => !input.owned && input.line === null && input.disabled), "embedded task remains disabled and unowned");
    await evaluate(`(async()=>{const api=app.plugins.modules.obsidian,state=globalThis.__readingTaskStatic={owner:new api.Component(),host:document.createElement('div')};state.host.dataset.readingTaskStyleStatic='';document.body.append(state.host);await state.owner.load();await api.MarkdownRenderer.render(app,${q("# Static tasks\n\n- [x] Static parent\n  - [ ] Static task\n")},state.host,${q(path)},state.owner)})()`);
    assert.equal(await evaluate("(()=>{const input=__readingTaskStatic.host.querySelector('input[type=checkbox]');return Boolean(input)&&input.disabled&&!input.hasAttribute('data-reading-task-line')})()"), true);
    const staticStyle = await styles(tools, "static checked parent and unchecked child", '[data-reading-task-style-static]'); assert.ok(staticStyle.tasks.every(task => task.disabled && task.line === null));
    await evaluate("(async()=>{await __readingTaskStatic.owner.unloadAndWait();__readingTaskStatic.host.remove();delete globalThis.__readingTaskStatic})()");
    const parentText = text.replace("- [ ] Parent taskneedle λ", "- [x] Parent taskneedle λ");
    await pointer(tools, parent, parentText, true); await styles(tools, "checked bullet parent leaves unchecked grandchild plain"); await capture?.("reading-tasks-pointer");
    assert.equal(await evaluate(`(()=>{const host=${root}.querySelector('li[data-source-line="${parent}"] .markdown-embed-content.markdown-preview-view');return Boolean(host)&&!host.parentElement.closest('.reading-task-label')&&[...host.querySelectorAll('input')].every(input=>input.disabled&&!input.hasAttribute('data-reading-task-line'))})()`), true, "inline URI note embed stays outside the completed parent label and retains read-only inputs");
    const childText = parentText.replace("  - [x] Child taskneedle 😀", "  - [ ] Child taskneedle 😀");
    await space(tools, child, childText, false); await styles(tools, "unchecked child and grandchild remain plain below checked parent"); await capture?.("reading-tasks-keyboard");
    const looseText = childText.replace("- [ ] Loose task", "- [x] Loose task"); await pointer(tools, loose, looseText, true);
    const orderedChecked = looseText.replace("1. [ ] Ordered task", "1. [x] Ordered task"); await pointer(tools, ordered, orderedChecked, true);
    const orderedText = orderedChecked.replace("   1. [x] Ordered child", "   1. [ ] Ordered child"); await space(tools, orderedChild, orderedText, false);
    await styles(tools, "checked loose and ordered parent leave own prose and unchecked ordered child plain");
    assert.equal(await evaluate(`(()=>{const r=${root},item=r.querySelector('li[data-source-line="${loose}"]'),label=item.querySelector(':scope>p>.reading-task-label'),continuation=[...item.children].find(node=>node.tagName==='P'&&node!==label.parentElement),ordinary=r.querySelector('li[data-source-line="${ordinary}"]'),normal=getComputedStyle(r).color;return label.querySelector('strong')?.textContent==='bold λ'&&Number(getComputedStyle(label.querySelector('strong')).fontWeight)>=600&&label.querySelector('em')?.textContent==='italic Ω'&&getComputedStyle(label.querySelector('em')).fontStyle==='italic'&&label.querySelector('code')?.textContent==='code'&&label.querySelector('a')?.textContent==='Other'&&continuation?.textContent==='Continuation paragraph remains exact.'&&getComputedStyle(continuation).color===normal&&getComputedStyle(continuation).textDecorationLine==='none'&&getComputedStyle(ordinary).color===normal&&getComputedStyle(ordinary).textDecorationLine==='none'})()`), true);
    await evaluate(`(()=>{const r=${root},item=r.querySelector('li[data-source-line="${loose}"]'),p=__readingTaskStyleProbe; p.retained={input:item.querySelector('input'),label:item.querySelector('.reading-task-label'),inline:[...item.querySelectorAll('strong,em,code,a')],body:r.querySelector('li[data-source-line="${parent}"]>ul'),plugin:item.querySelector('[data-reading-task-style-plugin]'),loads:p.loads,unloads:p.unloads}})()`);
    await click(marked + ` [data-reading-list-fold-toggle=${q(String(parent))}]`); await click(marked + ` [data-reading-list-fold-toggle=${q(String(parent))}]`);
    assert.equal(await evaluate(`(()=>{const r=${root},p=__readingTaskStyleProbe,s=p.retained,item=r.querySelector('li[data-source-line="${loose}"]');return item.querySelector('input')===s.input&&item.querySelector('.reading-task-label')===s.label&&s.inline.every(node=>s.label.contains(node))&&r.querySelector('li[data-source-line="${parent}"]>ul')===s.body&&item.querySelector('[data-reading-task-style-plugin]')===s.plugin&&p.loads===s.loads&&p.unloads===s.unloads})()`), true);
    await click(marked + ' [data-reading-task-style-plugin]'); assert.ok(await evaluate('__readingTaskStyleProbe.clicks>0')); await styles(tools, "original labels and plugin child retained through list folds");
    await evaluate(`${root}.querySelector('input[data-reading-task-line="${parent}"]').scrollIntoView({block:'start'})`); await capture?.("reading-tasks-styling");
    assert.deepEqual(await readFile(join(directory, path)), bytes(text), "Reading task edits do not bypass the paused ordinary save workflow");
    pass(report, "Actual pointer and physical Space edit original tight/nested/ordered/loose Reading task markers in the existing source editor, preserve its selection, and refocus the new task after render. Quoted, embedded and static renderer inputs remain disabled/unowned; paused saving retains every original BOM/CRLF byte.");
    pass(report, "Computed Reading task labels follow only their own checked marker across mixed nested bullet/ordered and tight/loose tasks. Parent completion leaves unchecked child/grandchild labels, ordinary nested prose and loose continuation prose unmuted and unstruck; strong/emphasis/code/link formatting, original checkbox/list/label nodes and live postprocessor children survive list folds. Static, quoted and embedded tasks share correct styles without gaining edit ownership.");

    stage = "source history, dirty text and normal save";
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",false);app.editor.focus()'); await press("z", "KeyZ", 90, 2); await wait(`app.editor.getValue()===${q(orderedChecked)}`, "Source Ctrl+Z isolates the last Reading task marker");
    await press("y", "KeyY", 89, 2); await wait(`app.editor.getValue()===${q(orderedText)}`, "Source Ctrl+Y restores only the task marker");
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("live-preview",false)'); assert.equal(await evaluate("app.editor.getValue()"), orderedText);
    await evaluate('app.editor.setCursor(app.editor.lastLine(),0);app.editor.focus()'); await command("Input.insertText", { text: "Dirty prose Ω" });
    const dirty = orderedText + "Dirty prose Ω"; assert.equal(await evaluate("app.editor.getValue()"), dirty); await reading(tools, path, count);
    const dirtyTask = dirty.replace("- [ ] Last task", "- [x] Last task"); await pointer(tools, last, dirtyTask, true);
    await press("s", "KeyS", 83, 2); await wait("!app.workspace.activeLeaf.view.isDirty&&!app.workspace.activeLeaf.view.isSaving", "ordinary Ctrl+S completes the Reading task save"); await exact(tools, path, dirtyTask, true);
    await evaluate("app.editor.undo()"); await ready(tools, dirty, last, false); await evaluate("app.editor.redo()"); await ready(tools, dirtyTask, last, true); await evaluate("app.saveAll()"); await exact(tools, path, dirtyTask, true); await styles(tools, "saved exact source and isolated Undo/Redo retain own task styling");
    assert.deepEqual(await readFile(join(directory, embedded)), bytes(embeddedText)); assert.deepEqual(await readFile(join(directory, other)), bytes(otherText));
    pass(report, "Source Ctrl+Z/Ctrl+Y isolate each Reading task step, Live Preview returns the same text/history, and a task edit retains existing dirty prose. Ordinary Ctrl+S saves exact UTF-8 BOM/CRLF/Unicode/1.50 source; further task Undo/Redo keeps the dirty prose and untouched other notes.");

    stage = "retained source/owner/write guards"; await reset();
    const hold = async () => evaluate(`(()=>{const view=app.workspace.activeLeaf.view;globalThis.__readingTaskHeld={controller:view.currentMode.tasks,input:${root}.querySelector('input[data-reading-task-line="${parent}"]')};return Boolean(__readingTaskHeld.input)})()`);
    assert.equal(await hold(), true);
    for (const kind of ["root", "readonly", "pending"]) {
      const result = await evaluate(`(()=>{const h=__readingTaskHeld,root=app.vault.rootPath,readonly=app.vault.readOnly,pending=app.changingVault;try{if(${q(kind)}==='root')app.vault.rootPath=root+'-stale-task-root';if(${q(kind)}==='readonly')app.vault.readOnly=true;if(${q(kind)}==='pending')app.changingVault=true;h.input.checked=true;h.input.dispatchEvent(new Event('change',{bubbles:true}));return{applied:h.controller.setChecked(${parent},true),checked:h.input.checked,text:app.editor.getValue()}}finally{app.vault.rootPath=root;app.vault.readOnly=readonly;app.changingVault=pending}})()`);
      assert.deepEqual(result, { applied: false, checked: false, text });
    }
    await evaluate('app.workspace.activeLeaf.view.setEditingMode("source",false)');
    assert.equal(await evaluate(`__readingTaskHeld.controller.setChecked(${parent},true)`), false); assert.equal(await evaluate("app.editor.getValue()"), text); await reading(tools, path, count);
    assert.equal(await hold(), true); const newer = text + "Newer dirty source Ω";
    assert.equal(await evaluate(`(()=>{const old=app.editor.getValue();app.editor.replaceExpected(old,0,old.length,${q(newer)},'input.reading-task-stale-source');__readingTaskHeld.input.click();return __readingTaskHeld.controller.setChecked(${parent},true)})()`), false);
    assert.equal(await evaluate("app.editor.getValue()"), newer); await evaluate("app.editor.undo()"); await ready(tools, text, parent, false); await evaluate("app.saveAll()");
    assert.equal(await hold(), true); const external = text.replace("- [X] Other task", "- [X] Observed external task");
    await writeFile(join(directory, path), bytes(external)); await wait(`app.editor.getValue()===${q(external)}`, "physical external source update replaces the Reading task generation");
    assert.equal(await evaluate(`(()=>{__readingTaskHeld.input.click();return __readingTaskHeld.controller.setChecked(${parent},true)})()`), false); await exact(tools, path, external, true);
    await writeFile(join(directory, path), bytes(text)); await wait(`app.editor.getValue()===${q(text)}`, "original physical task note returns exactly"); await reading(tools, path, count); assert.equal(await hold(), true);
    await evaluate(`app.openFile(${q(other)})`); assert.equal(await evaluate(`__readingTaskHeld.controller.setChecked(${parent},true)`), false); assert.equal(await evaluate("app.editor.getValue()"), otherText); await reset();
    pass(report, "Retained Reading checkbox events and direct handlers refuse a changed root, read-only/pending state, Source mode, newer dirty source, observed external text and a different note owner. Refusals retain authoritative checkbox/source state and every physical external byte without creating files or changing other notes.");

    stage = "fold visibility, Find retirement and narrow controls";
    await evaluate(`${root}.focus()`); await press("f", "KeyF", 70, 2); await wait('Boolean(document.querySelector("[data-reading-search-query]"))', "Reading Find opens before task interaction");
    await click("[data-reading-search-query]"); await command("Input.insertText", { text: "taskneedle" }); await wait('document.querySelector("[data-reading-search]")?.dataset.readingSearchCount==="3"', "all three visible task labels participate in Reading Find");
    await click(marked + ` [data-reading-list-fold-toggle=${q(String(parent))}]`); await wait(`!${root}.querySelector('input[data-reading-task-line="${child}"]').checkVisibility()&&document.querySelector('[data-reading-search]')?.dataset.readingSearchCount==='1'`, "folded list body hides child tasks from Find");
    const hidden = await evaluate(`(()=>{const view=app.workspace.activeLeaf.view,input=${root}.querySelector('input[data-reading-task-line="${child}"]');input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));return{applied:view.currentMode.tasks.setChecked(${child},false),checked:input.checked,text:app.editor.getValue()}})()`);
    assert.deepEqual(hidden, { applied: false, checked: true, text });
    await click(marked + ` [data-reading-fold-toggle=${q(String(heading))}]`);
    assert.equal(await evaluate(`app.workspace.activeLeaf.view.currentMode.tasks.setChecked(${parent},true)`), false); assert.equal(await evaluate("app.editor.getValue()"), text);
    await evaluate(`app.workspace.activeLeaf.view.revealLine(${parent})`); await wait(`${root}.querySelector('input[data-reading-task-line="${parent}"]').checkVisibility()`, "explicit task source reveal expands heading ancestors");
    await pointer(tools, parent, parentText, true);
    assert.equal(await evaluate('Boolean(document.querySelector("[data-reading-search]"))'), false, "source edit retires the old Reading Find owner");
    assert.equal(await evaluate(`${root}.querySelector('[data-reading-list-fold-toggle="${parent}"]').getAttribute('aria-expanded')`), "true", "ordinary source rerender resets per-render list folds");
    const originalStyle = await evaluate(`${root}.firstElementChild.getAttribute('style')`);
    const narrow = async () => evaluate(`${root}.firstElementChild.style.width='320px';${root}.firstElementChild.style.maxWidth='320px'`);
    try {
      await narrow(); const next = parentText.replace("- [X] Other task", "- [ ] Other task"); await space(tools, upper, next, false); await narrow();
      const geometry = await evaluate(`(()=>{const section=${root}.firstElementChild,box=section.getBoundingClientRect(),inputs=[...section.querySelectorAll('input[data-reading-task-line]')].filter(input=>input.checkVisibility());return{width:box.width,inputs:inputs.map(input=>{const a=input.getBoundingClientRect(),li=input.closest('li'),fold=li.querySelector(':scope > button.reading-list-fold-toggle')?.getBoundingClientRect(),overlap=fold&&Math.min(a.right,fold.right)>Math.max(a.left,fold.left)&&Math.min(a.bottom,fold.bottom)>Math.max(a.top,fold.top);return a.width>0&&a.height>0&&a.left>=box.left-1&&a.right<=box.right+1&&!overlap}),labels:inputs.map(input=>{const label=input.parentElement.querySelector(':scope>.reading-task-label'),rects=label&&[...label.getClientRects()].filter(rect=>rect.width>0&&rect.height>0);return Boolean(rects?.length)&&rects.every(rect=>rect.left>=box.left-1&&rect.right<=box.right+1)})}})()`);
      assert.ok(geometry.width <= 321 && geometry.inputs.length === count && geometry.inputs.every(Boolean) && geometry.labels.length === count && geometry.labels.every(Boolean), JSON.stringify(geometry)); await styles(tools, "320px wrapped labels preserve independent completion states"); await capture?.("reading-tasks-narrow");
    } finally { await evaluate(`(()=>{const section=${root}.firstElementChild;if(${q(originalStyle)}===null)section.removeAttribute('style');else section.setAttribute('style',${q(originalStyle)})})()`); }
    pass(report, "Heading/list folds make held hidden-task actions refuse without source changes and prune task labels from Find. Editing a visible task retires the old Find owner and resets per-render folds. At a measured 320px Reading column, real Space editing and refocused original task controls remain visible and do not overlap fold buttons.");

    stage = "restart and fresh task ownership";
    await evaluate("(async()=>{if(globalThis.__readingTaskStyleProbe){__readingTaskStyleProbe.api.MarkdownPreviewRenderer.unregisterPostProcessor(__readingTaskStyleProbe.processor);await Promise.resolve();await app.workspace.activeLeaf.view.currentMode.whenReady()}})()");
    const saved = await evaluate("app.editor.getValue()"); await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()"); await exact(tools, path, saved, true);
    if (restart) await restart(); else await command("Page.reload"); await afterReload(); await reading(tools, path, count);
    assert.equal(await evaluate("app.editor.getValue()"), saved); const after = saved.replace("1. [ ] Ordered task", "1. [x] Ordered task");
    await space(tools, ordered, after, true); await evaluate("app.editor.undo()"); await ready(tools, saved, ordered, false); await evaluate("app.saveAll()"); await exact(tools, path, saved, true); await styles(tools, "restart installs fresh own-marker styles"); await capture?.("reading-tasks-restored");
    report.readingTasks = { originalMainInputsOnly: true, mouseAndPhysicalSpace: true, focusRestored: true, nestedOrderedAndLoose: true, sameSourceEditorAndSelection: true, exactBomCrLfUnicode: true,
      isolatedUndoRedo: true, dirtyProseRetained: true, sourceAndLivePreviewReturn: true, normalGuardedSave: true, staleSourceModeFileRootRefusal: true, observedExternalRefusal: true,
      readOnlyAndPendingRefusal: true, hiddenFoldedActionRefusal: true, findOwnerRetired: true, narrow320: true, restartFreshOwner: true };
    report.taskStyling = { ownMarkerOnly: true, mixedDescendantStates: true, tightLooseBulletOrdered: true, inlineFormattingAndProse: true, originalDomAndFoldControls: true,
      staticQuotedEmbedded: true, uriEmbedsOutsideLabels: true, historySaveExact: true, narrow320: true, restart: true };
    pass(report, "Full native restart or actual-folder reconnection restores exact saved task source and installs fresh Reading checkbox owners. A new physical Space action still edits one ordered-task marker, restores focus and undoes in one step; normal saving retains every original BOM/CRLF and other-note byte.");
  } catch (error) {
    try { report.readingTasksFailure = { stage, ...await evaluate(invoke(taskState)) }; await capture?.("reading-tasks-precleanup-failure"); } catch { report.readingTasksFailure ??= { stage }; }
    throw error;
  } finally {
    await evaluate("(async()=>{if(globalThis.__readingTaskStyleProbe){__readingTaskStyleProbe.api.MarkdownPreviewRenderer.unregisterPostProcessor(__readingTaskStyleProbe.processor);delete globalThis.__readingTaskStyleProbe}if(globalThis.__readingTaskStatic){await __readingTaskStatic.owner.unloadAndWait();__readingTaskStatic.host.remove();delete globalThis.__readingTaskStatic}for(const key of ['__readingTaskSelection','__readingTaskHeld'])delete globalThis[key];for(const node of document.querySelectorAll('[data-reading-tasks-probe]'))delete node.dataset.readingTasksProbe})()");
    await evaluate(`(async()=>{await app.openFile(${q(path)});app.workspace.activeLeaf.view.setEditingMode('source',false);const editor=app.editor;if(editor.getValue()!==${q(text)})editor.replaceExpected(editor.getValue(),0,editor.getValue().length,${q(text)},'input.reading-task-cleanup');await app.saveAll()})()`);
    await writeFile(configPath, originalConfig); await evaluate(`(async()=>{await app.configuration.read('app');app.markdownAutosave.configure();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout()})()`);
    assert.deepEqual(await readFile(join(directory, path)), bytes(text)); assert.deepEqual(await readFile(configPath), originalConfig);
  }
}

/** Root supplies the actual cached repository and audits all unchanged blobs/network counters. */
export async function checkReadingTasksReadOnly(tools) {
  const { evaluate, command, wait, report, capture } = tools; assert.equal(await evaluate("app.vault.readOnly"), true);
  const text = await evaluate("app.editor.getValue()"), lines = text.split(/\r?\n/), open = lines.indexOf("- [ ] Open task"); assert.ok(open >= 0);
  const count = lines.filter(line => /^[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]+\[[ xX]\](?:[ \t]|$)/.test(line)).length;
  const before = await evaluate('(async()=>(await app.configuration.read("app")).data)()');
  try {
    await reading(tools, "Read only.md", count); await evaluate(`app.workspace.activeLeaf.view.revealLine(${open})`);
    await wait(`${root}.querySelector('input[data-reading-task-line="${open}"]')?.checkVisibility()`, "cache-only disabled task checkbox is visibly rendered");
    const initial = await evaluate(invoke(taskState)); assert.equal(initial.inputs.filter(input => input.owned && input.line !== null).length, count); assert.ok(initial.inputs.every(input => input.disabled));
    const styled = await styles(tools, "cached read-only checked parent and unchecked nested task");
    const checkedParent = lines.indexOf("- [x] Parent task"), uncheckedChild = lines.indexOf("  - [ ] Nested task"); assert.ok(checkedParent >= 0 && uncheckedChild > checkedParent);
    assert.equal(styled.tasks.find(task => task.line === String(checkedParent))?.checked, true); assert.equal(styled.tasks.find(task => task.line === String(uncheckedChild))?.checked, false);
    const point = await evaluate(`(()=>{const input=${root}.querySelector('input[data-reading-task-line="${open}"]');input.scrollIntoView({block:'center'});const r=input.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await command("Page.bringToFront"); await command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 }); await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    const event = { key: " ", code: "Space", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32, modifiers: 0 };
    await command("Input.dispatchKeyEvent", { type: "keyDown", ...event, text: " ", unmodifiedText: " " }); await command("Input.dispatchKeyEvent", { type: "keyUp", ...event });
    assert.equal(await evaluate("app.editor.getValue()"), text);
    const forced = await evaluate(`(()=>{const view=app.workspace.activeLeaf.view,input=${root}.querySelector('input[data-reading-task-line="${open}"]');input.disabled=false;input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));const applied=view.currentMode.tasks.setChecked(${open},true);view.currentMode.tasks.refresh();return{applied,checked:input.checked,disabled:input.disabled,text:app.editor.getValue()}})()`);
    assert.deepEqual(forced, { applied: false, checked: false, disabled: true, text }); assert.deepEqual(await evaluate('(async()=>(await app.configuration.read("app")).data)()'), before);
    const refusedStyles = await styles(tools, "cached read-only refusal keeps independent styles"); assert.ok(refusedStyles.tasks.every(task => task.disabled));
    await capture?.("reading-tasks-readonly");
    report.readingTasks = { ...(report.readingTasks ?? {}), cachedReadOnlyDisabled: true, readOnlyPhysicalRefusal: true, readOnlySyntheticAndDirectRefusal: true, readOnlySourceAndConfigurationExact: true };
    report.taskStyling = { ...(report.taskStyling ?? {}), cachedReadOnlyMixedStates: true, cachedReadOnlyDisabled: true, cachedReadOnlyExactSource: true };
    pass(report, "A genuine cached read-only Reading note keeps every original task checkbox disabled. Actual mouse/Space attempts and forced change/direct-handler calls refuse one-character edits and restore the original checkbox, source and configuration while the parent audits exact blobs and zero GitHub requests.");
    pass(report, "A genuine cached read-only checked parent and unchecked nested task have independent computed label color/decoration. Quoted and embedded labels retain their own marker styling; all task inputs stay disabled, refused gestures retain those styles, and source/configuration remain exact.");
  } catch (error) {
    try { report.readingTasksReadOnlyFailure = await evaluate(invoke(taskState)); await capture?.("reading-tasks-readonly-precleanup-failure"); } catch { /* Keep original assertion. */ }
    throw error;
  } finally { await evaluate(`delete ${root}.dataset.readingTasksProbe`); }
}
