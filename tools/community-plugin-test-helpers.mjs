import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export async function setCommunityPluginEnabled({ evaluate, click, wait }, id, enabled) {
  if (!await evaluate('document.querySelector("#settings-dialog").open')) { await click("#open-settings"); }
  await click("#community-plugins-tab");
  await wait("!app.plugins.isManaging", "community plugin manager idle");
  if (enabled && await evaluate("app.plugins.isRestricted")) {
    await click("#community-restricted-toggle");
    await wait("!app.plugins.isManaging&&!app.plugins.isRestricted", "explicit community-plugin opt-in");
  }
  if (await evaluate(`Boolean(app.plugins.getPlugin(${JSON.stringify(id)}))`) !== enabled) {
    await click(`[data-toggle-plugin="${id}"]`);
  }
  const selector = `.plugin-card[data-plugin-id="${id}"]`;
  await wait(`!app.plugins.isManaging&&(Boolean(app.plugins.getPlugin(${JSON.stringify(id)}))===${enabled}||Boolean(document.querySelector(${JSON.stringify(selector + " .plugin-error")})||document.querySelector("#community-settings-error")))`, "plugin runtime and enabled-file operation complete");
  assert.equal(await evaluate(`Boolean(app.plugins.getPlugin(${JSON.stringify(id)}))`), enabled, await evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`));
}

export async function assertCommunityPluginConfiguration(path, original, changes) {
  const readIds = text => {
    const value = JSON.parse(text.replace(/^\ufeff/, ""));
    assert.ok(Array.isArray(value) && value.every(id => typeof id === "string"), "Enabled configuration must remain an array of IDs.");
    return value;
  };
  const before = original?.toString("utf8") ?? null;
  const expected = new Set(before === null ? [] : readIds(before));
  for (const [id, enabled] of Object.entries(changes)) {
    if (enabled) { expected.add(id); } else { expected.delete(id); }
  }
  const saved = await readFile(path, "utf8");
  const actual = readIds(saved);
  assert.deepEqual([...actual].sort(), [...expected].sort(), "Only explicitly toggled plugin IDs may change.");
  assert.equal(actual.length, new Set(actual).size, "Explicit saves must not introduce duplicate IDs.");
  assert.equal(saved.startsWith("\ufeff"), before?.startsWith("\ufeff") ?? false, "Explicit saves must preserve the original BOM policy.");
}
