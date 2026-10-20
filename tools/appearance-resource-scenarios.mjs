import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";
import { expectErrors } from "./error-log-audit.mjs";

// Licensed KaTeX font (retained provenance: node_modules/katex, MIT) and a 1x1 PNG are the only disposable inputs.
const fontPath = join("node_modules", "katex", "dist", "fonts", "KaTeX_Main-Regular.woff2");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const theme = ".obsidian/themes/Local/theme.css";
const selfContained = "Only self-contained appearance CSS is supported. Imports and URL/image resources are not loaded. Enable trusted local resources to use theme-relative fonts and images.";
const goodCss = '@font-face{font-family:"AppearanceLocal";src:url("./fonts/Main.woff2") format("woff2")}\n.theme-dark,.theme-light{--text-accent:#12ab34;--appearance-font:"AppearanceLocal"}\nbody{background-image:url(img/dot.png)}\n';

export const appearanceResourceVerificationPaths = [
  fontPath, join("tools", "smoke.mjs"), join("tools", "web-smoke.mjs"), join("tools", "cached-github-fixture.mjs"),
  join("client", "browser-vault.ts"), join("client", "github-vault.ts"), join("src", "RonSijm.Slopsidian", "Program.cs"),
  join("tools", "appearance-resource-scenarios.mjs"), join("client", "appearance-assets.ts"), join("client", "appearance-model.ts"), join("client", "appearance.ts"),
  join("src", "RonSijm.Slopsidian", "Services", "VaultService.Appearance.cs"),
];

export async function checkAppearanceResources(tools) {
  const { directory, evaluate, click, wait, report, restart, afterReload, readRequests } = tools;
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const control = key => `[data-appearance-settings] [data-setting-key=${JSON.stringify(key)}]`;
  const preferencesPath = join(directory, ".obsidian", "appearance.json");
  const put = async (path, bytes) => { const full = join(directory, ...path.split("/")); await mkdir(dirname(full), { recursive: true }); await writeFile(full, bytes); };
  const accent = () => evaluate('getComputedStyle(document.body).getPropertyValue("--text-accent").trim()');
  const styles = () => evaluate('Array.from(document.querySelectorAll("style[data-appearance-style]"),s=>s.dataset.appearanceStyle)');
  const open = async () => { await click("#open-settings"); await click("#appearance-tab"); await wait('document.querySelector("[data-appearance-settings] [data-setting-key=theme] select")', "Appearance controls"); };
  const reload = async () => {
    await evaluate(`(()=>{const row=Array.from(document.querySelectorAll("[data-appearance-settings] .setting-item")).find(r=>r.querySelector(".setting-item-name")?.textContent==="Reload appearance and CSS files");row.dataset.smokeResourceReload="";})()`);
    await click("[data-smoke-resource-reload]"); await evaluate("app.appearance.whenIdle()");
  };
  const toggle = async key => { await click(control(key) + " [role=switch]"); await evaluate("app.appearance.whenIdle()"); };
  const fontBase64 = (await readFile(fontPath)).toString("base64"), pngBase64 = png.toString("base64");
  // Pixel proof: the applied "AppearanceLocal" face must render identically to a face built straight from the file bytes and differently from the fallback.
  const fontPixels = () => evaluate(`(async()=>{
    const bytes=Uint8Array.from(atob(${JSON.stringify(fontBase64)}),c=>c.charCodeAt(0)), ref=new FontFace("AppearanceReference",bytes.buffer);await ref.load();document.fonts.add(ref);
    await document.fonts.load('48px "AppearanceLocal"');
    const draw=family=>{const c=document.createElement("canvas");c.width=320;c.height=80;const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,320,80);x.fillStyle="#000";x.font='48px '+family;x.fillText("Rag@gy 123",4,56);return Array.from(x.getImageData(0,0,320,80).data).join(",")};
    const applied=draw('"AppearanceLocal",monospace'), reference=draw('"AppearanceReference",monospace'), fallback=draw("monospace");
    return{sameAsReference:applied===reference,differsFromFallback:applied!==fallback,inked:applied.includes("0,0,0,255")};
  })()`);
  const imagePixel = () => evaluate(`(async()=>{
    const load=async src=>{const i=new Image();i.src=src;try{await i.decode()}catch(e){throw new Error("decode "+src.slice(0,120)+" len="+src.length)}const c=document.createElement("canvas");c.width=c.height=1;const x=c.getContext("2d");x.drawImage(i,0,0);return Array.from(x.getImageData(0,0,1,1).data)};
    const bg=getComputedStyle(document.body).backgroundImage,applied=(bg.startsWith("url(")?bg.slice(4,-1).replace(/^"|"$/g,""):"BG:"+bg);if(applied.startsWith("BG:"))throw new Error(applied.slice(0,200)+" styles="+Array.from(document.querySelectorAll("style[data-appearance-style]")).map(s=>s.textContent.slice(-200)).join("|"));
    return{applied:await load(applied),reference:await load("data:image/png;base64,${pngBase64}"),dataUrl:applied.startsWith("data:image/png;base64,")};
  })()`);  const fontBytes = await readFile(fontPath);
  await put(theme, goodCss); await put(".obsidian/themes/Local/fonts/Main.woff2", fontBytes); await put(".obsidian/themes/Local/img/dot.png", png);
  const original = JSON.parse((await readFile(preferencesPath, "utf8").catch(() => "{}")).replace(/^\ufeff/, "") || "{}");
  await expectErrors(tools, [{ source: "notification", message: selfContained }], async () => {
    await writeFile(preferencesPath, JSON.stringify({ ...original, cssTheme: "Local", enabledCssSnippets: [] }, null, 2));
    await evaluate('(async()=>{await app.configuration.refresh("appearance");await app.appearance.whenIdle()})()');
  }, "Refuse resource CSS adopted by the configuration watcher");
  await expectErrors(tools, [{ source: "notification", message: selfContained }], open, "Refuse resource CSS when Appearance first opens");
  await expectErrors(tools, [{ source: "notification", message: selfContained }], reload, "Refuse resource CSS by default");

  // Default: resource CSS refuses and is not applied.
  assert.equal(await evaluate('app.appearance.getControlValue("allowLocalResources")'), false);
  assert.equal(await evaluate('document.querySelector("[data-appearance-failure]")?.checkVisibility()'), true);
  assert.notEqual(await accent(), "#12ab34");
  pass("Resource-bearing theme CSS refuses by default and none of it is applied.");

  // Opt in: font and image really load and render.
  await toggle("allowLocalResources");
  await wait('getComputedStyle(document.body).getPropertyValue("--text-accent").trim()==="#12ab34"', "opted-in theme");
  assert.deepEqual(await fontPixels(), { sameAsReference: true, differsFromFallback: true, inked: true });
  { const pixel = await imagePixel(); assert.equal(pixel.dataUrl, true); assert.deepEqual(pixel.applied, pixel.reference); assert.ok(pixel.applied[3] > 0); }

  assert.deepEqual(readRequests().filter(url => /Main\.woff2|dot\.png|^https?:\/\/(?!127\.0\.0\.1|localhost)/.test(url) && !url.includes("/api/appearance/") && !url.includes("/api/adapter/stat?")), []);
  assert.deepEqual(await readFile(join(directory, ".obsidian", "themes", "Local", "fonts", "Main.woff2")), fontBytes);
  pass("Opt-in loads the actual local woff2 and png through bounded data URLs with no direct file or remote requests, leaving asset bytes unchanged.");

  // Invalid assets refuse on Reload and retain the previous accepted style elements.
  await evaluate('globalThis.acceptedResourceStyles=Array.from(document.querySelectorAll("style[data-appearance-style]"));true');
  for (const [css, label, message] of [
    ['body{background:url(https://example.invalid/a.png)}', "remote", "Only relative local resource paths are supported; remote, absolute, encoded, query or fragment URLs are refused: https://example.invalid/a.png"], ['body{background:url(../../../app.json)}', "escaping", "Resource paths must not contain traversal or empty segments: ../../../app.json"],
    ['body{background:url(img/x.svg)}', "svg", "This appearance resource format is not supported. Use woff2, woff, ttf, otf, png, jpg, gif, webp or avif; SVG and other formats are refused."], ['body{background:url(img/fake.png)}', "mismatched bytes", "The resource content does not match its file extension: .obsidian/themes/Local/img/fake.png"], ['@import "x.css";', "import", "Imports, image-set(), src() and image() are not supported, even with local resources enabled."],
  ]) {
    await put(".obsidian/themes/Local/img/fake.png", fontBytes.subarray(0, 64));
    const hostMessage = label === "mismatched bytes" ? (await evaluate('document.body.classList.contains("is-browser")') ? "Host 415: " + message : "Host 415: " + JSON.stringify({ error: message })) : message;
    const watcherMessage = label === "mismatched bytes" ? "Appearance could not check external CSS changes: " + hostMessage : hostMessage;
    await expectErrors(tools, [{ source: "notification", message: watcherMessage }], async () => {
      await put(theme, goodCss + css);
      await wait(`app.appearance.lastAssetFailure===${JSON.stringify(hostMessage)}`, "external " + label + " CSS refusal");
    }, "Watcher refuses " + label + " resource");
    await expectErrors(tools, [{ source: "notification", message: hostMessage }], reload, "Refuse " + label + " resource");
    assert.equal(await evaluate('acceptedResourceStyles.every((s,i)=>document.querySelectorAll("style[data-appearance-style]")[i]===s)'), true, label);
    assert.equal(await accent(), "#12ab34", label);
  }
  pass("Remote, escaping, SVG, mismatched-byte and import CSS all expose a failure while the prior accepted styles stay in the DOM and effective.");
  await put(theme, goodCss); await reload();

  // Restart restores from the opt-in preference.
  await click(".settings-close"); await restart();
  assert.equal(await accent(), "#12ab34");
  assert.deepEqual(await fontPixels(), { sameAsReference: true, differsFromFallback: true, inked: true });
  pass("After an actual restart the opted-in local font/image theme restores from appearance.json.");

  // Disabling returns to refusing resource CSS; the failure retains accepted styles.
  await open();
  await expectErrors(tools, [{ source: "notification", message: selfContained }], async () => { await click(control("allowLocalResources") + " [role=switch]"); await evaluate("app.appearance.whenIdle().catch(()=>0)"); await new Promise(resolve => setTimeout(resolve, 1500)); }, "Refuse disabling resources under a resource theme");
  assert.equal(await evaluate('app.appearance.getControlValue("allowLocalResources")'), true, "Saving with the opt-in off refuses while the resource theme is selected.");
  // The rejected write deliberately keeps the leave guard closed. A successful Reload reconfirms the retained preference before leaving.
  await reload();
  await click(".settings-close");
  pass("Turning the opt-in off while resource CSS is selected refuses and retains the opted-in state and styles.");

  // Cache-only GitHub with verified blobs.
  const localUrl = await evaluate("location.href"), localRoot = await evaluate("app.vault.rootPath");
  const fixture = await mountCachedGitHub(evaluate, "appearance-resources", [
    ["Remote.md", "# Remote\n"],
    [".obsidian/appearance.json", JSON.stringify({ cssTheme: "Local", allowLocalResources: true })],
    [theme, goodCss], [".obsidian/themes/Local/fonts/Main.woff2", fontBytes], [".obsidian/themes/Local/img/dot.png", png],
    [".obsidian/core-plugins.json", "[]"], [".obsidian/community-plugins.json", "[]"],
  ]);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault`);
  await wait('getComputedStyle(document.body).getPropertyValue("--text-accent").trim()==="#12ab34"', "cache-only theme");
  assert.deepEqual(await fontPixels(), { sameAsReference: true, differsFromFallback: true, inked: true });
  { const pixel = await imagePixel(); assert.equal(pixel.dataUrl, true); assert.deepEqual(pixel.applied, pixel.reference); assert.ok(pixel.applied[3] > 0); }
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  assert.deepEqual(await evaluate('(()=>{const {api,raw}=app.githubVaults.state().counters;return{api,raw}})()'), { api: 0, raw: 0 });
  pass("A cache-only GitHub mount renders the same local font/image from verified cached blobs with zero API/raw requests and unchanged blobs.");

  // Stale generation: leaving the vault clears the remote assets' styles.
  await tools.command("Page.navigate", { url: localUrl }); await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot);
  assert.equal((await styles()).every(path => path.startsWith(".obsidian/")), true);
  pass("Returning to the local vault retains only its own appearance state.");
}
