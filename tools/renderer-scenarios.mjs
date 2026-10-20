import { expectErrors } from "./error-log-audit.mjs";
import assert from "node:assert/strict";
import { assertCommunityPluginConfiguration, setCommunityPluginEnabled } from "./community-plugin-test-helpers.mjs";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pixel } from "./reading-scenarios.mjs";

const id = "markdown-host-probe";
const source = String.raw`
const { Plugin, Component, Modal, MarkdownRenderer, MarkdownRenderChild, MarkdownPreviewRenderer } = require("obsidian");
const classic = require("codemirror");
const { EditorState } = require("@codemirror/state");
const { StreamLanguage, syntaxTree, highlightingFor } = require("@codemirror/language");
const { highlightTree } = require("@lezer/highlight");
class Counter extends MarkdownRenderChild {
  constructor(element, state) { super(element); this.state = state; }
  async onload() {
    this.state.started++;
    if (this.state.deferChild) await new Promise(resolve => { this.state.resolveChild = resolve; });
    this.state.loaded++;
    this.registerDomEvent(this.containerEl, "click", () => this.state.clicks++);
  }
  onunload() { this.state.unloaded++; }
}
module.exports = class extends Plugin {
  onload() {
    const state = this.state = globalThis.markdownProbe = { calls: [], contexts: [], started: 0, loaded: 0, unloaded: 0, clicks: 0 };
    const early = this.registerMarkdownPostProcessor(async (element, context) => {
      if (!context.sourcePath.startsWith("Plugin rendering/")) return;
      state.calls.push("early");
      state.contexts.push({ docId: context.docId, path: context.sourcePath, frontmatter: context.frontmatter,
        section: context.getSectionInfo(element.querySelector("p strong") ?? element.querySelector("p")),
        outside: context.getSectionInfo(document.body) });
      const button = element.createEl("button", { text: "Rendered action", attr: { "data-markdown-probe-control": "" } });
      state.retained = button;
      context.addChild(new Counter(button, state));
      if (state.fail) throw new Error("Expected Markdown processor failure");
      if (state.deferProcessor) {
        await new Promise(resolve => { state.resolveProcessor = resolve; });
        state.staleSection = context.getSectionInfo(button);
        element.createDiv({ text: "Obsolete processor output", cls: "markdown-probe-obsolete" });
      }
    }, -20);
    this.registerMarkdownPostProcessor((element, context) => {
      if (!context.sourcePath.startsWith("Plugin rendering/")) return;
      state.calls.push("late");
      element.dataset.markdownProbeOrder = state.calls.slice(-2).join(",");
      element.dataset.markdownProbeDoc = context.docId;
    }, 20);
    state.registrationIdentity = early;
    const staticProcessor = (element, context) => {
      if (context.sourcePath.startsWith("Plugin rendering/")) element.createSpan({ text: "Registered later", cls: "markdown-probe-static" });
    };
    state.registerStatic = () => { MarkdownPreviewRenderer.registerPostProcessor(staticProcessor, -100); state.staticActive = true; };
    state.unregisterStatic = () => { MarkdownPreviewRenderer.unregisterPostProcessor(staticProcessor); state.staticActive = false; };
    this.register(() => { if (state.staticActive) state.unregisterStatic(); });
    state.rendererTypes = { render: typeof MarkdownRenderer?.render, legacy: typeof MarkdownRenderer?.renderMarkdown,
      factory: typeof MarkdownPreviewRenderer.createCodeBlockPostProcessor };
    state.installCodeBlocks = () => {
      state.blocks = [];
      state.blockButtons = [];
      state.blockCounts = { started: 0, loaded: 0, unloaded: 0, clicks: 0 };
      state.blockRegistration = this.registerMarkdownCodeBlockProcessor("slopsidian-probe", async (source, element, context) => {
        const record = { source, path: context.sourcePath, frontmatter: context.frontmatter, docId: context.docId, section: context.getSectionInfo(element) };
        state.blocks.push(record);
        element.createEl("output", { text: source, attr: { "data-code-block-source": "" } });
        const button = element.createEl("button", { text: "Code action", attr: { "data-code-block-control": "" } });
        state.blockButtons.push(button);
        context.addChild(new Counter(button, state.blockCounts));
        if (state.deferBlock) await new Promise(resolve => { state.resolveBlock = resolve; });
        if (state.failBlock && source === "fail") throw new Error("Expected code block failure");
        element.createSpan({ text: "Async complete", cls: "api-code-finished" });
        record.finished = true;
      }, -10);
      this.registerMarkdownPostProcessor(MarkdownPreviewRenderer.createCodeBlockPostProcessor("slopsidian-static", (source, element, context) => {
        state.factorySection = context.getSectionInfo(element);
        element.createEl("output", { text: source, attr: { "data-code-block-factory": "" } });
      }), -5);
      state.newApiOwner = async () => {
        state.apiOwner = this.addChild(new Component());
        await state.apiOwner.load();
      };
      state.openApi = async () => {
        await state.newApiOwner();
        const modal = state.apiModal = new Modal(this.app);
        modal.setTitle("Actual Markdown renderer API");
        state.apiElement = modal.contentEl.createDiv({ attr: { "data-markdown-api-output": "" } });
        state.sentinel = state.apiElement.createEl("button", { text: "Existing content", attr: { "data-markdown-api-sentinel": "" } });
        state.sentinelClicks = 0;
        state.apiOwner.registerDomEvent(state.sentinel, "click", () => state.sentinelClicks++);
        modal.onClose = () => {
          state.apiClosing = state.apiOwner.unload();
          state.apiClosing.catch(error => console.error(error));
        };
        this.register(() => modal.close());
        state.revokedUrls = [];
        const revoke = URL.revokeObjectURL;
        URL.revokeObjectURL = url => { state.revokedUrls.push(url); revoke.call(URL, url); };
        this.register(() => { URL.revokeObjectURL = revoke; });
        modal.open();
      };
      state.appendApi = async (text, legacy = false) => {
        if (legacy) await MarkdownRenderer.renderMarkdown(text, state.apiElement, "Plugin rendering/Blocks.md", state.apiOwner);
        else await MarkdownRenderer.render(this.app, text, state.apiElement, "Plugin rendering/Blocks.md", state.apiOwner);
      };
      state.invalidOwner = () => MarkdownRenderer.render(this.app, "Invalid owner", state.apiElement, "", {});
    };
    state.checkLegacy = () => {
      const original = "# Before\n\n" + "Filler text.\n".repeat(60) + "\nHeading\n-------\n\n| A | B |\n| --- | --- |\n| one | two |\n";
      const language = StreamLanguage.define(classic.getMode({}, "hypermd"));
      let editor = EditorState.create({ doc: original, extensions: [language] });
      const compare = text => {
        const expected = Array.from({ length: text.length }, () => "");
        const actual = [...expected];
        const lines = text.split("\n"), offsets = [];
        let offset = 0;
        for (const line of lines) { offsets.push(offset); offset += line.length + 1; }
        classic.runMode(text, "hypermd", (part, style, line, column) => {
          if (!style || typeof line !== "number") return;
          const classes = style.split(/\s+/).filter(Boolean).map(value => "cm-" + value).sort().join(" ");
          for (let index = 0; index < part.length; index++) expected[offsets[line] + column + index] = classes;
        });
        highlightTree(syntaxTree(editor), { style: tags => highlightingFor(editor, tags) }, (from, to, style) => {
          const classes = style.split(/\s+/).filter(value => value.startsWith("cm-")).sort().join(" ");
          for (let index = from; index < to; index++) actual[index] = classes;
        });
        return { mismatches: expected.flatMap((value, index) => value === actual[index] ? [] : [{ index, expected: value, actual: actual[index] }]).slice(0, 8),
          styledCharacters: expected.filter(Boolean).length, headingClasses: expected[text.indexOf("Heading")] };
      };
      const before = compare(original);
      const from = original.indexOf("-------");
      const changed = original.slice(0, from) + "not a heading" + original.slice(from + 7);
      editor = editor.update({ changes: { from, to: from + 7, insert: "not a heading" } }).state;
      const after = compare(changed);
      return { sameRuntime: classic === window.CodeMirror, before, after };
    };
  }
};
`;

export async function checkMarkdownProcessors(tools) {
  const { directory, evaluate, command, click, press, wait, restart, afterReload, report } = tools;
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const note = "Plugin rendering/Context.md";
  const content = "---\r\nprobe: preserved\r\n---\r\n\r\n# Renderer context\r\n\r\nParagraph **bold**.\r\n";
  const original = Buffer.from("\ufeff" + content);
  const blocksNote = "Plugin rendering/Blocks.md";
  const blocksContent = ["---", "probe: code", "---", "", "# Block rendering", "", "```slopsidian-probe",
    "first <>& \u03bb", "", "```", "", "> ```slopsidian-probe", "> nested", "> ```", "",
    "```slopsidian-static", "factory source", "```", "", "```other-language", "not processed", "```", ""].join("\r\n");
  const blocksOriginal = Buffer.from("\ufeff" + blocksContent);
  const image = pixel(3, 2);
  const communityPath = join(directory, ".obsidian", "community-plugins.json");
  let community = null;
  try { community = await readFile(communityPath); } catch (error) { if (error.code !== "ENOENT") { throw error; } }
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const layout = await evaluate("app.workspace.getLayout()");
  await mkdir(join(directory, "Plugin rendering"), { recursive: true });
  await writeFile(join(directory, note), original);
  await writeFile(join(directory, blocksNote), blocksOriginal);
  await writeFile(join(directory, "Plugin rendering", "Pixel.png"), image);
  const folder = join(directory, ".obsidian", "plugins", id);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "manifest.json"), JSON.stringify({ id, name: "Markdown host probe", version: "1.0.0", description: "Independent renderer lifecycle and genuine classic tokenizer fixture", isDesktopOnly: false }));
  await writeFile(join(folder, "main.js"), source);
  if (restart) { await restart(); } else { await command("Page.reload"); }
  await afterReload();
  async function toggle(enabled) {
    await setCommunityPluginEnabled({ evaluate, click, wait }, id, enabled);
    await click(".settings-close");
  }
  const mode = async value => {
    await evaluate(`(async()=>{const leaf=app.workspace.activeLeaf;await leaf.setViewState({type:"markdown",state:{...leaf.getViewState().state,mode:${JSON.stringify(value)},source:true}})})()`);
  };
  const settled = () => wait('Boolean(document.querySelector(\'[data-markdown-probe-order="early,late"]\'))&&markdownProbe.loaded>0', "ordered real postprocessor output");
  await toggle(true);
  const legacy = await evaluate("markdownProbe.checkLegacy()");
  report.classicTokenizer = legacy;
  assert.equal(legacy.sameRuntime, true);
  assert.match(legacy.before.headingClasses, /cm-header/);
  assert.doesNotMatch(legacy.after.headingClasses, /cm-header/);
  assert.deepEqual(legacy.before.mismatches, []);
  assert.deepEqual(legacy.after.mismatches, []);
  await evaluate(`app.openFile(${JSON.stringify(note)},"tab")`);
  await mode("preview");
  await settled();
  const context = await evaluate("markdownProbe.contexts.at(-1)");
  assert.equal(context.path, note);
  assert.equal(context.frontmatter.probe, "preserved");
  assert.equal(context.outside, null);
  assert.match(context.docId, /^[a-f\d-]{36}$/);
  assert.deepEqual(context.section, { text: content, lineStart: 6, lineEnd: 6 });
  assert.deepEqual(context.section.text.split("\r\n").slice(context.section.lineStart, context.section.lineEnd + 1), ["Paragraph **bold**."]);
  assert.equal(await evaluate('document.querySelector("[data-markdown-probe-doc]").dataset.markdownProbeDoc'), context.docId);
  await click("[data-markdown-probe-control]");
  assert.equal(await evaluate("markdownProbe.clicks"), 1);
  assert.deepEqual(await readFile(join(directory, note)), original);
  pass("Real shared Markdown postprocessors run in async sort order with matching document/source/frontmatter/section context and owned interactive controls; genuine classic HyperMD and the modern bridge agree before and after a following-line edit without changing source bytes.");

  await evaluate("markdownProbe.retained.remove();true");
  await wait("markdownProbe.loaded===markdownProbe.unloaded", "render child unloaded after owned DOM removal");
  await evaluate("markdownProbe.retained.click();true");
  assert.equal(await evaluate("markdownProbe.clicks"), 1);
  await mode("source");
  await evaluate("markdownProbe.deferChild=true;true");
  await mode("preview");
  await wait("typeof markdownProbe.resolveChild==='function'", "pending real render-child onload");
  await mode("source");
  await evaluate("markdownProbe.deferChild=false;markdownProbe.resolveChild();true");
  await wait("markdownProbe.loaded===markdownProbe.unloaded", "late-loaded child receives cleanup");
  await evaluate("markdownProbe.retained.click();true");
  assert.equal(await evaluate("markdownProbe.clicks"), 1);
  pass("Render-child removal and Reading/Source transitions unload actual component events; an asynchronous onload that finishes after removal is still cleaned up and its retained button cannot act.");

  await evaluate("markdownProbe.deferProcessor=true;true");
  await mode("preview");
  await wait("typeof markdownProbe.resolveProcessor==='function'", "pending actual asynchronous postprocessor");
  await mode("source");
  await evaluate("markdownProbe.deferProcessor=false;true");
  await mode("preview");
  await settled();
  const newDoc = await evaluate('document.querySelector("[data-markdown-probe-doc]").dataset.markdownProbeDoc');
  await evaluate("markdownProbe.resolveProcessor();true");
  await wait("markdownProbe.staleSection===null", "stale context invalidated");
  assert.equal(await evaluate('Boolean(document.querySelector(".markdown-probe-obsolete"))'), false);
  assert.equal(await evaluate('document.querySelector("[data-markdown-probe-doc]").dataset.markdownProbeDoc'), newDoc);
  await mode("source");
  await evaluate("markdownProbe.fail=true;true");
  await expectErrors(tools, [{ source: "notification", message: "Expected Markdown processor failure", stackIncludes: "vault-plugin:markdown-host-probe:" }], () => mode("preview"), "Exercise the owned Markdown postprocessor rejection fixture");
  await wait('document.querySelector("#client-errors").textContent.includes("Expected Markdown processor failure")&&Boolean(document.querySelector(".reading-embed-error"))', "visible actual processor rejection");
  await mode("source");
  await evaluate('markdownProbe.fail=false;document.querySelector("#client-errors").replaceChildren();true');
  await mode("preview");
  await settled();
  pass("Superseded asynchronous processors can only change their detached render section, stale section queries return null, and current processor errors are visible without rewriting or poisoning the next render.");

  await evaluate("markdownProbe.registerStatic();true");
  await wait('Boolean(document.querySelector(".markdown-probe-static"))', "registration refreshes unchanged Reading content");
  await evaluate("markdownProbe.unregisterStatic();true");
  await wait('!document.querySelector(".markdown-probe-static")&&Boolean(document.querySelector("[data-markdown-probe-control]"))', "unregister refreshes unchanged Reading content");
  await toggle(false);
  await wait('!document.querySelector("[data-markdown-probe-control]")&&markdownProbe.loaded===markdownProbe.unloaded', "plugin unload refreshes Reading and disposes children");
  assert.match(await evaluate("app.markdownView.previewEl.textContent"), /Paragraph bold\./);
  assert.deepEqual(await readFile(join(directory, note)), original);
  await evaluate("app.workspace.flushLayout()");
  if (restart) { await restart(); } else { await command("Page.reload"); }
  await afterReload();
  assert.equal(await evaluate("app.markdownView.getMode()"), "preview");
  assert.equal(await evaluate(`Boolean(app.plugins.plugins["${id}"])`), false);
  assert.equal(await evaluate('Boolean(document.querySelector("[data-markdown-probe-control]"))'), false);
  await toggle(true);
  await settled();
  await toggle(false);
  await evaluate(`app.workspace.changeLayout(${JSON.stringify(layout)},false)`);
  assert.deepEqual(await readFile(join(directory, note)), original);
  await assertCommunityPluginConfiguration(communityPath, community, { [id]: false });
  assert.equal(await evaluate('document.querySelector("#client-errors").textContent'), "");
  report.markdownProcessors = { fixture: id, sha256: createHash("sha256").update(source).digest("hex"), thirdPartyPlugin: false, privateRendererEquivalence: "not established", classicTokenizerReference: "unchanged public HyperMD and CodeMirror 5, not the private Obsidian fork" };
  pass("Register/unregister and real plugin disable refresh unchanged Reading views and remove owned controls; a persisted disable survives restart/reconnect, re-enable works, and original Markdown BOM/CRLF plus other configured plugin IDs remain unchanged.");

  await toggle(true);
  assert.deepEqual(await evaluate("markdownProbe.rendererTypes"), { render: "function", legacy: "function", factory: "function" });
  await evaluate("markdownProbe.installCodeBlocks();true");
  await evaluate(`app.openFile(${JSON.stringify(blocksNote)},"tab")`);
  await mode("preview");
  await wait('document.querySelectorAll(".block-language-slopsidian-probe .api-code-finished").length===2&&Boolean(document.querySelector("[data-code-block-factory]"))', "real async fenced-code processors");
  const blocks = await evaluate("markdownProbe.blocks");
  assert.deepEqual(blocks.map(block => block.source), ["first <>& \u03bb\n", "nested"]);
  assert.deepEqual(blocks[0].section, { text: blocksContent, lineStart: 6, lineEnd: 9 });
  assert.deepEqual(blocks[1].section, { text: blocksContent, lineStart: 11, lineEnd: 13 });
  assert.equal(blocks[0].docId, blocks[1].docId);
  assert.equal(blocks[0].frontmatter.probe, "code");
  assert.equal(blocks[0].path, blocksNote);
  assert.equal(await evaluate('document.querySelector("[data-code-block-factory]").textContent'), "factory source");
  assert.match(await evaluate('document.querySelector("code.language-other-language").textContent'), /^not processed\n$/);
  await click("[data-code-block-control]");
  assert.equal(await evaluate("markdownProbe.blockCounts.clicks"), 1);
  await mode("source");
  await wait("markdownProbe.blockCounts.loaded===markdownProbe.blockCounts.unloaded", "fenced-code child cleanup");
  await evaluate("markdownProbe.blockButtons[0].click();true");
  assert.equal(await evaluate("markdownProbe.blockCounts.clicks"), 1);
  const rejectedRegistrations = await evaluate(`(()=>{
    const plugin=app.plugins.plugins[${JSON.stringify(id)}], errors=[];
    for(const [language,order] of [["slopsidian-probe",0],["invalid language",0],["slopsidian-retry",0.5],["mermaid",0]]) {
      try { plugin.registerMarkdownCodeBlockProcessor(language,()=>{},order); errors.push(null); }
      catch(error) { errors.push(error.message); }
    }
    plugin.registerMarkdownCodeBlockProcessor("slopsidian-retry",(source,element)=>element.createSpan({text:"retry: "+source,cls:"api-retry"}));
    return errors;
  })()`);
  assert.match(rejectedRegistrations[0], /already registered/);
  assert.match(rejectedRegistrations[1], /language without whitespace/);
  assert.match(rejectedRegistrations[2], /integer sort order/);
  assert.match(rejectedRegistrations[3], /built-in Mermaid renderer/);
  assert.deepEqual(await readFile(join(directory, blocksNote)), blocksOriginal);
  pass("Actual plugin and factory code-block processors replace real fenced/nested code, await async handlers, preserve raw Unicode/HTML-like text and trailing blank lines, expose exact source/section context and own working controls; duplicate/invalid registrations reject without reserving a failed language.");

  const leavesBefore = await evaluate("app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.id)");
  await evaluate("markdownProbe.openApi()");
  const fragment = ["---", "probe: fragment", "---", "", "# API fragment", "", "Paragraph **first**.",
    "", "```slopsidian-probe", "fragment", "```", "", "```slopsidian-retry", "available", "```",
    "", "![Pixel](Pixel.png)", "", "[[Context#Renderer context|Vault link]]", "",
    "[[Missing renderer target]]", "",
    "<script>globalThis.rendererInjected=true</script>", ""].join("\r\n");
  await evaluate(`markdownProbe.deferBlock=true;markdownProbe.apiDone=false;markdownProbe.apiPending=markdownProbe.appendApi(${JSON.stringify(fragment)}).then(()=>{markdownProbe.apiDone=true});true`);
  await wait("typeof markdownProbe.resolveBlock==='function'", "deferred real static code-block handler");
  assert.equal(await evaluate("markdownProbe.apiDone"), false);
  await evaluate("markdownProbe.deferBlock=false;markdownProbe.resolveBlock();true");
  await evaluate("markdownProbe.apiPending");
  await wait('(()=>{const image=document.querySelector("[data-markdown-api-output] img");return image?.complete&&image.naturalWidth===3&&image.naturalHeight===2})()', "actual source-relative static vault image");
  assert.equal(await evaluate("markdownProbe.blocks.at(-1).section"), null);
  assert.equal(await evaluate("markdownProbe.blocks.at(-1).frontmatter.probe"), "fragment");
  assert.equal(await evaluate('document.querySelector(".api-retry").textContent'), "retry: available");
  assert.equal(await evaluate('Boolean(globalThis.rendererInjected||document.querySelector("[data-markdown-api-output] script"))'), false);
  await evaluate('markdownProbe.firstFragment=markdownProbe.apiElement.querySelector(".markdown-renderer-fragment");markdownProbe.apiImageUrl=markdownProbe.apiElement.querySelector("img").src;true');
  await evaluate('markdownProbe.appendApi("Legacy **second**.",true)');
  assert.equal(await evaluate('markdownProbe.apiElement.firstElementChild===markdownProbe.sentinel&&markdownProbe.apiElement.querySelector(".markdown-renderer-fragment")===markdownProbe.firstFragment'), true);
  assert.match(await evaluate("markdownProbe.apiElement.textContent"), /Legacy second\./);
  assert.deepEqual(await evaluate("app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.id)"), leavesBefore);
  await click("[data-markdown-api-sentinel]");
  assert.equal(await evaluate("markdownProbe.sentinelClicks"), 1);
  const pins = await evaluate("(async()=>{const leaves=app.workspace.getLeavesOfType('markdown'),saved=leaves.map(leaf=>({id:leaf.id,pinned:leaf.getViewState().pinned??false}));for(const leaf of leaves)await leaf.setViewState({...leaf.getViewState(),pinned:true});return saved})()");
  await expectErrors(tools, [{ source: "notification", message: "The linked file does not exist: Missing renderer target", stackIncludes: "openMarkdownLink" }],
    () => click('[data-markdown-api-output] a[data-slopsidian-link="Missing renderer target"]'), "Reject the deliberately missing static-renderer link before creating a pane");
  await wait('document.querySelector("#client-errors").textContent.includes("The linked file does not exist: Missing renderer target")', "invalid static link fails before creating a pane");
  assert.deepEqual(await evaluate("app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.id)"), leavesBefore);
  await evaluate(`(async()=>{for(const saved of ${JSON.stringify(pins)}){const leaf=app.workspace.getLeafById(saved.id);await leaf.setViewState({...leaf.getViewState(),pinned:saved.pinned})}document.querySelector("#client-errors").replaceChildren()})()`);
  await click('[data-markdown-api-output] a[data-slopsidian-link="Context#Renderer context"]');
  await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(note)}`, "static-rendered link opens the actual vault target");
  assert.equal(await evaluate("app.markdownView.getMode()"), "preview");
  await mode("source");
  pass("Real MarkdownRenderer.render and deprecated renderMarkdown append independently owned formatted fragments without replacing prior DOM or opening hidden leaves, await actual handlers, provide null fragment-section context, sanitize note HTML and resolve a decoded vault image plus working source-relative link.");

  await evaluate('markdownProbe.blockCounts.deferChild=true;markdownProbe.apiDone=false;markdownProbe.apiPending=markdownProbe.appendApi("```slopsidian-probe\\nchild pending\\n```").then(()=>{markdownProbe.apiDone=true});true');
  await wait("typeof markdownProbe.blockCounts.resolveChild==='function'", "static render awaits actual child onload");
  assert.equal(await evaluate("markdownProbe.apiDone"), false);
  await evaluate("markdownProbe.blockCounts.deferChild=false;markdownProbe.blockCounts.resolveChild();true");
  await evaluate("markdownProbe.apiPending");
  const unloadedBefore = await evaluate("markdownProbe.blockCounts.unloaded");
  await evaluate('markdownProbe.removedButton=markdownProbe.blockButtons.at(-1);markdownProbe.apiElement.lastElementChild.remove();true');
  await wait(`markdownProbe.blockCounts.unloaded===${unloadedBefore + 1}`, "removed static fragment disposes its owned child");
  const clicksBefore = await evaluate("markdownProbe.blockCounts.clicks");
  await evaluate("markdownProbe.removedButton.click();true");
  assert.equal(await evaluate("markdownProbe.blockCounts.clicks"), clicksBefore);
  await evaluate('markdownProbe.deferBlock=true;markdownProbe.apiDone=false;markdownProbe.apiPending=markdownProbe.appendApi("```slopsidian-probe\\nstale pending\\n```").then(()=>{markdownProbe.apiDone=true});true');
  await wait("markdownProbe.blocks.at(-1)?.source==='stale pending'&&typeof markdownProbe.resolveBlock==='function'", "pending static processor before owner unload");
  await evaluate("markdownProbe.apiOwner.unload()");
  assert.equal(await evaluate("markdownProbe.apiDone"), false);
  assert.equal(await evaluate("markdownProbe.revokedUrls.includes(markdownProbe.apiImageUrl)"), true);
  await evaluate('markdownProbe.newApiOwner()');
  await evaluate('markdownProbe.deferBlock=false;markdownProbe.appendApi("Surviving **render**.")');
  await evaluate("markdownProbe.resolveBlock();true");
  await evaluate("markdownProbe.apiPending");
  assert.match(await evaluate("markdownProbe.apiElement.textContent"), /Surviving render\./);
  assert.equal(await evaluate('Boolean(markdownProbe.apiElement.querySelector(".api-code-finished"))'), false);
  await evaluate("markdownProbe.sentinel.click();true");
  assert.equal(await evaluate("markdownProbe.sentinelClicks"), 1);
  pass("Static rendering waits for real asynchronous render-child loads; removing its DOM unloads controls, owner unload revokes the actual image URL, and a late processor can only mutate its detached section while a new render and disposed retained controls remain correct.");

  await evaluate("markdownProbe.failBlock=true;true");
  const failedRender = await expectErrors(tools, [{ source: "notification", message: "Expected code block failure", stackIncludes: "vault-plugin:markdown-host-probe:" }], () => evaluate('(async()=>{try{await markdownProbe.appendApi("```slopsidian-probe\\nfail\\n```\\n\\n```slopsidian-probe\\nvalid\\n```");return null}catch(error){return error.message}})()'), "Exercise the owned code-block renderer rejection fixture");
  assert.match(failedRender, /Expected code block failure/);
  await wait('document.querySelector("#client-errors").textContent.includes("Expected code block failure")&&Boolean(document.querySelector("[data-markdown-api-output] .reading-embed-error"))', "failed block renderer is visible and rejects");
  assert.match(await evaluate('markdownProbe.apiElement.querySelector(".reading-embed-error").textContent'), /Expected code block failure/);
  assert.match(await evaluate('markdownProbe.apiElement.querySelector("pre code").textContent'), /^fail\n$/);
  assert.equal(await evaluate('markdownProbe.apiElement.querySelectorAll(".api-code-finished").length'), 1);
  const invalidOwner = await evaluate('(async()=>{const count=markdownProbe.apiElement.children.length;try{await markdownProbe.invalidOwner();return null}catch(error){return {message:error.message,unchanged:count===markdownProbe.apiElement.children.length}}})()');
  assert.match(invalidOwner.message, /owning Component/);
  assert.equal(invalidOwner.unchanged, true);
  await evaluate('markdownProbe.failBlock=false;document.querySelector("#client-errors").replaceChildren();true');
  await click(".modal-container .modal-close-button");
  await evaluate("markdownProbe.apiClosing");
  await wait("markdownProbe.blockCounts.loaded===markdownProbe.blockCounts.unloaded&&markdownProbe.loaded===markdownProbe.unloaded", "static owner cleanup completes all actual children");
  await evaluate(`app.openFile(${JSON.stringify(blocksNote)},"tab")`);
  await mode("preview");
  await wait('document.querySelectorAll(".block-language-slopsidian-probe .api-code-finished").length===2', "real Reading processors before disable");
  await toggle(false);
  await wait('!document.querySelector(".block-language-slopsidian-probe")&&Boolean(document.querySelector("code.language-slopsidian-probe"))', "provider unload restores original code");
  await toggle(true);
  await evaluate("markdownProbe.installCodeBlocks();true");
  await wait('document.querySelectorAll(".block-language-slopsidian-probe .api-code-finished").length===2', "code language ownership released for re-enable");
  await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
  const enabledBeforeRestart = await readFile(communityPath);
  if (restart) { await restart(); } else { await command("Page.reload"); }
  await afterReload();
  assert.equal(await evaluate("app.markdownView.getMode()"), "preview");
  assert.equal(await evaluate(`Boolean(app.plugins.plugins["${id}"])`), true);
  assert.deepEqual(await readFile(communityPath), enabledBeforeRestart, "Restoring the configured renderer must not rewrite canonical enablement.");
  assert.equal(await evaluate('Boolean(document.querySelector(".block-language-slopsidian-probe"))'), false);
  await evaluate("markdownProbe.installCodeBlocks();true");
  await wait('document.querySelectorAll(".block-language-slopsidian-probe .api-code-finished").length===2', "actual code processors after configured full restart/reconnect");
  await toggle(false);
  await evaluate(`app.workspace.changeLayout(${JSON.stringify(layout)},false)`);
  assert.deepEqual(await readFile(join(directory, note)), original);
  assert.deepEqual(await readFile(join(directory, blocksNote)), blocksOriginal);
  assert.deepEqual(await readFile(join(directory, "Plugin rendering", "Pixel.png")), image);
  await assertCommunityPluginConfiguration(communityPath, community, { [id]: false });
  assert.equal(await evaluate('document.querySelector("#client-errors").textContent'), "");
  report.markdownProcessors.staticRenderer = { actualApi: true, fragmentSections: null, fullInstanceAbi: "not established" };
  report.markdownProcessors.codeBlocks = { actualHandlers: true, livePreviewWidgets: "not implemented", privateReplaceCode: "not implemented" };
  pass("Async code-block failures reject and visibly retain original code while another block renders; invalid owners write no DOM, disable restores plain fences, re-enable/restart/reconnect removes language registrations correctly, and original Markdown/image bytes plus other enabled IDs remain unchanged.");
  const { checkRenderChildOwnership } = await import("./render-child-scenarios.mjs");
  await checkRenderChildOwnership(tools);
}
