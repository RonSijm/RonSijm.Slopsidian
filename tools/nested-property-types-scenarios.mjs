import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const q = JSON.stringify, host = '[data-nested-property-types-root="true"]';
const row = host + ' [data-property-key="opaque"]', inspector = row + ' [data-property-structured="opaque"]';
const edit = (...path) => row + ' [data-property-structured-edit=' + q(JSON.stringify(['branch', ...path])) + ']';
const input = row + ' [data-property-structured-input]', type = row + ' [data-property-structured-type]';
const apply = row + ' [data-property-structured-apply]', cancel = row + ' [data-property-structured-cancel]';
const preview = row + ' [data-property-structured-preview]', issue = row + ' .metadata-property-error';
const bytes = (text, hasBom = true) => Buffer.from((hasBom ? '\ufeff' : '') + text), sha = raw => createHash('sha256').update(raw).digest('hex');
const pass = (report, text) => { report.checks.push(text); console.log('PASS ' + text); };
const original = ['---', '# Typed nested source λ', 'untouched: >- # keep unrelated folded', '  Exact first', '  wrapped 😀', 'opaque:', '  branch:',
  '    enabled: true # keep boolean', '    count: 1.50 # keep number', '    empty: ~ # keep explicit null', '    implicit: # keep implicit empty null',
  "    text: '<img src=x> λ 😀' # keep string", '    multiline: |- # keep selected block', '      First nested λ', '      Second nested 😀',
  '    folded: >- # keep nested folded', '      Folded first', '      continuation Ω', '    mixed: [one, 2, false, { child: value }] # keep flow',
  'single: Plain', 'anchored: &shared { retained: exact }', 'aliased: *shared', '---', '# Typed nested source λ', '', 'Untouched body 😀.', ''].join('\r\n');
export const nestedPropertyTypesReadOnlyFixture = Object.freeze({source: original, files: []});

async function key(tools, value, code = value, number = value === 'Enter' ? 13 : value === 'Escape' ? 27 : value === 'Tab' ? 9 : 65, modifiers = 0) {
  const event = {key: value, code, windowsVirtualKeyCode: number, nativeVirtualKeyCode: number, modifiers};
  await tools.command('Input.dispatchKeyEvent', {type: value === 'Enter' && !modifiers ? 'keyDown' : 'rawKeyDown', ...event, ...(value === 'Enter' && !modifiers ? {text: '\r', unmodifiedText: '\r'} : {})});
  await tools.command('Input.dispatchKeyEvent', {type: 'keyUp', ...event});
}
async function fill(tools, selector, text) {
  await tools.click(selector); await key(tools, 'a', 'KeyA', 65, 2);
  if (text) await tools.command('Input.insertText', {text}); else await key(tools, 'Backspace', 'Backspace', 8);
}
async function choose(tools, selector, value) {
  const index = await tools.evaluate(`(()=>{const node=document.querySelector(${q(selector)});node.scrollIntoView({block:'center'});node.focus();return [...node.options].findIndex(option=>option.value===${q(value)})})()`);
  assert.ok(index >= 0); await key(tools, 'Home', 'Home', 36);
  // A type change deliberately focuses the new value control. Restore only
  // select focus before each trusted key, without forging its value/change.
  for (let i = 0; i < index; i++) { await tools.evaluate(`document.querySelector(${q(selector)}).focus()`); await key(tools, 'ArrowDown', 'ArrowDown', 40); }
  await key(tools, 'Tab', 'Tab', 9); await tools.wait(`document.querySelector(${q(selector)})?.value===${q(value)}`, 'trusted scalar type selection');
}
async function mark(tools, id) {
  await tools.evaluate(`(()=>{for(const node of document.querySelectorAll('[data-nested-property-types-root]'))delete node.dataset.nestedPropertyTypesRoot;const leaf=${id ? 'app.workspace.getLeafById(' + q(id) + ')' : 'app.workspace.activeLeaf'};leaf.view.metadataEditor.contentEl.dataset.nestedPropertyTypesRoot='true'})()`);
}
async function expand(tools) {
  await tools.wait(`Boolean(document.querySelector(${q(inspector)})?.checkVisibility())`, 'current typed nested inspector');
  if (!await tools.evaluate(`document.querySelector(${q(inspector)}).open`)) await tools.click(inspector + ' > summary');
  const branch = inspector + ' > ul > li > details';
  if (!await tools.evaluate(`document.querySelector(${q(branch)}).open`)) await tools.click(branch + ' > summary');
}
async function openEditor(tools, ...path) {
  await tools.evaluate(`(()=>{const t=globalThis.nestedPropertyTypesTrace;if(t)t.requestedPath=${q(['branch', ...path])}})()`);
  await expand(tools); const selector = edit(...path);
  while (await tools.evaluate(`(()=>{for(const node of document.querySelectorAll('[data-nested-property-types-disclosure]'))delete node.dataset.nestedPropertyTypesDisclosure;let node=document.querySelector(${q(selector)});const closed=[];while(node){if(node.tagName==='DETAILS'&&!node.open)closed.unshift(node);node=node.parentElement}if(!closed.length)return false;closed[0].dataset.nestedPropertyTypesDisclosure='open';return true})()`)) await tools.click(host + ' details[data-nested-property-types-disclosure="open"] > summary');
  await tools.wait(`(()=>{const node=document.querySelector(${q(selector)});return Boolean(node&&!node.disabled&&node.checkVisibility())})()`, 'enabled current typed scalar Edit');
  await tools.click(selector); await tools.wait(`Boolean(document.querySelector(${q(type)})?.checkVisibility()&&document.querySelector(${q(input)})?.checkVisibility())`, 'explicit type and value draft');
}

/** Saved bytes precede the accepted Apply's metadata refresh and row retirement. */
export async function finishNestedPropertyTypeApply(tools, path) {
  await tools.evaluate(`(()=>{
    const w=app.workspace,t=globalThis.nestedPropertyTypesTrace,root=document.querySelector(${q(host)}),m=app.plugins.modules['@codemirror/commands'];
    const panel=w.leaves().find(leaf=>leaf.view.metadataEditor?.contentEl===root),session=w.sessions.get(${q(path)});
    if(!t||!root?.isConnected||!panel||!session||!m.historyField)throw new Error('Typed Apply completion needs its existing visible owner');
    const owners=w.leaves().filter(leaf=>leaf.view.file?.path===${q(path)}&&leaf.view.editor?.cm).map(leaf=>{
      const view=leaf.view,editor=view.editor,cm=editor.cm;
      return{leaf,view,file:view.file,editor,cm,doc:cm.state.doc,selection:JSON.stringify(cm.state.selection.toJSON()),history:cm.state.field(m.historyField),undo:m.undoDepth(cm.state),redo:m.redoDepth(cm.state)};
    });
    if(!owners.length)throw new Error('Typed Apply completion cannot allocate a Source owner');
    const receipt={path:${q(path)},phase:'mutation',calls:t.calls.length};(t.applyBarriers??=[]).push(receipt);
    globalThis.nestedPropertyTypesApplyOwner={root,panel,view:panel.view,parent:panel.parent,pinned:panel.pinned,state:JSON.stringify(panel.view.getState()),session,saved:session.document,text:session.text,dirty:session.dirty,rootPath:app.vault.rootPath,adapter:app.vault.adapter,owners,receipt};
  })()`);
  await tools.wait(`nestedPropertyTypesTrace.calls.length>0&&nestedPropertyTypesTrace.calls.every(call=>call.settled)`, 'preceding typed Apply mutation finishes');
  await tools.evaluate(`(async()=>{nestedPropertyTypesApplyOwner.receipt.phase='idle';await app.core.whenIdle();await app.workspace.whenIdle();nestedPropertyTypesApplyOwner.receipt.phase='row'})()`);
  await tools.wait(`(()=>{const o=nestedPropertyTypesApplyOwner,node=o.root.querySelector('[data-property-key="opaque"]');return Boolean(o.root.isConnected&&node?.isConnected&&node.getAttribute('aria-busy')!=='true'&&!document.querySelector(${q(type)})&&nestedPropertyTypesTrace.calls.every(call=>call.settled))})()`, 'accepted typed Apply retires its draft and current row');
  const proof = await tools.evaluate(`(()=>{
    const o=nestedPropertyTypesApplyOwner,w=app.workspace,m=app.plugins.modules['@codemirror/commands'];
    const result={sameRoot:app.vault.rootPath===o.rootPath&&app.vault.adapter===o.adapter,samePanel:w.getLeafById(o.panel.id)===o.panel&&o.panel.view===o.view&&o.panel.parent===o.parent&&o.panel.pinned===o.pinned&&JSON.stringify(o.view.getState())===o.state&&o.view.metadataEditor.contentEl===o.root,
      sameSession:w.sessions.get(${q(path)})===o.session,sameSavedDocument:o.session.document===o.saved,sourceExact:o.session.text===o.text&&o.session.dirty===o.dirty,
      sourceOwnersExact:o.owners.every(a=>w.getLeafById(a.leaf.id)===a.leaf&&a.leaf.view===a.view&&a.view.file===a.file&&app.vault.getFileByPath(a.file.path)===a.file&&a.view.editor===a.editor&&a.editor.cm===a.cm&&a.cm.state.doc===a.doc&&JSON.stringify(a.cm.state.selection.toJSON())===a.selection&&a.cm.state.field(m.historyField)===a.history&&m.undoDepth(a.cm.state)===a.undo&&m.redoDepth(a.cm.state)===a.redo)};
    o.receipt.phase='complete';o.receipt.proof=result;delete globalThis.nestedPropertyTypesApplyOwner;return result;
  })()`);
  for (const [name, value] of Object.entries(proof)) assert.equal(value, true, 'Typed Apply completion preserves ' + name);
  return proof;
}
const snapshot = 'app.metadataCache.getDocuments().map(entry=>({path:entry.document.file.path,text:entry.text,version:entry.document.version,hasBom:entry.document.hasBom})).sort((a,b)=>a.path.localeCompare(b.path))';
async function disabledPointer(tools, selector) {
  const point = await tools.evaluate(`(()=>{const node=document.querySelector(${q(selector)});node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return{x,y,hit:document.elementFromPoint(x,y)===node}})()`); assert.equal(point.hit, true);
  for (const event of ['mousePressed', 'mouseReleased']) await tools.command('Input.dispatchMouseEvent', {type: event, x: point.x, y: point.y, button: 'left', clickCount: 1});
}

/** Bounded native-input workflow. Parent owns the frozen build, host, actual folder selection and final audits. */
export async function checkNestedPropertyTypes(tools) {
  const {directory, evaluate, wait, click, command, capture, report, restart, afterReload} = tools;
  const folder = 'Nested property types', path = folder + '/Source.md', other = folder + '/Other.md', peer = '# Other λ\r\n\r\nExact peer.\r\n';
  await evaluate('(async()=>{await app.saveAll();await app.core.whenIdle();await app.workspace.flushLayout()})()');
  const layout = await evaluate('app.workspace.getLayout()'), enabled = await evaluate('app.core.isEnabled("properties")');
  const configPath = join(directory, '.obsidian/app.json'), configBytes = await readFile(configPath), config = JSON.parse(configBytes.toString('utf8').replace(/^\ufeff/, ''));
  const workingConfig = Buffer.from(JSON.stringify({...config, markdownAutosave: false}, null, 2)), source = 'app.workspace.sessions.get(' + q(path) + ')';
  let stage = 'fixture', failure, traceActive = false, narrow = false;
  const exact = async (expected, hasBom = true) => { await wait(source + '?.text===' + q(expected) + '&&!' + source + '.dirty&&!' + source + '.isSaving', 'exact typed source is saved'); assert.deepEqual(await readFile(join(directory, path)), bytes(expected, hasBom)); assert.deepEqual(await readFile(join(directory, other)), bytes(peer)); assert.deepEqual(await readFile(configPath), workingConfig); };
  const open = async (mode = 'preview') => { await evaluate(`(async()=>{await app.openFile(${q(path)});const view=app.workspace.activeLeaf.view;view.setEditingMode(${q(mode)},false);if(view.getMode()==='preview')await view.currentMode.whenReady();view.metadataEditor.render(true)})()`); await mark(tools); await expand(tools); };
  const history = async (expected, redo = false, returnMode = 'preview') => {
    const before = await evaluate(source + '.text');
    await finishNestedPropertyTypeApply(tools, path);
    await exact(before);
    await evaluate(`(()=>{const leaf=app.workspace.leaves().find(leaf=>leaf.view.file?.path===${q(path)}&&leaf.view.getEditingMode);app.workspace.setActiveLeaf(leaf);leaf.view.setEditingMode('source',false);leaf.view.editor.focus()})()`);
    // Installed CodeMirror binds Windows Redo to Mod-y; Mod-Shift-z is macOS.
    await key(tools, redo ? 'y' : 'z', redo ? 'KeyY' : 'KeyZ', redo ? 89 : 90, 2);
    await wait(source + '.text===' + q(expected), redo ? 'trusted Windows Source Redo restores the exact typed scalar' : 'trusted Source Undo restores the exact previous document');
    await evaluate('app.saveAll()'); await exact(expected); await open(returnMode);
  };
  const restoreProbe = `(()=>{delete globalThis.nestedPropertyTypesApplyOwner;const t=globalThis.nestedPropertyTypesTrace;if(!t)return true;t.closed=true;if(t.session&&t.reload)t.session.reload=t.reload;for(const release of t.releases.splice(0))release();if(t.frontmatter)app.fileManager.processFrontMatter=t.frontmatter;if(t.read)app.vault.readDocument=t.read;t.abort?.abort();return true})()`;
  const trace = async () => { await evaluate(`(()=>{const t=globalThis.nestedPropertyTypesTrace={events:[],negativeProbes:[],calls:[],closed:false,releases:[],frontmatter:app.fileManager.processFrontMatter,abort:new AbortController()};app.fileManager.processFrontMatter=async function(...args){const call={path:args[0].path,settled:false};t.calls.push(call);try{return await t.frontmatter.apply(this,args)}finally{call.settled=true}};for(const type of ['pointerdown','keydown'])document.addEventListener(type,event=>{const properties=Boolean(event.target.closest?.(${q(host)})),id=event.target.closest?.('[data-leaf-id]')?.dataset.leafId,leaf=id?app.workspace.getLeafById(id):null,source=leaf?.view.file?.path===${q(path)}&&event.target.closest?.('.cm-content');if(properties||source)t.events.push({type,key:event.key??null,scope:properties?'properties':'source',trusted:event.isTrusted})},{capture:true,signal:t.abort.signal});return true})()`); traceActive = true; };
  try {
    if (!enabled) await evaluate('app.core.setEnabled("properties",true)');
    await mkdir(join(directory, folder)); await writeFile(join(directory, path), bytes(original), {flag: 'wx'}); await writeFile(join(directory, other), bytes(peer), {flag: 'wx'});
    await writeFile(configPath, workingConfig); await evaluate('(async()=>{await app.configuration.read("app");app.markdownAutosave.configure();await app.vault.refresh();await app.metadataCache.refresh()})()'); await open(); await trace();

    stage = 'reviewed null and exact typed conversions in inline Reading and Live Preview';
    // Raw Source intentionally hides inline Properties. Its supported visible
    // Properties owner is exercised through the real fixed pane below.
    for (const mode of ['preview', 'live-preview']) {
      await open(mode); await openEditor(tools, 'empty'); assert.equal(await evaluate(`document.querySelector(${q(type)}).value`), 'null'); assert.equal(await evaluate(`document.querySelector(${q(input)}).readOnly`), true);
      await choose(tools, type, 'string'); await fill(tools, input, 'null'); assert.equal(await evaluate(`document.querySelector(${q(preview)}).textContent`), 'Null: null → Text: "null"'); await exact(original); await click(apply);
      const changed = original.replace('empty: ~', 'empty: "null"'); await exact(changed); assert.equal(await evaluate(`app.metadataCache.getDocument(${q(path)}).cache.frontmatter.opaque.branch.empty`), 'null'); await history(original, false, mode); await history(changed, true, mode); await history(original, false, mode);
    }
    await open('live-preview'); await openEditor(tools, 'enabled'); await choose(tools, type, 'string'); assert.equal(await evaluate(`document.querySelector(${q(input)}).value`), 'true'); await click(apply); await exact(original.replace('enabled: true', 'enabled: "true"')); await history(original);
    await openEditor(tools, 'count'); await choose(tools, type, 'null'); await capture?.('nested-types-null-review'); await click(apply); await exact(original.replace('count: 1.50', 'count: null')); await history(original);
    pass(report, 'Explicit nested null converts to the string "null" in visible inline Reading and Live Preview Properties. Reviewed type changes distinguish text from boolean and null, preserve exact BOM/CRLF/comments/opaque YAML, and use one trusted shared Undo/Redo step.');

    stage = 'per-type drafts, exact numbers, no-op and cancellation'; await openEditor(tools, 'text'); await fill(tools, input, 'Kept text λ\n😀'); await choose(tools, type, 'number'); await fill(tools, input, '9007199254740991.1'); await click(apply);
    await wait(`Boolean(document.querySelector(${q(issue)})?.textContent)`, 'unsafe precision refuses with draft intact'); assert.equal(await evaluate(`document.querySelector(${q(input)}).value`), '9007199254740991.1'); await exact(original);
    await choose(tools, type, 'boolean'); await choose(tools, input, 'false'); await choose(tools, type, 'string'); assert.equal(await evaluate(`document.querySelector(${q(input)}).value`), 'Kept text λ\n😀'); await choose(tools, type, 'number'); assert.equal(await evaluate(`document.querySelector(${q(input)}).value`), '9007199254740991.1'); await fill(tools, input, '-0'); await capture?.('nested-types-number-review'); await key(tools, 'Enter', 'Enter', 13, 2); await exact(original.replace("'<img src=x> λ 😀'", '-0')); assert.equal(await evaluate(`Object.is(app.metadataCache.getDocument(${q(path)}).cache.frontmatter.opaque.branch.text,-0)`), true); await history(original);
    const noOpCalls = await evaluate('nestedPropertyTypesTrace.calls.length');
    for (const name of ['empty', 'count', 'multiline']) { await openEditor(tools, name); const prior = await evaluate(`document.querySelector(${q(type)}).value`); await choose(tools, type, prior === 'string' ? 'boolean' : 'string'); await choose(tools, type, prior); await click(apply); await wait(`!document.querySelector(${q(type)})`, 'same semantic typed draft closes'); await exact(original); }
    for (const via of ['Cancel', 'Escape']) { await openEditor(tools, 'empty'); await choose(tools, type, 'string'); await fill(tools, input, 'Discard this type λ'); await click(host + ' [data-property-key="single"] input[data-metadata-input]'); await exact(original); if (via === 'Cancel') await click(cancel); else { await click(input); await key(tools, 'Escape'); } await wait(`!document.querySelector(${q(type)})`, 'explicit type draft cancellation'); await exact(original); }
    assert.equal(await evaluate('nestedPropertyTypesTrace.calls.length'), noOpCalls); assert.equal(await evaluate(`document.querySelectorAll(${q(edit('implicit'))}).length`), 1); assert.equal(await evaluate(`document.querySelector(${q(edit('implicit'))}).parentElement.querySelector('.metadata-structured-leaf').textContent`), 'null');
    await openEditor(tools, 'implicit'); assert.equal(await evaluate(`document.querySelector(${q(type)}).value`), 'null'); await choose(tools, type, 'string'); await fill(tools, input, 'Discard implicit draft λ'); await exact(original); await click(cancel); await wait(`!document.querySelector(${q(type)})`, 'implicit-null draft cancellation'); await exact(original); assert.equal(await evaluate('nestedPropertyTypesTrace.calls.length'), noOpCalls);
    pass(report, 'Each scalar type retains its own exact draft. Rounded precision refuses and a reviewed negative-zero retry succeeds; blur, Cancel, Escape and switching back to the original value cause no write. Explicit ~ spelling and implicit empty null source remain exact.');

    stage = 'detached control negative probe'; await openEditor(tools, 'text'); await evaluate(`nestedPropertyTypesTrace.detachedInput=document.querySelector(${q(input)})`); await choose(tools, type, 'number'); await fill(tools, input, '2.75');
    await evaluate(`(()=>{const t=nestedPropertyTypesTrace;t.negativeProbes.push('synthetic retained detached input key/composition events');for(const key of ['Enter','Escape'])t.detachedInput.dispatchEvent(new KeyboardEvent('keydown',{key,ctrlKey:true,bubbles:true}));t.detachedInput.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));return true})()`); await exact(original); assert.equal(await evaluate(`document.querySelector(${q(type)}).value`), 'number'); await click(apply); await exact(original.replace("'<img src=x> λ 😀'", '2.75')); await history(original);

    stage = 'fixed Properties and earlier trusted source history';
    const fixed = 'nested-types-fixed-properties', md = 'nested-types-fixed-note';
    const fixedLayout = {version: 1, main: {id: 'nested-types-fixed-main', type: 'split', direction: 'vertical', children: [{id: 'nested-types-note-tabs', type: 'tabs', dimension: 55, currentTab: 0, children: [{id: md, type: 'leaf', state: {type: 'markdown', pinned: true, state: {file: path, mode: 'source', source: true}}}]}, {id: 'nested-types-properties-tabs', type: 'tabs', dimension: 45, currentTab: 0, children: [{id: fixed, type: 'leaf', state: {type: 'file-properties', pinned: true, state: {file: path, followActiveFile: false, sort: 'name', query: ''}}}]}]}, active: fixed};
    await evaluate(`(async()=>{await app.workspace.changeLayout(${q(fixedLayout)});await app.workspace.flushLayout()})()`); await wait(`app.workspace.getLeafById(${q(fixed)})?.view.metadataEditor?.rendered.length>0`, 'real fixed typed Properties'); assert.equal(await evaluate(`app.workspace.getLeafById(${q(md)}).view.getEditingMode()`), 'source'); assert.equal(await evaluate(`app.workspace.getLeafById(${q(md)}).view.metadataEditor.contentEl.hidden`), true); await mark(tools, fixed);
    const dirty = original + 'Earlier dirty body Ω.\r\n'; await click('[data-leaf-id=' + q(md) + '] .cm-content'); await key(tools, 'End', 'End', 35, 2); await command('Input.insertText', {text: 'Earlier dirty body Ω.\n'}); await wait(source + '.dirty&&' + source + '.text===' + q(dirty), 'earlier trusted Source edit remains dirty'); assert.deepEqual(await readFile(join(directory, path)), bytes(original));
    await openEditor(tools, 'empty'); await choose(tools, type, 'boolean'); await choose(tools, input, 'true'); await click(apply); await exact(dirty.replace('empty: ~', 'empty: true')); await capture?.('nested-types-fixed-applied'); await history(dirty); await history(original); await evaluate(`app.workspace.changeLayout(${q(layout)})`); await open();
    pass(report, 'A real fixed Properties pane beside raw Source converts explicit null through the ordinary shared queue while hidden inline Source Properties remain hidden. The earlier trusted dirty Source edit is saved intact; one trusted Undo removes only the typed conversion and the second removes the earlier body edit. Detached former-type controls are explicitly forged negative probes and cannot apply, cancel or lock the live draft.');

    stage = 'actual immutable versions, BOM-only replacement and external source'; report.nestedPropertyTypesPhysicalVersions = [];
    for (const external of [{name: 'BOM-only same Markdown body', text: original, hasBom: false}, {name: 'same YAML semantics, changed null spelling', text: original.replace('empty: ~', 'empty: NULL'), hasBom: true}, {name: 'changed numeric value', text: original.replace('count: 1.50', 'count: 4.50'), hasBom: true}]) {
      await openEditor(tools, 'empty'); await choose(tools, type, 'number'); await fill(tools, input, '2.5');
      const before = await evaluate(`app.vault.getFileInfo(app.vault.getFileByPath(${q(path)}))`); assert.equal(before.version, sha(bytes(original)));
      const externalBytes = bytes(external.text, external.hasBom); await writeFile(join(directory, path), externalBytes);
      const after = await evaluate(`app.vault.getFileInfo(app.vault.getFileByPath(${q(path)}))`); assert.equal(after.version, sha(externalBytes)); assert.notEqual(after.version, before.version); assert.equal(after.root, before.root); assert.equal(after.file.path, path);
      report.nestedPropertyTypesPhysicalVersions.push({name: external.name, before: before.version, after: after.version, actualRawShaVerified: true, changedVersion: true, sameMarkdownBody: external.text === original, hasBom: external.hasBom});
      await click(apply); await wait(`Boolean(document.querySelector(${q(issue)})?.textContent)&&!${source}.isSaving`, 'actual physical version/source conflict refuses'); await exact(external.text, external.hasBom); assert.equal(await evaluate(`${source}.document.hasBom`), external.hasBom); assert.equal(await evaluate(`document.querySelector(${q(type)}).value`), 'number'); assert.equal(await evaluate(`document.querySelector(${q(input)}).value`), '2.5'); await click(cancel);
      await writeFile(join(directory, path), bytes(original)); await evaluate(`(async()=>{await ${source}.reload(false);await app.metadataCache.refresh()})()`); await open(); await exact(original);
    }

    stage = 'queued owner refusal'; await openEditor(tools, 'empty'); await choose(tools, type, 'boolean'); await choose(tools, input, 'true');
    await evaluate(`(()=>{const t=nestedPropertyTypesTrace;t.session=${source};t.reload=t.session.reload;t.waiting=false;t.session.reload=async function(...args){if(!t.closed){t.waiting=true;await new Promise(resolve=>t.releases.push(resolve))}return t.reload.apply(this,args)};return true})()`); await click(apply); await wait('nestedPropertyTypesTrace.waiting', 'ordinary reload holds the typed transaction');
    for (const selector of [type, input, apply, cancel]) assert.equal(await evaluate(`document.querySelector(${q(selector)}).disabled`), true); await capture?.('nested-types-pending');
    await evaluate(`(()=>{const t=nestedPropertyTypesTrace;app.workspace.activeLeaf.view.setEditingMode('source',false);t.closed=true;t.session.reload=t.reload;for(const release of t.releases.splice(0))release()})()`); await wait(`nestedPropertyTypesTrace.calls.at(-1)?.settled&&!${source}.isSaving`, 'held typed owner conflict settles'); await exact(original); await open(); await wait(`Boolean(document.querySelector(${q(type)})?.checkVisibility())&&Boolean(document.querySelector(${q(issue)})?.textContent)`, 'failed typed draft remains for explicit cancellation'); assert.equal(await evaluate(`document.querySelector(${q(type)}).value`), 'boolean'); await click(cancel);
    pass(report, 'Ordinary reload refuses actual raw-SHA version changes: a removed BOM with identical Markdown body, changed null spelling with identical YAML semantics, and an independent numeric change. Every external byte and BOM state survives while the typed draft stays reviewable. Held queued controls lock together and a genuine owner mode change refuses without mutating source or shared history.');

    stage = 'core lifecycle stale handle and closed note'; await open(); await openEditor(tools, 'empty'); await choose(tools, type, 'string'); await fill(tools, input, 'Never apply stale lifecycle'); await evaluate(`nestedPropertyTypesTrace.staleApply=document.querySelector(${q(apply)})`);
    await evaluate('app.core.setEnabled("properties",false)'); await evaluate(`(()=>{nestedPropertyTypesTrace.negativeProbes.push('synthetic retained Apply after real Properties disable');nestedPropertyTypesTrace.staleApply.click();return true})()`); await exact(original); await evaluate('app.core.setEnabled("properties",true)'); await open();
    const closedLayout = {version: 1, main: {id: 'nested-types-closed-main', type: 'split', direction: 'vertical', children: [{id: 'nested-types-closed-tabs', type: 'tabs', currentTab: 0, children: [{id: 'nested-types-closed-properties', type: 'leaf', state: {type: 'file-properties', state: {file: path, followActiveFile: false, sort: 'name', query: ''}}}]}]}, active: 'nested-types-closed-properties'};
    await evaluate(`app.workspace.changeLayout(${q(closedLayout)})`); await wait(`!${source}&&app.workspace.activeLeaf.view.metadataEditor?.rendered.length>0`, 'closed note inspector allocates no Markdown source owner'); await mark(tools); await expand(tools); const closedCalls = await evaluate('nestedPropertyTypesTrace.calls.length');
    await evaluate("(()=>{const t=nestedPropertyTypesTrace;t.read=app.vault.readDocument;t.reads=0;app.vault.readDocument=async function(){t.reads++;throw new Error('Closed nested Edit reached a source read')};return true})()"); assert.equal(await evaluate(`document.querySelector(${q(edit('empty'))}).disabled`), true); await disabledPointer(tools, edit('empty'));
    await evaluate(`(()=>{nestedPropertyTypesTrace.negativeProbes.push('synthetic enabled Edit for a closed note');const button=document.querySelector(${q(edit('empty'))});button.disabled=false;button.click();button.disabled=true;return true})()`); assert.equal(await evaluate(`document.querySelectorAll(${q(type)}).length`), 0); assert.equal(await evaluate('nestedPropertyTypesTrace.calls.length'), closedCalls); assert.equal(await evaluate('nestedPropertyTypesTrace.reads'), 0); assert.equal(await evaluate(`Boolean(${source})`), false); assert.deepEqual(await readFile(join(directory, path)), bytes(original)); await evaluate('app.vault.readDocument=nestedPropertyTypesTrace.read;delete nestedPropertyTypesTrace.read');
    await evaluate(`app.workspace.changeLayout(${q(layout)})`); await open(); await exact(original);

    stage = 'narrow reviewed type controls';
    const beforeNarrow = await evaluate('app.workspace.getLayout()'), narrowLayout = {version: 1, main: {id: 'nested-types-narrow-main', type: 'split', direction: 'vertical', children: [{id: 'nested-types-narrow-tabs', type: 'tabs', currentTab: 0, children: [{id: 'nested-types-narrow-note', type: 'leaf', state: {type: 'markdown', state: {file: path, mode: 'source', source: false}}}]}]}, left: {width: 260, collapsed: true}, right: {width: 260, collapsed: true}, active: 'nested-types-narrow-note'};
    await evaluate(`app.workspace.changeLayout(${q(narrowLayout)})`); await command('Emulation.setDeviceMetricsOverride', {width: 360, height: 800, deviceScaleFactor: 1, mobile: false}); narrow = true; await mark(tools); await openEditor(tools, 'empty'); await choose(tools, type, 'string'); await fill(tools, input, 'Narrow λ');
    const bounds = `(()=>{const nodes=[...document.querySelectorAll(${q(type + ',' + input + ',' + apply + ',' + cancel)})];return{width:innerWidth,height:innerHeight,layout:app.workspace.getLayout(),controls:nodes.map(node=>{node.scrollIntoView({block:'center',inline:'nearest'});const r=node.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return{left:r.left,right:r.right,width:r.width,reachable:hit===node||node.contains(hit),inViewport:x>=0&&x<=innerWidth&&y>=0&&y<=innerHeight}})}})()`;
    const measured = await evaluate(bounds); assert.equal(measured.width, 360); assert.equal(measured.height, 800); assert.equal(measured.layout.left.collapsed, true); assert.equal(measured.layout.right.collapsed, true); assert.equal(measured.controls.length, 4); assert.ok(measured.controls.every(control => control.width > 0 && control.left >= 0 && control.right <= 361 && control.reachable && control.inViewport)); report.nestedPropertyTypesNarrow = measured; await capture?.('nested-types-narrow-review'); await click(cancel); await command('Emulation.clearDeviceMetricsOverride'); narrow = false; await evaluate(`app.workspace.changeLayout(${q(beforeNarrow)})`); await open(); await exact(original);

    stage = 'saved conversion restart and fresh typed controls'; await openEditor(tools, 'empty'); await choose(tools, type, 'number'); await fill(tools, input, '2.75'); await click(apply); const persisted = original.replace('empty: ~', 'empty: 2.75'); await exact(persisted); await finishNestedPropertyTypeApply(tools, path); await exact(persisted);
    report.nestedPropertyTypesInputs = await evaluate('nestedPropertyTypesTrace.events'); report.nestedPropertyTypesNegativeProbes = await evaluate('nestedPropertyTypesTrace.negativeProbes'); assert.ok(report.nestedPropertyTypesInputs.length > 30 && report.nestedPropertyTypesInputs.every(event => event.trusted)); assert.ok(report.nestedPropertyTypesInputs.some(event => event.scope === 'source' && event.key === 'z')); assert.ok(report.nestedPropertyTypesInputs.some(event => event.scope === 'properties')); await evaluate(restoreProbe); traceActive = false; await evaluate('(async()=>{await app.saveAll();await app.workspace.flushLayout()})()'); if (restart) await restart(); else await command('Page.reload'); await afterReload(); await open(); await exact(persisted); await openEditor(tools, 'empty'); assert.equal(await evaluate(`document.querySelector(${q(type)}).value`), 'number'); assert.equal(await evaluate(`document.querySelector(${q(input)}).value`), '2.75'); await click(cancel); await capture?.('nested-types-restored');
    report.nestedPropertyTypes = {explicitScalarTypes: true, explicitNull: true, reviewedTypeValue: true, readingSourceLivePreview: true, perTypeDrafts: true, precisionRefusedAndRetried: true, negativeZero: true, noBlurCommit: true, noOpLexemesExact: true, explicitApplyCancel: true, implicitNullReviewedCancel: true, fixedPropertiesPane: true, trustedEarlierDirtyHistory: true, isolatedUndoRedo: true, exactBOMCRLFCommentsAndOpaqueYAML: true, physicalSourceAndSameValueVersionRefused: true, actualImmutableVersionSHAProven: true, BOMOnlyVersionRefused: true, queuedOwnerRefused: true, pendingControlsLocked: true, detachedInputRefused: true, coreLifecycleRefused: true, closedNoteNoHiddenOwner: true, narrowPhysicalReachability: true, restartFreshTypes: true, trustedInputs: true};
    pass(report, 'Real core disable revokes retained typed Apply handles, closed-note inspection cannot allocate a hidden owner, and narrow 360px controls remain physically reachable. Saved explicit types survive full restart or actual-folder reconnection with fresh usable controls.');
  } catch (error) {
    failure = error; report.nestedPropertyTypesFailure = {stage, error: String(error?.stack ?? error)};
    try { report.nestedPropertyTypesFailure.controls = await evaluate(`(()=>{const root=document.querySelector(${q(host)}),owner=app.workspace.leaves().find(leaf=>leaf.view.metadataEditor?.contentEl===root),t=globalThis.nestedPropertyTypesTrace;return{requestedPath:t?.requestedPath,owner:owner?{id:owner.id,pinned:owner.pinned,state:owner.view.getState()}:null,rowBusy:root?.querySelector('[data-property-key="opaque"]')?.getAttribute('aria-busy'),draftPresent:Boolean(document.querySelector(${q(type)})),disclosures:[...root?.querySelectorAll('details')??[]].map(node=>({open:node.open,connected:node.isConnected,visible:node.checkVisibility(),label:node.querySelector(':scope > summary')?.textContent})),edits:[...root?.querySelectorAll('[data-property-structured-edit]')??[]].map(node=>({path:node.dataset.propertyStructuredEdit,disabled:node.disabled,connected:node.isConnected,visible:node.checkVisibility(),closedAncestor:Boolean(node.closest('details:not([open])'))})),applyBarriers:t?.applyBarriers??[]}})()`); } catch { /* Keep the original failure and ordinary source snapshot. */ }
    try { report.nestedPropertyTypesFailure.state = await evaluate(`(()=>({file:app.workspace.getActiveFile()?.path,source:${source}?.text,mode:app.workspace.activeLeaf.view.getEditingMode?.(),fields:[...document.querySelectorAll(${q(host + ' input,' + host + ' textarea,' + host + ' select')})].map(node=>({tag:node.tagName,value:node.value,disabled:node.disabled,readOnly:node.readOnly,visible:node.checkVisibility()})),errors:[...document.querySelectorAll('.metadata-property-error')].filter(node=>node.textContent).map(node=>node.textContent),trace:globalThis.nestedPropertyTypesTrace?{calls:nestedPropertyTypesTrace.calls,waiting:nestedPropertyTypesTrace.waiting,queuedReleases:nestedPropertyTypesTrace.releases.length}:null}))()`); await capture?.('nested-types-precleanup-failure'); } catch { /* Retain the original failure. */ }
    throw error;
  } finally {
    try { if (traceActive) await evaluate(restoreProbe); if (narrow) await command('Emulation.clearDeviceMetricsOverride'); await evaluate('app.saveAll()'); await writeFile(configPath, configBytes); await evaluate(`(async()=>{await app.configuration.read('app');app.markdownAutosave.configure();await app.workspace.changeLayout(${q(layout)});await app.workspace.flushLayout();delete globalThis.nestedPropertyTypesTrace})()`); if (!enabled) await evaluate('app.core.setEnabled("properties",false)'); }
    catch (error) { if (!failure) throw error; report.nestedPropertyTypesFailure.cleanupError = String(error?.stack ?? error); }
  }
}

/** Parent provides a genuine complete cached mount with this fixture as its leading frontmatter. */
export async function checkNestedPropertyTypesReadOnly(tools) {
  const {evaluate, wait, click, capture, report} = tools; assert.equal(await evaluate('app.vault.readOnly'), true);
  await evaluate(`(()=>{const leaf=app.workspace.activeLeaf,view=leaf.view,editor=view.editor,cm=editor.cm,session=app.workspace.sessions.get(view.file.path);if(globalThis.nestedPropertyTypesReadOnlyOwner)throw new Error('Readonly owner probe already installed');if(!session)throw new Error('Readonly helper needs its existing live anchor session');const o=globalThis.nestedPropertyTypesReadOnlyOwner={leaf,view,editor,cm,doc:cm.state.doc,session,savedDocument:session.document,root:app.vault.rootPath,file:view.file,text:session.text,dirty:session.dirty,mode:view.getEditingMode(),source:view.isSourceMode,layout:JSON.stringify(app.workspace.getLayout())};o.current=()=>app.workspace.getLeafById(leaf.id)===leaf&&leaf.view===view&&view.editor===editor&&editor.cm===cm&&cm.state.doc===o.doc&&app.workspace.sessions.get(o.file.path)===session&&session.document===o.savedDocument&&session.text===o.text&&session.dirty===o.dirty&&app.vault.rootPath===o.root&&view.file===o.file&&app.vault.getFileByPath(o.file.path)===o.file;return true})()`);
  const before = await evaluate(snapshot), config = await evaluate('(async()=>(await app.configuration.read("app")).data)()'); let installed = false, failure;
  try {
    await evaluate('(async()=>{const view=app.workspace.activeLeaf.view;view.setEditingMode("preview",false);await view.currentMode.whenReady();view.metadataEditor.render(true)})()'); await mark(tools); await expand(tools);
    await evaluate(`(()=>{const t=globalThis.nestedPropertyTypesReadOnlyTrace={read:app.vault.readDocument,frontmatter:app.fileManager.processFrontMatter,reads:0,mutations:0,events:[],abort:new AbortController(),sessions:[...app.workspace.sessions.keys()].sort()};app.vault.readDocument=async function(){t.reads++;throw new Error('Readonly typed control reached a source read')};app.fileManager.processFrontMatter=async function(){t.mutations++;throw new Error('Readonly typed control reached a mutation')};for(const type of ['pointerdown','keydown'])document.addEventListener(type,event=>{if(event.target.closest?.(${q(host)}))t.events.push({type,key:event.key??null,trusted:event.isTrusted})},{capture:true,signal:t.abort.signal});return true})()`); installed = true;
    for (const name of ['text', 'count', 'enabled', 'empty', 'multiline', 'implicit']) {
      const selector = edit(name); await wait(`Boolean(document.querySelector(${q(selector)})?.checkVisibility())`, 'disabled cached typed scalar Edit'); assert.equal(await evaluate(`document.querySelector(${q(selector)}).disabled`), true); await disabledPointer(tools, selector); assert.equal(await evaluate(`document.querySelectorAll(${q(type)}).length`), 0);
      // Deliberately forged handler probe; distinct from the trusted pointer trace.
      await evaluate(`(()=>{const button=document.querySelector(${q(selector)});button.disabled=false;button.click();button.disabled=true})()`); assert.equal(await evaluate(`document.querySelectorAll(${q(type + ',' + input)}).length`), 0);
    }
    assert.equal(await evaluate(`document.querySelectorAll(${q(edit('implicit'))}).length`), 1); assert.equal(await evaluate(`document.querySelector(${q(edit('implicit'))}).disabled`), true); assert.equal(await evaluate(`document.querySelector(${q(edit('implicit'))}).parentElement.querySelector('.metadata-structured-leaf').textContent`), 'null'); assert.equal(await evaluate(`document.querySelector(${q(inspector)}).querySelectorAll('img,script,a,input,textarea,select').length`), 0); await capture?.('nested-types-readonly');
    const probe = await evaluate('({reads:nestedPropertyTypesReadOnlyTrace.reads,mutations:nestedPropertyTypesReadOnlyTrace.mutations,beforeSessions:nestedPropertyTypesReadOnlyTrace.sessions,afterSessions:[...app.workspace.sessions.keys()].sort()})'); assert.equal(probe.reads, 0); assert.equal(probe.mutations, 0); assert.deepEqual(probe.afterSessions, probe.beforeSessions); report.nestedPropertyTypesReadOnlyProbe = probe;
    report.nestedPropertyTypesReadOnlyInputs = await evaluate('nestedPropertyTypesReadOnlyTrace.events'); assert.ok(report.nestedPropertyTypesReadOnlyInputs.length > 0 && report.nestedPropertyTypesReadOnlyInputs.every(event => event.trusted)); assert.deepEqual(await evaluate(snapshot), before); assert.deepEqual(await evaluate('(async()=>(await app.configuration.read("app")).data)()'), config); assert.deepEqual(await evaluate('(()=>{const {api,raw}=app.githubVaults.state().counters;return{api,raw}})()'), {api: 0, raw: 0});
    report.nestedPropertyTypesReadOnly = {genuineCachedReadOnly: true, explicitNullInspected: true, scalarTypesDisabled: true, forcedControlRefused: true, noDraftOrHiddenOwner: true, refusedBeforeSourceReadOrMutation: true, implicitNullDisabled: true, inertText: true, exactDocumentsVersionsBOMAndConfiguration: true, zeroApiRaw: true, trustedInputs: true}; pass(report, 'Genuine cached Properties inspect explicit and implicit nulls with inert HTML-looking text. Disabled trusted pointer input and separately forged enabled Edit controls cannot open a type draft, read source, allocate an owner or mutate; cached bytes/versions/BOM/configuration remain exact with zero API/raw requests.');
  } catch (error) { failure = error; report.nestedPropertyTypesReadOnlyFailure = {error: String(error?.stack ?? error)}; throw error; }
  finally {
    try {
      if (installed) await evaluate('(()=>{const t=nestedPropertyTypesReadOnlyTrace;app.vault.readDocument=t.read;app.fileManager.processFrontMatter=t.frontmatter;t.abort.abort();delete globalThis.nestedPropertyTypesReadOnlyTrace})()');
      // Preserve the existing anchor and its history. Only undo our local mode
      // switch after proving no other layout/owner change occurred.
      report.nestedPropertyTypesReadOnlyOwnerRestored = await evaluate(`(async()=>{const o=nestedPropertyTypesReadOnlyOwner;if(!o.current())throw new Error('Readonly anchor owner/editor/history identity changed');const actual=app.workspace.getLayout();const normalize=node=>{if(!node||typeof node!=='object')return;if(node.type==='leaf'&&node.id===o.leaf.id){node.state.state.mode=o.mode==='preview'?'preview':'source';node.state.state.source=o.source}for(const value of Object.values(node))if(value&&typeof value==='object'){if(Array.isArray(value))value.forEach(normalize);else normalize(value)}};normalize(actual);if(JSON.stringify(actual)!==o.layout)throw new Error('Readonly helper changed layout beyond its local mode');o.view.setEditingMode(o.mode,false);if(o.view.getMode()==='preview')await o.view.currentMode.whenReady();await app.workspace.flushLayout();const result={sameLeaf:app.workspace.getLeafById(o.leaf.id)===o.leaf,sameView:o.leaf.view===o.view,sameEditor:o.view.editor===o.editor,sameCM:o.editor.cm===o.cm,sameDoc:o.cm.state.doc===o.doc,sameSession:app.workspace.sessions.get(o.file.path)===o.session,sameSavedDocument:o.session.document===o.savedDocument,sourceExact:o.current(),sameLayout:JSON.stringify(app.workspace.getLayout())===o.layout,sameMode:o.view.getEditingMode()===o.mode};if(Object.values(result).some(value=>value!==true))throw new Error('Readonly anchor restoration lost identity/layout');delete globalThis.nestedPropertyTypesReadOnlyOwner;return result})()`);
      assert.deepEqual(await evaluate(snapshot), before); assert.deepEqual(await evaluate('(async()=>(await app.configuration.read("app")).data)()'), config); assert.deepEqual(await evaluate('(()=>{const {api,raw}=app.githubVaults.state().counters;return{api,raw}})()'), {api: 0, raw: 0}); if (report.nestedPropertyTypesReadOnly) report.nestedPropertyTypesReadOnly.ownerIdentityAndLayoutPreserved = true;
    }
    catch (error) { if (!failure) throw error; report.nestedPropertyTypesReadOnlyFailure.cleanupError = String(error?.stack ?? error); }
  }
}
