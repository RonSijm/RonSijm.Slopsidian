import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Real-host math and note-embed workflow: Reading, Live Preview, dirty/external refresh, later-created/moved/deleted embeds,
// cycle/limit refusal, exact source bytes, teardown and restart.
export async function checkMathEmbeds({ directory, evaluate, command, wait, report, restart, afterReload, capture }) {
  const folder = "Math embeds", host = folder + "/Host.md", target = folder + "/Target.md", later = folder + "/Later.md", moved = folder + "/Moved.md";
  const cycleA = folder + "/Cycle A.md", cycleB = folder + "/Cycle B.md", deep = [1, 2, 3, 4, 5, 6].map(n => `${folder}/Deep ${n}.md`);
  const pass = message => { report.checks.push(message); console.log("PASS " + message); };
  const crlf = text => Buffer.from("\ufeff" + text.replaceAll("\n", "\r\n"));
  const hostText = [
    "---", "title: Math host", "---", "# Math host", "",
    "Inline $x^2 + y^2 = z^2$ and cost $5 and $6 stay literal, plus `$code$` and \\$escaped\\$.", "",
    "$$", "\\int_0^1 x\\,dx = \\frac{1}{2}", "$$", "",
    "Broken $\\notacommand{x}$ here.", "",
    "![[Target]]", "", "![[Target#Alpha]]", "", "![[Target#^pickme]]", "", "![[Later]]", "", "![[Target#Missing heading]]", "", "![[Cycle A]]", "", "![[Deep 1]]", "",
    "Tail #tagged-after-math $a #not-a-tag$ end", ""].join("\n");
  const targetText = ["# Target", "intro $\\alpha$", "", "## Alpha", "alpha body", "", "## Beta", "beta body", "", "paragraph to pick ^pickme", ""].join("\n");
  const active = ".workspace-tabs.mod-active .workspace-leaf:not([hidden])";
  const preview = active + " .markdown-preview-view";
  const q = selector => JSON.stringify(selector);
  const refresh = () => evaluate("(async()=>{await app.vault.refresh();await app.metadataCache.refresh()})()");
  const mode = async value => {
    await evaluate(`(async()=>{const leaf=app.workspace.activeLeaf;await leaf.setViewState({type:"markdown",state:{...leaf.getViewState().state,mode:${JSON.stringify(value)},source:${value === "source" ? "false" : "true"}}})})()`);
  };
  const open = async path => { await evaluate(`app.openFile(${JSON.stringify(path)},"tab")`); await wait(`app.workspace.getActiveFile()?.path===${JSON.stringify(path)}`, "open " + path); };
  const settled = async (scope = preview) => wait(`(()=>{const e=[...document.querySelectorAll(${q(scope + " .markdown-embed")})];return e.length>0&&e.every(n=>n.dataset.slopsidianEmbedState!==undefined&&n.dataset.slopsidianEmbedState!=="")})()`, "embeds settle");
  const states = scope => evaluate(`[...document.querySelectorAll(${q(scope + " .markdown-embed")})].map(n=>({state:n.dataset.slopsidianEmbedState,title:n.querySelector(":scope>.markdown-embed-title")?.textContent??null,text:n.querySelector(":scope>.markdown-embed-content, :scope>.markdown-embed-error")?.textContent??n.textContent}))`);
  const hostBytes = crlf(hostText), targetBytes = crlf(targetText);

  await evaluate("app.workspace.saveAll()");
  await mkdir(join(directory, folder), { recursive: true });
  await writeFile(join(directory, host), hostBytes);
  await writeFile(join(directory, target), targetBytes);
  await writeFile(join(directory, cycleA), crlf("# A\n![[Cycle B]]\n"));
  await writeFile(join(directory, cycleB), crlf("# B\n![[Cycle A]]\n"));
  for (let index = 0; index < deep.length; index++) { await writeFile(join(directory, deep[index]), crlf(`# Deep ${index + 1}\nlevel ${index + 1}\n` + (index + 1 < deep.length ? `![[Deep ${index + 2}]]\n` : ""))); }
  await rm(join(directory, later), { force: true }); await rm(join(directory, moved), { force: true });
  await refresh();

  await open(host); await mode("preview");
  await settled();

  // Math
  assert.ok(await evaluate(`document.querySelectorAll(${q(preview + " .math math")}).length`) >= 3, "inline, display and nested math render MathML");
  assert.equal(await evaluate(`document.querySelectorAll(${q(preview + " .math script, " + preview + " .math style, " + preview + " .math img, " + preview + " .math svg, " + preview + " .math a")}).length`), 0, "math output is inert");
  assert.equal(await evaluate(`document.querySelectorAll(${q(preview + " .math-block math")}).length`), 1, "one block math expression");
  assert.equal(await evaluate(`document.querySelector(${q(preview + " .math-block")}).dataset.sourceLine`), "7", "block math keeps its source line anchor");
  assert.match(await evaluate(`document.querySelector(${q(preview + " .math.is-error")}).textContent`), /notacommand/, "invalid TeX shows an explicit error with the retained source");
  const literal = await evaluate(`document.querySelector(${q(preview)}).textContent`);
  assert.match(literal, /cost \$5 and \$6 stay literal/);
  assert.match(literal, /\$code\$/);
  assert.match(literal, /\$escaped\$/);
  assert.equal(await evaluate("app.metadataCache.getFileCache(app.workspace.getActiveFile()).tags.map(t=>t.tag).join()"), "#tagged-after-math", "tags inside math are not indexed");
  pass("Reading renders inline, display and block MathML locally and inertly; invalid TeX, currency, code and escapes stay explicit source; tags inside math are not indexed.");

  // Note embeds
  const initial = await states(preview);
  const byTitle = title => initial.find(entry => entry.title === title);
  assert.match(byTitle("Target").text, /intro[\s\S]*alpha body[\s\S]*beta body/, "whole note embed");
  assert.match(byTitle("Target > Alpha").text, /alpha body/); assert.doesNotMatch(byTitle("Target > Alpha").text, /beta body/);
  assert.equal(byTitle("Target > ^pickme").text.trim(), "paragraph to pick", "block embed strips the block id");
  assert.equal(await evaluate(`document.querySelectorAll(${q(preview + " .markdown-embed .math math")}).length`) > 0, true, "nested embed math renders");
  assert.equal(initial.filter(entry => entry.state === "missing").length, 1, "missing note is explicit");
  assert.ok(initial.some(entry => entry.state === "error" && /does not exist/.test(entry.text)), "missing heading is an explicit error");
  assert.ok(initial.some(entry => entry.state === "error" && /Embedded note cycle: Math embeds\/Cycle A\.md → Math embeds\/Cycle B\.md → Math embeds\/Cycle A\.md/.test(entry.text)), "cycle refused with ancestry");
  assert.ok(initial.some(entry => entry.state === "error" && /limited to 4 levels/.test(entry.text)), "depth limit refused");
  assert.equal(await evaluate(`document.querySelectorAll(${q(preview + " .markdown-preview-view .markdown-preview-view")}).length`) > 0, true, "nested views are real Reading children");
  await capture?.();
  pass("Note, heading and block embeds render through nested Reading views with nested math; missing note/heading, cycle and depth limits fail explicitly.");

  // Later-created, moved, deleted
  await writeFile(join(directory, later), crlf("# Later\nlater body\n")); await refresh();
  await wait(`[...document.querySelectorAll(${q(preview + " .markdown-embed")})].some(n=>n.querySelector(".markdown-embed-title")?.textContent==="Later"&&/later body/.test(n.textContent))`, "later-created note resolves the missing embed");
  await evaluate(`app.vault.rename(app.vault.getFileByPath(${JSON.stringify(later)}),${JSON.stringify(moved)})`);
  await wait(`!document.querySelector(${q(preview + " .markdown-embed-title")}) || ![...document.querySelectorAll(${q(preview + " .markdown-embed-title")})].some(n=>n.textContent==="Later")`, "moved target invalidates the embed");
  assert.equal((await states(preview)).filter(entry => entry.state === "missing").length, 1, "moved target is missing again");
  await evaluate(`app.vault.rename(app.vault.getFileByPath(${JSON.stringify(moved)}),${JSON.stringify(later)})`);
  await wait(`[...document.querySelectorAll(${q(preview + " .markdown-embed-title")})].some(n=>n.textContent==="Later")`, "restored target resolves again");
  await evaluate(`app.vault.delete(app.vault.getFileByPath(${JSON.stringify(later)}))`);
  await wait(`document.querySelectorAll(${q(preview + " [data-slopsidian-embed-state=missing]")}).length===1`, "deleted target invalidates the embed");
  assert.equal(await evaluate(`[...document.querySelectorAll(${q(preview + " .markdown-embed-title")})].some(n=>n.textContent==="Later")`), false, "no stale deleted-note content");
  pass("A missing embed resolves when its file is created or restored and falls back to an explicit missing state when the file is moved or deleted, without stale content.");

  // External and dirty refresh
  await writeFile(join(directory, target), crlf(targetText.replace("alpha body", "alpha EXTERNAL"))); await refresh();
  await wait(`document.querySelector(${q(preview)}).textContent.includes("alpha EXTERNAL")`, "external change refreshes embeds");
  await open(target);
  await evaluate(`(()=>{const editor=app.workspace.activeLeaf.view.editor;editor.setValue(editor.getValue().replace("alpha EXTERNAL","alpha DIRTY"))})()`);
  await open(host); await mode("preview");
  await wait(`document.querySelector(${q(preview)}).textContent.includes("alpha DIRTY")`, "dirty unsaved buffer is used by embeds");
  assert.deepEqual(await readFile(join(directory, target)), crlf(targetText.replace("alpha body", "alpha EXTERNAL")), "dirty text is not written to disk by rendering");
  await evaluate("app.workspace.saveAll()");
  pass("Embeds follow external modifications and unsaved dirty buffers without writing them to disk.");

  // Link/embed aliases, CRLF block math, encoded hrefs and the shared embed budget
  const alias = folder + "/Alias Math.md", hashed = folder + "/A#B.md", hashHost = folder + "/Hash Host.md";
  const budgetHost = folder + "/Budget Host.md", budgetA = folder + "/Budget A.md", budgetB = folder + "/Budget B.md", leaf = folder + "/Leaf.md";
  await writeFile(join(directory, alias), crlf("# Alias\n[[Target|$x$]] and ![[Target|$y$]]\n\n$$\nx [[Inside]]\n$$\n\nTail [[After]]\n"));
  await writeFile(join(directory, hashed), crlf("# B.md\nhash body\n\n## Sub\nsub body\n"));
  await writeFile(join(directory, hashHost), crlf("![](A%23B.md)\n\n![](A%23B.md#Sub)\n"));
  await writeFile(join(directory, leaf), crlf("# Leaf\nleaf\n"));
  await writeFile(join(directory, budgetB), crlf("# B\nbudget b body\n"));
  await writeFile(join(directory, budgetA), crlf("# A r0\n![[Budget B]]\n"));
  await writeFile(join(directory, budgetHost), crlf("![[Leaf]]\n\n".repeat(62) + "![[Budget A]]\n"));
  await refresh();
  const cacheLinks = path => evaluate(`(()=>{const c=app.metadataCache.getFileCache(app.vault.getFileByPath(${JSON.stringify(path)}));return JSON.stringify({l:c.links.map(x=>x.link),e:c.embeds.map(x=>x.link),m:(c.math??[]).length})})()`).then(JSON.parse);
  assert.deepEqual(await cacheLinks(alias), { l: ["Target", "After"], e: ["Target"], m: 1 }, "alias math keeps link/embed targets; CRLF block math hides its inner link");
  await open(hashHost); await mode("preview");
  await wait(`document.querySelectorAll(${q(preview + " .markdown-embed[data-slopsidian-embed-state=ready]")}).length===2`, "encoded-href embeds render");
  const hashStates = await states(preview);
  assert.deepEqual(hashStates.map(entry => entry.title), ["A#B", "A#B > Sub"], "an encoded # stays in the file name; only the real fragment is the subpath");
  assert.match(hashStates[0].text, /hash body/); assert.match(hashStates[1].text, /sub body/); assert.doesNotMatch(hashStates[1].text, /hash body/);
  assert.equal(await evaluate(`document.querySelector(${q(preview + " .markdown-embed-link")}).getAttribute("href")`), "A%23B.md", "Open keeps the encoded href");
  await open(budgetHost); await mode("preview");
  const budgetReady = () => wait(`document.querySelector(${q(preview)}).textContent.includes("budget b body")&&document.querySelectorAll(${q(preview + " [data-slopsidian-embed-state=error]")}).length===0`, "64 live embeds fit the limit");
  await budgetReady();
  for (let round = 1; round <= 3; round++) {
    await writeFile(join(directory, budgetA), crlf(`# A r${round}\n![[Budget B]]\n`)); await refresh();
    await wait(`document.querySelector(${q(preview)}).textContent.includes("A r${round}")`, "refreshed embed re-renders");
    await budgetReady();
  }
  pass("Link/embed aliases keep precedence over math, CRLF block math suppresses inner links, encoded Markdown hrefs keep # in file names, and refreshing nested embeds never exhausts the shared budget.");
  await open(host); await mode("preview");

  // Live Preview
  await mode("source");
  const live = active + " .cm-content";
  await wait(`document.querySelectorAll(${q(live + " .math math")}).length>=3&&document.querySelectorAll(${q(live + " .markdown-embed")}).length>0`, "Live Preview math and embeds");
  assert.equal(await evaluate(`document.querySelectorAll(${q(live + " .math-block math")}).length`), 1);
  assert.equal(await evaluate(`document.querySelector(${q(live)}).textContent.includes("not-a-tag")`), true, "math under unrelated tags stays rendered or sourced, never dropped");
  await evaluate(`(()=>{const view=app.workspace.activeLeaf.view,editor=view.editor;editor.setCursor({line:5,ch:12})})()`);
  await wait(`document.querySelector(${q(live)}).textContent.includes("x^2 + y^2 = z^2")`, "cursor reveals math source");
  await capture?.();
  pass("Live Preview shows the same MathML and embeds as widgets and reveals math source under the cursor.");

  // Bytes, teardown, restart
  assert.deepEqual(await readFile(join(directory, host)), hostBytes, "host bytes unchanged");
  assert.equal(await evaluate("app.dirty"), false);
  await evaluate(`(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()`);
  await mode("preview");
  await settled();
  if (restart) { await restart(); } else { await command("Page.reload"); }
  await afterReload();
  await open(host); await mode("preview"); await settled();
  assert.ok(await evaluate(`document.querySelectorAll(${q(preview + " .math math")}).length`) >= 3);
  await evaluate("(async()=>{for(const leaf of app.workspace.getLeavesOfType('markdown')){await app.workspace.closeLeaf(leaf);}})()");
  await wait("document.querySelectorAll('.markdown-embed,.math math').length===0", "closing the note tears every embed and math node down");
  assert.equal(await evaluate('document.querySelector("#client-errors")?.textContent??""'), "");
  assert.deepEqual(await readFile(join(directory, host)), hostBytes);
  pass("Restart restores math and embeds from untouched bytes; closing the note leaves no leaked embed or math DOM.");
  report.mathEmbeds = { mathml: "KaTeX 0.18.10, MathML only, sanitized", embeds: "nested ReadingView per owner", unsupported: ["mhchem", "math in tables", "A#B#C paths", "embed sizes", "editing inside embeds"] };
}
