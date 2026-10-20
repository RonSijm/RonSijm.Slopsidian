import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Actual app controls and pixels; this is a UI check, not original-app parity certification. */
export async function checkUiPolish({ evaluate, command, click, press, wait, report }) {
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const directory = join(fileURLToPath(new URL("../", import.meta.url)), ".runtime/evidence");
  const host = await evaluate('document.body.classList.contains("is-browser") ? "web" : "desktop"');
  const images = [];
  await mkdir(directory, { recursive: true });
  async function capture(name) {
    const result = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const path = join(directory, "ui-polish-" + name + "-" + host + ".png");
    await writeFile(path, Buffer.from(result.data, "base64")); images.push(path);
  }
  const viewport = await evaluate("({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio,mobile:false})");
  const right = '[aria-label="Toggle right sidebar"]';
  assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(right)}).length`), 1);
  const rightDisplay = await evaluate('getComputedStyle(document.querySelector("#right-sidebar")).display');
  await click(right);
  await wait(`getComputedStyle(document.querySelector("#right-sidebar")).display!==${JSON.stringify(rightDisplay)}`, "the upper sidebar control changes visibility");
  await click(right);
  await wait(`getComputedStyle(document.querySelector("#right-sidebar")).display===${JSON.stringify(rightDisplay)}`, "the upper sidebar control restores visibility");
  assert.equal(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(right)}),b=e.getBoundingClientRect();return b.top>=0&&b.bottom<=45&&b.left>=0&&b.right<=innerWidth&&!e.closest("#right-sidebar,footer")})()`), true);
  assert.equal(await evaluate('(()=>{const s=document.querySelector("#open-settings svg"),u=s?.querySelector("use");return u?.getAttribute("href")==="lucide-icons.svg#settings"&&getComputedStyle(s).strokeWidth==="2px"})()'), true);
  pass("The single upper right-sidebar toggle remains reachable while collapsed, restores its prior state, and shell settings uses the canonical Lucide sprite and stroke.");

  await press("p", "KeyP", 80, 2);
  await wait('document.querySelector("#desktop-picker")?.open', "actual command palette");
  await command("Input.insertText", { text: "toggle" });
  await wait('document.querySelector("#desktop-picker .suggestion-highlight")', "literal matched command text");
  const palette = await evaluate('(()=>{const p=document.querySelector("#desktop-picker");return {focus:document.activeElement===p.querySelector("input"),stops:[...p.querySelectorAll("[role=option]")].map(e=>e.tabIndex),footer:p.querySelector(".prompt-instructions").textContent,highlights:[...p.querySelectorAll(".suggestion-highlight")].map(e=>e.textContent)}})()');
  assert.equal(palette.focus, true); assert.ok(palette.stops.length); assert.ok(palette.stops.every(value => value === -1));
  assert.doesNotMatch(palette.footer, /create|new tab/i); assert.ok(palette.highlights.every(text => text.length));
  await capture("palette");
  await press("Escape", "Escape", 27); await wait('!document.querySelector("#desktop-picker").open');
  await press("o", "KeyO", 79, 2); await wait('document.querySelector("#desktop-picker").open');
  assert.match(await evaluate('document.querySelector("#desktop-picker .prompt-instructions").textContent'), /new tab/i);
  assert.equal(await evaluate('(()=>{const p=document.querySelector("#desktop-picker");return document.activeElement===p.querySelector("input")&&[...p.querySelectorAll("[role=option]")].every(e=>e.tabIndex===-1)})()'), true);
  await capture("switcher"); await press("Escape", "Escape", 27);
  pass("Real palette and switcher shortcuts open input-focused comboboxes with non-tabbable options, visible match highlighting and mode-correct instructions; Escape closes them.");

  await click("#new-folder"); await wait('document.querySelector("[data-file-dialog=folder]")', "guarded shared folder modal");
  assert.equal(await evaluate('document.activeElement===document.querySelector("[data-file-dialog=folder] input")'), true);
  assert.equal(await evaluate('(()=>{const b=document.querySelector("[data-file-dialog=folder] .modal-close-button");return b?.getAttribute("aria-label")==="Close dialog"&&Boolean(b.querySelector("svg"))&&!b.textContent.trim()})()'), true);
  await capture("modal"); await click('[data-file-dialog=folder] .modal-close-button');
  await wait('!document.querySelector("[data-file-dialog=folder]")');
  pass("The shared guarded dialog focuses its editable field and its labelled X closes it without applying the file operation.");

  const point = await evaluate('(()=>{const b=document.querySelector("#open-settings").getBoundingClientRect();return{x:b.left+b.width/2,y:b.top+b.height/2}})()');
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await wait('document.querySelector(".tooltip[role=tooltip]")?.textContent.includes("Settings")', "delayed styled literal tooltip");
  assert.equal(await evaluate('(()=>{const t=document.querySelector(".tooltip"),b=t.getBoundingClientRect(),e=document.querySelector("#open-settings");return b.left>=7&&b.right<=innerWidth-7&&b.top>=7&&b.bottom<=innerHeight-7&&(e.getAttribute("aria-describedby")??"").split(/\\s+/).includes(t.id)})()'), true);
  await capture("tooltip"); await press("Escape", "Escape", 27); await wait('!document.querySelector(".tooltip")');
  assert.match(await evaluate('document.querySelector("#open-settings").getAttribute("title")'), /Settings/);
  pass("Trusted pointer hover displays a bounded, associated tooltip; Escape removes it and restores the original native title without activating a control.");

  await click("#open-settings"); await wait('document.querySelector("#settings-dialog").open', "actual Settings"); await capture("settings");
  try {
    await command("Emulation.setDeviceMetricsOverride", { width: 360, height: 800, deviceScaleFactor: 1, mobile: false });
    await wait('innerWidth===360&&document.querySelector("#settings-dialog .settings-content").getBoundingClientRect().width>250', "usable narrow Settings content");
    assert.equal(await evaluate('(()=>{const d=document.querySelector("#settings-dialog"),b=d.getBoundingClientRect(),c=d.querySelector(".settings-content");return b.left>=0&&b.right<=innerWidth&&d.scrollWidth<=d.clientWidth+1&&c.scrollWidth<=c.clientWidth+1})()'), true);
    assert.equal(await evaluate('(()=>{const n=document.querySelector("#settings-dialog .settings-navigation"),c=getComputedStyle(n),b=n.getBoundingClientRect();return ["auto","scroll"].includes(c.overflowY)&&b.height>0&&b.height<=240&&b.left>=0&&b.right<=innerWidth})()'), true);
    await capture("settings-narrow");
  } finally { await command("Emulation.setDeviceMetricsOverride", viewport); }
  await click('[data-close-dialog="settings-dialog"]'); await wait('!document.querySelector("#settings-dialog").open');
  pass("Settings retains its controls in the normal viewport and has contained content wider than 250px in a 360px viewport, with independently scrollable navigation.");

  const explorerId = await evaluate('(async()=>{const leaf=app.workspace.getLeaf("tab");globalThis.uiPolishExplorer=leaf;await leaf.setViewState({type:"file-explorer",state:{}});app.workspace.setActiveLeaf(leaf);return leaf.id})()');
  const pane = `[data-file-explorer=${JSON.stringify(explorerId)}]`; await wait(`document.querySelector(${JSON.stringify(pane + " [data-explorer-options]")})`);
  assert.deepEqual(await evaluate('Array.from(uiPolishExplorer.view.contentEl.querySelectorAll(".file-explorer-controls [data-explorer-action]")).map(e=>e.dataset.explorerAction)'), ["new-note", "new-folder", "search", "auto-reveal", "collapse"]);
  await click(pane + ' [data-explorer-options] > summary'); await wait(`document.querySelector(${JSON.stringify(pane + " [data-explorer-options]")}).open`);
  await capture("explorer-options"); await click(pane + ' [data-explorer-action=refresh]');
  await wait('!uiPolishExplorer.view.contentEl.querySelector("[data-explorer-options]").open', "advanced action retires the disclosure");
  const previousWidth = await evaluate('(()=>{const e=uiPolishExplorer.view.contentEl;const old=e.style.maxWidth;e.style.maxWidth="120px";return old})()');
  try {
    assert.equal(await evaluate('(()=>{const p=uiPolishExplorer.view.contentEl.querySelector(".file-explorer-controls"),b=p.getBoundingClientRect();return b.width<=120&&[...p.querySelectorAll("button")].every(e=>{const r=e.getBoundingClientRect();return r.left>=b.left-1&&r.right<=b.right+1&&r.width>=26})})()'), true);
    await capture("explorer-narrow-pane");
  } finally { await evaluate(`(async()=>{const leaf=uiPolishExplorer;leaf.view.contentEl.style.maxWidth=${JSON.stringify(previousWidth)};await app.workspace.closeLeaf(leaf);delete globalThis.uiPolishExplorer;return !app.workspace.getLeafById(${JSON.stringify(explorerId)})})()`); }
  pass("Files keeps five primary icons, opens its advanced disclosure with a trusted click, runs the original guarded Refresh action, and wraps every primary control inside a constrained 120px pane.");
  report.uiPolish = { host, images, comparisonTarget: "Obsidian 1.15.1 default theme", originalRuntimeEquivalence: "not established", ime: "composition guards have focused event tests; native IME sessions are outside this workflow" };
}
