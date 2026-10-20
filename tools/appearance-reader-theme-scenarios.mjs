import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Native Reader re-theme: flips the real saved color scheme with an external appearance.json edit while an actual
 * extracted Reader is open, then requires the same iframe element/window name, article DOM, scroll and progress to
 * survive while the Reader palette changes. Called from the Reader appearance scenario with its live helpers.
 */
export async function checkReaderRetheme({ host, reader, until, directory, pass, capture }) {
  // The Reader leaf/view is captured once; a later activeLeaf change must not redirect the identity checks.
  await host.evaluate("globalThis.readerRethemeLeaf=app.workspace.activeLeaf;true");
  const view = "(app.workspace.leaves().includes(readerRethemeLeaf)?readerRethemeLeaf.view:(()=>{throw new Error('The original Reader leaf is no longer live')})())", path = join(directory, ".obsidian", "appearance.json");
  let original = null;
  try { original = await readFile(path); } catch (error) { if (error?.code !== "ENOENT") { throw error; } }
  const parsed = original ? JSON.parse(original.toString("utf8").replace(/^\uFEFF/, "")) : {};
  const palette = frame => frame.evaluate('(()=>{const style=getComputedStyle(document.documentElement);return{background:style.getPropertyValue("--reader-background").trim(),scheme:style.colorScheme,scroll:scrollY}})()');
  const first = await reader();
  // Exact host-side references: the leaf's original view, iframe element and its contentWindow, so a replacement that reproduces the same name/HTML cannot pass.
  const identity = await host.evaluate(`(()=>{const leaf=readerRethemeLeaf,v=leaf.view,frame=v.contentEl.querySelector("[data-webviewer-reader]");frame.dataset.rethemeMarker="same";globalThis.readerIdentity={leaf,view:v,frame,win:frame.contentWindow};return{name:frame.name}})()`);
  const owned = `(()=>{const o=readerIdentity,f=o.view.contentEl.querySelector("[data-webviewer-reader]");return app.workspace.leaves().includes(o.leaf)&&o.leaf.view===o.view&&f===o.frame&&f.isConnected&&f.contentWindow===o.win})()`;
  // The actual article node lives in the Reader context; a reload or replacement loses this reference even with identical HTML.
  await first.evaluate('globalThis.readerArticleNode=document.querySelector("article");globalThis.readerDocument=document;true');
  const sameArticle = frame => frame.evaluate('document===globalThis.readerDocument&&document.querySelector("article")===globalThis.readerArticleNode&&globalThis.readerArticleNode.isConnected');
  const article = await first.evaluate('document.querySelector("article").innerHTML');
  await first.evaluate("scrollTo(0,90)");
  const before = await palette(first);
  assert.ok(before.scroll > 0, "the measured baseline scroll is nonzero");
  const retained = async (frame, label) => {
    assert.equal(await host.evaluate(owned), true, `${label}: the live leaf still owns the original view, iframe element and contentWindow`);
    assert.equal(await sameArticle(frame), true, `${label}: the very same article node and document survive, not a reload with identical HTML`);
    assert.equal(await host.evaluate(`${view}.contentEl.querySelector("[data-webviewer-reader]").dataset.rethemeMarker`), "same", `${label}: same iframe element, not a replacement`);
    assert.equal(await host.evaluate(`${view}.contentEl.querySelector("[data-webviewer-reader]").name`), identity.name, `${label}: same frame name`);
    assert.equal(await frame.evaluate('document.querySelector("article").innerHTML'), article, `${label}: article DOM retained`);
    assert.equal((await palette(frame)).scroll, before.scroll, `${label}: measured scroll/progress retained`);
  };
  const target = before.scheme.includes("dark") ? "light" : "dark", theme = target === "light" ? "moonstone" : "obsidian";
  let primary = null;
  try {
    await writeFile(path, JSON.stringify({ ...parsed, theme }, null, 2));
    await until(async () => { const value = await palette(first); return value.background !== before.background; }, "Reader palette follows the external color-scheme change");
    const after = await reader();
    assert.equal(after.name, first.name, "same Reader window");
    await retained(after, "after external change");
    await capture("reader-retheme");
  } catch (error) {
    primary = error;
  }
  try {
    if (original) { await writeFile(path, original); } else { await rm(path, { force: true }); }
    await until(async () => (await palette(await reader())).background === before.background, "Reader palette restored with the saved scheme");
    await retained(await reader(), "after restoring original preferences");
  } catch (error) {
    if (!primary) { primary = error; } else { primary.message += ` | restore also failed: ${error?.message ?? error}`; }
  }
  if (primary) { throw primary; }
  pass("An external appearance.json color-scheme change re-themes the already open native Reader in place: same iframe element/name, article DOM and scroll retained, original scheme restored");
}
