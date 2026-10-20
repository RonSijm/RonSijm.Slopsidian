import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkFormatConversion({ directory, evaluate, command, click, press, wait, afterReload, restart, capture, report }) {
  const id = "markdown-importer";
  const folder = "Format conversion";
  const path = folder + "/Legacy.md";
  const target = folder + "/9376012345 Target.md";
  const content = [
    "---", "# Retain YAML comment", "alias: First alias, Second alias", "tag: one two", "cssclass: first second",
    "precise: 9007199254740993", "unknown: &keep { value: retained }", "copy: *keep", "---",
    "# Legacy formats", "", "#topic #123 #[[Two words]]", "^^Roam text^^ and ::Bear text::",
    "- {{[[TODO]]}} Open task", "- {{[[DONE]]}} Completed task", "[[9376012345]] and [[404404404]]",
    "`^^Matching raw code^^`", "", "Unrelated ordinary text.", "",
  ].join("\r\n");
  const bytes = Buffer.from("\ufeff" + content);
  const originalSettings = "\ufeff" + JSON.stringify({ futureSetting: { retain: [id, 19] } });
  const root = `[data-core-dialog="${id}"]`;
  const action = name => `${root} [data-format-action="${name}"]`;
  const option = name => `${root} [data-format-option="${name}"]`;
  const error = `${root} [data-format-error]`;
  const status = `${root} [data-format-status]`;
  const formats = ["roam-tags", "roam-highlights", "roam-todos", "bear-highlights", "zettelkasten-links", "frontmatter"];
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const accept = test => {
    if (report.coreChecks) {
      assert.ok(!report.coreChecks.some(check => check.id === test), "Duplicate conversion observation: " + test);
      report.coreChecks.push({ id: test, status: "passed" });
    }
  };
  async function reload() {
    await evaluate("(async()=>{await app.saveAll();await app.workspace.flushLayout()})()");
    if (restart) { await restart(); } else { await command("Page.reload"); }
    await afterReload();
  }
  async function toggle(enabled) {
    await click("#open-settings");
    await click("#core-plugins-tab");
    if (await evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await click("#core-settings-back"); }
    if (await evaluate(`app.core.isEnabled(${JSON.stringify(id)})`) !== enabled) { await click(`[data-core-toggle="${id}"]`); }
    await wait(`!app.core.busy&&app.core.isEnabled(${JSON.stringify(id)})===${enabled}`, "format converter enabled state");
    await click(".settings-close");
  }
  async function open(selected) {
    await press("p", "KeyP", 80, 2);
    await wait('document.querySelector("#desktop-picker")?.open', "format converter command palette");
    await command("Input.insertText", { text: "Open format converter" });
    await click('[data-command-id="markdown-importer:open"]');
    await wait(`Boolean(document.querySelector(${JSON.stringify(root)}))&&!document.querySelector("#desktop-picker").open`, "actual format converter dialog");
    assert.equal(await evaluate(`[...document.querySelectorAll(${JSON.stringify(root + " [data-format-option]")})].every(input=>!input.checked)`), true, "Each dialog starts with explicit opt-in conversions");
    for (const format of selected) { await click(option(format)); }
  }
  async function preview() {
    await click(action("preview"));
    await wait(`document.querySelector(${JSON.stringify(status)})?.dataset.formatStatus==="preview"&&!document.querySelector(${JSON.stringify(action("preview"))}).disabled`, "completed read-only conversion preview");
  }
  async function apply() {
    await click(`${root} [data-format-confirm]`);
    await click(action("apply"));
    await wait(`document.querySelector(${JSON.stringify(status)})?.dataset.formatStatus==="applied"&&!document.querySelector(${JSON.stringify(action("undo"))}).disabled`, "guarded Markdown conversion committed");
  }
  async function close() {
    await click(action("cancel"));
    await wait(`!document.querySelector(${JSON.stringify(root)})`, "format converter closed");
  }
  async function undo() {
    await click(action("undo"));
    await wait(`document.querySelector(${JSON.stringify(status)})?.dataset.formatStatus==="undone"`, "guarded conversion undo completed");
  }
  async function unchanged(originals) {
    for (const [file, original] of originals) { assert.deepEqual(await readFile(join(directory, file)), original, file + " bytes"); }
  }

  await mkdir(join(directory, folder), { recursive: true });
  await mkdir(join(directory, ".obsidian"), { recursive: true });
  await writeFile(join(directory, path), bytes);
  await writeFile(join(directory, target), "# A numeric-link destination\r\n");
  await writeFile(join(directory, ".obsidian", id + ".json"), originalSettings);
  await reload();
  await toggle(true);
  await click("#open-settings");
  await click("#core-plugins-tab");
  assert.equal(await evaluate(`app.core.state(${JSON.stringify(id)}).settingsSupport==="none"&&!document.querySelector('[data-core-settings="${id}"]')`), true);
  await click(".settings-close");
  accept(id + ":settings");
  await evaluate(`app.openFile(${JSON.stringify(path)},"tab")`);
  const originals = new Map();
  for (const file of await evaluate("app.vault.getMarkdownFiles().map(file=>file.path)")) { originals.set(file, await readFile(join(directory, file))); }

  await open(formats);
  await preview();
  const convertedPreview = await evaluate(`document.querySelector(${JSON.stringify(root + ' [data-format-path="' + path + '"] pre:nth-of-type(2)')}).textContent`);
  assert.ok(convertedPreview.includes("[[topic]] #123 [[Two words]]"));
  assert.ok(convertedPreview.includes("==Roam text== and ==Bear text=="));
  assert.ok(convertedPreview.includes("- [ ] Open task\r\n- [x] Completed task"));
  assert.ok(convertedPreview.includes("[[9376012345 Target]] and [[404404404]]"));
  assert.ok(convertedPreview.includes("precise: 9007199254740993"));
  await unchanged(originals);
  await click(`${root} [data-format-confirm]`);
  await evaluate(`globalThis.closedFormatApply=document.querySelector(${JSON.stringify(action("apply"))})`);
  await close();
  await evaluate("closedFormatApply.click()");
  await unchanged(originals);
  pass("The actual opt-in converter previews Roam/Bear/tasks/numeric links and legacy frontmatter in real vault files; Cancel and a retained closed-dialog button write no notes.");

  await open(formats);
  await preview();
  if (capture) { await capture(); }
  await apply();
  const converted = await readFile(join(directory, path), "utf8");
  assert.ok(converted.startsWith("\ufeff---\r\n"));
  assert.equal(converted.slice(1), convertedPreview);
  assert.ok(converted.endsWith("Unrelated ordinary text.\r\n"));
  assert.match(converted, /# Retain YAML comment\r\n/);
  assert.match(converted, /&keep/);
  assert.match(converted, /\*keep/);
  assert.deepEqual(await evaluate(`app.metadataCache.getDocument(${JSON.stringify(path)}).cache.frontmatter.aliases`), ["First alias", "Second alias"]);
  assert.deepEqual(await evaluate(`app.metadataCache.getDocument(${JSON.stringify(path)}).cache.frontmatter.tags`), ["one", "two"]);
  assert.deepEqual(await evaluate(`app.metadataCache.getDocument(${JSON.stringify(path)}).cache.frontmatter.cssclasses`), ["first", "second"]);
  assert.equal(await evaluate("app.editor.getValue()"), convertedPreview);
  assert.equal(await evaluate("app.dirty"), false);
  await undo();
  await unchanged(originals);
  await close();
  pass("Confirmed legacy conversion rewrites the actual BOM/CRLF note with lossless unknown numeric/YAML data and refreshes its real clean editor; version-guarded Undo restores every original Markdown file byte-for-byte.");

  await open(["zettelkasten-aliases"]);
  await preview();
  const external = Buffer.concat([bytes, Buffer.from("Newer external content.\r\n")]);
  await writeFile(join(directory, path), external);
  await click(`${root} [data-format-confirm]`);
  await click(action("apply"));
  await wait(`document.querySelector(${JSON.stringify(error)})?.textContent.includes("changed")&&!app.workspace.isChangingFiles`, "stale conversion visibly refused");
  assert.deepEqual(await readFile(join(directory, path)), external);
  await unchanged(new Map([...originals].filter(([file]) => file !== path)));
  await close();
  await writeFile(join(directory, path), bytes);
  await evaluate("app.metadataCache.refresh()");
  const duplicate = "Format duplicate/9376012345 Target.md";
  await mkdir(join(directory, "Format duplicate"), { recursive: true });
  await writeFile(join(directory, duplicate), "# An ambiguous numeric ID\r\n");
  await evaluate("app.metadataCache.refresh()");
  assert.equal(await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${JSON.stringify(target)}),"Outside.md")`), target.slice(0, -3));
  assert.equal(await evaluate(`app.metadataCache.fileToLinktext(app.vault.getFileByPath(${JSON.stringify(target)}),${JSON.stringify(path)},false)`), "9376012345 Target.md");
  await open(["zettelkasten-aliases"]);
  await click(action("preview"));
  await wait(`document.querySelector(${JSON.stringify(error)})?.textContent.includes("numeric ID")`, "ambiguous numeric ID rejected without selecting an arbitrary file");
  await unchanged(originals);
  await close();
  await rm(join(directory, duplicate));
  await evaluate("app.metadataCache.refresh()");
  await open(["zettelkasten-aliases"]);
  await preview();
  await evaluate(`app.editor.setValue(${JSON.stringify(content + "Unsaved concurrent edit.")});true`);
  await click(`${root} [data-format-confirm]`);
  await click(action("apply"));
  await wait(`document.querySelector(${JSON.stringify(error)})?.textContent.includes("unsaved")&&!app.workspace.isChangingFiles`, "dirty concurrent edit retained instead of implicitly saved or replaced");
  assert.equal(await evaluate("app.editor.getValue()"), content + "Unsaved concurrent edit.");
  await unchanged(originals);
  await close();
  await evaluate(`app.editor.setValue(${JSON.stringify(content)});true`);
  pass("Newer external versions, ambiguous numeric destinations and post-preview dirty edits reject visibly without partial note writes, implicit saves or loss of local text; generated link text disambiguates real files.");

  await open(["zettelkasten-aliases"]);
  await preview();
  await apply();
  assert.equal(await readFile(join(directory, path), "utf8"), "\ufeff" + content.replace("[[9376012345]]", "[[9376012345 Target|Target]]"));
  await undo();
  await unchanged(originals);
  await close();
  await open(["roam-highlights"]);
  await preview();
  await click(`${root} [data-format-confirm]`);
  await evaluate(`globalThis.closedFormatApply=document.querySelector(${JSON.stringify(action("apply"))})`);
  await evaluate(`app.core.setEnabled(${JSON.stringify(id)},false)`);
  assert.equal(await evaluate(`!document.querySelector(${JSON.stringify(root)})&&!app.commands.listCommands().some(command=>command.id==="markdown-importer:open")&&!document.querySelector('[data-core-ribbon="${id}"]')`), true);
  await evaluate("closedFormatApply.click();delete globalThis.closedFormatApply");
  await unchanged(originals);
  await toggle(true);
  await reload();
  assert.equal(await evaluate(`app.core.isEnabled(${JSON.stringify(id)})`), true);
  assert.equal(await readFile(join(directory, ".obsidian", id + ".json"), "utf8"), originalSettings);
  await open([]);
  await close();
  await unchanged(originals);
  accept(id + ":convert");
  pass("Readable numeric aliases are a separate working conversion; disable removes real converter UI/ribbon/commands/listeners, and restart/reconnect restores enablement without altering unknown settings or original note bytes.");
  report.formatConverter = { implementation: "independent seven-format subset", originalModuleLoaded: false, ambiguousIds: "refused", apply: "root/version-guarded batch of at most 256 changed notes", undo: "guarded contents restoration while the dialog remains open", originalRuntimeEquivalence: "not established" };
}
