import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, unlink, rename } from "node:fs/promises";
import { join } from "node:path";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";
import { expectErrors } from "./error-log-audit.mjs";

export const appearanceVerificationPaths = [
  join("tools", "appearance-scenarios.mjs"), join("tools", "cached-github-fixture.mjs"),
  ...["appearance", "appearance-model", "font-family", "web-reader-appearance", "web-reader-frame", "app", "editor", "editor-host", "settings", "contracts", "browser-vault", "github-vault"].map(name => join("client", name + ".ts")),
  ...["appearance", "files", "browser-vault", "github-vault", "web-reader-custom-font"].map(name => join("tests", name + ".test.mjs")),
  join("src", "RonSijm.Slopsidian", "wwwroot", "app.css"),
  join("src", "RonSijm.Slopsidian", "Services", "VaultService.Appearance.cs"),
  join("src", "RonSijm.Slopsidian", "Services", "VaultModels.cs"), join("src", "RonSijm.Slopsidian", "Program.cs"),
  ...["Home.razor", "Home.razor.cs"].map(name => join("src", "RonSijm.Slopsidian", "Components", "Pages", name)),
];

const selfContainedMessage = "Only self-contained appearance CSS is supported. Imports and URL/image resources are not loaded. Enable trusted local resources to use theme-relative fonts and images.";
const leaf = (id, file, mode, source = mode === "source") => ({ id, type: "leaf", state: { type: "markdown", state: { file, mode, source } } });

export async function checkAppearance(tools) {
  const { directory, evaluate, command, click, press, wait, report, restart, afterReload, capture, readRequests } = tools;
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const control = key => `[data-appearance-settings] [data-setting-key=${JSON.stringify(key)}]`;
  const styles = () => evaluate('Array.from(document.querySelectorAll("style[data-appearance-style]"),s=>s.dataset.appearanceStyle)');
  const color = () => evaluate('getComputedStyle(document.body).getPropertyValue("--text-accent").trim()');
  const rawChoose = async (key, value) => {
    const selector = control(key) + " select";
    const index = await evaluate(`Array.from(document.querySelector(${JSON.stringify(selector)}).options).findIndex(option=>option.value===${JSON.stringify(value)})`);
    assert.ok(index >= 0, "Actual Appearance dropdown option: " + value);
    const focused = `document.activeElement===document.querySelector(${JSON.stringify(selector)})`;
    for (let i = 0; i < 64 && !await evaluate(focused); i++) { await press("Tab", "Tab", 9); }
    assert.equal(await evaluate(focused), true, "Keyboard Tab reaches the actual closed Appearance select.");
    await press("Home", "Home", 36);
    for (let i = 0; i < index; i++) { await press("ArrowDown", "ArrowDown", 40); }
    await wait(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(value)}`, "actual Appearance select value");
  };
  const choose = async (key, value) => {
    await rawChoose(key, value); await evaluate("app.appearance.whenIdle()");
    await wait(`app.appearance.getControlValue(${JSON.stringify(key)})===${JSON.stringify(value)}`, "saved Appearance dropdown");
  };
  const fill = async (key, value) => {
    const selector = control(key) + " input";
    await wait(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});return input&&!input.disabled&&!input.readOnly&&!input.closest("[inert],[aria-busy=true]")})()`, "editable Appearance input");
    await click(selector); await press("a", "KeyA", 65, 2);
    await command("Input.insertText", { text: String(value) }); await evaluate("app.appearance.whenIdle()");
  };
  const set = async (key, value) => {
    await fill(key, value);
    await wait(`app.appearance.getControlValue(${JSON.stringify(key)})===${JSON.stringify(value)}`, "saved Appearance input");
  };
  const setFonts = async () => {
    await set("interfaceFontFamily", "Arial");
    await set("textFontFamily", "Georgia, serif");
    await set("monospaceFontFamily", "Courier New, monospace");
    await set("baseFontSize", 24);
  };
  const retainedEditors = () => evaluate('appearanceEditors.every(({id,editor,cm,doc,selection})=>{const current=app.workspace.getLeafById(id)?.view.editor;return current===editor&&current.cm===cm&&current.cm.state.doc===doc&&current.cm.state.selection.eq(selection)})');
  const snapshotEditors = () => evaluate('globalThis.appearanceEditors=app.workspace.getLeavesOfType("markdown").map(({id,view})=>({id,editor:view.editor,cm:view.editor.cm,doc:view.editor.cm.state.doc,selection:view.editor.cm.state.selection}));true');
  const fontSnapshot = () => evaluate(`(()=>{
    const source=app.workspace.getLeafById("appearance-source").view.editor.cm, live=app.workspace.getLeafById("appearance-live-preview").view.editor.cm;
    const read=document.querySelector('[data-leaf-id="appearance-reading"] .markdown-preview-view');
    const sourceCode=Array.from(source.contentDOM.querySelectorAll("span")).find(span=>span.textContent.includes("appearance_code"));
    const liveCode=live.contentDOM.querySelector(".cm-live-inline-code"), readCode=read.querySelector("code");
    const font=(element,label)=>{if(!element)throw new Error("Missing actual typography element: "+label);const style=getComputedStyle(element);return{family:style.fontFamily,size:style.fontSize}};
    return{interface:font(document.querySelector("#open-settings"),"interface"),source:font(source.contentDOM,"Source"),reading:font(read.querySelector("p"),"Reading"),live:font(live.contentDOM,"Live Preview"),
      sourceCode:font(sourceCode,"Source code"),readingCode:font(readCode,"Reading code"),liveCode:font(liveCode,"Live Preview code"),sourceLineHeight:source.defaultLineHeight,liveLineHeight:live.defaultLineHeight};
  })()`);
  const open = async () => {
    await click("#open-settings"); await click("#appearance-tab");
    await wait('document.querySelector("[data-appearance-settings] [data-setting-key=theme] select")', "shared Appearance controls");
  };
  const action = async (name, id) => {
    await evaluate(`(()=>{const row=Array.from(document.querySelectorAll("[data-appearance-settings] .setting-item")).find(row=>row.querySelector(".setting-item-name")?.textContent===${JSON.stringify(name)});if(!row)throw new Error("Missing Appearance action");row.dataset.smokeAppearanceAction=${JSON.stringify(id)};})()`);
    await click(`[data-smoke-appearance-action="${id}"]`);
    await evaluate("app.appearance.whenIdle()");
  };
  const reload = () => action("Reload appearance and CSS files", "reload");
  const disable = () => action("Disable custom styles", "disable");
  const preferencesPath = join(directory, ".obsidian", "appearance.json");
  const preferences = async () => JSON.parse((await readFile(preferencesPath, "utf8")).replace(/^\ufeff/, ""));
  const source = "Appearance source.md", reading = "Appearance reading.md";
  const sourceText = "---\r\ntitle: Appearance source\r\n---\r\n# Appearance source\r\n\r\nKeep selection and undo across color changes.\r\n\r\nInline `appearance_code` and ordinary note text.\r\n";
  const sourceBytes = Buffer.from("\ufeff" + sourceText);
  const readingBytes = Buffer.from("# Appearance reading\n\n[[Appearance source|A local note]] and #appearance.\n\nTheme changes must not rewrite this note. Inline `appearance_reading_code`.\n");
  const css = new Map([
    [".obsidian/themes/Portable/theme.css", Buffer.from('\ufeff.theme-dark,.theme-light { --text-accent: #186a90; --appearance-theme: loaded; }\r\n')],
    [".obsidian/snippets/First.css", Buffer.from('/* Literal url("https://appearance.invalid/comment") is not a resource. */\r\n.theme-dark,.theme-light { --text-accent: #a34413; --appearance-first: loaded; --label: "url(https://appearance.invalid/string)"; }\r\n')],
    [".obsidian/snippets/Second.CSS", Buffer.from(".theme-dark,.theme-light { --text-accent: #18793c; --appearance-second: loaded; }\r\n")],
    [".obsidian/snippets/Font override.css", Buffer.from(':root { --font-text: "Times New Roman",serif; --font-text-size: 22px; }\r\n')],
    [".obsidian/snippets/Resources.css", Buffer.from('body { background: u\\72l("https://appearance.invalid/blocked.png"); }\n')],
    [".obsidian/snippets/Broken.css", Buffer.from('body { content: "bad\n; background:url(https://appearance.invalid/newline.png); } "\n')],
    [".obsidian/snippets/Nested/Ignored.css", Buffer.from("body { --appearance-nested: must-not-load; }\n")],
    [".obsidian/snippets/.hidden.css", Buffer.from("body { --appearance-hidden: must-not-load; }\n")],
    [".obsidian/themes/.hidden/theme.css", Buffer.from("body { --appearance-hidden: must-not-load; }\n")],
  ]);
  const megabyte = Buffer.from("/*" + "x".repeat(1024 * 1024 - 4) + "*/");
  for (let i = 1; i <= 5; i++) { css.set(`.obsidian/snippets/Limit${i}.css`, megabyte); }
  await evaluate("app.saveAll()"); await evaluate("app.workspace.flushLayout()");
  for (const [path, bytes] of css) {
    const segments = path.split("/");
    await mkdir(join(directory, ...segments.slice(0, -1)), { recursive: true });
    await writeFile(join(directory, ...segments), bytes);
  }
  await mkdir(join(directory, ".obsidian", "themes", "Not installed"), { recursive: true });
  await writeFile(join(directory, source), sourceBytes);
  await writeFile(join(directory, reading), readingBytes);
  const original = {
    main: { id: "appearance-main", type: "split", direction: "vertical", children: [
      { id: "appearance-source-tabs", type: "tabs", children: [leaf("appearance-source", source, "source")] },
      { id: "appearance-reading-tabs", type: "tabs", children: [leaf("appearance-reading", reading, "preview")] },
      { id: "appearance-live-tabs", type: "tabs", children: [leaf("appearance-live-preview", source, "source", false)] },
    ] }, active: "appearance-source", appearanceFuture: { keep: true },
  };
  const workspacePath = join(directory, ".obsidian", "workspace.json");
  const workspaceBytes = Buffer.from("\ufeff" + JSON.stringify(original, null, 2).replaceAll("\n", "\r\n") + "\r\n");
  const importedPreferences = Buffer.from('\ufeff{"theme":"obsidian","cssTheme":"","enabledCssSnippets":[],"baseFontSize":20,"futureAppearance":{"keep":[true,42]}}\r\n');
  await restart(async () => {
    await writeFile(preferencesPath, importedPreferences);
    await writeFile(workspacePath, workspaceBytes);
    await unlink(join(directory, ".obsidian", "vault-dotnet-workspace.json")).catch(error => { if (error.code !== "ENOENT") { throw error; } });
  });
  await command("Network.enable");
  assert.deepEqual(await styles(), []);
  await wait('app.workspace.getLeafById("appearance-live-preview")?.view.getEditingMode()==="live-preview"');
  report.appearanceImportedFonts = await fontSnapshot();
  await wait('app.workspace.getLeafById("appearance-source").view.editor.cm.defaultLineHeight===30&&app.workspace.getLeafById("appearance-live-preview").view.editor.cm.defaultLineHeight===30', "imported Source and Live Preview typography measurements");
  report.appearanceImportedFonts = await fontSnapshot();
  for (const key of ["source", "reading", "live"]) { assert.equal(report.appearanceImportedFonts[key].size, "20px"); }
  assert.deepEqual(await readFile(preferencesPath), importedPreferences);
  pass("Imported native-shaped baseFontSize materializes in real Source/Reading/Live Preview text and CodeMirror line measurements without writing absent font choices or changing the original BOM preferences.");
  await open();
  assert.deepEqual(await evaluate('Array.from(document.querySelector("[data-setting-key=cssTheme] select").options,o=>o.value)'), ["", "Portable"]);
  assert.equal(await evaluate('!!document.querySelector("[data-setting-key=\'snippet:Ignored\'],[data-setting-key=\'snippet:.hidden\']")'), false);
  pass("The shared Appearance page discovers real non-hidden installed theme.css and top-level case-insensitive CSS snippets, excluding nested snippets and folders without a theme.");

  await click(".settings-close");
  await click('[data-leaf-id="appearance-source"] .cm-content[contenteditable=true]');
  await press("End", "End", 35, 2); await command("Input.insertText", { text: "\nAppearance edit" });
  await wait("app.dirty");
  await snapshotEditors();
  const edited = await evaluate("app.editor.getValue()");
  await open(); await choose("theme", "moonstone");
  assert.equal(await evaluate('document.documentElement.classList.contains("theme-light")&&document.body.classList.contains("theme-light")&&getComputedStyle(document.documentElement).colorScheme==="light"'), true);
  report.appearanceLightMode = await evaluate('appearanceEditors.map(({id,editor,cm,doc,selection})=>{const current=app.workspace.getLeafById(id).view.editor;return{id,sameEditor:current===editor,sameView:current.cm===cm,sameDocument:current.cm.state.doc===doc,sameSelection:current.cm.state.selection.eq(selection),darkTheme:cm.state.facet(cm.constructor.darkTheme),background:getComputedStyle(cm.dom).backgroundColor,color:getComputedStyle(cm.dom).color}})');
  assert.deepEqual(report.appearanceLightMode, ["appearance-source", "appearance-reading", "appearance-live-preview"].map(id => ({ id, sameEditor: true, sameView: true, sameDocument: true, sameSelection: true, darkTheme: false, background: "rgb(255, 255, 255)", color: "rgb(37, 37, 37)" })));
  assert.equal(await evaluate("app.editor.getValue()"), edited); assert.equal(await evaluate("app.dirty"), true);
  await click(".settings-close"); await capture("light");
  await click('[data-leaf-id="appearance-source"] .cm-content[contenteditable=true]'); await press("z", "KeyZ", 90, 2);
  await wait(`app.editor.getValue()===${JSON.stringify(sourceText)}`, "undo remains available after the real mode change");
  await press("y", "KeyY", 89, 2); await wait(`app.editor.getValue()===${JSON.stringify(edited)}`, "redo remains available after the real mode change");
  await press("z", "KeyZ", 90, 2); await wait("!app.dirty");
  assert.deepEqual(await readFile(join(directory, source)), sourceBytes);
  pass("Real light mode updates root/body classes, native color-scheme and every Source/Reading CodeMirror compartment without replacing editors, documents or selections; dirty text, keyboard undo/redo and original BOM/CRLF note bytes survive.");

  await click('[data-leaf-id="appearance-source"] .cm-content[contenteditable=true]');
  await press("End", "End", 35, 2); await command("Input.insertText", { text: "\nTypography edit" }); await wait("app.dirty");
  const typographyEdit = await evaluate("app.editor.getValue()"); await snapshotEditors();
  await open(); await setFonts();
  await wait('app.workspace.getLeafById("appearance-source").view.editor.cm.defaultLineHeight===36&&app.workspace.getLeafById("appearance-live-preview").view.editor.cm.defaultLineHeight===36');
  report.appearanceCustomFonts = await fontSnapshot();
  assert.match(report.appearanceCustomFonts.interface.family, /^"?Arial"?,/);
  for (const key of ["source", "reading", "live"]) {
    assert.match(report.appearanceCustomFonts[key].family, /^"?Georgia"?,/);
    assert.equal(report.appearanceCustomFonts[key].size, "24px");
  }
  for (const key of ["sourceCode", "readingCode", "liveCode"]) { assert.match(report.appearanceCustomFonts[key].family, /^"Courier New",/); }
  assert.equal(await retainedEditors(), true);
  assert.equal(await evaluate("app.editor.getValue()"), typographyEdit); assert.equal(await evaluate("app.dirty"), true);
  await click(".settings-close"); await capture("fonts");
  await click('[data-leaf-id="appearance-source"] .cm-content[contenteditable=true]'); await press("z", "KeyZ", 90, 2); await wait(`app.editor.getValue()===${JSON.stringify(sourceText)}`);
  await press("y", "KeyY", 89, 2); await wait(`app.editor.getValue()===${JSON.stringify(typographyEdit)}`);
  await press("z", "KeyZ", 90, 2); await wait("!app.dirty");
  assert.deepEqual(await readFile(join(directory, source)), sourceBytes);
  pass("Actual interface/text/monospace controls and note text size repaint all three modes, including real inline code. CodeMirror remeasures 36px lines while editor/document/selection ownership, shared dirty text and real keyboard undo/redo survive.");

  await open(); const beforeInvalidFont = await readFile(preferencesPath);
  await evaluate('globalThis.acceptedAppearancePreferences=document.querySelector("style[data-appearance-preferences]");true');
  await fill("textFontFamily", "Georgia,");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(control("textFontFamily") + " [role=alert]")}).checkVisibility()`), true);
  assert.deepEqual(await readFile(preferencesPath), beforeInvalidFont);
  await fill("textFontFamily", "url(https://appearance.invalid/font.woff)");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(control("textFontFamily") + " [role=alert]")}).checkVisibility()`), true);
  await fill("baseFontSize", "24.5");
  assert.match(await evaluate(`document.querySelector(${JSON.stringify(control("baseFontSize") + " [role=alert]")}).textContent`), /whole pixels/);
  assert.deepEqual(await readFile(preferencesPath), beforeInvalidFont);
  assert.equal(await evaluate('acceptedAppearancePreferences===document.querySelector("style[data-appearance-preferences]")'), true);
  await set("textFontFamily", "Georgia, serif"); await set("baseFontSize", 24);
  pass("Incomplete comma drafts, a resource URL and fractional text size expose actual inline validation without saving or replacing accepted typography. Corrected real inputs remain usable.");

  await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await choose("theme", "system"); await wait('document.body.classList.contains("theme-light")');
  const systemBytes = await readFile(preferencesPath);
  await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] }); await wait('document.body.classList.contains("theme-dark")');
  await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] }); await wait('document.body.classList.contains("theme-light")');
  assert.deepEqual(await readFile(preferencesPath), systemBytes);
  await choose("theme", "obsidian"); assert.equal(await evaluate('document.body.classList.contains("theme-dark")'), true);
  await command("Emulation.setEmulatedMedia", { features: [] }); await choose("theme", "moonstone");
  pass("Adapt to system follows real Chromium media-query change events without rewriting appearance.json; an explicit dark choice ignores the emulated light preference.");

  await choose("cssTheme", "Portable");
  assert.equal(await color(), "#186a90");
  await evaluate('globalThis.appearanceCssEvents=0;globalThis.appearanceCssRef=app.workspace.on("css-change",()=>appearanceCssEvents++);true');
  await click(control("snippet:First") + " [role=switch]"); await evaluate("app.appearance.whenIdle()");
  assert.equal(await color(), "#a34413"); assert.equal(await evaluate("appearanceCssEvents"), 1);
  await evaluate("app.workspace.offref(appearanceCssRef)");
  await click(control("snippet:Second") + " [role=switch]"); await evaluate("app.appearance.whenIdle()");
  assert.equal(await color(), "#18793c");
  assert.deepEqual(await styles(), [".obsidian/themes/Portable/theme.css", ".obsidian/snippets/First.css", ".obsidian/snippets/Second.CSS"]);
  const selected = await preferences(); assert.deepEqual(selected.enabledCssSnippets, ["First", "Second"]);
  assert.deepEqual(selected.futureAppearance, { keep: [true, 42] }); assert.equal(selected.baseFontSize, 24);
  assert.ok((await readFile(preferencesPath, "utf8")).startsWith("\ufeff"));
  pass("An actual installed theme and two real snippets cascade in configured order, including an uppercase .CSS file. Versioned saves preserve unknown/BOM preferences and emit one css-change notification per accepted control save.");

  await snapshotEditors(); await click(control("snippet:Font override") + " [role=switch]"); await evaluate("app.appearance.whenIdle()");
  await wait('app.workspace.getLeafById("appearance-source").view.editor.cm.defaultLineHeight===33');
  const overriddenFonts = await fontSnapshot();
  for (const key of ["source", "reading", "live"]) { assert.match(overriddenFonts[key].family, /^"Times New Roman",/); assert.equal(overriddenFonts[key].size, "22px"); }
  assert.equal(await evaluate('app.appearance.getControlValue("baseFontSize")'), 24); assert.equal(await retainedEditors(), true);
  await click(control("snippet:Font override") + " [role=switch]"); await evaluate("app.appearance.whenIdle()");
  await wait('app.workspace.getLeafById("appearance-source").view.editor.cm.defaultLineHeight===36');
  const beforeFontDefaults = await preferences(), selectedStyles = await styles();
  await action("Restore default fonts", "font-defaults");
  const fontDefaults = await preferences();
  for (const key of ["interfaceFontFamily", "textFontFamily", "monospaceFontFamily", "baseFontSize"]) { assert.equal(Object.hasOwn(fontDefaults, key), false); }
  assert.equal(fontDefaults.theme, beforeFontDefaults.theme); assert.equal(fontDefaults.cssTheme, beforeFontDefaults.cssTheme);
  assert.deepEqual(fontDefaults.enabledCssSnippets, beforeFontDefaults.enabledCssSnippets); assert.deepEqual(fontDefaults.futureAppearance, beforeFontDefaults.futureAppearance);
  assert.deepEqual(await styles(), selectedStyles); assert.equal(await retainedEditors(), true);
  await wait('app.workspace.getLeafById("appearance-source").view.editor.cm.defaultLineHeight===24');
  const defaultFonts = await fontSnapshot();
  assert.match(defaultFonts.interface.family, /^"Segoe UI",/);
  for (const key of ["source", "reading", "live"]) { assert.match(defaultFonts[key].family, /^"Segoe UI",/); assert.equal(defaultFonts[key].size, "16px"); }
  await setFonts();
  pass("A real later snippet can override ordinary font/size variables without changing saved preferences or editor objects. Restore default fonts removes only the four typography keys while retaining mode, selected CSS, unknown values and all assets.");

  const external = { ...selected, enabledCssSnippets: ["Second", "First", "First"], externalAppearance: { newer: true } };
  const externalBytes = Buffer.from("\ufeff" + JSON.stringify(external, null, 2) + "\r\n");
  await writeFile(preferencesPath, externalBytes);
  const conflict = "The configuration changed on disk. Reload it before saving; the existing file was retained.";
  const browser = await evaluate('document.body.classList.contains("is-browser")');
  const conflictMessage = browser ? "Host 409: " + conflict : "Host 409: " + JSON.stringify({ error: conflict });
  await expectErrors(tools, [{ source: "notification", message: conflictMessage }], async () => {
    await click(control("snippet:Second") + " [role=switch]");
    await wait(`document.querySelector(${JSON.stringify(control("snippet:Second") + " [role=alert]")}).textContent.includes("changed on disk")`);
  }, "Refuse a stale Appearance configuration save");
  assert.deepEqual(await readFile(preferencesPath), externalBytes);
  assert.equal(await color(), "#18793c");
  await reload(); assert.equal(await color(), "#a34413");
  assert.deepEqual(await styles(), [".obsidian/themes/Portable/theme.css", ".obsidian/snippets/Second.CSS", ".obsidian/snippets/First.css"]);
  await click(control("snippet:First") + " [role=switch]"); await evaluate("app.appearance.whenIdle()");
  assert.deepEqual((await preferences()).enabledCssSnippets, ["Second"]);
  css.set(".obsidian/snippets/Second.CSS", Buffer.from(".theme-dark,.theme-light { --text-accent: #285e9c; --appearance-second: reloaded; }\r\n"));
  await writeFile(join(directory, ".obsidian", "snippets", "Second.CSS"), css.get(".obsidian/snippets/Second.CSS"));
  const beforeCssReload = await readFile(preferencesPath);
  await reload(); assert.equal(await color(), "#285e9c");
  assert.equal(await evaluate('getComputedStyle(document.body).getPropertyValue("--appearance-second").trim()'), "reloaded");
  assert.deepEqual(await readFile(preferencesPath), beforeCssReload);
  pass("External configuration replacements refuse stale saves without replacing accepted CSS. Explicit Reload adopts newer unknown keys and deduplicated order, then rereads changed CSS bytes without rewriting preferences.");

  const beforeRefusal = await readFile(preferencesPath), requestStart = readRequests().length;
  await evaluate('globalThis.acceptedAppearanceStyles=Array.from(document.querySelectorAll("style[data-appearance-style]"));true');
  for (const [name, message] of [["Resources", selfContainedMessage], ["Broken", "CSS strings must not contain unescaped newlines."]]) {
    await expectErrors(tools, [{ source: "notification", message }], async () => {
      await click(control("snippet:" + name) + " [role=switch]");
      await wait(`document.querySelector(${JSON.stringify(control("snippet:" + name) + " [role=alert]")}).textContent.length>0`);
    }, "Refuse " + name + " CSS before saving or insertion");
    assert.deepEqual(await readFile(preferencesPath), beforeRefusal);
    assert.equal(await evaluate('acceptedAppearanceStyles.every((s,i)=>document.querySelectorAll("style[data-appearance-style]")[i]===s)'), true);
  }
  assert.deepEqual(readRequests().slice(requestStart).filter(url => url.includes("appearance.invalid")), []);
  pass("Escaped URL CSS and a browser bad-string/newline loading attempt refuse before insertion or preference writes, preserving accepted DOM styles with no probe network requests. Literal strings/comments remain usable.");

  const limited = { ...(await preferences()), enabledCssSnippets: [1, 2, 3, 4, 5].map(i => "Limit" + i) };
  const limitBytes = Buffer.from("\ufeff" + JSON.stringify(limited) + "\r\n"); await writeFile(preferencesPath, limitBytes);
  await expectErrors(tools, [{ source: "notification", message: "The selected appearance styles exceed the 4 MiB total limit." }], reload, "Refuse an oversized selected CSS set");
  assert.equal(await evaluate('document.querySelector("[data-appearance-failure]").checkVisibility()'), true);
  assert.equal(await color(), "#285e9c"); assert.deepEqual(await readFile(preferencesPath), limitBytes);
  await disable(); assert.deepEqual(await styles(), []);
  assert.equal((await preferences()).cssTheme, ""); assert.deepEqual((await preferences()).enabledCssSnippets, []);
  pass("A selected set of individually valid 1 MiB files refuses above the 4 MiB total before replacement. The visible failure retains accepted CSS and Disable custom styles recovers without deleting any asset.");

  const themesPath = join(directory, ".obsidian", "themes"), themesBackup = join(directory, ".obsidian", "theme-inventory-keep");
  await rename(themesPath, themesBackup); await writeFile(themesPath, "Not a folder\n");
  await expectErrors(tools, [{ source: "notification", message: "The appearance asset path is not a folder: .obsidian/themes" }], reload, "Expose a failed CSS inventory");
  await choose("theme", "obsidian");
  assert.equal(await evaluate('document.querySelector("[data-appearance-failure]").checkVisibility()'), true);
  await disable();
  assert.equal(await evaluate('document.querySelector("[data-appearance-failure]").checkVisibility()'), true);
  await unlink(themesPath); await rename(themesBackup, themesPath); await reload();
  assert.equal(await evaluate('document.querySelector("[data-appearance-failure]").checkVisibility()'), false);
  pass("A failed CSS inventory remains visibly failed through an unrelated mode save and disabling CSS. Repairing its folder and Reload recover without deleting the installed assets.");

  await writeFile(preferencesPath, "\ufeff" + JSON.stringify({ ...(await preferences()), textFontFamily: { invalid: true } }) + "\r\n");
  await expectErrors(tools, [{ source: "notification", message: "Appearance fonts must be a comma-separated list of at most eight local family names." }], reload, "Expose invalid imported font configuration");
  assert.equal(await evaluate('document.querySelector("[data-appearance-failure]").checkVisibility()'), true);
  assert.equal(await evaluate('!!document.querySelector("[data-setting-key=textFontFamily]")'), false);
  await action("Reset supported appearance preferences", "font-reset");
  assert.equal(await evaluate('app.appearance.getControlValue("textFontFamily")'), "");
  assert.equal(await evaluate('app.appearance.getControlValue("baseFontSize")'), 16);
  assert.deepEqual((await preferences()).futureAppearance, { keep: [true, 42] });
  pass("Invalid externally imported font configuration exposes the genuine recovery page instead of applying coerced fonts. Reset repairs supported appearance and typography values while retaining unrelated data and rediscovering installed CSS.");

  await evaluate("app.appearance.clear()");
  await writeFile(preferencesPath, "\ufeff" + JSON.stringify({ ...(await preferences()), theme: "sepia", enabledCssSnippets: "invalid", monospaceFontFamily: ["invalid"], baseFontSize: "invalid" }) + "\r\n");
  await expectErrors(tools, [{ source: "notification", message: "Choose dark, light or system appearance." }], reload, "Expose malformed supported Appearance preferences");
  assert.equal(await evaluate('!!document.querySelector("[data-appearance-settings] [data-setting-key=theme]")'), false);
  assert.equal(await evaluate('document.querySelector("[data-appearance-failure]").checkVisibility()'), true);
  await action("Reset supported appearance preferences", "reset");
  assert.equal((await preferences()).theme, "obsidian"); assert.deepEqual((await preferences()).enabledCssSnippets, []);
  assert.deepEqual((await preferences()).externalAppearance, { newer: true }); assert.deepEqual((await preferences()).futureAppearance, { keep: [true, 42] });
  for (const key of ["interfaceFontFamily", "textFontFamily", "monospaceFontFamily", "baseFontSize"]) { assert.equal(Object.hasOwn(await preferences(), key), false); }
  await choose("theme", "moonstone"); await choose("cssTheme", "Portable"); await setFonts();
  await click(control("snippet:Second") + " [role=switch]"); await evaluate("app.appearance.whenIdle()");
  pass("Malformed supported preferences keep an explicit usable error page. From a cleared Appearance controller, Reset repairs only supported mode/style/font keys and rereads the real CSS inventory, preserving unknown data and files before ordinary controls become usable again.");

  await click(".settings-close"); await evaluate("app.saveAll()"); await evaluate("app.workspace.flushLayout()"); await restart();
  assert.equal(await evaluate('document.body.classList.contains("theme-light")'), true);
  assert.deepEqual(await styles(), [".obsidian/themes/Portable/theme.css", ".obsidian/snippets/Second.CSS"]);
  assert.equal(await color(), "#285e9c"); assert.deepEqual(await readFile(workspacePath), workspaceBytes);
  assert.deepEqual(await readFile(join(directory, source)), sourceBytes);
  assert.equal(await evaluate('app.appearance.getControlValue("textFontFamily")'), "Georgia, serif");
  assert.equal(await evaluate('app.appearance.getControlValue("baseFontSize")'), 24);
  assert.match((await fontSnapshot()).interface.family, /^"?Arial"?,/);
  await capture("theme-snippets");
  pass("A real desktop process restart/browser directory-handle reconnection restores mode, font choices/text size, installed theme and reread snippet bytes while original imported workspace and note bytes remain unchanged.");

  const generationSnippet = join(directory, ".obsidian", "snippets", "Inventory generation.css");
  await evaluate(`(()=>{globalThis.savedAppearanceInventory=app.appearance.inventory;globalThis.heldAppearanceInventoryReady=false;let first=true;const gate=new Promise(resolve=>globalThis.releaseAppearanceInventory=resolve);app.appearance.inventory=async function(){const assets=await savedAppearanceInventory.call(this);if(first){first=false;heldAppearanceInventoryReady=true;await gate;}return assets;};globalThis.heldAppearanceInventoryRestore=app.appearance.restore().then(()=>({accepted:true}),error=>({accepted:false,message:error.message}));})()`);
  await wait("heldAppearanceInventoryReady", "real inventory held before owner checks");
  await writeFile(generationSnippet, "body { --appearance-inventory: new-owner; }\n");
  await evaluate("app.appearance.clear();app.appearance.restore()"); await open();
  await evaluate("releaseAppearanceInventory()");
  assert.deepEqual(await evaluate("heldAppearanceInventoryRestore"), { accepted: false, message: "These appearance assets belong to an inactive vault." });
  await evaluate("app.appearance.inventory=savedAppearanceInventory;true"); await disable();
  assert.equal(await evaluate(`!!document.querySelector(${JSON.stringify(control("snippet:Inventory generation"))})`), true);
  await unlink(generationSnippet); await reload(); await choose("cssTheme", "Portable");
  await click(control("snippet:Second") + " [role=switch]"); await evaluate("app.appearance.whenIdle()"); await click(".settings-close");
  pass("A held real CSS inventory cannot overwrite a replacement owner on same-root re-entry. A newly discovered on-disk snippet survives rebuilding the actual replacement controls after the obsolete result is refused.");

  const holdPreparation = async () => {
    await evaluate(`(()=>{globalThis.savedAppearancePrepare=app.appearance.prepareStyles;globalThis.heldAppearanceReady=false;let first=true;const gate=new Promise(resolve=>globalThis.releaseAppearancePreparation=resolve);app.appearance.prepareStyles=async function(...args){const prepared=await savedAppearancePrepare.apply(this,args);if(first){first=false;globalThis.heldAppearancePrepared=prepared;heldAppearanceReady=true;await gate;}return prepared;};})()`);
  };
  await open(); await evaluate('globalThis.oldAppearanceControl=document.querySelector("[data-setting-key=theme] select");globalThis.oldAppearanceFont=document.querySelector("[data-setting-key=textFontFamily] input");true');
  await holdPreparation(); await rawChoose("theme", "obsidian"); await wait("heldAppearanceReady", "actual control CSS preflight held");
  assert.equal((await preferences()).theme, "moonstone");
  await click(".settings-close"); await wait('!document.querySelector("#settings-dialog").open');
  await evaluate("releaseAppearancePreparation()");
  await wait("!oldAppearanceControl.isConnected", "the settings close drains its pending CSS/read/save action");
  await evaluate("app.appearance.prepareStyles=savedAppearancePrepare;true");
  assert.equal((await preferences()).theme, "obsidian");
  await open(); await choose("theme", "moonstone");
  const beforeStaleControl = await readFile(preferencesPath);
  await expectErrors(tools, [{ source: "notification", message: "This settings control belongs to an inactive page or vault." }], async () => {
    await evaluate('oldAppearanceControl.value="obsidian";oldAppearanceControl.dispatchEvent(new Event("change",{bubbles:true}));true');
  }, "Refuse a detached Appearance control after reopening the same vault page");
  await expectErrors(tools, [{ source: "notification", message: "This settings control belongs to an inactive page or vault." }], async () => {
    await evaluate('oldAppearanceFont.value="Arial";oldAppearanceFont.dispatchEvent(new Event("input",{bubbles:true}));true');
  }, "Refuse a detached Appearance font input after reopening");
  assert.deepEqual(await readFile(preferencesPath), beforeStaleControl); assert.equal(await color(), "#285e9c");
  await click(".settings-close");
  pass("Closing a page drains a held real CSS preflight/save before detaching controls. After reopening, the old theme and font controls refuse instead of saving into the new page or changing its appearance.");

  const startHeldRestore = async () => {
    await holdPreparation();
    await evaluate('globalThis.heldAppearanceRestore=app.appearance.restore().then(()=>({accepted:true}),error=>({accepted:false,message:error.message}));true');
    await wait("heldAppearanceReady", "actual restored CSS bytes prepared but held");
  };
  const releaseRestore = async () => {
    await evaluate("releaseAppearancePreparation()");
    assert.deepEqual(await evaluate("heldAppearanceRestore"), { accepted: false, message: "These appearance assets belong to an inactive vault." });
    assert.equal(await evaluate("heldAppearancePrepared.every(style=>!style.isConnected)"), true);
    await evaluate("app.appearance.prepareStyles=savedAppearancePrepare;true");
  };
  await startHeldRestore(); await evaluate("app.appearance.clear();app.appearance.restore()"); await releaseRestore();
  assert.equal(await color(), "#285e9c");
  pass("A held preparation cannot reapply after clearing/re-entering the same root: the asset generation refuses even though the root string is identical.");

  await startHeldRestore();
  const localRoot = await evaluate("app.vault.rootPath"), localUrl = await evaluate("location.href");
  const remotePreferences = '\ufeff{"theme":"obsidian","cssTheme":"Remote","enabledCssSnippets":["Remote"],"interfaceFontFamily":"Georgia","textFontFamily":"Arial","monospaceFontFamily":"Consolas","baseFontSize":18,"futureRemoteAppearance":{"keep":true}}\r\n';
  const fixture = await mountCachedGitHub(evaluate, "readonly-appearance", [
    ["Remote.md", "# Remote appearance\n\nRead-only cached content.\n"],
    [".obsidian/appearance.json", remotePreferences],
    [".obsidian/themes/Remote/theme.css", ".theme-dark,.theme-light { --text-accent: #b0528a; --appearance-remote: loaded; }\n"],
    [".obsidian/snippets/Remote.css", ".theme-dark,.theme-light { --text-accent: #604ca6; --appearance-remote-snippet: loaded; }\n"],
    [".obsidian/core-plugins.json", "[]"], [".obsidian/community-plugins.json", "[]"],
    [".obsidian/workspace.json", JSON.stringify({ main: { id: "remote-appearance-main", type: "split", direction: "vertical", children: [{ id: "remote-appearance-tabs", type: "tabs", children: [leaf("remote-appearance-note", "Remote.md", "source")] }] }, active: "remote-appearance-note" })],
  ]);
  await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&app.vault.readOnly&&!app.changingVault`);
  await releaseRestore();
  assert.deepEqual(await styles(), [".obsidian/themes/Remote/theme.css", ".obsidian/snippets/Remote.css"]);
  assert.equal(await color(), "#604ca6");
  assert.equal(await evaluate('app.appearance.getControlValue("baseFontSize")'), 18);
  assert.match(await evaluate('getComputedStyle(document.querySelector("#open-settings")).fontFamily'), /^"?Georgia"?,/);
  assert.equal(await evaluate('getComputedStyle(document.body).getPropertyValue("--appearance-theme").trim()'), "");
  await open(); await choose("theme", "moonstone"); await set("textFontFamily", "Times New Roman"); await set("baseFontSize", 22);
  await click(control("snippet:Remote") + " [role=switch]"); await evaluate("app.appearance.whenIdle()"); await click(".settings-close");
  await command("Page.reload");
  if (browser) {
    await wait(`document.querySelector("main[data-ready=true]")&&app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault`, "cache-only Appearance URL restoration");
  } else { await afterReload(); }
  if (await evaluate("app.vault.rootPath") !== fixture.mount.id) {
    await evaluate(`app.githubVaults.open({url:${JSON.stringify(fixture.mount.repository)},cached:true})`);
    await wait(`app.vault.rootPath===${JSON.stringify(fixture.mount.id)}&&!app.changingVault`);
  }
  assert.equal(await evaluate('app.appearance.getControlValue("theme")'), "moonstone");
  assert.equal(await evaluate('app.appearance.getControlValue("textFontFamily")'), "Times New Roman"); assert.equal(await evaluate('app.appearance.getControlValue("baseFontSize")'), 22);
  assert.equal(await evaluate('getComputedStyle(app.editor.cm.contentDOM).fontSize'), "22px");
  assert.match(await evaluate('getComputedStyle(app.editor.cm.contentDOM).fontFamily'), /^"Times New Roman",/);
  assert.deepEqual(await styles(), [".obsidian/themes/Remote/theme.css"]); assert.equal(await color(), "#b0528a");
  assert.deepEqual(await evaluate('(async()=> (await app.configuration.read("appearance")).data.futureRemoteAppearance)()'), { keep: true });
  await assertCachedBlobsUnchanged(evaluate, fixture.blobs);
  assert.deepEqual(await evaluate('(()=>{const {api,raw}=app.githubVaults.state().counters;return{api,raw}})()'), { api: 0, raw: 0 });
  await open(); await capture("readonly"); await click(".settings-close");
  pass("A real cache-only GitHub vault rejects the old root's held preparation and clears its CSS/fonts. Mode, font and text-size changes persist only in local overlays across reload with zero API/raw requests and exact cached source/configuration/CSS blobs.");
  await command("Page.navigate", { url: localUrl }); await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), localRoot); assert.equal(await evaluate("app.vault.readOnly"), false);
  assert.deepEqual(await styles(), [".obsidian/themes/Portable/theme.css", ".obsidian/snippets/Second.CSS"]); assert.equal(await color(), "#285e9c");
  assert.equal(await evaluate('app.appearance.getControlValue("baseFontSize")'), 24); assert.match((await fontSnapshot()).interface.family, /^"?Arial"?,/);
  for (const [path, bytes] of css) { assert.deepEqual(await readFile(join(directory, ...path.split("/"))), bytes, "Appearance rewrote CSS: " + path); }
  assert.deepEqual(await readFile(join(directory, source)), sourceBytes);
  assert.deepEqual(await readFile(join(directory, reading)), readingBytes);
  assert.deepEqual(await readFile(workspacePath), workspaceBytes);
  assert.deepEqual(readRequests().filter(url => url.includes("appearance.invalid")), []);
  pass("Returning to the real local vault restores only its own appearance. All authored CSS bytes, original note bytes and imported workspace source remain exact, with no authored probe network loads.");
}
