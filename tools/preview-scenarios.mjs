import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function checkPagePreviews({ directory, evaluate, command, click, press, wait, afterReload, restart, capture, report }) {
  const folder = "Preview workflows";
  const source = folder + "/Source.md";
  const target = folder + "/Target note.md";
  const image = folder + "/Image.png";
  const configuration = join(directory, ".obsidian", "page-preview.json");
  const pluginId = "page-preview-probe";
  const sourceText = `# Hover source\r\n\r\n[[${target.replace(/\.md$/, "")}#Details|Heading preview]]\r\n\r\n[[${target.replace(/\.md$/, "")}#^preview-block|Block preview]]\r\n\r\n[Encoded preview](./Target%20note.md#Details)\r\n\r\n[[${folder}/Missing|Missing preview]]\r\n\r\n\`[[${target}]]\`\r\n`;
  const targetText = "---\r\naliases: [Preview alias]\r\n---\r\n# Preview target\r\n\r\n" + Array.from({ length: 40 }, (_, index) => `Padding paragraph ${index}.\r\n\r\n`).join("")
    + `## Details\r\n\r\n**Real target content** ![[${image}]]\r\n\r\nPreview block content. ^preview-block\r\n\r\n<script>globalThis.previewExecuted=true</script>\r\n`;
  const initial = { editor: true, preview: false, "preview-probe": false, futureSetting: { keep: [true, 42] } };
  const popup = ".page-preview-popover:popover-open";
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const accept = id => {
    if (report.coreChecks) {
      assert.ok(!report.coreChecks.some(test => test.id === id), "Duplicate Page preview observation: " + id);
      report.coreChecks.push({ id, status: "passed" });
    }
  };
  let sourceId;
  const pane = () => `[data-leaf-id="${sourceId}"]`;
  const link = text => `${pane()} [data-slopsidian-link="${text}"]`;
  async function reload() {
    await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
    if (restart) { await restart(); } else { await command("Page.reload"); }
    await afterReload();
  }
  async function settings() {
    if (!await evaluate('document.querySelector("#settings-dialog").open')) { await click("#open-settings"); }
    await click("#core-plugins-tab");
    if (await evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await click("#core-settings-back"); }
  }
  async function toggle(enabled) {
    await settings();
    if (await evaluate('app.core.isEnabled("page-preview")') !== enabled) { await click('[data-core-toggle="page-preview"]'); }
    await wait(`!app.core.busy&&app.core.isEnabled("page-preview")===${enabled}`, "Page preview toggled");
    await click(".settings-close");
  }
  async function hover(selector, modifiers = 0) {
    const point = await evaluate(`(async()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e?.checkVisibility())throw new Error("Hover target is hidden: "+${JSON.stringify(selector)});e.scrollIntoView({block:"nearest",inline:"nearest"});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));for(const b of e.getClientRects()){const left=Math.max(0,b.left),right=Math.min(innerWidth,b.right),top=Math.max(0,b.top),bottom=Math.min(innerHeight,b.bottom);if(right<=left||bottom<=top)continue;const x=(left+right)/2,y=(top+bottom)/2,hit=document.elementFromPoint(x,y);if(hit===e||e.contains(hit))return{x,y}}throw new Error("Hover target has no reachable visible fragment: "+e.outerHTML.slice(0,160))})()`);
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point, modifiers });
  }
  async function editorHover(offset, modifiers = 0) {
    await evaluate(`(async()=>{const cm=app.workspace.getLeafById(${JSON.stringify(sourceId)}).view.editor.cm;cm.dispatch({effects:cm.constructor.scrollIntoView(${offset},{y:"center"})});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))})()`);
    const point = await evaluate(`(()=>{const cm=app.workspace.getLeafById(${JSON.stringify(sourceId)}).view.editor.cm;const p=cm.coordsAtPos(${offset});if(!p)throw new Error("Editor hover position is not visible");const x=p.left+2,y=(p.top+p.bottom)/2;if(!document.elementFromPoint(x,y)?.closest(".cm-content"))throw new Error("Editor hover position is unreachable");return{x,y}})()`);
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point, modifiers });
  }
  async function shown() {
    await wait(`document.querySelector('${popup}[data-preview-state="ready"]')?.dataset.previewPath===${JSON.stringify(target)}`, "actual visible target preview");
  }
  async function dismiss() {
    await press("Escape", "Escape", 27);
    await wait('!document.querySelector(".page-preview-popover")', "dismissed preview removed");
  }
  async function mode(value) {
    await click(`[data-tab-id="${sourceId}"]`);
    await evaluate(`app.workspace.activeLeaf.view.setMode(${JSON.stringify(value)});true`);
  }

  await mkdir(join(directory, folder), { recursive: true });
  await mkdir(join(directory, ".obsidian"), { recursive: true });
  await writeFile(join(directory, source), "\ufeff" + sourceText);
  await writeFile(join(directory, target), "\ufeff" + targetText);
  await writeFile(join(directory, image), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOqkAAAAASUVORK5CYII=", "base64"));
  await writeFile(configuration, "\ufeff" + JSON.stringify(initial, null, 2));
  const pluginDirectory = join(directory, ".obsidian", "plugins", pluginId);
  await mkdir(pluginDirectory, { recursive: true });
  await writeFile(join(pluginDirectory, "manifest.json"), JSON.stringify({ id: pluginId, name: "Page preview probe", version: "1.0.0", description: "Independent hover API acceptance fixture", isDesktopOnly: false }));
  await writeFile(join(pluginDirectory, "main.js"), `
const {Plugin,HoverPopover}=require("obsidian");
module.exports=class extends Plugin {
  onload() {
    this.registerHoverLinkSource("preview-probe",{display:"Preview probe",defaultMod:false});
    const parent={hoverPopover:null};
    const target=this.addStatusBarItem();target.textContent="Hover probe";target.dataset.previewProbe="true";
    this.registerDomEvent(target,"pointermove",event=>this.app.workspace.trigger("hover-link",{event,source:"preview-probe",hoverParent:parent,targetEl:target,linktext:${JSON.stringify(target)},sourcePath:""}));
    this.register(()=>parent.hoverPopover?.unload());
    this.addCommand({id:"own-hover",name:"Open owned hover",callback:()=>{const popover=new HoverPopover(parent,target,0);popover.hoverEl.classList.add("probe-owned-hover");popover.hoverEl.textContent="Plugin-owned popover";this.addChild(popover)}});
  }
};`);
  await reload();
  await toggle(true);
  await evaluate(`(async()=>{await app.openFile(${JSON.stringify(source)},"tab");app.workspace.activeLeaf.view.setMode("preview")})()`);
  sourceId = await evaluate("app.workspace.activeLeaf.id");
  const leafCount = await evaluate("app.workspace.leaves().length");
  await hover(link(target.replace(/\.md$/, "") + "#Details"));
  await shown();
  await wait(`document.querySelector('${popup} img')?.naturalWidth===1`, "actual local image in hover preview");
  assert.equal(await evaluate("globalThis.previewExecuted===true"), false);
  assert.equal(await evaluate("app.current.file.path"), source);
  assert.equal(await evaluate("app.workspace.leaves().length"), leafCount);
  assert.equal(await evaluate(`(()=>{const c=document.querySelector('${popup} .page-preview-content'),h=c.querySelector("h2"),b=c.getBoundingClientRect(),r=h.getBoundingClientRect();return c.scrollTop>0&&r.top>=b.top-1&&r.bottom<=b.bottom})()`), true, "The actual heading is scrolled into the popover viewport");
  await hover(`${popup} h2`);
  await delay(400);
  assert.equal(await evaluate(`Boolean(document.querySelector('${popup}'))`), true, "Moving from a link into its popover retains it");
  await dismiss();
  await hover(link(target.replace(/\.md$/, "") + "#^preview-block"));
  await shown();
  assert.equal(await evaluate(`(()=>{const c=document.querySelector('${popup} .page-preview-content'),p=[...c.querySelectorAll("p")].find(p=>p.textContent.includes("Preview block content")),b=c.getBoundingClientRect(),r=p.getBoundingClientRect();return c.scrollTop>0&&r.top>=b.top-1&&r.bottom<=b.bottom})()`), true, "The block, not the start of the note, is visible");
  await dismiss();
  await hover(`${pane()} a[href="./Target%20note.md#Details"]`);
  await shown();
  await dismiss();
  await hover(link(folder + "/Missing"));
  await wait(`document.querySelector('${popup}[data-preview-state="error"]')?.textContent.includes("does not exist")`, "missing target is explicit without creating a note");
  await dismiss();
  await assert.rejects(readFile(join(directory, folder, "Missing.md")), { code: "ENOENT" });
  assert.equal(await readFile(join(directory, source), "utf8"), "\ufeff" + sourceText);
  pass("Page preview uses real note/heading/block targets and encoded links, scrolls the actual target inside an unclipped popover, retains pointer entry and cleans up dismissal without opening hidden leaves, executing note HTML or changing source bytes.");

  await evaluate(`app.openFile(${JSON.stringify(target)},"split")`);
  await evaluate(`app.editor.setValue(${JSON.stringify(targetText + "\r\n**Unsaved hover target**\r\n")});true`);
  await hover(link(target.replace(/\.md$/, "") + "#Details"));
  await shown();
  assert.match(await evaluate(`document.querySelector('${popup}').textContent`), /Unsaved hover target/);
  assert.equal(await readFile(join(directory, target), "utf8"), "\ufeff" + targetText);
  await evaluate(`app.editor.setValue(${JSON.stringify(targetText + "\r\n**Updated dirty preview**\r\n")});true`);
  await wait(`document.querySelector('${popup}')?.textContent.includes("Updated dirty preview")`, "live unsaved target refresh");
  await evaluate(`app.editor.setValue(${JSON.stringify(targetText)});true`);
  await wait("!app.dirty", "dirty target restored without a disk write");
  await writeFile(join(directory, target), "\ufeff" + targetText + "\r\nExternal hover update.\r\n");
  await wait(`document.querySelector('${popup}')?.textContent.includes("External hover update")`, "real external target refresh");
  await dismiss();
  await writeFile(join(directory, target), "\ufeff" + targetText);
  await wait(`app.editor.getValue()===${JSON.stringify(targetText)}`, "target restored after external refresh");
  pass("An open hover preview follows the real target's unsaved shared buffer and external file changes without saving a dirty target, replacing a source pane or changing its bytes.");

  await mode("source");
  const offset = await evaluate('app.editor.cm.state.doc.toString().indexOf("[[")+4');
  await editorHover(offset);
  await delay(400);
  assert.equal(await evaluate('Boolean(document.querySelector(".page-preview-popover"))'), false);
  await command("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, modifiers: 2 });
  await shown();
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, modifiers: 0 });
  await dismiss();
  await settings();
  await click('[data-core-settings="page-preview"]');
  await click('[data-core-field="editor"]');
  await click('[data-core-field="preview"]');
  await click('[data-core-save="page-preview"]');
  await wait('!app.core.busy&&app.core.state("page-preview").settings.editor===false&&app.core.state("page-preview").settings.preview===true', "hover modifier settings saved");
  await click(".settings-close");
  await editorHover(offset);
  await shown();
  await dismiss();
  const codeOffset = await evaluate('app.editor.cm.state.doc.toString().lastIndexOf("[[")+4');
  await editorHover(codeOffset);
  await delay(400);
  assert.equal(await evaluate('Boolean(document.querySelector(".page-preview-popover"))'), false, "Code spans are not treated as links");
  await mode("preview");
  await hover(link(target.replace(/\.md$/, "") + "#Details"));
  await delay(400);
  assert.equal(await evaluate('Boolean(document.querySelector(".page-preview-popover"))'), false);
  // A modifier-only mouseMoved at unchanged coordinates can produce no pointer
  // event. Press the actual key, as a user hovering this existing link would.
  await command("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, modifiers: 2 });
  await hover(link(target.replace(/\.md$/, "") + "#Details"), 2);
  await shown();
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, modifiers: 0 });
  if (capture) { await capture(); }
  await dismiss();
  accept("page-preview:settings");
  pass("Real editor mouse coordinates and a later Control key show previews; actual settings switch Reading/editor modifier behavior, code spans remain excluded and UTF-8 BOM plus unknown settings survive.");

  await click("#open-settings");
  await click("#community-plugins-tab");
  await click(`[data-toggle-plugin="${pluginId}"]`);
  await wait(`!app.plugins.isManaging&&document.querySelector('.plugin-card[data-plugin-id="${pluginId}"]')?.dataset.loaded==="true"`, "actual hover probe enabled");
  await click(".settings-close");
  await hover("[data-preview-probe]");
  await shown();
  await dismiss();
  await settings();
  await click('[data-core-settings="page-preview"]');
  assert.equal(await evaluate('document.querySelector("[data-core-field=preview-probe]").checked'), false);
  await click(".settings-close");
  await evaluate(`app.commands.execute("${pluginId}:own-hover")`);
  await wait('document.querySelector(".probe-owned-hover:popover-open")?.textContent==="Plugin-owned popover"', "public HoverPopover constructor");
  await click("#open-settings");
  await click("#community-plugins-tab");
  await click(`[data-toggle-plugin="${pluginId}"]`);
  await wait(`!app.plugins.isManaging&&document.querySelector('.plugin-card[data-plugin-id="${pluginId}"]')?.dataset.loaded==="false"&&!document.querySelector(".probe-owned-hover")`, "owned popover and source cleanup");
  assert.equal(await evaluate('Object.hasOwn(app.workspace.hoverLinkSources,"preview-probe")'), false);
  await click(".settings-close");
  await hover(link(target.replace(/\.md$/, "") + "#Details"), 2);
  await shown();
  await toggle(false);
  assert.equal(await evaluate('document.querySelector(".page-preview-popover")'), null);
  await hover(link(target.replace(/\.md$/, "") + "#Details"), 2);
  await delay(400);
  assert.equal(await evaluate('document.querySelector(".page-preview-popover")'), null);
  await toggle(true);
  await reload();
  assert.equal(await evaluate('app.core.state("page-preview").settings.editor'), false);
  assert.equal(await evaluate('app.core.state("page-preview").settings.preview'), true);
  const bytes = await readFile(configuration);
  assert.deepEqual(bytes.subarray(0, 3), Buffer.from([239, 187, 191]));
  assert.deepEqual(JSON.parse(bytes.subarray(3)).futureSetting, initial.futureSetting);
  assert.equal(await readFile(join(directory, source), "utf8"), "\ufeff" + sourceText);
  assert.equal(await readFile(join(directory, target), "utf8"), "\ufeff" + targetText);
  accept("page-preview:hover");
  pass("A real CommonJS probe registers a dynamic hover source and uses the public HoverPopover constructor; disabling removes owned popovers and hooks, and modifier settings/unknown configuration survive an actual restart or folder reconnect.");
  report.pagePreview = { implementation: "independent Markdown subset", originalModuleLoaded: false, arbitraryCustomFilePreviews: "unavailable", privateNativePreviewViews: "unavailable" };
}
