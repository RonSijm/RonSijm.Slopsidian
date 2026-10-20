import assert from "node:assert/strict";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Real-app proof for reviewed subscriptions: modal, vault configuration, native resources/DOM, all panes, restart and vault isolation. */
export async function checkWebAdblockSubscriptions({ host, origin, targets, connect, restart, until, requests, directory, pass, capture }) {
  const view = "app.workspace.activeLeaf.view", output = `${view}.contentEl.querySelector("[data-webviewer-adblocking]")`;
  const path = join(directory, ".obsidian", "vault-dotnet-web-filters.json");
  const story = phase => origin + "/sub-story?phase=" + phase;
  const q = value => JSON.stringify(value);
  const config = async () => { try { return await readFile(path, "utf8"); } catch (error) { if (error.code === "ENOENT") { return null; } throw error; } };
  const subscriptions = async () => JSON.parse(await config() ?? "{}").subscriptions ?? [];
  const listRequests = () => requests.filter(item => item.url.startsWith("/sub/")).length;
  const hits = (name, phase) => requests.filter(item => item.destination === "script" && item.url === `/subads/${name}.js?phase=${phase}`).length;
  const generation = () => host.evaluate('app.core.getEnabledPluginById("webviewer").filters.applied?.generation ?? 0');
  const loaded = url => host.wait(`${view}.getViewType()==="webviewer"&&${view}.getState().url===${q(url)}&&${view}.contentEl.dataset.webviewerLoading==="false"`, "subscription page loaded " + url);
  async function remotePage(url) {
    let target; await until(async () => { target = (await targets()).find(item => item.url === url); return target; }, "native subscription page " + url);
    return connect(target);
  }
  async function open(url) { await host.evaluate(`app.core.getEnabledPluginById("webviewer").openUrl(${q(url)},true)`); await loaded(url); return remotePage(url); }
  async function reveal(url) { await host.evaluate(`app.workspace.revealLeaf(app.workspace.getLeavesOfType("webviewer").find(leaf=>leaf.view.getState().url===${q(url)}))`); await loaded(url); }
  async function setting(enabled) {
    await host.click("#open-settings"); await host.click("#core-plugins-tab");
    if (await host.evaluate('Boolean(document.querySelector("#core-settings-back"))')) { await host.click("#core-settings-back"); }
    await host.click('[data-core-settings="webviewer"]');
    if (await host.evaluate('document.querySelector("[data-core-field=enableAdblocking]").checked') !== enabled) { await host.click('[data-core-field="enableAdblocking"]'); }
    await host.click('[data-core-save="webviewer"]');
    await host.wait(`!app.core.busy&&app.core.state("webviewer").settings.enableAdblocking===${enabled}`, "ad-blocking setting saved");
    await host.click(".settings-close");
    await host.wait(`app.workspace.getLeavesOfType("webviewer").every(leaf=>leaf.view.contentEl.querySelector("[data-webviewer-adblocking]")?.dataset.webviewerAdblocking===${q(enabled ? "on" : "off")})`, "panes adopt ad-blocking setting");
  }
  const modal = selector => `document.querySelector("[data-web-filters] ${selector}")`;
  async function openModal() {
    await host.evaluate(`(()=>{document.querySelectorAll("[data-subscription-filter-opener]").forEach(element=>element.removeAttribute("data-subscription-filter-opener"));const button=${view}.contentEl.querySelector('[data-webviewer-action="filters"]');if(!button)throw new Error("The active Web viewer has no Filters action.");button.setAttribute("data-subscription-filter-opener","");delete button.dataset.subscriptionFilterClicked;button.addEventListener("click",()=>{button.dataset.subscriptionFilterClicked="true"},{once:true})})()`);
    await host.click("[data-subscription-filter-opener]");
    try { await host.wait('Boolean(document.querySelector("[data-web-filters]"))', "Filters modal opens"); }
    catch (error) {
      const state = await host.evaluate(`(()=>{const button=document.querySelector("[data-subscription-filter-opener]");const rect=button?.getBoundingClientRect();const active=document.activeElement;return{clicked:button?.dataset.subscriptionFilterClicked,activeElement:active?{tag:active.tagName,id:active.id,className:active.getAttribute("class")}:null,activeLeaf:app.workspace.activeLeaf.id,changingVault:app.changingVault,busy:app.core.busy,bounds:${view}.lastBounds,rect:rect?.toJSON(),dpr:devicePixelRatio,viewport:{width:innerWidth,height:innerHeight},point:rect?document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.outerHTML.slice(0,200):null}})()`);
      throw new Error(error.message + " :: " + JSON.stringify(state), { cause: error });
    }
    assert.equal(await host.evaluate('document.querySelector("[data-subscription-filter-opener]").dataset.subscriptionFilterClicked'), "true", "one unobscured real pointer click opens Filters");
    await host.wait('!document.querySelector("[data-web-filters-status]").textContent.startsWith("Filters are being")&&Boolean(document.querySelector("[data-web-filters-status]").textContent)', "Filters modal status");
  }
  async function closeModal() { await host.press("Escape", "Escape", 27); await host.wait('!document.querySelector("[data-web-filters]")', "Filters modal closes"); }
  async function download(address) {
    await host.fill("[data-web-filters-address]", address); await host.click('[data-web-filters-action="download"]');
    await host.wait('!document.querySelector("[data-web-filters-review]").hidden||!document.querySelector("[data-web-filters-error]").hidden', "download review or error for " + address);
  }
  const reviewText = () => host.evaluate('document.querySelector("[data-web-filters-review-summary]")?.textContent??""');
  const errorText = () => host.evaluate('document.querySelector("[data-web-filters-error]").hidden?"":document.querySelector("[data-web-filters-error]").textContent');
  const action = async name => { await host.click(`[data-web-filters-action="${name}"]`); };
  const idle = () => host.wait('[...document.querySelectorAll("[data-web-filters] button,[data-web-filters] input")].every(item=>!item.disabled)', "Filters modal idle");
  const displays = remote => remote.evaluate('Object.fromEntries(["hide-a","hide-b","hide-c","keep","never"].map(id=>[id,getComputedStyle(document.getElementById(id)).display]))');
  const panes = async () => Promise.all(pageUrls.map(url => pageRemotes.get(url)));
  const pageUrls = [], pageRemotes = new Map();
  async function track(url) { pageUrls.push(url); pageRemotes.set(url, await open(url)); }

  if (!await host.evaluate('app.core.isEnabled("webviewer")')) { await host.evaluate('app.core.setEnabled("webviewer",true)'); }
  await host.evaluate('(async()=>{for(const leaf of [...app.workspace.getLeavesOfType("webviewer"),...app.workspace.getLeavesOfType("webviewer-history")])await app.workspace.closeLeaf(leaf)})()');
  const vaultOrigin = await host.evaluate("location.origin");
  assert.equal(await config(), null, "fresh vault has no filter configuration");
  await track(story("one")); await track(story("two"));
  await setting(true);
  assert.equal(listRequests(), 0, "opening panes and settings never requests lists");
  for (const remote of await panes()) {
    assert.deepEqual(await displays(remote), { "hide-a": "block", "hide-b": "block", "hide-c": "block", keep: "block", never: "block" });
    assert.equal(await remote.evaluate("document.documentElement.dataset.subA"), remote === pageRemotes.get(story("one")) ? "one" : "two");
  }
  pass("Opening native panes, enabling Block ads and the vault start issue no hidden subscription requests; the page's ad scripts and hide targets are intact");

  await openModal();
  await download(origin + "/sub/a.txt");
  assert.equal(listRequests(), 1);
  assert.match(await reviewText(), /1 blocking.*SHA-256 [0-9a-f]{16}/);
  assert.equal(await config(), null, "a review alone saves nothing");
  const before = await generation();
  await action("discard"); await host.wait('document.querySelector("[data-web-filters-review]").hidden', "review discarded");
  assert.equal(await config(), null); assert.equal(await generation(), before);
  for (const remote of await panes()) { await remote.evaluate('loadSub("discarded")'); }
  assert.equal(hits("a", "discarded"), 2, "a discarded review leaves the old engine active in every pane");
  await download(origin + "/sub/a.txt"); assert.equal(listRequests(), 2);
  await action("accept"); await host.wait('Boolean(document.querySelector("[data-web-filters-item]"))', "accepted subscription listed");
  await idle();
  const saved = await subscriptions(); assert.equal(saved.length, 1); assert.equal(saved[0].url, origin + "/sub/a.txt");
  assert.ok((await generation()) > before);
  await capture("accepted");
  for (const remote of await panes()) { await remote.evaluate('loadSub("hot")'); }
  await until(async () => hits("b", "hot") === 2 && hits("c", "hot") === 2, "unlisted ad scripts still load in both panes");
  assert.equal(hits("a", "hot"), 0, "accepted rule blocks the resource in the visible and hidden pane before the server");
  for (const remote of await panes()) {
    await remote.wait('getComputedStyle(document.getElementById("hide-a")).display==="none"', "native DOM hides subscription element");
    assert.deepEqual(await displays(remote), { "hide-a": "none", "hide-b": "block", "hide-c": "block", keep: "block", never: "block" });
  }
  pass("Real modal Download shows a reviewed list, Discard keeps the old engine and saves nothing, Accept persists the list and hot-swaps native network blocking and static DOM hiding into the visible and hidden panes");

  await download(origin + "/sub/b.txt");
  assert.match(await reviewText(), /not supported and never run/);
  await action("accept"); await host.wait('document.querySelectorAll("[data-web-filters-item]").length===2', "second subscription listed"); await idle();
  for (const remote of await panes()) { await remote.evaluate('loadSub("both")'); }
  await until(async () => hits("c", "both") === 2 && hits("b", "both") === 0 && hits("a", "both") === 0, "both lists block in all panes");
  for (const remote of await panes()) {
    await remote.wait('getComputedStyle(document.getElementById("hide-b")).display==="none"', "second list hides");
    assert.equal(await remote.evaluate('document.documentElement.dataset.subNormal'), remote === pageRemotes.get(story("one")) ? "one" : "two");
  }
  pass("A second list with scripts and extended selectors shows the unsupported notice in review, never runs them, and its network and static rules apply");

  const kept = await config(), kg = await generation(), listsBefore = listRequests();
  const bad = [[origin + "/sub/html.txt", /HTML|filter list/i, 1], [origin + "/sub/binary.txt", /./, 1], [origin + "/sub/big.txt", /./, 1], ["ftp://127.0.0.1/list.txt", /./, 0], [vaultOrigin + "/api/vault", /./, 0], [origin.replace("http://", "http://user:pass@") + "/sub/a.txt", /./, 0]];
  let expected = listsBefore;
  for (const [address, pattern, fetched] of bad) {
    await download(address); await idle(); expected += fetched;
    assert.ok(await errorText(), "visible error for " + address); assert.match(await errorText(), pattern);
    assert.equal(await host.evaluate('document.querySelector("[data-web-filters-review]").hidden'), true);
    assert.equal(await config(), kept); assert.equal(await generation(), kg); assert.equal(listRequests(), expected, "request count after " + address);
  }
  for (const remote of await panes()) { await remote.evaluate('loadSub("after-failures")'); }
  await until(async () => hits("c", "after-failures") === 2, "failures leave page loading intact");
  assert.equal(hits("a", "after-failures") + hits("b", "after-failures"), 0, "prior accepted engine still blocks after failures");
  pass("HTML, binary, oversized, non-http, vault-endpoint and credential addresses fail visibly without saving or replacing the prior engine");

  await download(origin + "/sub/mutable.txt"); await action("accept"); await host.wait('document.querySelectorAll("[data-web-filters-item]").length===3', "mutable subscription"); await idle();
  const mutable = (await subscriptions()).find(item => item.url.endsWith("/mutable.txt"));
  await fetch(origin + "/sub-control?set=c");
  const update = `[data-web-filters-item=${q(mutable.id)}] [data-web-filters-action="update"]`;
  await host.click(update); await host.wait('!document.querySelector("[data-web-filters-review]").hidden', "update review");
  assert.match(await reviewText(), /replaces/); await action("discard"); await idle();
  assert.equal((await subscriptions()).find(item => item.id === mutable.id).sha256, mutable.sha256, "discarded update is not saved");
  await host.click(update); await host.wait('!document.querySelector("[data-web-filters-review]").hidden', "update review again"); await action("accept"); await idle();
  assert.notEqual((await subscriptions()).find(item => item.id === mutable.id).sha256, mutable.sha256);
  for (const remote of await panes()) { await remote.wait('getComputedStyle(document.getElementById("hide-c")).display==="none"', "updated list hides"); }
  await fetch(origin + "/sub-control?set=a");
  pass("Update is an explicit reviewed action: Discard keeps the accepted list, Accept replaces it and applies the new rules to every pane");

  const savedConfig = await config(), g = await generation();
  await chmod(path, 0o444);
  try {
    await host.click('[data-web-filters-action="cosmetic"]'); await host.wait('!document.querySelector("[data-web-filters-error]").hidden', "persistence failure is visible");
  } finally { await chmod(path, 0o666); }
  assert.equal(await config(), savedConfig, "failed persistence keeps the saved configuration bytes"); assert.equal(await generation(), g);
  await idle();
  for (const remote of await panes()) { assert.equal(await remote.evaluate('getComputedStyle(document.getElementById("hide-a")).display'), "none"); }
  pass("A configuration write failure surfaces in the modal and keeps both the saved file and the accepted engine");

  const external = { ...JSON.parse(await config()), external: { keep: [1, true] } };
  await writeFile(path, JSON.stringify(external));
  const mutableRow = `[data-web-filters-item=${q(mutable.id)}] [data-web-filters-action="enable"]`;
  await host.click(mutableRow); await idle();
  const afterEdit = JSON.parse(await config());
  assert.deepEqual(afterEdit.external, { keep: [1, true] }, "externally added fields are preserved");
  assert.equal(afterEdit.subscriptions.find(item => item.id === mutable.id).enabled, false);
  for (const remote of await panes()) { await remote.wait('getComputedStyle(document.getElementById("hide-c")).display==="block"', "disabled list stops hiding"); }
  await host.click(`[data-web-filters-item=${q(mutable.id)}] [data-web-filters-action="remove"]`); await host.wait('document.querySelectorAll("[data-web-filters-item]").length===2', "removed"); await idle();
  await host.click('[data-web-filters-action="cosmetic"]'); await idle();
  for (const remote of await panes()) { await remote.wait('getComputedStyle(document.getElementById("hide-a")).display==="block"', "cosmetic option off shows elements"); }
  for (const remote of await panes()) { await remote.evaluate('loadSub("cosmetic-off")'); }
  await until(async () => hits("c", "cosmetic-off") === 2 && hits("a", "cosmetic-off") === 0, "network rules stay active with cosmetics off");
  await host.click('[data-web-filters-action="cosmetic"]'); await idle();
  for (const remote of await panes()) { await remote.wait('getComputedStyle(document.getElementById("hide-a")).display==="none"', "cosmetic option on hides elements"); }
  await closeModal();
  pass("Disable, Remove and the cosmetic option take effect in all panes, and unknown externally written configuration fields survive edits");

  const finalConfig = await config(); await capture("before-restart");
  const listsBeforeRestart = listRequests();
  await restart();
  await host.wait('Boolean(app.core.getEnabledPluginById("webviewer"))', "web viewer after restart");
  await host.wait('app.workspace.getLeavesOfType("webviewer").length>0', "panes restore");
  assert.equal(await config(), finalConfig);
  const restored = await remotePage(story("one")).catch(() => remotePage(story("two")));
  await restored.wait('document.documentElement.dataset.subNormal', "restored page loads");
  assert.equal(listRequests(), listsBeforeRestart, "restart issues no list requests");
  assert.equal(await restored.evaluate("document.documentElement.dataset.subA||''"), "", "persisted rule blocks before the first restored navigation");
  assert.equal(await restored.evaluate("document.documentElement.dataset.subB||''"), "");
  await restored.wait('getComputedStyle(document.getElementById("hide-a")).display==="none"', "persisted cosmetic rule hides after restart");
  pass("A new app process restores the persisted lists before restored navigation, with the same configuration bytes and no list requests");

  assert.equal(await host.evaluate('app.core.getEnabledPluginById("webviewer").filters.applied?.lists.length'), 2);

  const otherVault = join(directory, ".filters-other-vault"); await mkdir(join(otherVault, ".obsidian"), { recursive: true });
  await writeFile(join(otherVault, ".obsidian", "core-plugins.json"), JSON.stringify(await host.evaluate('Object.fromEntries(app.core.states.map(item=>[item.id,item.id==="webviewer"]))')));
  await writeFile(join(otherVault, ".obsidian", "webviewer.json"), '{"enableAdblocking":true}');
  const otherPath = join(otherVault, ".obsidian", "vault-dotnet-web-filters.json");
  async function switchVault(target) {
    await host.click("#vault-switcher"); await host.wait('document.querySelector("#vault-dialog").open', "filters vault dialog"); await host.fill("#vault-open-path", target); await host.click("#confirm-open-vault");
    await host.wait(`app.vault.rootPath===${q(target)}&&!app.changingVault&&!document.querySelector("#vault-dialog").open`, "filters vault switch " + target);
  }
  await switchVault(otherVault);
  await host.wait('app.core.isEnabled("webviewer")&&Boolean(app.core.getEnabledPluginById("webviewer"))', "other vault web viewer");
  assert.equal(await host.evaluate('app.core.getEnabledPluginById("webviewer").filters.applied?.lists.length'), 0, "the other vault starts without the first vault's lists");
  const foreignPage = story("foreign"); const foreign = await open(foreignPage);
  await foreign.wait('document.documentElement.dataset.subNormal==="foreign"', "foreign page loads");
  assert.equal(await foreign.evaluate("[document.documentElement.dataset.subA,document.documentElement.dataset.subB,document.documentElement.dataset.subC].join()"), "foreign,foreign,foreign", "foreign vault does not inherit native blocking");
  assert.equal(await displays(foreign).then(value => value["hide-a"]), "block");
  await openModal(); await download(origin + "/sub/b.txt"); await action("accept"); await host.wait('document.querySelectorAll("[data-web-filters-item]").length===1', "foreign list listed"); await idle();
  await foreign.evaluate('loadSub("foreign-hot")'); await until(async () => hits("a", "foreign-hot") === 1 && hits("c", "foreign-hot") === 1 && hits("b", "foreign-hot") === 0, "foreign vault applies only its own list");
  assert.equal(JSON.parse(await readFile(otherPath, "utf8")).subscriptions.length, 1);
  assert.equal(await config(), finalConfig, "first vault's configuration is untouched by the other vault");
  await closeModal();
  await switchVault(directory);
  await host.wait('app.core.getEnabledPluginById("webviewer")?.filters.applied?.lists.length===2', "first vault engine restored");
  assert.equal(await config(), finalConfig);
  assert.equal(JSON.parse(await readFile(otherPath, "utf8")).subscriptions.length, 1);
  const back = await remotePage(story("one")).catch(() => remotePage(story("two")));
  await back.wait('getComputedStyle(document.getElementById("hide-a")).display==="none"', "first vault rules apply again after switching back");
  await back.evaluate('loadSub("returned")'); await until(async () => hits("c", "returned") === 1, "returned vault loads unlisted ad");
  assert.equal(hits("a", "returned") + hits("b", "returned"), 0);
  pass("Switching vaults swaps the native engine per vault without leaking lists, persists each vault's configuration separately and restores the first vault's engine unchanged");
}