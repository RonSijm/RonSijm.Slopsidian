import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkMermaid({ directory, evaluate, command, click, press, wait, report, afterReload, restart, capture }) {
  const folder = "Mermaid workflows", note = folder + "/Diagrams.md", bad = folder + "/Errors.md", slides = folder + "/Slides.md";
  const definitions = [
    "flowchart LR\n  A[Start λ 中文] --> B{Ready?}\n  B -->|Yes| C[Done]\n  B -->|No| A",
    "sequenceDiagram\n  participant Alice\n  participant Bob\n  Alice->>Bob: Hello λ\n  Bob-->>Alice: Ready",
    "classDiagram\n  Animal <|-- Duck\n  Animal : +int age\n  Duck : +swim()",
    "stateDiagram-v2\n  [*] --> Draft\n  Draft --> Published\n  Published --> [*]",
    "erDiagram\n  USER ||--o{ NOTE : writes\n  NOTE {\n    string title\n  }",
    "gantt\n  title Build plan\n  dateFormat YYYY-MM-DD\n  section Work\n  Mermaid :a1, 2026-10-21, 1d",
    'pie title Tasks\n  "Done" : 8\n  "Next" : 2',
    "mindmap\n  root((Notes))\n    Mermaid\n    Markdown",
    "gitGraph\n  commit\n  branch feature\n  checkout feature\n  commit\n  checkout main\n  merge feature",
    "---\ntitle: Configured diagram\nconfig:\n  theme: forest\n  layout: elk\n---\nflowchart LR\n  Start --> Finish",
  ];
  const fenced = text => "```mermaid\n" + text + "\n```\n";
  const initial = ("---\ntitle: Diagram fixture\n---\n# Mermaid examples\n\n" + definitions.map(fenced).join("\n") + '\n```javascript\nconst mermaid = "ordinary code";\n```\n\n````text\n```mermaid\nflowchart LR\n Do --> NotRender\n```\n````\n').replaceAll("\n", "\r\n");
  const small = label => ("# Live diagrams\n\n" + fenced(`flowchart LR\n A[${label}] --> B[Done]`)).replaceAll("\n", "\r\n");
  const bytes = content => Buffer.from("\ufeff" + content);
  const active = ".workspace-tabs.mod-active .workspace-leaf:not([hidden])", preview = active + " .markdown-preview-view";
  const editor = active + " .cm-content[contenteditable=true]";
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  const originalWorkspace = await readFile(join(directory, ".obsidian", "workspace.json")).catch(error => { if (error.code !== "ENOENT") { throw error; } return null; });
  async function refresh() { await evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()"); }
  async function open(path) { await click(`[data-note-path="${path}"]`); await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(path)}`, "file tree opens " + path); }
  async function mode(value) { if (await evaluate("app.workspace.activeLeaf.view.getMode()") !== value) { await press("e", "KeyE", 69, 2); } }
  async function fill(content) { await click(editor + " .cm-line"); await press("a", "KeyA", 65, 2); await command("Input.insertText", { text: content }); }
  async function ready(count, selector = preview) {
    await wait(`(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify(selector + " [data-mermaid-status]")})];return nodes.length===${count}&&nodes.every(n=>n.dataset.mermaidStatus!=="pending")})()`, "all Mermaid blocks settle");
    const states = await evaluate(`[...document.querySelectorAll(${JSON.stringify(selector + " [data-mermaid-status]")})].map(n=>({state:n.dataset.mermaidStatus,error:n.querySelector('.mermaid-status')?.textContent,decoded:n.querySelector('img')?.naturalWidth>0}))`);
    assert.ok(states.every(n => n.state === "ready" && n.decoded), JSON.stringify(states));
  }
  async function observeImages() {
    await evaluate("window.mermaidTestBlobs=new Map();window.mermaidOriginalCreate=URL.createObjectURL;URL.createObjectURL=value=>{const url=window.mermaidOriginalCreate(value);if(value.type==='image/svg+xml')window.mermaidTestBlobs.set(url,value);return url}");
  }
  async function svg(selector = preview + " .mermaid-image") { return evaluate(`window.mermaidTestBlobs.get(document.querySelector(${JSON.stringify(selector)}).src).text()`); }
  async function labels(selector = preview + " .mermaid-image") { return evaluate(`(async()=>{const text=await window.mermaidTestBlobs.get(document.querySelector(${JSON.stringify(selector)}).src).text();const doc=new DOMParser().parseFromString(text,"image/svg+xml");return [...doc.querySelectorAll("text")].map(n=>[...n.childNodes].map(c=>c.textContent).join(" ")).join(" ").replace(/\\s+/g," ")})()`); }
  async function save() { await mode("source"); await click(editor); await press("s", "KeyS", 83, 2); await wait("!app.dirty", "explicit note save"); }
  async function restartAndRestore() { await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()"); if (restart) { await restart(); } else { await command("Page.reload"); } await afterReload(); }
  async function enable(id) { if (!await evaluate(`app.core.isEnabled(${JSON.stringify(id)})`)) { await evaluate(`app.core.setEnabled(${JSON.stringify(id)},true)`); } }

  await enable("file-explorer");
  if (await evaluate("app.workspace.leftSplit.collapsed")) { await click('[aria-label="Toggle left sidebar"]'); }
  await click('[data-sidebar-view="file-explorer"]');
  await evaluate("app.workspace.saveAll()"); await observeImages(); await mkdir(join(directory, folder), { recursive: true });
  await writeFile(join(directory, note), bytes(initial)); await refresh(); await open(note); await mode("preview");
  await ready(definitions.length);
  assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(preview + " svg, " + preview + " iframe")}).length`), 0, "engine SVG never enters the application DOM");
  assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(preview + " pre code.language-javascript")}).length`), 1);
  assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(preview + " pre code.language-text")}).length`), 1, "nested literal fence remains literal code");
  assert.match(await labels(), /Start λ 中文/);
  assert.equal(await evaluate("app.dirty"), false); assert.deepEqual(await readFile(join(directory, note)), bytes(initial));
  await click(preview); await press("Home", "Home", 36, 2); await capture?.();
  pass("Ten real Mermaid diagrams render and decode locally: flowchart, sequence, class, state, ER, Gantt, pie, mindmap, Git and ELK/theme frontmatter; literal fences stay code and original BOM/CRLF/Unicode bytes remain unchanged.");

  await mode("source"); await fill(small("Unsaved δ")); await mode("preview"); await ready(1);
  assert.match(await labels(), /Unsaved δ/); assert.equal(await evaluate("app.dirty"), true);
  assert.deepEqual(await readFile(join(directory, note)), bytes(initial));
  await mode("source"); await click(editor); await press("z", "KeyZ", 90, 2);
  assert.equal(await evaluate("app.editor.getValue()"), initial, "Reading mode retains editor undo");
  await press("y", "KeyY", 89, 2); assert.equal(await evaluate("app.editor.getValue()"), small("Unsaved δ"));
  await mode("preview"); await ready(1); const readingLeaf = await evaluate("app.workspace.activeLeaf.id");
  await evaluate('app.commands.execute("workspace:split-vertical")'); await mode("source");
  const otherPreview = `[data-leaf-id="${readingLeaf}"] .markdown-preview-view`;
  const oldUrl = await evaluate(`document.querySelector(${JSON.stringify(otherPreview + " .mermaid-image")}).src`);
  await evaluate("window.mermaidRevoked=[];window.mermaidOriginalRevoke=URL.revokeObjectURL;URL.revokeObjectURL=url=>{window.mermaidRevoked.push(url);window.mermaidOriginalRevoke(url)}");
  const final = small("Latest shared value");
  await evaluate(`(()=>{for(let i=0;i<8;i++)app.editor.setValue(${JSON.stringify(small("Superseded"))}+i);app.editor.setValue(${JSON.stringify(final)})})()`);
  await ready(1, otherPreview); assert.match(await labels(otherPreview + " .mermaid-image"), /Latest shared value/);
  assert.ok((await evaluate("window.mermaidRevoked")).includes(oldUrl), "superseded image URLs are revoked");
  await evaluate("URL.revokeObjectURL=window.mermaidOriginalRevoke");
  await save(); assert.deepEqual(await readFile(join(directory, note)), bytes(final));
  await evaluate('app.workspace.activeLeaf.view.setMode("preview");app.workspace.activeLeaf.view.setMode("source")');
  await evaluate(`app.workspace.closeLeaf(app.workspace.getLeafById(${JSON.stringify(readingLeaf)}))`);
  await wait('document.querySelectorAll("[data-mermaid-sandbox]").length===0', "cancelled and completed renderer sandboxes are removed");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(preview)})?.children.length`), 0);
  pass("Unsaved edits render without saving, undo/redo survives mode changes, split panes update from the shared buffer, superseded renders cannot replace current output, and closing/changing modes revokes images and removes sandbox work.");

  const errors = ["flowchart LR\n A -->", "notADiagram\n A-->B", "", "%%{init: {securityLevel: loose}}%%\nflowchart LR\n A-->B", "---\nconfig: {themeCSS: 'body {display:none}'}\n---\nflowchart LR\n A-->B", "x".repeat(32769)];
  const safe = 'flowchart LR\n A[Safe callback label] --> B[Done]\n click A call mermaidUnsafe()';
  const errorText = "# Invalid diagrams\n\n" + errors.map(fenced).join("\n") + fenced(safe) + '\n<pre><code class="language-mermaid">flowchart LR\n Fake --> Diagram</code></pre>\n<svg onload="window.mermaidUnsafe=true"></svg>\n';
  await evaluate("app.metadataCache.pause()");
  try {
    await writeFile(join(directory, bad), bytes(errorText));
    await evaluate('app.dotNet.invokeMethodAsync("OnVaultFilesChanged")');
    await wait(`(()=>{const button=document.querySelector(${JSON.stringify(`[data-note-path="${bad}"]`)});return button?.disabled&&!app.vault.getFileByPath(${JSON.stringify(bad)})})()`, "host renders the new file before the client inventory");
    await evaluate(`(()=>{window.mermaidPendingFile=document.querySelector(${JSON.stringify(`[data-note-path="${bad}"]`)})})()`);
    await evaluate("app.vault.refresh()");
    await wait("!window.mermaidPendingFile.disabled", "inventory refresh enables the existing file-tree control");
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(`[data-note-path="${bad}"]`)})===window.mermaidPendingFile`), true, "the existing file control does not need a replacement render");
  } finally {
    await evaluate("delete window.mermaidPendingFile;app.metadataCache.resume()");
  }
  await refresh(); await open(bad); await mode("preview");
  await wait(`(()=>{const all=[...document.querySelectorAll(${JSON.stringify(preview + " [data-mermaid-status]")})];return all.length===7&&all.every(n=>n.dataset.mermaidStatus!=="pending")})()`, "invalid blocks fail independently");
  assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(preview + ' [data-mermaid-status="error"]')}).length`), 6);
  assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(preview + ' [data-mermaid-status="ready"]')}).length`), 1);
  assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(preview + ' [data-mermaid-status="error"] details[open]')}).length`), 6, "failed source remains readable");
  assert.equal(await evaluate("window.mermaidUnsafe"), undefined);
  assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(preview + " script," + preview + " svg," + preview + " iframe")}))`), false);
  const safeSvg = await svg(); assert.ok(!/<(?:script|foreignObject|image|use|a)\b/i.test(safeSvg));
  assert.deepEqual(await readFile(join(directory, bad)), bytes(errorText));
  await open(note); await mode("preview"); await ready(1);
  const external = small("External refreshed Ω"); await writeFile(join(directory, note), bytes(external)); await refresh();
  await wait(`app.editor.getValue()===${JSON.stringify(external)}`, "clean editor sees external change"); await ready(1); assert.match(await labels(), /External refreshed Ω/);
  pass("Syntax/unknown/empty/oversized blocks and unsafe configuration fail individually with retained code; a following valid diagram still renders, forged HTML cannot become a diagram, callbacks do not execute, and clean external edits refresh the image.");

  await enable("slides"); await enable("page-preview");
  await writeFile(join(directory, slides), bytes("# First slide\n\n" + fenced("flowchart LR\n SlideOne --> Complete") + "\n---\n\n# Second slide\n\n" + fenced("sequenceDiagram\n A->>B: SlideTwo")));
  await refresh(); await open(slides); await evaluate('app.commands.execute("slides:start")');
  await ready(1, ".slides-stage"); await click('[data-slide-action="next"]'); await ready(1, ".slides-stage");
  assert.match(await labels(".slides-stage .mermaid-image"), /SlideTwo/); await click('[data-slide-action="close"]');
  await open(note); await mode("preview"); await ready(1);
  // A real registered hover-link event exercises the shared Page-preview renderer.
  await evaluate(`(()=>{const target=app.workspace.activeLeaf.containerEl;window.mermaidHoverOwner={hoverPopover:null};app.workspace.trigger("hover-link",{event:new MouseEvent("pointermove",{ctrlKey:true,clientX:500,clientY:200}),source:"preview",hoverParent:window.mermaidHoverOwner,targetEl:target,linktext:${JSON.stringify(note)},sourcePath:${JSON.stringify(slides)}})})()`);
  await ready(1, ".page-preview-content"); assert.match(await labels(".page-preview-content .mermaid-image"), /External refreshed Ω/);
  await press("Escape", "Escape", 27); await wait('!document.querySelector(".page-preview-popover")', "preview closes and releases its diagram");
  await restartAndRestore(); await ready(1);
  assert.match(await evaluate(`document.querySelector(${JSON.stringify(preview + " .mermaid-image")}).alt`), /External refreshed Ω/);
  await observeImages();
  await command("Network.setBlockedURLs", { urls: ["https://*"] });
  const offline = small("Local engine only"); await mode("source"); await fill(offline); await save(); await mode("preview"); await ready(1);
  assert.match(await labels(), /Local engine only/);
  await command("Network.setBlockedURLs", { urls: [] });
  assert.deepEqual(await readFile(join(directory, note)), bytes(offline));
  if (originalWorkspace) { assert.deepEqual(await readFile(join(directory, ".obsidian", "workspace.json")), originalWorkspace); }
  else { await assert.rejects(readFile(join(directory, ".obsidian", "workspace.json")), { code: "ENOENT" }); }
  await wait('document.querySelectorAll("[data-mermaid-sandbox]").length===0', "idle render engine releases the frame");
  await evaluate("URL.createObjectURL=window.mermaidOriginalCreate;window.mermaidTestBlobs.clear()");
  pass("Mermaid also renders in actual Slides and Page-preview surfaces, survives full host restart/browser reconnect, works with HTTPS/CDN requests blocked, and preserves exact files plus the original workspace.");
}
