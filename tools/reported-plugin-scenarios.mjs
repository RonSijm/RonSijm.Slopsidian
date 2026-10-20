import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const releases = [
  {
    id: "dataview", version: "0.5.68", repository: "blacksmithgu/obsidian-dataview",
    hashes: ["794e9eaede73920bb8d54b0eda4f5de2182d698cc638774500f24f14bcd4da0b", "9235db47112da81b85591c79ecb9ae2574e5e72207056e976472f90616286185", "3306dd9032e00f989ba7233a37fd255bc4d3f4340cee661762e952f3f6aa1de9"],
  },
  {
    id: "obsidian-tasks-plugin", version: "8.0.0", repository: "obsidian-tasks-group/obsidian-tasks",
    hashes: ["7a47cc91576d2a78932f925073a8688cfcb06bc1fdfa19565043f8ab9979ab56", "150cec115dfd83f2f95c4edd515df7254e1102c116032bd0998dc90d67138737", "62865e01fbaf8418635c0eeacc27d4f7352c90f07e81b1be396acd1a1f7eabbc"],
  },
  {
    id: "mermaid-tools", version: "1.3.0", repository: "dartungar/obsidian-mermaid",
    hashes: ["fc1968f9edd5ddd9bab3ea713a6863583c3dbb8c12bbddb596990f74dff73383", "10f838291c789295688dcffd25ca88c69fa9e3a714115b4ec400605d0877428e", "7be8af19d73bcca6695764a2dc0f3e2c5fe19cb8b7d50a46ff9c51620cd9434c"],
  },
  {
    id: "folder-notes", version: "1.8.19", repository: "LostPaul/obsidian-folder-notes",
    hashes: ["761f16cc811c91fe286909aa7df9e9dd8104bb31b699ef855c2397562454ac37", "9a5984322e3af70a43ffecbd7a5c76fdabbc8e1feee7bbc61831f7341474ebe1", "0be981f1240faf811a11127bb06cb4df31806c1f3c45e2adca77f5f4f38ed9d9"],
  },
  {
    id: "metadata-menu", version: "0.8.12", repository: "mdelobelle/metadatamenu",
    hashes: ["a4c37d9f3931a72a8115c34ca226121f8d6f3d1c1d1feaef1179f05113cf3c6d", "5e553e4132c8d6d9f7992fec2cdb570cc108a1f32daee4d4c24c017c6c9a2fbd", "b08f764bb08ae8ea06c1def27f97a2da16b4cc1920bbb618aaae2dcc7cf4f3cf"],
  },
  {
    id: "obsidian-excalidraw-plugin", version: "2.22.3", repository: "zsviczian/obsidian-excalidraw-plugin",
    hashes: ["8ee40733d87fffb225ac43fd8dfe68374e1c81f515118dabd770f9afacc6b1b9", "ea85647686daf11a06248c80026557e2fe43302e3d015aafa7c117bc26b55c59", "c5da56b04c5f74dbe7b1f5773dc470c14babf4cd4c1593c819c5288cbd80c549"],
  },
];
const assetNames = ["main.js", "manifest.json", "styles.css"];

async function verifyAssets(directory, release) {
  const assets = [];
  for (const [index, name] of assetNames.entries()) {
    const bytes = await readFile(join(directory, name));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    assert.equal(sha256, release.hashes[index], `Refuse a modified ${release.id} ${release.version} asset: ${name}`);
    assets.push({ name, bytes: bytes.length, sha256 });
  }
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  assert.equal(manifest.id, release.id);
  assert.equal(manifest.version, release.version);
  assert.equal(manifest.isDesktopOnly, false);
  return assets;
}

export async function checkReportedPlugins(tools) {
  const { directory, evaluate, command, click, press, wait, restart, afterReload, readConsoleErrors, report } = tools;
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  report.reportedPlugins = {
    host: restart ? "desktop" : "browser-wasm", scope: "reported helpers, unchanged plugin startup, settings and owned cleanup; not full plugin parity",
    referenceRuntimeComparison: "not-performed", releases: [],
  };
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  await writeFile(join(directory, "Reported plugins.md"), "---\nstatus: ready\ntags: [startup-probe]\n---\n# Startup probe\n\n- [ ] A genuine startup task #task\n", { flag: "wx" });
  const navigationPath = "Reported navigation.md";
  const navigationBytes = Buffer.from("\ufeff# Ordinary Markdown navigation\r\n\r\nStill opens after every plugin is enabled.\r\n");
  await writeFile(join(directory, navigationPath), navigationBytes, { flag: "wx" });
  await mkdir(join(directory, "Reported helpers", "Collapsed"), { recursive: true });
  await writeFile(join(directory, "Reported helpers", "Collapsed", "Nested.md"), "# Real reveal target\n", { flag: "wx" });
  for (const release of releases) {
    const source = join(root, ".runtime", "compatibility", "reported-plugins", `${release.id}-${release.version}`);
    const assets = await verifyAssets(source, release);
    await cp(source, join(directory, ".obsidian", "plugins", release.id), { recursive: true, errorOnExist: true, force: false });
    report.reportedPlugins.releases.push({
      id: release.id, version: release.version, url: `https://github.com/${release.repository}/releases/tag/${release.version}`,
      unmodifiedReleaseAssets: assets, status: "not-tested",
    });
  }
  if (restart) { await restart(); } else { await command("Page.reload"); }
  await afterReload();
  await click('[data-note-path="Reported plugins.md"]');
  await wait('app.workspace.getActiveFile()?.path==="Reported plugins.md"&&app.workspace.activeLeaf.view.getViewType()==="markdown"', "actual Markdown note open before plugin enablement");
  const consoleStart = readConsoleErrors().length;
  async function checkHelpers() {
    const originalNote = await readFile(join(directory, "Reported plugins.md"));
    report.reportedPlugins.helpers = await evaluate(`(async()=>{
    const api=app.plugins.require("obsidian");
    const fragment=api.sanitizeHTMLToDom('<button type="button" onclick="globalThis.helperUnsafe=true">Safe control</button><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" onload="globalThis.helperUnsafe=true"><path d="M1 1h10v10z"/></svg><script>globalThis.helperUnsafe=true</script><a href="javascript:globalThis.helperUnsafe=true">Unsafe URL</a><iframe srcdoc="unsafe"></iframe>');
    const host=createDiv({cls:["reported-helper-contract","second-class"]});
    if(host.parentNode!==null)throw new Error("Global element factories must create detached elements.");
    host.appendChild(fragment);document.body.appendChild(host);
    try {
      globalThis.helperUnsafe=false;
      host.querySelector("button").click();
      if(host.querySelector("script,iframe")||host.querySelector("button").hasAttribute("onclick")||host.querySelector("a").hasAttribute("href")||host.querySelector("svg").hasAttribute("onload")||globalThis.helperUnsafe)throw new Error("Plugin HTML was not sanitized.");
      if(!(host.querySelector("svg") instanceof SVGSVGElement)||!host.querySelector("path")||!host.classList.contains("second-class"))throw new Error("Sanitization must retain genuine SVGs and plugin UI.");
      if(!(api.getIcon("folder") instanceof SVGSVGElement))throw new Error("Built-in icon lookup must return a real SVG.");
      host.classList.add("selector-probe");
      const child=host.createSpan({cls:"selector-probe"});
      host.appendText("<literal text>");
      if(host.find(".selector-probe")!==child||host.findAll(".selector-probe").length!==1||host.findAllSelf(".selector-probe")[0]!==host||host.findAllSelf(".selector-probe").length!==2||host.lastChild.textContent!=="<literal text>")throw new Error("DOM selector and literal text helpers must operate on real nodes.");
      const delegated=host.createDiv({cls:"delegated-target"}),nested=delegated.createSpan({text:"Nested target"}),events=[];
      function listener(event,target){events.push({receiver:this,target,eventTarget:event.target})}
      host.on("click",".delegated-target",listener,true);
      nested.click();host.click();
      if(events.length!==1||events[0].receiver!==delegated||events[0].target!==delegated||events[0].eventTarget!==nested)throw new Error("Delegated events must find the matching ancestor and preserve the actual event and receiver.");
      host.off("click",".delegated-target",listener,false);nested.click();
      host.off("click",".delegated-target",listener,true);nested.click();
      if(events.length!==2)throw new Error("Delegated listener removal must respect the capture option and remove the real listener.");
      const changes={text:[],slider:[],color:[]},setting=new api.Setting(host).setName("Real SDK controls");
      let text,slider,color,warning;
      setting.addTextArea(control=>{text=control;control.setValue("Before").setPlaceholder("Actual placeholder").onChange(value=>changes.text.push(value))});
      text.inputEl.value="After";text.inputEl.dispatchEvent(new Event("input",{bubbles:true}));
      setting.setDisabled(true).addSlider(control=>{slider=control;control.setLimits(-5,5,0.5).setValue(2).setDynamicTooltip().setInstant(false).onChange(value=>changes.slider.push(value))});
      if(!text.inputEl.disabled||!slider.sliderEl.disabled||text.inputEl.getAttribute("aria-label")!=="Real SDK controls")throw new Error("Settings must label and disable both existing and newly added controls.");
      setting.setDisabled(false).setVisibility(false);
      if(setting.settingEl.getClientRects().length)throw new Error("Hidden settings must not remain in the rendered layout.");
      setting.setVisibility(true);
      if(!setting.settingEl.getClientRects().length||slider.sliderEl.disabled)throw new Error("Settings visibility and disabled state must be reversible.");
      slider.sliderEl.value="3.5";slider.sliderEl.dispatchEvent(new Event("input"));
      if(changes.slider.length||slider.sliderEl.title!=="3.5")throw new Error("Non-instant sliders must update their tooltip without notifying until change.");
      slider.sliderEl.dispatchEvent(new Event("change"));slider.setInstant(true).setValue(4);
      slider.sliderEl.dispatchEvent(new Event("input"));slider.sliderEl.dispatchEvent(new Event("change"));
      setting.addColorPicker(control=>{color=control;control.setValue("rgb(51, 102, 153)").onChange(value=>changes.color.push(value))});
      if(color.getValue()!=="#336699")throw new Error("Color controls must normalize actual CSS RGB values.");
      color.colorPickerEl.value="#abcdef";color.colorPickerEl.dispatchEvent(new Event("input"));
      setting.addButton(control=>{warning=control;control.setButtonText("Warning").setWarning()});
      const normal=new api.ButtonComponent(host).setButtonText("Normal");
      if(getComputedStyle(warning.buttonEl).color===getComputedStyle(normal.buttonEl).color)throw new Error("Warning buttons must have actual warning presentation.");
      if(JSON.stringify(changes)!==JSON.stringify({text:["After"],slider:[3.5,4],color:["#abcdef"]}))throw new Error("Real control interactions must invoke callbacks with their edited values.");
      const view=app.markdownView;
      for(const mode of ["source","live-preview","preview","source"]){
        view.setEditingMode(mode,false);
        const state=view.editor.cm.state,info=state.field(api.editorInfoField);
        if(info!==view||info.editor!==view.editor||info.file.path!=="Reported plugins.md"||state.field(api.editorLivePreviewField)!==(mode==="live-preview"))throw new Error("CodeMirror SDK fields must reference the real Markdown file/editor and actual editing mode.");
      }
      if(!view.metadataEditor.rendered.some(item=>item.entry.key==="status"&&item.valueEl.textContent==="ready"&&item.containerEl.contains(item.valueEl)))throw new Error("Metadata editor compatibility must expose actual rendered property rows, not empty placeholders.");
      for(const id of ["publish","sync"]){
        const core=app.internalPlugins.getPluginById(id);
        if(!core||core!==app.internalPlugins.plugins[id]||core.enabled||core.instance!==null||app.internalPlugins.getEnabledPluginById(id)!==null)throw new Error("Known unavailable core modules must have real inventory entries with no provider or fake enabled instance.");
      }
      const explorer=app.internalPlugins.getEnabledPluginById("file-explorer"),file=app.vault.getAbstractFileByPath("Reported helpers/Collapsed/Nested.md");
      const row=document.querySelector('[data-note-path="Reported helpers/Collapsed/Nested.md"]');
      if(!explorer||!file||!row)throw new Error("The actual nested vault file must be indexed and rendered before reveal.");
      const ancestors=[];for(let parent=row.parentElement;parent;parent=parent.parentElement){if(parent instanceof HTMLDetailsElement){parent.open=false;ancestors.push(parent)}}
      if(ancestors.length<2)throw new Error("The reveal fixture must contain genuinely nested collapsed folders.");
      await explorer.revealInFolder(file);
      if(ancestors.some(parent=>!parent.open)||!row.getClientRects().length||document.activeElement!==row)throw new Error("File Explorer reveal must open real ancestors, show the row and focus the actual file.");
      let rejectedForeign=false;try{await explorer.revealInFolder({path:file.path})}catch{rejectedForeign=true}
      if(!rejectedForeign)throw new Error("File Explorer reveal must reject a foreign file object.");
      if(window.moment("2024-02-29","YYYY-MM-DD",true).add(1,"day").format("YYYY-MM-DD")!=="2024-03-01")throw new Error("Global Moment must perform actual date operations.");
      if(!api.requireApiVersion("1.8.7")||!api.requireApiVersion("1.12.7")||!api.requireApiVersion("1.13.3")||api.requireApiVersion("1.14.0"))throw new Error("API versions must compare numerically against the experimental compatibility target.");
      const mermaid=await api.loadMermaid();
      if(window.mermaid!==mermaid||await api.loadMermaid()!==mermaid||!(await mermaid.parse("flowchart LR\\n  Real --> Parser")).diagramType.startsWith("flowchart"))throw new Error("The lazy Mermaid API must expose the actual cached engine and parser.");
      const value={actualTimer:true};
      if(await app.plugins.require("timers/promises").setTimeout(5,value)!==value||await app.plugins.require("node:timers/promises").setTimeout(1,value)!==value)throw new Error("Promise timers must resolve the actual supplied value.");
      let refreshed=0;
      const refresh=api.debounce(value=>{refreshed=value},5,true);
      refresh(1);refresh(2);
      await new Promise(resolve=>setTimeout(resolve,30));
      if(refreshed!==2)throw new Error("The actual shared debounce must deliver the latest call.");
      return {sanitizedDom:true,retainedSvgAndControls:true,detachedGlobalFactories:true,delegatedEventsAndRemoval:true,realSettingsInteractions:true,actualEditorInfoAndPreviewFields:true,actualMetadataPropertyRows:true,nestedFileExplorerReveal:true,globalMoment:true,numericApiVersion:true,builtinSvg:true,lazyMermaidParser:true,promiseTimers:true,debounce:true};
    } finally {host.remove();delete globalThis.helperUnsafe;}
  })()`);
    assert.deepEqual(await readFile(join(directory, "Reported plugins.md")), originalNote, "Editor/Reading mode and shared SDK probes must not write the note.");
    await evaluate('app.markdownView.setEditingMode("live-preview")');
    await wait('app.markdownView.metadataEditor.contentEl.getClientRects().length>0', "actual inline properties visible in Live Preview");
    const propertyDialog = '.modal[data-core-dialog="properties"]';
    for (const value of ["verified through the inline editor", "ready"]) {
      await click('[data-property-key="status"] [data-metadata-property-action="edit"]');
      await wait(`document.querySelector('${propertyDialog} [data-property-field="name"]')?.value==="status"`, "real inline property edit dialog");
      await evaluate(`(()=>{const input=document.querySelector('${propertyDialog} [data-property-field="value"]');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event("input",{bubbles:true}))})()`);
      await click(`${propertyDialog} [data-property-action="save"]`);
      await wait(`!document.querySelector('${propertyDialog}')&&app.markdownView.metadataEditor.rendered.some(item=>item.entry.key==="status"&&item.entry.value===${JSON.stringify(value)})`, "actual guarded inline property save and refreshed metadata row");
      await wait(`app.plugins.plugins.dataview.api.page("Reported plugins.md")?.status===${JSON.stringify(value)}`, "unchanged Dataview observes the real property write");
    }
    const editedNote = await readFile(join(directory, "Reported plugins.md"));
    assert.equal(editedNote.toString("utf8"), originalNote.toString("utf8").replace("tags: [startup-probe]", "tags: [ startup-probe ]"), "Guarded property edits retain exact body/values; the existing YAML writer normalizes flow-collection padding.");
    await click('[data-metadata-property-action="add"]');
    await wait(`document.querySelector('${propertyDialog} [data-property-field="name"]')?.value===""`, "real add-property dialog");
    await press("Escape", "Escape", 27);
    await wait(`!document.querySelector('${propertyDialog}')`, "inline add-property cancellation");
    assert.deepEqual(await readFile(join(directory, "Reported plugins.md")), editedNote, "Cancelling Add must retain every byte after the explicit property edits.");
    await evaluate('app.markdownView.setEditingMode("source")');
    assert.equal(await evaluate("app.markdownView.metadataEditor.contentEl.getClientRects().length"), 0, "Raw Source must hide the inline property panel.");
    Object.assign(report.reportedPlugins.helpers, { inlinePropertyEditing: true, inlinePropertyCancellation: true, dataviewObservesPropertyWrites: true, exactPropertyWriteBytes: true, cancelledAddPreservesExactBytes: true });
    pass("The shared SDK executes actual editor state/mode fields, metadata rows, unavailable-core entries, sanitized/delegated DOM, settings controls, nested-file reveal, Moment/version/icons, the lazy Mermaid parser and real timers.");
    pass("Actual inline property dialogs save through guarded file operations, refresh real Dataview pages, preserve note content with the existing YAML formatting and cancel without writing.");
  }
  await evaluate(`(()=>{
    globalThis.reportedPluginWorkers=[];
    globalThis.reportedPluginWorkerPolicy=[];
    globalThis.reportedPluginWorkerPolicyListener=event=>reportedPluginWorkerPolicy.push({directive:event.effectiveDirective,blockedURI:event.blockedURI,disposition:event.disposition});
    document.addEventListener("securitypolicyviolation",reportedPluginWorkerPolicyListener);
    globalThis.reportedPluginOriginalWorker=window.Worker;
    window.Worker=class extends reportedPluginOriginalWorker{
      constructor(url,options){
        super(url,options);
        const record={url:String(url).slice(0,500),messages:0,errors:[]};reportedPluginWorkers.push(record);
        this.addEventListener("message",()=>record.messages++);
        this.addEventListener("error",event=>record.errors.push({message:event.message,filename:event.filename}));
      }
    };
    globalThis.reportedPluginLoadErrors={};
    globalThis.reportedPluginOriginalEnable=app.plugins.enable;
    app.plugins.enable=async function(id){
      try{return await reportedPluginOriginalEnable.call(this,id)}
      catch(error){reportedPluginLoadErrors[id]={message:error.message,stack:error.stack};throw error}
    };
  })()`);
  const failures = [];
  async function closeSettings() {
    if (await evaluate('document.querySelector("#settings-dialog").open')) { await click(".settings-close"); }
    for (let count = 0; count < 5 && await evaluate('Boolean(document.querySelector(".modal-container"))'); count++) {
      await press("Escape", "Escape", 27);
    }
    assert.equal(await evaluate('Boolean(document.querySelector(".modal-container"))'), false, "Plugin first-run dialogs must close through actual keyboard handlers.");
  }
  try {
    for (const result of report.reportedPlugins.releases) {
      const id = result.id;
      try {
        result.phase = "enabling";
        const viewTypesBefore = await evaluate("Object.keys(app.viewRegistry.viewByType)");
        await click("#open-settings");
        await click("#community-plugins-tab");
        if (!await evaluate(`Boolean(app.plugins.getPlugin(${JSON.stringify(id)}))`)) { await click(`[data-toggle-plugin="${id}"]`); }
        await wait(`(()=>{const card=document.querySelector('.plugin-card[data-plugin-id="${id}"]');return !app.plugins.isManaging&&(card?.dataset.loaded==="true"||Boolean(card?.querySelector(".plugin-error")?.textContent))})()`, id + " enable completion or visible error");
        result.startupError = await evaluate(`globalThis.reportedPluginLoadErrors[${JSON.stringify(id)}]??null`);
        const state = await evaluate(`(()=>{const card=document.querySelector('.plugin-card[data-plugin-id="${id}"]');return{loaded:card.dataset.loaded,error:card.querySelector(".plugin-error")?.textContent}})()`);
        assert.equal(state.loaded, "true", `${id}: ${state.error}`);
        assert.equal(await evaluate(`app.plugins.plugins["${id}"]._loaded`), true);
        result.phase = "asynchronous-startup";
        if (id === "dataview") {
          await wait('app.plugins.plugins.dataview.index.initialized', "actual Dataview initial file indexing");
          assert.equal(await evaluate('app.plugins.plugins.dataview.api.page("Reported plugins.md").status'), "ready");
          result.indexedFixture = "Reported plugins.md";
        }
        if (id === "metadata-menu") {
          await wait('app.plugins.plugins["metadata-menu"].launched||Boolean(document.querySelector("#client-errors").textContent)', "actual Metadata Menu initial indexing and commands");
          assert.equal(await evaluate('app.plugins.plugins["metadata-menu"].launched'), true, await evaluate('document.querySelector("#client-errors").textContent'));
        }
        if (id === "obsidian-excalidraw-plugin") {
          await wait(`app.plugins.plugins["${id}"].isReady&&app.plugins.plugins["${id}"].settingsReady||Boolean(document.querySelector("#client-errors").textContent)`, "unchanged Excalidraw 2.22.3 asynchronous readiness");
          assert.equal(await evaluate(`app.plugins.plugins["${id}"].isReady&&app.plugins.plugins["${id}"].settingsReady`), true);
        }
        result.commands = await evaluate(`app.commands.listCommands().filter(item=>item.id.startsWith("${id}:")).map(item=>item.id)`);
        result.registeredViewTypes = (await evaluate("Object.keys(app.viewRegistry.viewByType)")).filter(type => !viewTypesBefore.includes(type));
        assert.ok(result.commands.length > 0, id + " must register its actual commands.");
        result.startup = "passed";
        result.phase = "settings";
        await click(`[data-open-plugin-settings="${id}"]`);
        await wait(`document.querySelector("#desktop-shell").getAttribute("aria-busy")==="false"&&(app.settingsTabs.get("${id}").containerEl.isConnected&&app.settingsTabs.get("${id}").containerEl.childElementCount>0||Boolean(document.querySelector(".error-banner")?.textContent?.trim()))`, id + " actual completed settings controls");
        result.settings = await evaluate(`({text:app.settingsTabs.get("${id}").containerEl.textContent.slice(0,1600),controls:app.settingsTabs.get("${id}").containerEl.querySelectorAll("input,button,select,textarea").length,error:document.querySelector("#client-errors").textContent,hostError:document.querySelector(".error-banner")?.textContent?.trim()??"",notices:[...document.querySelectorAll(".notice")].map(node=>node.textContent)})`);
        assert.equal(result.settings.error, "", JSON.stringify(result.settings));
        assert.equal(result.settings.hostError, "", JSON.stringify(result.settings));
        result.status = "passed-startup-settings";
        pass(`Unchanged ${id} ${result.version} enables through Settings and displays its real settings and commands.`);
      } catch (error) {
        result.status = "failed";
        result.error = error.stack ?? String(error);
        if (id === "dataview") {
          result.indexDiagnostics = await evaluate(`(()=>{const index=app.plugins.plugins.dataview?.index;return index?{initialized:index.initialized,pages:[...index.pages.keys()],workers:index.importer.workers.length,busy:index.importer.busy,queued:index.importer.reloadQueue.map(file=>file.path),pending:[...index.importer.callbacks.keys()],observedWorkers:reportedPluginWorkers,policyViolations:reportedPluginWorkerPolicy}:null})()`);
        }
        failures.push(error);
        console.error(`FAIL ${id} ${result.version}: ${error.message}`);
      }
      await closeSettings();
    }
    try {
      const originalNote = await readFile(join(directory, "Reported plugins.md"));
      report.reportedPlugins.navigation = { status: "in-progress" };
      await evaluate(`app.openFile(${JSON.stringify(navigationPath)})`);
      await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(navigationPath)}&&app.workspace.activeLeaf.view.getViewType()==="markdown"`, "ordinary App.openFile after all six plugins are enabled");
      await click('[data-note-path="Reported plugins.md"]');
      await wait('app.workspace.getActiveFile()?.path==="Reported plugins.md"&&app.workspace.activeLeaf.view.getViewType()==="markdown"', "actual File explorer return with all plugins enabled");
      await evaluate(`app.workspace.activeLeaf.openFile(app.vault.getFileByPath(${JSON.stringify(navigationPath)}))`);
      await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(navigationPath)}&&app.workspace.activeLeaf.view.getViewType()==="markdown"`, "ordinary WorkspaceLeaf.openFile with the real Excalidraw wrapper installed");
      await click('[data-note-path="Reported plugins.md"]');
      await wait('app.workspace.getActiveFile()?.path==="Reported plugins.md"&&app.workspace.activeLeaf.view.getViewType()==="markdown"', "normal note restored after both file-opening APIs");
      assert.deepEqual(await readFile(join(directory, navigationPath)), navigationBytes);
      assert.deepEqual(await readFile(join(directory, "Reported plugins.md")), originalNote);
      assert.equal(await evaluate('document.querySelector("#client-errors").textContent'), "");
      report.reportedPlugins.navigation = { status: "passed", appOpenFile: true, leafOpenFile: true, actualFileExplorer: true, allSixEnabled: await evaluate("Object.keys(app.plugins.plugins).filter(id=>" + JSON.stringify(releases.map(release => release.id)) + ".includes(id)).length"), exactBothNoteBytes: true };
      assert.equal(report.reportedPlugins.navigation.allSixEnabled, releases.length);
      pass("With all six unchanged plugins enabled, ordinary App/WorkspaceLeaf opening and real File explorer navigation work without Excalidraw metadata errors or rewriting either note.");
    } catch (error) {
      report.reportedPlugins.navigation = { status: "failed", error: error.stack ?? String(error) };
      failures.push(error);
      console.error("FAIL Ordinary note navigation with all plugins: " + error.message);
    }
    try {
      await checkHelpers();
    } catch (error) {
      report.reportedPlugins.helpersError = error.stack ?? String(error);
      failures.push(error);
      console.error("FAIL Shared SDK interactions: " + error.message);
      await closeSettings();
    }
    await delay(1500);
    for (const result of [...report.reportedPlugins.releases].reverse()) {
      const id = result.id;
      if (!await evaluate(`Boolean(app.plugins.plugins["${id}"])`)) { continue; }
      try {
        await click("#open-settings");
        await click("#community-plugins-tab");
        await click(`[data-toggle-plugin="${id}"]`);
        await wait(`!app.plugins.isManaging&&!app.plugins.plugins["${id}"]`, id + " owned disable completion");
        assert.equal(await evaluate(`app.plugins.enabledPlugins.has("${id}")||app.plugins.getPlugin("${id}")!==null||app.settingsTabs.has("${id}")||app.commands.listCommands().some(item=>item.id.startsWith("${id}:"))||Boolean(document.querySelector('style[data-plugin-id="${id}"]'))`), false, id + " must remove owned registrations.");
        assert.equal(await evaluate(`${JSON.stringify(result.registeredViewTypes ?? [])}.some(type=>Object.hasOwn(app.viewRegistry.viewByType,type))`), false, id + " must remove its actual view factories.");
        result.cleanup = "passed";
      } catch (error) {
        result.cleanup = { error: error.stack ?? String(error) };
        failures.push(error);
        console.error(`FAIL ${id} cleanup: ${error.message}`);
      }
      await closeSettings();
    }
    report.reportedPlugins.consoleErrors = readConsoleErrors().slice(consoleStart);
    report.reportedPlugins.workers = await evaluate("reportedPluginWorkers");
    report.reportedPlugins.workerPolicyViolations = await evaluate("reportedPluginWorkerPolicy");
    const workerFailures = report.reportedPlugins.workers.flatMap(worker => worker.errors.map(error => ({ url: worker.url, ...error })));
    if (workerFailures.length) { failures.push(new Error("Actual plugin workers failed: " + JSON.stringify(workerFailures))); }
    if (report.reportedPlugins.consoleErrors.length) { failures.push(new Error("Plugin startup/settings/cleanup emitted console errors: " + report.reportedPlugins.consoleErrors.join("\n"))); }
    for (const release of releases) {
      await verifyAssets(join(directory, ".obsidian", "plugins", release.id), release);
    }
    if (!failures.length) { pass("All six unchanged releases remove their owned commands, settings and styles when disabled, without startup/settings/cleanup console errors."); }
    try {
      const storage = await evaluate(`(()=>{
      const key="reported-plugin-contract-"+crypto.randomUUID();
      app.saveLocalStorage(key,false);
      if(app.loadLocalStorage(key)!==false)throw new Error("Vault-local storage must retain falsy values.");
      app.saveLocalStorage(key,{status:"persisted",nested:[0,false]});
      const detached=app.loadLocalStorage(key);detached.nested.push("must not persist");
      if(app.loadLocalStorage(key).nested.length!==2)throw new Error("Stored JSON must not alias returned objects.");
      try{app.saveLocalStorage(key,undefined);throw new Error("An unserializable value was accepted.");}
      catch(error){if(!(error instanceof TypeError))throw error;}
      if(app.loadLocalStorage(key).status!=="persisted")throw new Error("A rejected save must retain the previous value.");
      return{key,appId:app.appId};
    })()`);
      await evaluate("app.workspace.flushLayout()");
      if (restart) { await restart(); } else { await command("Page.reload"); }
      await afterReload();
      assert.deepEqual(await evaluate(`({appId:app.appId,value:app.loadLocalStorage(${JSON.stringify(storage.key)})})`), { appId: storage.appId, value: { status: "persisted", nested: [0, false] } });
      await evaluate(`app.saveLocalStorage(${JSON.stringify(storage.key)},null)`);
      assert.equal(await evaluate(`app.loadLocalStorage(${JSON.stringify(storage.key)})`), null);
      report.reportedPlugins.vaultLocalStorage = { falsyValues: true, detachedJson: true, rejectedSavePreservesValue: true, persistedThroughRestart: true, nullRemovesEntry: true };
      pass("Real vault-local storage preserves falsy/detached JSON, rejects invalid saves without replacement and persists through restart/reconnect.");
    } catch (error) {
      report.reportedPlugins.vaultLocalStorage = { status: "failed", error: error.stack ?? String(error) };
      failures.push(error);
      console.error("FAIL Vault-local storage: " + error.message);
    }
    if (failures.length) { throw new AggregateError(failures, "Reported plugin startup/settings/persistence failures; inspect the per-plugin report."); }
  } finally {
    await evaluate("if(globalThis.reportedPluginOriginalWorker){window.Worker=globalThis.reportedPluginOriginalWorker;delete globalThis.reportedPluginOriginalWorker;delete globalThis.reportedPluginWorkers;document.removeEventListener('securitypolicyviolation',globalThis.reportedPluginWorkerPolicyListener);delete globalThis.reportedPluginWorkerPolicyListener;delete globalThis.reportedPluginWorkerPolicy}if(globalThis.reportedPluginOriginalEnable){app.plugins.enable=globalThis.reportedPluginOriginalEnable;delete globalThis.reportedPluginOriginalEnable;delete globalThis.reportedPluginLoadErrors}");
  }
}
