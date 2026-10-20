import assert from "node:assert/strict";
import { expectErrors } from "./error-log-audit.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { prepareAdditionalPluginAssets } from "./additional-plugin-assets.mjs";
import { prepareAdditionalPluginWorkflows, checkAdditionalPluginWorkflows } from "./additional-plugin-workflows.mjs";
import { checkFurtherPluginWorkflows, checkFurtherKanbanWorkflows } from "./additional-plugin-next-workflows.mjs";

const execute = promisify(execFile);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

export async function checkAdditionalPlugins(tools) {
  const { directory, evaluate, command, click, wait, report, restart, afterReload, readConsoleErrors, readRuntimeErrors, readExpectedShutdownErrors, capture } = tools;
  const browser = !restart;
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const assets = await prepareAdditionalPluginAssets();
  const result = report.additionalPlugins = {
    scope: "exact operator-provided startup, real settings, selected physical workflows and explicit browser Node limitations; not full plugin parity",
    upstreamReleaseProvenanceVerified: false,
    referenceRuntimeComparison: "not-performed",
    releases: assets.releases.map(release => ({ ...release, status: "pending" })),
  };
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  for (const release of assets.releases) {
    const target = join(directory, ".obsidian", "plugins", release.id);
    await mkdir(join(directory, ".obsidian", "plugins"), { recursive: true });
    await cp(release.directory, target, { recursive: true, force: false, errorOnExist: true });
  }
  const gitSettings = { disablePush: true, autoSaveInterval: 0, autoPushInterval: 0, autoPullInterval: 0, autoPullOnBoot: false, autoBackupAfterFileChange: false, refreshSourceControl: false, showStatusBar: false };
  await writeFile(join(directory, ".obsidian", "plugins", "obsidian-git", "data.json"), JSON.stringify(gitSettings), { flag: "wx" });
  await writeFile(join(directory, ".obsidian", "plugins", "obsidian-kanban", "data.json"), JSON.stringify({ "show-checkboxes": true }), { flag: "wx" });
  const workflowFixtures = await prepareAdditionalPluginWorkflows(directory);
  await writeFile(join(directory, "Additional plugin probe.md"), "# Compatibility probe\n\nA synthetic note for unchanged plugin execution.\n", { flag: "wx" });
  await execute("git", ["-c", "init.templateDir=", "-C", directory, "init", "--initial-branch=main"]);
  // Suppressing user templates also suppresses Git's standard exclude file.
  // The unchanged plugin reads it during local askpass initialization.
  await mkdir(join(directory, ".git", "info"), { recursive: true });
  await writeFile(join(directory, ".git", "info", "exclude"), "# Disposable smoke repository exclusions\n", { flag: "wx" });
  assert.equal((await execute("git", ["-C", directory, "remote"])).stdout.trim(), "", "The disposable Git repository must have no remotes.");
  const inheritedFsmonitorDisabled = Array.from({ length: Number(process.env.GIT_CONFIG_COUNT) || 0 }, (_, index) => index)
    .some(index => process.env[`GIT_CONFIG_KEY_${index}`] === "core.fsmonitor" && process.env[`GIT_CONFIG_VALUE_${index}`] === "false");
  result.git = { automaticRoutinesDisabled: true, disablePush: true, remoteCount: 0, remoteOperationsPermitted: false, inheritedFsmonitorDisabled };
  if (restart) { await restart(); } else { await command("Page.reload"); }
  await afterReload();
  await click('[data-note-path="Additional plugin probe.md"]');
  await wait('app.workspace.getActiveFile()?.path==="Additional plugin probe.md"');
  await click("#open-settings");
  await click("#community-plugins-tab");
  await wait("!app.plugins.isManaging");
  if (await evaluate("app.plugins.isRestricted")) {
    await click("#community-restricted-toggle");
    await wait("!app.plugins.isManaging&&!app.plugins.isRestricted");
  }
  const errorOffset = readConsoleErrors().length;
  const failures = [];
  const openSettings = async id => {
    await click(`[data-open-plugin-settings="${id}"]`);
    await wait(`document.querySelector(${JSON.stringify(`#plugin-settings-host [data-plugin-id="${id}"]`)})?.checkVisibility()&&document.querySelector(${JSON.stringify(`[data-open-plugin-settings="${id}"]`)})?.classList.contains("is-active")`, "actual visible registered settings tab");
    await wait('!document.querySelector("main[aria-busy=true]")');
  };
  for (const release of result.releases) {
    if (browser && release.id === "templater-obsidian") {
      await expectErrors(tools, [{ source: "notification", message: "Cannot read properties of undefined (reading 'functions_generator')", stackIncludes: "vault-plugin:templater-obsidian:" }],
        () => click(`[data-toggle-plugin="${release.id}"]`), "Exercise the documented exact Templater 2.26.0 failed-start cleanup without browser Node support");
    } else { await click(`[data-toggle-plugin="${release.id}"]`); }
    await wait("!app.plugins.isManaging", "actual plugin toggle complete");
    const loaded = await evaluate(`Boolean(app.plugins.getPlugin(${JSON.stringify(release.id)}))`);
    const diagnostic = await evaluate(`app.plugins.errorFor(${JSON.stringify(release.id)})`);
    release.unavailableModules = await evaluate(`app.plugins.unavailableModulesFor(${JSON.stringify(release.id)})`);
    release.startupError = loaded ? null : diagnostic;
    release.runtimeWarning = loaded ? diagnostic : null;
    release.status = loaded ? "loaded" : "startup-failed";
    if (!loaded) {
      if (browser && (release.id === "obsidian-git" && release.unavailableModules.includes("path")
          || release.id === "templater-obsidian" && release.unavailableModules.includes("util"))
          && /Unsupported module without the desktop Node runtime:/.test(release.startupError)) {
        release.status = "requires-desktop-node";
      } else { failures.push(`${release.id} ${release.version}: ${release.startupError}`); }
    }
  }
  const gitLoadedAt = !browser && await evaluate('Boolean(app.plugins.getPlugin("obsidian-git"))') ? Date.now() : null;
  if (capture) { await capture(); }
  for (const release of result.releases.filter(release => release.status === "loaded")) {
    try {
      await openSettings(release.id);
      release.settingsText = await evaluate('document.querySelector("#plugin-settings-host").textContent.slice(0,1200)');
      assert.ok(release.settingsText.trim().length > 20, `The actual ${release.id} settings must render meaningful content.`);
      assert.equal(await evaluate('document.querySelector("#client-errors").textContent'), "", "Settings must not produce a new runtime error.");
      release.status = browser && release.id === "omnisearch" && release.unavailableModules.includes("http")
        ? "startup-and-settings-partial-node-dependency" : "startup-and-settings-passed";
      if (release.runtimeWarning) {
        assert.match(await evaluate(`document.querySelector(${JSON.stringify(`.plugin-card[data-plugin-id="${release.id}"] .plugin-error`)})?.textContent??""`), /Browser limitation: unavailable modules http/, "A caught optional Node dependency must remain visible in the real Community page.");
      }
    } catch (error) {
      release.status = "settings-failed";
      release.settingsError = String(error.stack ?? error);
      failures.push(`${release.id} ${release.version} settings: ${error.message ?? error}`);
    }
  }
  result.sharedApis = await evaluate(`(async()=>{
    const api=app.plugins.modules.obsidian, host=document.createElement("div");
    host.hidden=true;document.body.append(host);
    const check=(condition,message)=>{if(!condition)throw new Error(message)};
    try{
      const callback=()=>{},otherCallback=()=>{},callbacks=[callback,otherCallback,callback];
      check(callbacks.remove(callback)===undefined&&callbacks.length===1&&callbacks[0]===otherCallback,"Array removal must remove every matching callback in place.");
      callbacks.remove(callback);check(callbacks.length===1&&callbacks[0]===otherCallback,"Removing an absent callback must preserve other subscribers.");
      const controller=app.workspace.editorSuggest;
      check(controller===app.editorSuggestions,"The workspace must expose its genuine editor-suggestion controller.");
      const previous=controller.suggests,provider=new class extends api.EditorSuggest{
        onTrigger(){return null}getSuggestions(){return []}renderSuggestion(){}selectSuggestion(){}
      }(app);
      const removeProvider=controller.register("additional-registry-contract",provider);
      try{
        check(!previous.includes(provider)&&controller.suggests.includes(provider),"Suggestion enumeration must include actual newly registered instances, not a fixed empty array.");
        controller.suggests.length=0;
        check(controller.suggests.includes(provider),"A returned suggestion snapshot must not mutate provider ownership.");
      }finally{removeProvider()}
      check(!controller.suggests.includes(provider)&&controller.suggests.length===previous.length,"Removing a provider must update the genuine registry without removing other providers.");
      const child=document.createElement("div");let once=0,repeat=0,cancelled=0;
      const stopOnce=child.onNodeInserted(()=>once++,true);
      const stopRepeat=child.onNodeInserted(()=>repeat++);
      const stopCancelled=child.onNodeInserted(()=>cancelled++);stopCancelled();
      host.append(child);await new Promise(resolve=>setTimeout(resolve,0));
      child.remove();await new Promise(resolve=>setTimeout(resolve,0));
      host.append(child);await new Promise(resolve=>setTimeout(resolve,0));
      stopOnce();stopRepeat();
      check(once===1&&repeat===2&&cancelled===0,"Insertion hooks must support repeated/once delivery and real cancellation.");
      check(child.doc===document&&child.win===window&&document.win===window,"DOM owner accessors must expose the actual document/window.");
      check(child.instanceOf(HTMLElement)&&child.instanceOf(HTMLDivElement)&&!child.instanceOf(HTMLButtonElement),"Node constructor checks must distinguish real DOM types.");
      let mouse=false;child.addEventListener("click",event=>{mouse=event.instanceOf(MouseEvent)&&!event.instanceOf(KeyboardEvent)&&event.targetNode===child&&event.win===window&&event.doc===document});
      child.dispatchEvent(new MouseEvent("click",{bubbles:true,view:window}));check(mouse,"UI event helpers must preserve their actual type, target and owner.");
      child.setAttrs({"data-probe":42,"aria-hidden":false});child.setAttr("data-probe",null);
      check(child.getAttr("data-probe")===null&&child.getAttr("aria-hidden")==="false","DOM attributes must write and remove real values.");
      child.setCssStyles({marginTop:"7px"});child.setCssProps({"--additional-contract":"11px"});
      check(child.style.marginTop==="7px"&&child.getCssPropertyValue("--additional-contract")==="11px","Style helpers must change actual inline and computed CSS.");
      const frame=document.createElement("iframe");
      await new Promise(resolve=>{frame.addEventListener("load",resolve,{once:true});host.append(frame)});
      const other=frame.contentWindow,foreign=frame.contentDocument.createElement("button");
      frame.contentDocument.body.append(foreign);
      check(Node.prototype.instanceOf.call(foreign,HTMLButtonElement)&&!Node.prototype.instanceOf.call(foreign,HTMLDivElement),"Cross-window constructor checks must use the real owning window's types.");
      let foreignEvent=false;foreign.addEventListener("click",event=>{foreignEvent=UIEvent.prototype.instanceOf.call(event,MouseEvent)&&Object.getOwnPropertyDescriptor(UIEvent.prototype,"targetNode").get.call(event)===foreign});
      foreign.dispatchEvent(new other.MouseEvent("click",{bubbles:true,view:other}));check(foreignEvent,"Cross-window event checks must preserve the genuine target.");
      const migrations=[],stopMigration=child.onWindowMigrated(view=>migrations.push(view));
      frame.contentDocument.body.append(frame.contentDocument.adoptNode(child));await new Promise(resolve=>setTimeout(resolve,0));
      host.append(document.adoptNode(child));await new Promise(resolve=>setTimeout(resolve,0));stopMigration();
      check(migrations.length===2&&migrations[0]===other&&migrations[1]===window,"Window migration must follow real DOM adoption and be removable.");
      frame.contentDocument.body.append(frame.contentDocument.adoptNode(child));await new Promise(resolve=>setTimeout(resolve,0));
      check(migrations.length===2,"Unregistered migration listeners must not run.");host.append(document.adoptNode(child));frame.remove();
      let format;const changes=[],sample=document.createElement("span");
      const setting=new api.Setting(host).addMomentFormat(control=>{format=control;control.setDefaultFormat("YYYY-MM-DD").setValue("YYYY").setSampleEl(sample).onChange(value=>changes.push(value))});
      check(sample.textContent===api.moment().format("YYYY")&&changes.length===0,"Programmatic date formats must preview without persisting.");
      const color=new api.ColorComponent(setting.controlEl).setValue(null);setting.components.push(color);
      setting.setDisabled(true);check(format.inputEl.disabled&&color.colorPickerEl.disabled&&color.disabled,"Owned and manually registered controls must share disabled state.");
      setting.setDisabled(false);format.inputEl.value="YYYY/MM";format.inputEl.dispatchEvent(new Event("input",{bubbles:true}));
      check(changes.join()==="YYYY/MM"&&sample.textContent===api.moment().format("YYYY/MM"),"Moment format edits must update previews and deliver their actual value.");
      api.addIcon("additional-contract-icon",'<path d="M1 1L15 15"/>');
      try{
        const ids=api.getIconIds(),first=api.getIcon("additional-contract-icon");ids.push("not-a-real-icon");
        check(ids.includes("additional-contract-icon")&&ids.some(id=>id.startsWith("lucide-")),"Icon enumeration must include genuine builtins and custom registrations.");
        first.setAttribute("data-mutated","true");
        check(!api.getIconIds().includes("not-a-real-icon")&&!api.getIcon("additional-contract-icon").hasAttribute("data-mutated"),"Icon arrays and SVG instances must not alias their registry.");
      }finally{api.removeIcon("additional-contract-icon")}
      check(!api.getIconIds().includes("additional-contract-icon"),"Removing a custom icon must update actual enumeration.");
      const classicHost=document.createElement("div"),textarea=document.createElement("textarea");
      classicHost.hidden=true;classicHost.append(textarea);app.workspace.activeLeaf.view.containerEl.append(classicHost);
      const classic=window.CodeMirror.fromTextArea(textarea,{value:"Owned classic editor",mode:"text/plain"});
      try{
        const editors=[];app.workspace.iterateCodeMirrors(editor=>{editors.push(editor);editor.setOption("mode",editor.getOption("mode"))});
        check(editors.filter(editor=>editor===classic).length===1,"Classic editor enumeration must visit the genuine workspace CodeMirror instance exactly once.");
        check(!editors.includes(app.workspace.activeLeaf.view.editor?.cm),"Classic callbacks must never receive a CM6 EditorView.");
      }finally{classic.toTextArea();classicHost.remove()}
      const menu=new api.Menu();let selected=0,submenu;
      try{
        menu.addItem(item=>{submenu=item.setTitle("Owned parent").setSubmenu();submenu.addItem(child=>child.setTitle("Owned child").onClick(()=>selected++))});
        menu.showAtPosition({x:24,y:24});
        menu.dom.querySelector("button").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));
        check(menu.dom.isConnected&&submenu.dom.isConnected&&submenu.dom.contains(document.activeElement),"Keyboard navigation must open a real submenu without closing its parent.");
        submenu.dom.querySelector("button").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true}));
        check(menu.dom.isConnected&&!submenu.dom.isConnected&&menu.dom.contains(document.activeElement),"Left-arrow navigation must return to the parent menu.");
        menu.dom.querySelector("button").click();
        submenu.dom.querySelector("button").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));
        check(menu.dom.isConnected&&submenu.dom.isConnected,"Pointer interaction inside a submenu must not dismiss its parent.");
        submenu.dom.querySelector("button").click();await new Promise(resolve=>setTimeout(resolve,0));
        check(selected===1&&!menu.dom.isConnected&&!submenu.dom.isConnected,"Submenu actions must run once and dismiss the complete menu tree.");
      }finally{menu.hide()}
      return {insertion:{once,repeat,cancelled},arrayRemoval:"all-matching-subscribers",editorSuggestions:"actual-provider-registration-snapshots-and-removal",classicEditors:"genuine-CM5-without-CM6-substitution",domTypes:"local-and-cross-window",migration:"actual-adoption-and-cancellation",styles:"actual-inline-and-computed",momentFormat:"preview-and-change-passed",settingOwnership:"real-disabled-controls",icons:"catalog-custom-clone-and-removal-passed",submenus:"real-keyboard-action-and-dismissal"};
    }finally{host.remove()}
  })()`);
  pass("Real DOM insertion/migration, cross-window node/event types, CSS, Moment previews, settings control ownership and SVG registry behavior pass in the actual renderer.");
  result.markdownEmbed = await evaluate(`(async()=>{
    const text="# Embedded contract\\n\\nOriginal fixture text.\\n";
    const file=await app.vault.create("Embedded contract probe.md",text),container=document.createElement("div");
    document.body.append(container);
    const embed=app.embedRegistry.getEmbedCreator(file)({app,containerEl:container,state:{}},file,"");
    try{
      await embed.load();
      if(!container.querySelector("h1")?.textContent.includes("Embedded contract"))throw new Error("The registry must render the actual Markdown file.");
      embed.editable=true;embed.showEditor();
      if(!embed.editor?.cm?.dom||!container.contains(embed.editor.cm.dom))throw new Error("Editable Markdown embeds must own a real CodeMirror editor.");
      const expected=text+"Edited through the actual embedded editor.\\n";embed.editor.setValue(expected);await embed.save();
      if(await app.vault.read(file)!==expected)throw new Error("Embedded changes did not reach the physical fixture file.");
      embed.showPreview();await embed.reading.whenReady();
      if(!container.textContent.includes("Edited through the actual embedded editor."))throw new Error("The reading preview lost the saved embedded edit.");
      return {path:file.path,reading:"actual-Markdown",editor:"owned-CodeMirror",persistence:"exact-physical-text"};
    }finally{await embed.unloadAndWait();container.remove()}
  })()`);
  pass("The native-shaped Markdown embed registry owns a real renderer/editor and persists an exact physical edit, rather than supplying an empty constructor seam.");
  result.cachedMarkdownRender = await evaluate(`(async()=>{
    const api=app.plugins.modules.obsidian,owner=new api.Component(),container=document.createElement("div"),path="Owned cached renderer contract.md";
    let loads=0,unloads=0;
    const processor=(element,context)=>{if(context.sourcePath===path)context.addChild(new class extends api.MarkdownRenderChild{onload(){loads++}onunload(){unloads++}}(element))};
    document.body.append(container);await owner.load();api.MarkdownPreviewRenderer.registerPostProcessor(processor);
    try{
      await api.MarkdownRenderer.render(app,"# Retained cached preview",container,path,owner);
      const heading=container.querySelector("h1");
      if(!heading||loads!==1||unloads!==0)throw new Error("A real static render must load its original owned child.");
      container.remove();await new Promise(resolve=>setTimeout(resolve,0));
      if(container.querySelector("h1")!==heading||unloads!==0)throw new Error("Temporarily detaching an owned render cache must preserve its actual DOM and component.");
      document.body.append(container);await new Promise(resolve=>setTimeout(resolve,0));
      if(container.querySelector("h1")!==heading)throw new Error("Reattaching the cache must retain its original rendered node.");
      await owner.unloadAndWait();
      if(unloads!==1||container.textContent!=="")throw new Error("The actual owner must still drain and clear its render exactly once.");
      return {sameHeadingNodeAfterDetachAndReattach:true,loads,unloads,ownerCleanupAwaited:true};
    }finally{await owner.unloadAndWait();api.MarkdownPreviewRenderer.unregisterPostProcessor(processor);container.remove()}
  })()`);
  pass("Actual component-owned Markdown caches retain their DOM and postprocessor children through temporary detachment, then drain on owner unload.");
  result.declarativeSettings = await evaluate(`(async()=>{
    const api=app.plugins.modules.obsidian,host=document.createElement("div"),tick=()=>new Promise(resolve=>setTimeout(resolve,0));
    const check=(condition,message)=>{if(!condition)throw new Error(message)};
    host.hidden=true;document.body.append(host);
    let release,writes=0,cleanups=0;
    const gate=new Promise(resolve=>release=resolve);
    class ContractTab extends api.SettingTab{
      getSettingDefinitions(){return [
        {name:"Owned asynchronous value",control:{type:"text",key:"additional-settings-contract",defaultValue:"initial",validate:async value=>{if(value==="blocked"){await gate;return "Fixture async validation rejected"}}}},
        {name:"Owned render cleanup",render:setting=>{setting.descEl.textContent="Owned renderer";return ()=>cleanups++}},
        {type:"page",name:"Nested fixture",items:[{name:"Owned nested page",desc:"Actual declarative navigation"}]}
      ]}
      async setControlValue(key,value){writes++;await super.setControlValue(key,value)}
    }
    const tab=new ContractTab(app);host.append(tab.containerEl);
    try{
      await tab.showSettings();await tab.whenIdle();check(writes===0,"Opening declarative settings must not save.");
      const input=tab.containerEl.querySelector("input");
      input.value="blocked";input.dispatchEvent(new Event("input",{bubbles:true}));await tick();
      check(writes===0,"Pending validation must not persist a value.");release();await tab.whenIdle();
      const validation=tab.containerEl.querySelector(".setting-validation-message");
      check(writes===0&&!validation.hidden&&validation.textContent==="Fixture async validation rejected","Async rejection must be visible without writing.");
      input.value="accepted";input.dispatchEvent(new Event("input",{bubbles:true}));await tab.whenIdle();
      check(writes===1&&validation.hidden,"Valid settings must await exactly one real configuration write.");
      tab.navigateToPagePath(["Nested fixture"]);
      check(cleanups===1&&tab.containerEl.querySelector(".setting-page-title")?.textContent==="Nested fixture","Page navigation must dispose the previous owned render.");
      tab.closePage();check(tab.containerEl.querySelector("input").value==="accepted"&&writes===1,"Back navigation must restore persisted values without resaving.");
    }finally{release();await tab.closeSettings();host.remove()}
    check(cleanups===2,"Closing must dispose the final owned render.");
    return {openingWrites:0,asyncValidation:"visible-rejection-without-write",validWrites:writes,renderCleanups:cleanups,navigation:"nested-and-back"};
  })()`);
  assert.equal(JSON.parse(await readFile(join(directory, ".obsidian", "app.json"), "utf8"))["additional-settings-contract"], "accepted");
  pass("Declarative settings reject held asynchronous validation without saving, persist a valid value physically, navigate nested pages and dispose owned renders.");
  result.confirmation = await evaluate(`(async()=>{
    const api=app.plugins.modules.obsidian,tick=()=>new Promise(resolve=>setTimeout(resolve,0));
    let release,operation,started=0,button;
    const gate=new Promise(resolve=>release=resolve),modal=new api.ConfirmationModal(app);
    modal.setTitle("Owned confirmation contract");
    modal.addButton(component=>{button=component.buttonEl;component.setButtonText("Apply owned fixture").onClick(()=>{
      started++;operation=(async()=>{await gate;await app.configuration.update("app",data=>{data["additional-confirmation-contract"]="applied"})})();return operation;
    })});
    try{
      modal.open();button.click();button.click();await tick();modal.close();
      if(started!==1||!modal.isOpen)throw new Error("Pending confirmations must reject duplicate actions and remain open until the real action settles.");
      release();await operation;await tick();
      if(modal.isOpen)throw new Error("An awaited confirmation must close after its pending physical action completes.");
    }finally{release();if(operation)await operation;await tick();modal.close()}
    return {actions:started,duplicateActionsBlocked:true,closeWaitedForPhysicalAction:true};
  })()`);
  assert.equal(JSON.parse(await readFile(join(directory, ".obsidian", "app.json"), "utf8"))["additional-confirmation-contract"], "applied");
  pass("An actual confirmation blocks duplicate actions and waits for its physical configuration write before closing.");
  result.workflows = {};
  const workflow = async (name, action) => {
    try {
      result.workflows[name] = { status: "passed", ...await action() };
      pass(`Unchanged-plugin workflow: ${name}.`);
    } catch (error) {
      result.workflows[name] = { status: "failed", error: String(error.stack ?? error) };
      try {
        result.workflows[name].failureContext = await evaluate(`({
          activeFile:app.workspace.getActiveFile()?.path,activeView:app.workspace.activeLeaf.view.getViewType(),
          settingsOpen:document.querySelector("#settings-dialog")?.open,
          settingsPlugins:[...document.querySelectorAll("#plugin-settings-host [data-plugin-id]")].map(node=>node.dataset.pluginId),
          switches:[...document.querySelectorAll('#plugin-settings-host [role="switch"]')].map(node=>({name:node.getAttribute("aria-label"),visible:node.checkVisibility(),checked:node.getAttribute("aria-checked")})),
          modals:[...document.querySelectorAll(".modal")].map(node=>node.getAttribute("data-file-dialog")??node.querySelector("h2")?.textContent),
          documentHasFocus:document.hasFocus(),focusedElement:document.activeElement?.outerHTML.slice(0,800),
          embeddedEditor:app.workspace.activeEditor?{text:app.workspace.activeEditor.editor.cm.state.doc.toString().slice(0,1000),focused:app.workspace.activeEditor.editor.cm.hasFocus,connected:app.workspace.activeEditor.editor.cm.dom.isConnected}:null,
          cards:[...document.querySelectorAll(".kanban-plugin__item-content-wrapper")].map(node=>({text:node.textContent.slice(0,1000),visible:node.checkVisibility()})),
          kanbanCache:app.workspace.activeLeaf.view.getViewType()==="kanban"?{
            viewLoaded:app.workspace.activeLeaf.view._loaded,
            model:app.workspace.activeLeaf.view.getBoard(),
            cached:[...app.workspace.activeLeaf.view.previewCache].map(([id,render])=>({id,markdown:render.markdown,loaded:render._loaded,authoritativeLoaded:render.isLoaded,visible:render.isVisible,connected:render.containerEl.isConnected,parent:render.containerEl.parentElement?.className,text:render.containerEl.textContent.slice(0,500),wrapper:render.wrapperEl?.outerHTML.slice(0,1000)}))
          }:null,
          inputs:[...document.querySelectorAll(".kanban-plugin__item-input .cm-content")].map(node=>({text:node.textContent,visible:node.checkVisibility()})),
          menus:[...document.querySelectorAll(".menu")].map(node=>node.textContent.slice(0,1000)),
          error:document.querySelector("#client-errors")?.textContent
        })`);
      } catch (diagnosticError) {
        result.workflows[name].diagnosticError = String(diagnosticError.stack ?? diagnosticError);
      }
      failures.push(`${name}: ${error.message ?? error}`);
      console.error(`FAIL ${name}: ${error.message ?? error}`);
    }
  };
  await workflow("Linter delayed settings persist on owned disable", async () => {
    await openSettings("obsidian-linter");
    const original = await evaluate(`(()=>{const row=[...document.querySelectorAll("#plugin-settings-host .setting-item")].find(row=>row.querySelector(".setting-item-name")?.textContent==="Lint on save");const toggle=row?.querySelector('[role="switch"]');if(!toggle)throw new Error("Linter's actual Lint on save setting is missing.");toggle.setAttribute("data-additional-probe","linter-save");return app.plugins.getPlugin("obsidian-linter").settings.lintOnSave})()`);
    const started = Date.now();
    await click('[data-additional-probe="linter-save"]');
    await click("#community-plugins-tab");
    await click('[data-toggle-plugin="obsidian-linter"]');
    await wait("!app.plugins.isManaging", "Linter settings write and owned disable");
    assert.equal(await evaluate('app.plugins.getPlugin("obsidian-linter")===null'), true);
    const saved = JSON.parse(await readFile(join(directory, ".obsidian", "plugins", "obsidian-linter", "data.json"), "utf8"));
    assert.equal(saved.lintOnSave, !original, "Disabling must finish the real plugin's queued settings write.");
    const elapsedMs = Date.now() - started;
    await click('[data-toggle-plugin="obsidian-linter"]');
    await wait("!app.plugins.isManaging", "Linter re-enable from physical saved settings");
    assert.equal(await evaluate('app.plugins.getPlugin("obsidian-linter").settings.lintOnSave'), !original);
    return { setting: "lintOnSave", previous: original, physicalValue: saved.lintOnSave, elapsedMs, disabledBeforeFiveSecondDeadline: elapsedMs < 5000, reloadedPhysicalValue: true };
  });
  await workflow("QuickAdd nested settings and physical persistence", async () => {
    await openSettings("quickadd");
    await evaluate(`(()=>{const row=[...document.querySelectorAll("#plugin-settings-host .setting-item")].find(row=>row.querySelector(".setting-item-name")?.textContent==="Advanced");if(!row)throw new Error("QuickAdd's real Advanced page is missing.");row.setAttribute("data-additional-probe","advanced")})()`);
    await click('[data-additional-probe="advanced"] .setting-item-name');
    await wait('document.querySelector("#plugin-settings-host .setting-page-title")?.textContent==="Advanced"');
    const initial = await evaluate(`(()=>{const row=[...document.querySelectorAll("#plugin-settings-host .setting-item")].find(row=>row.querySelector(".setting-item-name")?.textContent==="Show input cancellation notifications");const toggle=row?.querySelector('[role="switch"]');if(!toggle)throw new Error("QuickAdd's real nested toggle is missing.");toggle.setAttribute("data-additional-probe","notification");return toggle.getAttribute("aria-checked")})()`);
    assert.equal(initial, "false");
    await click('[data-additional-probe="notification"]');
    const path = join(directory, ".obsidian", "plugins", "quickadd", "data.json"), deadline = Date.now() + 10000;
    let saved;
    do {
      saved = JSON.parse(await readFile(path, "utf8"));
      if (saved.showInputCancellationNotification === true) { break; }
      await delay(100);
    } while (Date.now() < deadline);
    assert.equal(saved.showInputCancellationNotification, true, "An actual nested settings edit must reach the fixture's physical plugin data.");
    assert.equal(saved.disableOnlineFeatures, true, "Changing a setting must preserve the fixture's offline protection.");
    await click("#plugin-settings-host .setting-page-titlebar button");
    await wait('!document.querySelector("#plugin-settings-host .setting-page-title")');
    return { page: "Advanced", changed: "showInputCancellationNotification", physicalValue: true, offlineProtectionRetained: true };
  });
  if (browser && result.releases.find(release => release.id === "templater-obsidian").status === "requires-desktop-node") {
    result.workflows["Templater security consent and cancellation"] = { status: "not-run-requires-desktop-node", reason: "Exact 2.26.0 requests util and child_process during desktop-UI startup. The standalone browser supplies neither a fake process nor altered platform flags." };
  } else { await workflow("Templater security consent and cancellation", async () => {
    await openSettings("templater-obsidian");
    await evaluate(`(()=>{const row=[...document.querySelectorAll("#plugin-settings-host .setting-item")].find(row=>row.querySelector(".setting-item-name")?.textContent==="Enable user system command functions");const toggle=row?.querySelector('[role="switch"]');if(!toggle)throw new Error("Templater's actual security control is missing.");toggle.setAttribute("data-additional-probe","system-commands")})()`);
    const original = await evaluate('app.loadLocalStorage("templater-local-settings")');
    try {
      await click('[data-additional-probe="system-commands"]');
      await wait('Boolean(document.querySelector(".templater-confirm-dangerous-setting-modal"))');
      assert.equal(await evaluate('document.querySelector(".templater-confirm-dangerous-setting-modal .mod-cta").disabled'), true, "Templater must require explicit consent before enabling system commands.");
      await click('.templater-confirm-dangerous-setting-modal input[type="checkbox"]');
      await wait('!document.querySelector(".templater-confirm-dangerous-setting-modal .mod-cta").disabled');
      await click('.templater-confirm-dangerous-setting-modal input[type="checkbox"]');
      await wait('document.querySelector(".templater-confirm-dangerous-setting-modal .mod-cta").disabled');
    } finally {
      await evaluate(`(()=>{const modal=document.querySelector(".templater-confirm-dangerous-setting-modal");const cancel=[...modal?.querySelectorAll("button")??[]].find(button=>button.textContent==="Cancel");cancel?.click()})()`);
    }
    await wait('!document.querySelector(".templater-confirm-dangerous-setting-modal")');
    assert.deepEqual(await evaluate('app.loadLocalStorage("templater-local-settings")'), original, "Cancelling must not store consent or enable system commands.");
    return { checkboxRequired: true, checkingAndUnchecking: "gates-actual-enable-button", cancelledWithoutConsent: true, systemCommandsExecuted: false };
  }); }
  await evaluate('(async()=>{document.querySelector("#settings-dialog").close();await app.plugins.whenIdle()})()');
  await checkAdditionalPluginWorkflows(tools, workflowFixtures, workflow);
  await checkFurtherPluginWorkflows({ ...tools, openSettings }, workflowFixtures, workflow);
  await workflow("Natural Language Dates owned protocol callback", async () => {
    const details = await evaluate(`(async()=>{
      const api=app.plugins.modules.obsidian,options=app.internalPlugins.getPluginById("daily-notes")?.instance?.options??{};
      const folder=api.normalizePath(options.folder||""),day="2031-03-17";
      if(folder!=="/"&&!app.vault.getAbstractFileByPath(folder))await app.vault.createFolder(folder);
      const path=(folder!=="/"?folder+"/":"")+api.moment(day).format(options.format||"YYYY-MM-DD")+".md";
      const text="# Protocol callback fixture\\n\\nPreserve these owned bytes.\\n";
      await app.vault.create(path,text);
      await app.protocols.createDispatcher()("obsidian://nldates?day="+day+"&newPane=no");
      return {path,text};
    })()`);
    await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(details.path)}`, "the real protocol handler's asynchronous file navigation");
    assert.equal(await readFile(join(directory, ...details.path.split("/")), "utf8"), details.text);
    return { action: "nldates", path: details.path, physicalTextPreserved: true, osUrlAssociation: "not-claimed" };
  });
  await workflow("Kanban board rendering and physical checkbox persistence", async () => {
    await evaluate(`(async()=>{await app.vault.create("Kanban compatibility board.md","---\\nkanban-plugin: board\\n---\\n\\n## Owned lane\\n\\n- [ ] Owned compatibility card\\n")})()`);
    await wait('app.metadataCache.getCache("Kanban compatibility board.md")?.frontmatter?.["kanban-plugin"]==="board"', "indexed Kanban frontmatter before user navigation");
    result.kanbanRouting = await evaluate('({loaded:app.plugins.getPlugin("obsidian-kanban")._loaded,cache:app.metadataCache.getCache("Kanban compatibility board.md").frontmatter})');
    await evaluate('(async()=>{await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath("Kanban compatibility board.md"))})()');
    await wait('Boolean(document.querySelector(".kanban-plugin__board"))||Boolean(document.querySelector("#client-errors").textContent)', "real Kanban board rendering");
    assert.equal(await evaluate('app.workspace.activeLeaf.view.getViewType()'), "kanban", "The actual plugin must own the file view.");
    assert.equal(await evaluate('Boolean(document.querySelector(".kanban-plugin__board"))'), true, "The real Kanban component must mount.");
    await click('.kanban-plugin__board input[type="checkbox"]');
    result.kanbanAfterClick = await evaluate(`(()=>{const board=app.workspace.activeLeaf.view.getBoard();return {errors:board?.data.errors,cards:board?.children.flatMap(lane=>lane.children.map(card=>({title:card.data.title,checked:card.data.checked,checkChar:card.data.checkChar})))}})()`);
    assert.equal(result.kanbanAfterClick.cards[0].checked, true, "The actual checkbox handler must update its board model before persistence.");
    await wait('(async()=>/\\[x\\] Owned compatibility card/i.test(await app.vault.adapter.read("Kanban compatibility board.md")))()', "the board's physical save");
    assert.match(await readFile(join(directory, "Kanban compatibility board.md"), "utf8"), /\[x\] Owned compatibility card/i);
    if (capture) { await capture("board"); }
    return { view: "kanban", checkedCardPersisted: true };
  });
  await checkFurtherKanbanWorkflows(tools, workflowFixtures, workflow);
  if (gitLoadedAt !== null) {
    await workflow("Git real editor ownership across its scheduled stale-subscriber interval", async () => {
      const path = "Additional plugin probe.md", before = await readFile(join(directory, path));
      await evaluate(`app.workspace.getLeaf(false).openFile(app.vault.getFileByPath(${JSON.stringify(path)}))`);
      await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(path)}&&app.workspace.activeLeaf.view.getViewType()==="markdown"`, "a genuine Markdown editor for original Git subscribers");
      await command("Page.bringToFront");
      await delay(Math.max(0, 65000 - (Date.now() - gitLoadedAt)));
      assert.equal(await evaluate('(()=>{const cm=app.workspace.activeEditor.editor.cm;return Boolean(app.plugins.getPlugin("obsidian-git"))&&cm.state.field(app.plugins.modules.obsidian.editorEditorField)===cm})()'), true, "The original interval must retain a real owned editor field, not an undefined or constant-null shim.");
      assert.deepEqual(await readFile(join(directory, path)), before, "Subscriber cleanup must not modify the note.");
      return { intervalMs: 60000, loadedForMs: Date.now() - gitLoadedAt, actualEditorField: true, scheduledIntervalElapsed: true, noteBytesPreserved: true, remotes: 0, remoteOperationsExecuted: false, automaticRoutinesDisabled: true };
    });
  }
  await workflow("Configured restoration and owned disable cleanup", async () => {
    const expected = result.releases.filter(release => !["startup-failed", "requires-desktop-node"].includes(release.status)).map(release => release.id).sort();
    const unsupported = browser ? result.releases.filter(release => release.status === "requires-desktop-node").map(release => release.id).sort() : [];
    const configurationPath = join(directory, ".obsidian", "community-plugins.json");
    assert.deepEqual(JSON.parse(await readFile(configurationPath, "utf8")).sort(), expected);
    if (browser) {
      await writeFile(configurationPath, JSON.stringify([...expected, ...unsupported]) + "\n");
    }
    const original = await readFile(configurationPath, "utf8");
    await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
    if (restart) { await restart(); await afterReload(); }
    else {
      await expectErrors(tools, [
        { source: "notification", message: "Could not restore community plugin obsidian-git: Unsupported module without the desktop Node runtime: path", stackIncludes: "PluginHost.loadConfigured" },
        { source: "notification", message: "Cannot read properties of undefined (reading 'functions_generator')", stackIncludes: "vault-plugin:templater-obsidian:" },
        { source: "notification", message: "Could not restore community plugin templater-obsidian: Unsupported module without the desktop Node runtime: util", stackIncludes: "PluginHost.loadConfigured" },
      ], async () => { await command("Page.reload"); await afterReload(); }, "Explicitly restore unsupported Git/Templater IDs without rewriting the shared desktop/browser configuration");
    }
    await wait("!app.changingVault&&!app.plugins.isManaging", "configured restoration completion");
    assert.deepEqual(await evaluate(`${JSON.stringify(expected)}.filter(id=>Boolean(app.plugins.getPlugin(id))).sort()`), expected);
    assert.equal(await readFile(configurationPath, "utf8"), original, "Passive restoration must preserve exact canonical configuration bytes, including unsupported browser IDs.");
    if (capture) { await capture("restored"); }
    await click("#open-settings");
    await click("#community-plugins-tab");
    for (const id of expected) {
      if (browser && id === "omnisearch") {
        await expectErrors(tools, [{ source: "notification", message: "Cannot read properties of null (reading 'close')", stackIncludes: "vault-plugin:omnisearch:" }],
          () => click(`[data-toggle-plugin="${id}"]`), "Exercise the documented Omnisearch cleanup after its unavailable browser HTTP server");
      } else { await click(`[data-toggle-plugin="${id}"]`); }
      await wait("!app.plugins.isManaging", "owned plugin disable completion");
      const remaining = await evaluate(`({loaded:Boolean(app.plugins.getPlugin(${JSON.stringify(id)})),settings:app.settingsTabs.has(${JSON.stringify(id)}),style:Boolean(document.querySelector(${JSON.stringify(`style[data-plugin-id="${id}"]`)})),commands:Object.keys(app.commands.commands).filter(command=>command.startsWith(${JSON.stringify(id + ":")}))})`);
      assert.deepEqual(remaining, { loaded: false, settings: false, style: false, commands: [] }, "Disabling must remove the actual plugin and its owned settings, style and commands.");
    }
    assert.deepEqual(JSON.parse(await readFile(configurationPath, "utf8")).sort(), unsupported);
    assert.equal(await evaluate("app.workspace.getLeavesOfType('kanban').every(leaf=>leaf.isDeferred)"), true, "Disabled Kanban views must be closed or deferred, never left live.");
    return { restoredRunning: expected, originalConfigurationBytesPreserved: true, removedOwnedCommandsStylesAndSettings: true, unsupportedConfiguredIdsRetained: unsupported };
  });
  for (const release of result.releases) {
    for (const asset of release.assets) {
      assert.equal(hash(await readFile(join(directory, ".obsidian", "plugins", release.id, asset.name))), asset.sha256, "Actual plugin execution must not change its supplied assets.");
    }
  }
  assert.equal((await execute("git", ["-C", directory, "remote"])).stdout.trim(), "");
  result.consoleErrors = readConsoleErrors().slice(errorOffset);
  const startupModuleError = (error, id, name) => {
    const message = `Unsupported module without the desktop Node runtime: ${name}`;
    return error.startsWith("Error: " + message) && error.includes(`vault-plugin:${id}:`)
      || error.startsWith(`Error: Could not restore community plugin ${id}: ${message}`) && error.includes("PluginHost.loadConfigured");
  };
  result.knownLimitations = result.consoleErrors.filter(error => browser
    ? startupModuleError(error, "obsidian-git", "path")
      || startupModuleError(error, "templater-obsidian", "util")
      || error.startsWith("Omnisearch - Failed to load API server Error: Unsupported module without the desktop Node runtime: http") && error.includes("vault-plugin:omnisearch:")
      || error.startsWith("TypeError: Cannot read properties of null (reading 'close')") && /\.onunload \(vault-plugin:omnisearch:\d+:\d+\)/.test(error) && result.releases.find(release => release.id === "omnisearch").unavailableModules.includes("http")
      || error.startsWith("TypeError: Cannot read properties of undefined (reading 'functions_generator')") && /\.onunload \(vault-plugin:templater-obsidian:\d+:\d+\)/.test(error) && result.releases.find(release => release.id === "templater-obsidian").status === "requires-desktop-node"
    : inheritedFsmonitorDisabled && error.includes("Configuring core.fsmonitor is not permitted without enabling allowUnsafeFsMonitor") && error.includes("obsidian-git"));
  if (result.knownLimitations.length) {
    result.git.capability = browser ? "requires-desktop-node" : "bundled-git-library-rejects-inherited-fsmonitor-false-safety-configuration";
  }
  result.browserLimitations = browser ? [
    { plugin: "obsidian-git", stage: "startup", requiredModules: ["path"], scope: "Not loaded; real Node/Git backend unavailable." },
    { plugin: "templater-obsidian", stage: "startup-and-failed-load-cleanup", requiredModules: ["util", "child_process"], scope: "Not loaded; exact 2.26.0 starts its system-command module in desktop UI mode and its own partial-start cleanup also fails." },
    { plugin: "omnisearch", stage: "optional-http-and-cleanup", requiredModules: ["http", "url"], scope: "Startup/settings run, but the HTTP module cannot construct its server; the plugin's unconditional null-server close fails. Not complete browser compatibility." },
  ] : [];
  result.expectedShutdownErrors = readExpectedShutdownErrors?.().filter(error => result.consoleErrors.includes(error)) ?? [];
  result.unexpectedConsoleErrors = result.consoleErrors.filter(error => !result.knownLimitations.includes(error) && !result.expectedShutdownErrors.includes(error));
  result.uncaughtRuntimeErrors = readRuntimeErrors();
  if (capture) { await capture(); }
  assert.deepEqual(failures, [], "Exact releases must pass their declared host scope; only the explicitly recorded browser Node boundaries are accepted.");
  assert.deepEqual(result.unexpectedConsoleErrors, [], "Unexpected asynchronous plugin errors must fail acceptance rather than being cleared by Settings.");
  assert.deepEqual(result.uncaughtRuntimeErrors, [], "Uncaught renderer exceptions must fail acceptance even when no console.error was emitted.");
  pass(browser ? "Seven exact releases pass browser startup/settings; Omnisearch's HTTP/cleanup and Git/Templater's startup Node boundaries remain explicit, not full compatibility." : "All ten exact releases pass desktop startup and real settings; the inherited Git safety-configuration limitation is recorded separately.");
  pass("Every loaded release renders its real settings while all supplied manifests, scripts and styles remain byte-identical; Git still has no remotes.");
}
