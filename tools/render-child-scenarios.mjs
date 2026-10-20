import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCommunityPluginConfiguration, setCommunityPluginEnabled } from "./community-plugin-test-helpers.mjs";
import { lucideIconAliases } from "../client/lucide-icon-aliases.ts";

const probeId = "render-child-lifecycle-probe", admonitionId = "obsidian-admonition";
const source = String.raw`
const { Plugin, Component, MarkdownRenderer, MarkdownRenderChild } = require("obsidian");
module.exports = class extends Plugin {
  onload() {
    const state = globalThis.renderChildProbe = { loaded: 0, unloaded: 0, clicks: 0, unloadResolvers: [] };
    class Child extends MarkdownRenderChild {
      onload() { state.loaded++; this.registerDomEvent(this.containerEl, "click", () => state.clicks++); }
      unload() { super.unload(); }
      async onunload() {
        if (state.deferUnload) await new Promise(resolve => state.unloadResolvers.push(resolve));
        state.unloaded++;
      }
    }
    this.registerMarkdownCodeBlockProcessor("owned-replacement", async (source, element, context) => {
      const replacement = document.createElement("div");
      replacement.className = "owned-replacement";
      const button = replacement.createEl("button", { text: "Owned replacement" });
      state.button = button;
      context.addChild(new Child(button));
      context.addChild(new Child(replacement));
      if (source === "never inserted") return;
      if (state.deferConstruction) await new Promise(resolve => state.finishConstruction = resolve);
      element.replaceWith(replacement);
    });
    state.newOwner = async () => {
      state.owner = this.addChild(new Component()); await state.owner.load();
      state.target = document.body.createDiv({ attr: { "data-render-child-probe": "" } });
      state.owner.register(() => state.target.remove());
    };
    state.render = text => MarkdownRenderer.render(this.app, text, state.target, "Render ownership/Probe.md", state.owner);
  }
};
`;

export async function checkRenderChildOwnership(tools) {
  const { directory, evaluate, command, click, wait, report, restart, afterReload } = tools;
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const communityPath = join(directory, ".obsidian", "community-plugins.json");
  const community = await readFile(communityPath);
  const layout = await evaluate("app.workspace.getLayout()");
  const probe = join(directory, ".obsidian", "plugins", probeId);
  await mkdir(probe, { recursive: true });
  await writeFile(join(probe, "manifest.json"), JSON.stringify({ id: probeId, name: "Render child lifecycle probe", version: "1.0.0", description: "Detached Markdown replacement and asynchronous ownership fixture", isDesktopOnly: false }));
  await writeFile(join(probe, "main.js"), source);
  const packageSource = fileURLToPath(new URL("../Example/.obsidian/plugins/obsidian-admonition/", import.meta.url));
  const packageTarget = join(directory, ".obsidian", "plugins", admonitionId);
  await mkdir(packageTarget, { recursive: true });
  const immutable = [];
  for (const file of ["main.js", "manifest.json", "styles.css", "data.json"]) {
    const bytes = await readFile(join(packageSource, file));
    await writeFile(join(packageTarget, file), bytes);
    if (file !== "data.json") immutable.push({ file, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  const note = "Render ownership/Admonition.md", target = "Render ownership/Target.md";
  const markdown = ["# Fenced admonitions", "", "```ad-workshop-decision", "title: Choose **the route**", "collapse: open", "",
    "A **recorded decision** with [[Target|source context]].", "```", "", "```ad-workshop-risk", "title: Risk review", "collapse: closed", "",
    "Track the courtyard condition.", "```", ""].join("\r\n");
  const original = Buffer.from("\ufeff" + markdown);
  const stylesNote = "Render ownership/Callout styles.md";
  const stylesOriginal = Buffer.from("\ufeff" + ["# Callout styles", "", "> [!workshop-decision] Decision", "> A green decision.", "",
    "> [!workshop-risk] Risk", "> A red risk.", "", "> [!workshop-experiment] Experiment", "> A purple experiment.", "",
    "> [!warning] Legacy warning", "> Existing orange components.", "", "> [!note] Default note", "> Existing blue components.", ""].join("\r\n"));
  await mkdir(join(directory, "Render ownership"), { recursive: true });
  await writeFile(join(directory, note), original);
  await writeFile(join(directory, stylesNote), stylesOriginal);
  await writeFile(join(directory, target), "# Source context\n\nA linked source note.\n");
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const reload = async () => { if (restart) await restart(); else await command("Page.reload"); await afterReload(); };
  await reload();
  const toggle = async (id, enabled) => { await setCommunityPluginEnabled(tools, id, enabled); await click(".settings-close"); };
  await toggle(probeId, true);

  await evaluate('renderChildProbe.newOwner()');
  await evaluate('renderChildProbe.deferConstruction=true;renderChildProbe.pending=renderChildProbe.render("```owned-replacement\\nconstruct\\n```");true');
  await wait("typeof renderChildProbe.finishConstruction==='function'", "detached replacement children registered");
  await evaluate('(async()=>{document.body.createDiv().remove();await new Promise(resolve=>setTimeout(resolve,0));return true})()');
  assert.deepEqual(await evaluate('({loaded:renderChildProbe.loaded,unloaded:renderChildProbe.unloaded})'), { loaded: 2, unloaded: 0 });
  await evaluate('renderChildProbe.finishConstruction();renderChildProbe.pending');
  await wait('Boolean(document.querySelector(".owned-replacement button"))', "replacement inserted after real mutation delivery");
  await evaluate('renderChildProbe.button.click();true');
  assert.equal(await evaluate("renderChildProbe.clicks"), 2);
  await evaluate('renderChildProbe.deferUnload=true;renderChildProbe.target.firstElementChild.remove();true');
  await wait("renderChildProbe.unloadResolvers.length===2", "removed children begin asynchronous native-style unload");
  await evaluate('renderChildProbe.disposeDone=false;renderChildProbe.disposing=renderChildProbe.owner.unloadAndWait().then(()=>{renderChildProbe.disposeDone=true});true');
  await evaluate('(async()=>{await new Promise(resolve=>setTimeout(resolve,0));return true})()');
  assert.equal(await evaluate("renderChildProbe.disposeDone"), false);
  await evaluate('renderChildProbe.unloadResolvers.forEach(resolve=>resolve());renderChildProbe.disposing');
  assert.equal(await evaluate("renderChildProbe.unloaded"), 2);
  await evaluate('renderChildProbe.button.click();true');
  assert.equal(await evaluate("renderChildProbe.clicks"), 2);
  await evaluate('renderChildProbe.deferUnload=false;renderChildProbe.newOwner()');
  await evaluate('renderChildProbe.render("```owned-replacement\\nnever inserted\\n```")');
  assert.deepEqual(await evaluate('({loaded:renderChildProbe.loaded,unloaded:renderChildProbe.unloaded})'), { loaded: 4, unloaded: 4 });
  await toggle(probeId, false);
  pass("Real detached title/wrapper children survive async construction and mutation delivery, become owned after replacement, unload if never inserted, and dispose waits for observer-started async native-style teardown; retained controls stop acting.");

  await toggle(admonitionId, true);
  assert.equal(await evaluate(`app.plugins.getPlugin('${admonitionId}').manifest.version`), "12.0.11");
  await evaluate(`app.openFile(${JSON.stringify(note)},"tab")`);
  const mode = async value => evaluate(`(async()=>{const leaf=app.workspace.activeLeaf;await leaf.setViewState({type:"markdown",state:{...leaf.getViewState().state,mode:${JSON.stringify(value)},source:true}})})()`);
  const rendered = () => wait('document.querySelectorAll(".workspace-tabs.mod-active .workspace-leaf:not([hidden]) .view-content .admonition").length===2&&Boolean(document.querySelector(".workspace-tabs.mod-active .workspace-leaf:not([hidden]) .view-content .admonition-title strong"))', "unchanged Admonition fenced title/body rendering");
  await mode("preview"); await rendered();
  const details = await evaluate('Array.from(document.querySelectorAll(".workspace-tabs.mod-active .workspace-leaf:not([hidden]) .view-content .admonition")).map(el=>{const title=el.querySelector(".callout-title"),svg=el.querySelector(".callout-icon svg"),box=svg?.getBBox();return {text:el.textContent,color:getComputedStyle(el).getPropertyValue("--callout-color").trim(),icons:el.querySelectorAll(".callout-icon svg").length,collapsed:el.classList.contains("is-collapsed"),background:getComputedStyle(el).backgroundColor,titleColor:getComputedStyle(title).color,iconSize:svg?{width:svg.getBoundingClientRect().width,height:svg.getBoundingClientRect().height}:null,iconGeometry:box?{width:box.width,height:box.height}:null,iconStroke:svg?getComputedStyle(svg).stroke:null}})');
  assert.match(details[0].text, /Choose the route/); assert.match(details[0].text, /recorded decision/);
  assert.equal(new Set(details.map(detail => detail.color)).size, 2);
  assert.ok(details.every(detail => detail.icons > 0));
  assert.deepEqual(details.map(detail => detail.collapsed), [false, true]);
  assert.deepEqual(details.map(detail => detail.titleColor), ["rgb(52, 168, 83)", "rgb(218, 83, 83)"]);
  assert.ok(details.every(detail => detail.background !== "rgba(0, 0, 0, 0)" && detail.iconGeometry.width > 0 && detail.iconGeometry.height > 0));
  assert.deepEqual(details.map(detail => detail.iconStroke), ["rgb(52, 168, 83)", "rgb(218, 83, 83)"]);
  await click('.workspace-tabs.mod-active .workspace-leaf:not([hidden]) .view-content .admonition[data-callout="workshop-risk"] .callout-title');
  await wait('!document.querySelector(\'.workspace-tabs.mod-active .workspace-leaf:not([hidden]) .view-content .admonition[data-callout="workshop-risk"]\').classList.contains("is-collapsed")', "actual plugin collapse listener opens risk");
  const screenshot = await command("Page.captureScreenshot", { format: "png" });
  await writeFile(fileURLToPath(new URL(`../.runtime/evidence/admonition-${restart ? "desktop" : "web"}.png`, import.meta.url)), Buffer.from(screenshot.data, "base64"));
  await click('.workspace-tabs.mod-active .workspace-leaf:not([hidden]) .view-content .admonition a[data-slopsidian-link="Target"]');
  await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(target)}`, "actual fenced source-relative link");
  await evaluate(`app.openFile(${JSON.stringify(note)},"tab")`); await mode("preview"); await rendered();
  await mode("source");
  await wait('!document.querySelector(".workspace-tabs.mod-active .workspace-leaf:not([hidden]) .view-content .admonition")', "source transition removes replacement tree");
  await mode("preview"); await rendered();
  await toggle(admonitionId, false);
  await wait('Boolean(document.querySelector("code.language-ad-workshop-decision"))&&!document.querySelector(".workspace-tabs.mod-active .workspace-leaf:not([hidden]) .view-content .admonition")', "disable restores original fenced source");
  await toggle(admonitionId, true); await rendered();
  pass("Unchanged Admonition 12.0.11 renders fenced titles/body Markdown, distinct painted backgrounds/titles and nonempty colored icon geometry, working collapse and source-relative links; Source/Reading and disable/re-enable rebuild output. Full visual equivalence remains separate.");

  const styleEvidence = await checkCalloutStyles({ ...tools, stylesNote, note, mode, rendered });

  const enabled = await readFile(communityPath);
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  await reload(); await rendered();
  assert.deepEqual(await readFile(communityPath), enabled);
  // Exercise the same real package through static MarkdownRenderer as well.
  await evaluate(`(async()=>{const api=app.plugins.modules.obsidian;globalThis.admonitionStaticOwner=new api.Component();await admonitionStaticOwner.load();globalThis.admonitionStaticTarget=document.body.createDiv({attr:{"data-static-admonition":""}});await api.MarkdownRenderer.render(app,${JSON.stringify(markdown)},admonitionStaticTarget,${JSON.stringify(note)},admonitionStaticOwner);return true})()`);
  await wait('document.querySelectorAll("[data-static-admonition] .admonition").length===2&&Boolean(document.querySelector("[data-static-admonition] .admonition-content strong"))', "actual Admonition static render");
  await evaluate('admonitionStaticOwner.unloadAndWait()');
  assert.equal(await evaluate('admonitionStaticTarget.querySelector(".markdown-renderer-fragment").childElementCount'), 0);
  assert.equal(await evaluate('admonitionStaticTarget.textContent'), "");
  await evaluate('admonitionStaticTarget.remove();true');
  await toggle(admonitionId, false);
  await evaluate(`app.workspace.changeLayout(${JSON.stringify(layout)},false)`);
  for (const item of immutable) {
    assert.equal(createHash("sha256").update(await readFile(join(packageSource, item.file))).digest("hex"), item.sha256);
    assert.equal(createHash("sha256").update(await readFile(join(packageTarget, item.file))).digest("hex"), item.sha256);
  }
  assert.deepEqual(await readFile(join(directory, note)), original);
  assert.deepEqual(await readFile(join(directory, stylesNote)), stylesOriginal);
  await assertCommunityPluginConfiguration(communityPath, community, { [probeId]: false, [admonitionId]: false });
  assert.equal(await evaluate('document.querySelector("#client-errors").textContent'), "");
  report.renderChildOwnership = { package: "Admonition 12.0.11", immutable, details, noteBytesPreserved: true, nativeStyleAsyncUnload: true,
    calloutStyles: styleEvidence,
    scope: "Reading/static fenced custom admonitions, detached construction and lifecycle; full Live Preview, private ABI and all Admonition commands remain unestablished" };
  pass("Configured Admonition survives full restart/reconnect, also renders through the actual static MarkdownRenderer API, and cleans static fragments on owner unload; note BOM/CRLF, supplied package bytes and unrelated enabled plugin IDs are preserved.");
}

async function checkCalloutStyles({ evaluate, command, click, wait, report, restart, stylesNote, note, mode, rendered }) {
  const shell = await readFile(fileURLToPath(new URL('../src/RonSijm.Slopsidian/wwwroot/icons.svg',import.meta.url)),'utf8');
  const shellIds = [...shell.matchAll(/<symbol id="([^"]+)"/g)].map(match => match[1]);
  const aliases = Object.entries(lucideIconAliases).filter(([name]) => !shellIds.includes(name));
  const catalog = await evaluate(`(()=>{
    const api=app.plugins.modules.obsidian,ids=api.getIconIds(),missing=[];
    for(const id of ids){const svg=api.getIcon(id);if(!svg?.querySelector("path,circle,ellipse,line,polyline,polygon,rect"))missing.push(id)}
    const aliases=${JSON.stringify(aliases)};
    for(const [old,id]of aliases)if(api.getIcon(old)?.outerHTML!==api.getIcon(id)?.outerHTML)throw Error('Icon alias mismatch '+old);
    if(api.getIcon('missing-lucide-catalog-icon')!==null)throw Error('Unknown icons must remain unknown');
    const first=api.getIcon('flask-conical');first.replaceChildren();
    if(!api.getIcon('flask-conical').firstElementChild)throw Error('Icon templates must not alias returned SVGs');
    return {registered:ids.length,missing,aliases};
  })()`);
  assert.ok(catalog.registered >= 1544); assert.deepEqual(catalog.missing, []);
  // A plugin-owned icon must survive style changes without being replaced.
  assert.equal(await evaluate(`(async()=>{const block=document.querySelector('.workspace-tabs.mod-active .workspace-leaf:not([hidden]) .view-content .admonition'),svg=block.querySelector('.callout-icon svg');block.style.setProperty('--callout-color','#336699');await new Promise(resolve=>setTimeout(resolve,0));const same=block.querySelector('.callout-icon svg')===svg&&getComputedStyle(svg).stroke==='rgb(51, 102, 153)';block.style.removeProperty('--callout-color');return same})()`), true);
  await evaluate(`app.openFile(${JSON.stringify(stylesNote)},"tab")`); await mode("preview");
  await wait('document.querySelectorAll(".workspace-tabs.mod-active .workspace-leaf:not([hidden]) .view-content .callout").length===5', "native custom callout colors and host-owned CSS icons");
  const values = () => evaluate(`Array.from(document.querySelectorAll('.workspace-tabs.mod-active .workspace-leaf:not([hidden]) .view-content .callout')).map(el=>({type:el.dataset.callout,background:getComputedStyle(el).backgroundColor,title:getComputedStyle(el.querySelector('.callout-title')).color,icon:el.querySelector('[data-slopsidian-callout-icon]')?.dataset.slopsidianCalloutIcon,modern:el.hasAttribute('data-slopsidian-color-value')}))`);
  const initial = await values();
  assert.deepEqual(initial.map(value => value.title), ['rgb(52, 168, 83)','rgb(218, 83, 83)','rgb(124, 107, 214)','rgb(233, 151, 63)','rgb(8, 109, 221)']);
  assert.deepEqual(initial.slice(0,3).map(value => value.icon), ['check-circle','alert-triangle','flask-conical']);
  assert.deepEqual(initial.map(value => value.modern), [true,true,true,false,false]);
  assert.ok(initial.every(value => value.background !== 'rgba(0, 0, 0, 0)'));
  const screenshot = await command('Page.captureScreenshot',{format:'png'});
  await writeFile(fileURLToPath(new URL(`../.runtime/evidence/callout-styles-${restart?'desktop':'web'}.png`,import.meta.url)),Buffer.from(screenshot.data,'base64'));
  await evaluate(`(()=>{globalThis.retainedStyledCallout=document.querySelector('.workspace-tabs.mod-active .workspace-leaf:not([hidden]) .view-content [data-callout="workshop-decision"]');retainedStyledCallout.style.setProperty('--callout-color','91, 123, 177');return true})()`);
  await wait('!retainedStyledCallout.hasAttribute("data-slopsidian-color-value")&&getComputedStyle(retainedStyledCallout.querySelector(".callout-title")).color==="rgb(91, 123, 177)"', 'complete-color callout changes to legacy RGB');
  await evaluate('retainedStyledCallout.style.setProperty("--callout-color","#336699");true');
  await wait('retainedStyledCallout.hasAttribute("data-slopsidian-color-value")&&getComputedStyle(retainedStyledCallout.querySelector(".callout-title")).color==="rgb(51, 102, 153)"', 'legacy callout changes to complete CSS color');
  await evaluate(`(()=>{const nested=retainedStyledCallout.createDiv({cls:'callout',attr:{'data-callout':'warning'}});nested.createDiv({cls:'callout-title',text:'Nested legacy warning'});return true})()`);
  await wait('getComputedStyle(retainedStyledCallout.querySelector(\'.callout[data-callout="warning"] > .callout-title\')).color==="rgb(233, 151, 63)"', 'nested legacy title retains its own color');
  await mode('source');
  await evaluate('retainedStyledCallout.style.setProperty("--callout-color","23, 45, 67");true');
  await evaluate('(async()=>{await new Promise(resolve=>setTimeout(resolve,0));return true})()');
  assert.equal(await evaluate('retainedStyledCallout.hasAttribute("data-slopsidian-color-value")'),true,'Disposed callouts must not retain style observers.');
  await mode('preview');
  await wait('document.querySelectorAll(".workspace-tabs.mod-active .workspace-leaf:not([hidden]) .view-content .callout").length===5', 'rerender restores source callouts');
  assert.deepEqual(await values(), initial);
  await evaluate(`app.openFile(${JSON.stringify(note)},"tab")`); await mode('preview'); await rendered();
  report.checks.push('The full local icon catalog has real clone-owned vector geometry and legacy aliases; native custom callouts use CSS-selected icons, both color formats update without overwriting plugin styles or icons, nested legacy colors stay independent, and rerender disposes old style observers without changing note bytes.');
  console.log('PASS '+report.checks.at(-1));
  return {catalog,initial,dynamicLegacyAndComplete:true,nestedLegacy:true,disposedObserver:true};
}
