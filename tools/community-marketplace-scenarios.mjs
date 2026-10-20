import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expectErrors } from "./error-log-audit.mjs";
import { assertCachedBlobsUnchanged, mountCachedGitHub } from "./cached-github-fixture.mjs";

// Runs in the page. Serves deterministic public-GitHub responses for the registry, statistics, READMEs,
// manifests and release assets so the real Community Browse UI, catalog, bulk planner and plugin host run.
function marketplaceNetworkFixture(configuration) {
  const original = window.fetch.bind(window);
  const state = window.communityMarketNetwork = { stats: "ok", blocked: configuration.browser, requests: [], mutations: [], versions: { ...configuration.versions }, missingMain: [] };
  const registry = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugins.json";
  const stats = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugin-stats.json";
  window.fetch = async (input, options) => {
    const url = input instanceof Request ? input.url : String(input);
    const target = url === "/api/community-download" ? JSON.parse(options.body).url : url;
    const entry = configuration.entries.find(candidate => target.startsWith("https://raw.githubusercontent.com/" + candidate.repo + "/") || target.startsWith("https://github.com/" + candidate.repo + "/"));
    if (url.startsWith("/api/community-plugins") && String(options?.method ?? "GET").toUpperCase() !== "GET") { state.mutations.push({ url, method: options.method }); }
    if (target !== registry && target !== stats && !entry) { return original(input, options); }
    state.requests.push({ url: target, mode: options.mode, credentials: options.credentials, method: options.method });
    if (target === registry) { return new Response(JSON.stringify(configuration.entries)); }
    if (target === stats) { return state.stats === "ok" ? new Response(configuration.statistics) : new Response("", { status: 503 }); }
    const raw = "https://raw.githubusercontent.com/" + entry.repo + "/HEAD/";
    if (target === raw + "README.md" || target === raw + "readme.md") {
      const readme = configuration.readmes[entry.id];
      if (readme === undefined) { return new Response("", { status: 404 }); }
      return readme === null ? new Response("", { status: 500 }) : new Response(readme);
    }
    const releases = "https://github.com/" + entry.repo + "/releases/download/";
    if (target === raw + "manifest.json") { return new Response(configuration.packages[entry.id][state.versions[entry.id]]["manifest.json"]); }
    if (target.startsWith(releases)) {
      if (state.blocked) { throw new TypeError("Intentional fixture: GitHub release CORS blocked"); }
      const [version, name] = target.slice(releases.length).split("/");
      if (name === "main.js" && state.missingMain.includes(entry.id)) { return new Response("", { status: 404 }); }
      const value = configuration.packages[entry.id][version]?.[name];
      return value === undefined || value === null ? new Response("", { status: 404 }) : new Response(value);
    }
    throw new Error("Unexpected marketplace fixture request: " + target);
  };
}

export async function checkCommunityMarketplace({ directory, evaluate, command, click, press, wait, handleDialog, report, afterReload, capture, browser = false, selectVault, targetDirectory }) {
  const author = "Slopsidian test";
  const entries = [
    { id: "market.alpha", repo: "slopsidian-test/market-alpha", name: "Market Alpha", author, description: "Dotted installed fixture" },
    { id: "market-beta", repo: "slopsidian-test/market-beta", name: "Market Beta", author, description: "Installed fixture whose release asset is missing" },
    { id: "market.stale", repo: "slopsidian-test/market-stale", name: "Market Stale", author, description: "Installed fixture changed on disk after review" },
    { id: "market.fresh", repo: "slopsidian-test/market-fresh", name: "Market Fresh", author, description: "Not installed; bulk update must never install it" },
    { id: "con.txt", repo: "slopsidian-test/market-reserved", name: "Reserved device fixture", author, description: "Windows device alias" },
  ];
  const installedIds = ["market.alpha", "market-beta", "market.stale"];
  const packageFor = (entry, version) => ({
    "manifest.json": "\ufeff" + JSON.stringify({ id: entry.id, name: entry.name, version, minAppVersion: "1.0.0", description: entry.description, author, isDesktopOnly: false }, null, 2).replaceAll("\n", "\r\n") + "\r\n",
    "main.js": `\ufeffconst {Plugin}=require("obsidian");module.exports=class extends Plugin{onload(){(window.marketEvents??=[]).push("load:${entry.id}:${version}")}};\r\n`,
    "styles.css": null,
  });
  const packages = Object.fromEntries(entries.map(entry => [entry.id, { "1.0.0": packageFor(entry, "1.0.0"), "2.0.0": packageFor(entry, "2.0.0") }]));
  const statistics = ('{"market.alpha":{"downloads":5,"updated":3000},"market-beta":{"downloads":500,"updated":1000},"market.fresh":{"downloads":90000,"updated":2000},"market.stale":{"downloads":"many","updated":-1},"__proto__":{"downloads":999999}}');
  const hostile = "# Alpha readme\n\nSafe [link](https://example.com/page) and [bad](javascript:alert(1)).\n\n<script>window.marketReadmeRan=true</script>\n<img src=\"https://tracker.invalid/pixel.png\">\n\n![remote](https://tracker.invalid/remote.png)\n\n- first item\n- second item\n\n```\ncode block <b>not bold</b>\n```\n";
  const readmes = { "market.alpha": hostile, "market-beta": undefined, "market.stale": null, "market.fresh": "# Fresh\n\nPlain text.\n" };
  const versions = Object.fromEntries(entries.map(entry => [entry.id, "2.0.0"]));
  const plugins = join(directory, ".obsidian", "plugins"), enabledPath = join(directory, ".obsidian", "community-plugins.json");
  const checks = [];
  const pass = (name, detail) => { checks.push({ id: name, status: "passed", detail }); report.checks.push(detail); console.log("PASS " + detail); };
  const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent??null`);
  const ready = description => wait('document.querySelector("#community-browser .modal-content")?.getAttribute("aria-busy")==="false"', description);
  const closeBrowser = async () => { if (await evaluate('Boolean(document.querySelector("#community-browser"))')) { await click("#community-browser .modal-close-button"); } };
  const openBrowser = async () => {
    if (!await evaluate('document.querySelector("#settings-dialog").open')) { await click("#open-settings"); }
    await click("#community-plugins-tab");
    await wait("!app.plugins.isManaging");
    await click("#community-plugin-browse");
    await ready("catalog ready");
  };
  const order = () => evaluate('[...document.querySelectorAll("#community-catalog-list [data-catalog-plugin]")].map(button=>button.dataset.catalogPlugin)');
  const choose = async value => { await evaluate(`(()=>{const select=document.querySelector("#community-catalog-sort");select.value=${JSON.stringify(value)};select.dispatchEvent(new Event("change",{bubbles:true}))})()`); };
  const confirm = (selector, accept) => Promise.all([click(selector), handleDialog(accept)]);
  const bytes = async (id, name) => readFile(join(plugins, id, name));
  const dataFor = id => Buffer.from(JSON.stringify({ owner: id, preserve: "user data " + id }) + "\n");
  const requests = () => evaluate("communityMarketNetwork.requests");
  const original = new Map();
  let other = null;

  const fixtureScript = `(${marketplaceNetworkFixture.toString()})(${JSON.stringify({ entries, packages, statistics, readmes, versions, browser })})`;
  report.communityMarketplace = { checks, network: "Deterministic public-GitHub fixture responses; live public GitHub reads are checked separately by tools/community-live-check.mjs", publicDownloadsTested: false, realSelectedFiles: browser };
  const { identifier } = await command("Page.addScriptToEvaluateOnNewDocument", { source: fixtureScript });
  try {
    // Seed installed packages (disposable fixture vault) before the reload that makes the host discover them.
    for (const id of installedIds) {
      await mkdir(join(plugins, id), { recursive: true });
      for (const [name, value] of Object.entries(packages[id]["1.0.0"])) { if (value !== null) { await writeFile(join(plugins, id, name), value); } }
      await writeFile(join(plugins, id, "data.json"), dataFor(id));
      await writeFile(join(plugins, id, "user-notes.txt"), "Keep through update.\n");
    }
    await writeFile(enabledPath, "\ufeff[\"market.alpha\"]\r\n");
    for (const id of installedIds) { for (const name of ["manifest.json", "main.js", "data.json", "user-notes.txt"]) { original.set(id + "/" + name, await bytes(id, name)); } }
    const enabledBefore = await readFile(enabledPath);
    await command("Page.reload");
    await afterReload();
    await evaluate(fixtureScript);
    await wait(`!app.plugins.isManaging&&${JSON.stringify(installedIds)}.every(id=>app.plugins.installedPlugins.some(plugin=>plugin.id===id))`, "seeded dotted/plain packages discovered");
    const ranBefore = await evaluate('Boolean(app.plugins.getPlugin("market.alpha"))');

    await openBrowser();
    assert.equal(await text("#community-statistics-failure"), null, "Reachable statistics must not show the failure message.");
    assert.deepEqual(await order(), ["market.alpha", "market-beta", "market.fresh", "market.stale", "con.txt"]);
    await choose("popularity");
    assert.deepEqual(await order(), ["market.fresh", "market-beta", "market.alpha", "market.stale", "con.txt"], "Popularity sorts by real counts; unreported and malformed counts sort last by name.");
    await choose("updated");
    assert.deepEqual(await order(), ["market.alpha", "market.fresh", "market-beta", "market.stale", "con.txt"]);
    const listing = await text("#community-catalog-list");
    assert.match(listing, /90,000 downloads|90\u202f000 downloads|90.000 downloads/);
    assert.match(listing, /downloads not reported/);
    assert.doesNotMatch(listing, /999,?999/, "A __proto__ statistics key must not become any plugin's count.");
    assert.match(await text('[data-catalog-plugin="con.txt"] ~ .plugin-error') ?? await text("#community-catalog-list .plugin-error"), /safe local package-folder name/);
    await choose("name");
    await evaluate('(()=>{const filter=document.querySelector("#community-catalog-filter");filter.value="installed";filter.dispatchEvent(new Event("change",{bubbles:true}))})()');
    assert.deepEqual((await order()).sort(), [...installedIds].sort());
    await evaluate('(()=>{const filter=document.querySelector("#community-catalog-filter");filter.value="all";filter.dispatchEvent(new Event("change",{bubbles:true}))})()');
    await capture("catalog");
    pass("stats-sort-filter", "The real Community Browse UI showed bounded registry statistics, sorted by name/popularity/recently-updated with unreported counts last and a prototype-named key ignored, filtered installed plugins, and refused the reserved con.txt id visibly.");

    await click('[data-catalog-plugin="market.alpha"]');
    await wait('document.querySelector("#community-plugin-readme")&&!document.querySelector("#community-plugin-readme").textContent.includes("Loading")', "alpha README");
    const readme = await evaluate(`(()=>{const root=document.querySelector("#community-plugin-readme");return{text:root.textContent,forbidden:root.querySelectorAll("script,img,iframe,object,embed,style,link,form,input,svg").length,anchors:[...root.querySelectorAll("a")].map(a=>({href:a.href,rel:a.rel,referrerPolicy:a.referrerPolicy})),ran:window.marketReadmeRan===true,heading:Boolean(root.querySelector("h1,h2,h3,h4,h5,h6,strong"))}})()`);
    assert.match(readme.text, /Alpha readme/);
    assert.match(readme.text, /code block <b>not bold<\/b>/, "Code content must be shown as literal text.");
    assert.equal(readme.forbidden, 0);
    assert.equal(readme.ran, false, "README script must never run.");
    assert.deepEqual(readme.anchors.map(a => a.href), ["https://example.com/page"], "Only the credential-free http(s) link may be navigable.");
    assert.ok(readme.anchors.every(a => /noopener/.test(a.rel) && a.referrerPolicy === "no-referrer"));
    assert.equal((await requests()).some(request => request.url.includes("tracker.invalid")), false, "Rendering a README must not fetch tracking resources.");
    await click('[data-catalog-plugin="market-beta"]');
    await wait('document.querySelector("#community-plugin-readme")&&!document.querySelector("#community-plugin-readme").textContent.includes("Loading")', "beta README");
    assert.match(await text("#community-plugin-readme"), /no README\.md or readme\.md/);
    await click('[data-catalog-plugin="market.stale"]');
    await wait('document.querySelector("#community-plugin-readme")&&!document.querySelector("#community-plugin-readme").textContent.includes("Loading")', "stale README");
    assert.match(await text("#community-plugin-readme"), /README unavailable/, "A fetch failure must be distinct from a missing README.");
    await click('[data-catalog-plugin="market.alpha"]');
    await wait('document.querySelector("#community-plugin-readme")?.textContent.includes("Alpha readme")');
    assert.equal(await evaluate(`document.querySelector('#community-plugin-detail').textContent.includes('Installed: 1.0.0')`), true);
    pass("readme", "README rendering was inert for hostile HTML/script/image/javascript: content, preserved literal code, distinguished missing from failed README fetches, and loaded no tracking resource.");

    // Read-only planning: nothing may be downloaded or changed until explicit review.
    const before = (await requests()).length;
    await click("#community-check-updates");
    await wait('document.querySelector("#community-bulk-updates")&&document.querySelector("#community-browser .modal-content").getAttribute("aria-busy")==="false"', "update plan");
    const planned = (await requests()).slice(before);
    assert.equal(planned.some(request => request.url.includes("/releases/download/")), false, "Checking must not download packages.");
    const rows = await evaluate('Object.fromEntries([...document.querySelectorAll("[data-bulk-plugin]")].map(row=>[row.dataset.bulkPlugin,{state:row.dataset.bulkState,checked:row.querySelector("input").checked,disabled:row.querySelector("input").disabled}]))');
    assert.deepEqual(Object.keys(rows).sort(), [...installedIds].sort(), "Only installed plugins may be planned; market.fresh must not be listed.");
    assert.ok(Object.values(rows).every(row => row.state === "update" && !row.checked), "Nothing may be preselected.");
    assert.equal(await evaluate('document.querySelector("#community-bulk-apply").disabled'), true);
    for (const id of installedIds) { assert.deepEqual(await bytes(id, "main.js"), original.get(id + "/main.js")); }
    await capture("bulk-plan");
    pass("bulk-plan", "Check for updates was read-only: literal dotted IDs were listed from installed packages only, nothing was preselected, no release asset was downloaded and no disk bytes changed.");

    // Stale fence: change one reviewed package on disk after the plan was made.
    await writeFile(join(plugins, "market.stale", "main.js"), "\ufeff// changed by the user after review\r\n");
    const staleBytes = await bytes("market.stale", "main.js");
    await evaluate('communityMarketNetwork.missingMain=["market-beta"]');
    for (const id of installedIds) { await evaluate(`(()=>{const box=document.querySelector('[data-bulk-plugin="${id}"] input');box.click()})()`); }
    assert.equal(await evaluate('document.querySelector("#community-bulk-apply").textContent'), "Review and update selected (3)");
    await confirm("#community-bulk-apply", false);
    await ready("declined review settled");
    for (const id of installedIds) { assert.deepEqual(await bytes(id, "manifest.json"), original.get(id + "/manifest.json"), "Declining the single batch confirmation must change nothing."); }
    assert.deepEqual(await bytes("market.stale", "main.js"), staleBytes);
    if (browser) {
      await evaluate("communityMarketNetwork.blocked=true");
      await expectErrors({ evaluate, report }, [], async () => { await confirm("#community-bulk-apply", true); await ready("blocked batch settled"); }, "Exercise attributed browser CORS failures for every selected bulk row");
      assert.match(await text("#community-bulk-updates"), /CORS/);
      for (const id of installedIds) { assert.deepEqual(await bytes(id, "manifest.json"), original.get(id + "/manifest.json"), "CORS failures must write nothing."); }
      await evaluate("communityMarketNetwork.blocked=false");
      for (const id of installedIds) { if (await evaluate(`!document.querySelector('[data-bulk-plugin="${id}"] input').checked`)) { await evaluate(`document.querySelector('[data-bulk-plugin="${id}"] input').click()`); } }
    }
    await expectErrors({ evaluate, report }, [], async () => { await confirm("#community-bulk-apply", true); await wait('document.querySelector("#community-browser .modal-content").getAttribute("aria-busy")==="false"&&!app.plugins.isManaging', "bulk update settled"); }, "Apply the explicitly reviewed batch and report per-row outcomes");
    const outcomes = await evaluate('Object.fromEntries([...document.querySelectorAll("[data-bulk-plugin]")].map(row=>[row.dataset.bulkPlugin,row.textContent]))');
    assert.match(outcomes["market.alpha"], /Updated to 2\.0\.0\./);
    assert.match(outcomes["market-beta"], /Not updated: .*404/);
    assert.match(outcomes["market.stale"], /Not updated:/);
    assert.deepEqual(await bytes("market.alpha", "manifest.json"), Buffer.from(packages["market.alpha"]["2.0.0"]["manifest.json"]));
    assert.deepEqual(await bytes("market.alpha", "main.js"), Buffer.from(packages["market.alpha"]["2.0.0"]["main.js"]));
    assert.deepEqual(await bytes("market-beta", "manifest.json"), original.get("market-beta/manifest.json"), "A failed row must leave its package untouched.");
    assert.deepEqual(await bytes("market-beta", "main.js"), original.get("market-beta/main.js"));
    assert.deepEqual(await bytes("market.stale", "main.js"), staleBytes, "A package changed after review must not be overwritten.");
    for (const id of installedIds) {
      assert.deepEqual(await bytes(id, "data.json"), original.get(id + "/data.json"), "Plugin data must be preserved.");
      assert.deepEqual(await bytes(id, "user-notes.txt"), original.get(id + "/user-notes.txt"));
    }
    assert.deepEqual(await readFile(enabledPath), enabledBefore, "Bulk update must not change canonical enablement bytes.");
    assert.equal(await evaluate('Boolean(app.plugins.getPlugin("market.alpha"))'), ranBefore, "Running state is preserved by the existing update path.");
    assert.equal(await evaluate('app.plugins.installedPlugins.some(plugin=>plugin.id==="market.fresh")'), false, "Bulk update must never install a new package.");
    await assert.rejects(readFile(join(plugins, "market.fresh", "manifest.json")), { code: "ENOENT" });
    await capture("bulk-result");
    pass("bulk-update", "One explicit batch confirmation updated only the selected reviewed dotted package, reported a missing asset and a stale on-disk package as truthful per-row failures without overwriting them, preserved data/user files/enablement/running state, and never installed or executed a new package.");

    await closeBrowser();
    await click(".settings-close");
    await command("Page.reload");
    await afterReload();
    await wait('!app.plugins.isManaging&&app.plugins.installedPlugins.some(plugin=>plugin.id==="market.alpha"&&plugin.version==="2.0.0")', "updated dotted package after real reload");
    assert.deepEqual(await readFile(enabledPath), enabledBefore);
    assert.equal(await evaluate('app.plugins.installedPlugins.some(plugin=>plugin.id==="market.alpha")'), true);
    pass("dotted-reload", "The dotted plugin ID survived a real reload as a literal package/inventory ID with unchanged canonical enablement.");

    // Statistics outage: explicit failure, no invented counts, ordering that needs counts disabled.
    await evaluate("communityMarketNetwork.stats='fail'");
    await openBrowser();
    assert.match(await text("#community-statistics-failure"), /Download statistics are unavailable/);
    assert.equal(await evaluate('document.querySelector("#community-catalog-sort option[value=popularity]").disabled&&document.querySelector("#community-catalog-sort option[value=updated]").disabled'), true);
    assert.doesNotMatch(await text("#community-catalog-list"), /\d downloads|not reported/);
    await closeBrowser();
    await evaluate("communityMarketNetwork.stats='ok'");
    pass("stats-unavailable", "A statistics outage was reported explicitly, disabled count-dependent sorting and displayed no invented numbers.");

    // Root/selection fence through the real vault switch: a plan made here must not survive or write elsewhere.
    assert.equal(typeof selectVault, "function", "The runner must supply the actual vault-selection callback.");
    assert.ok(targetDirectory, "The runner must supply a disposable second vault.");
    other = targetDirectory;
    await mkdir(join(other, ".obsidian", "plugins", "market-beta"), { recursive: true });
    await writeFile(join(other, ".obsidian", "community-plugins.json"), "[]\n");
    await writeFile(join(other, "Other.md"), "# Other root\n");
    for (const [name, value] of Object.entries(packages["market-beta"]["1.0.0"])) { if (value !== null) { await writeFile(join(other, ".obsidian", "plugins", "market-beta", name), value); } }
    const otherBefore = await readFile(join(other, ".obsidian", "plugins", "market-beta", "main.js"));
    const betaBefore = await bytes("market-beta", "main.js");
    await openBrowser();
    await click("#community-check-updates");
    await wait('document.querySelector("#community-bulk-updates")&&document.querySelector("#community-browser .modal-content").getAttribute("aria-busy")==="false"', "plan before root switch");
    await evaluate('document.querySelector(\'[data-bulk-plugin="market-beta"] input\').click()');
    assert.equal(await evaluate('document.querySelector("#community-bulk-apply").disabled'), false);
    await closeBrowser();
    if (await evaluate('document.querySelector("#settings-dialog").open')) { await click(".settings-close"); }
    const mutationsBefore = await evaluate("communityMarketNetwork.mutations.length");
    // An earlier scenario leaves file-chooser interception on; folder pickers must reach the real OS picker.
    if (browser) { await command("Page.setInterceptFileChooserDialog", { enabled: false }); }
    await selectVault(other);
    await wait("!app.plugins.isManaging&&!app.changingVault");
    assert.deepEqual(await evaluate("app.plugins.installedPlugins.map(plugin=>plugin.id)"), ["market-beta"], "Only the selected vault's own plugin inventory may be visible.");
    assert.deepEqual(await readFile(join(other, ".obsidian", "plugins", "market-beta", "main.js")), otherBefore, "A plan reviewed in another root must not write here.");
    await openBrowser();
    assert.equal(await evaluate('Boolean(document.querySelector("#community-bulk-updates"))'), false, "A reopened browser must not retain the previous root's reviewed plan.");
    await closeBrowser();
    if (await evaluate('document.querySelector("#settings-dialog").open')) { await click(".settings-close"); }
    await selectVault(directory);
    await wait("!app.plugins.isManaging&&!app.changingVault");
    assert.deepEqual(await bytes("market-beta", "main.js"), betaBefore, "The original reviewed selection must not have been written by a stale plan.");
    assert.deepEqual(await readFile(enabledPath), enabledBefore);
    assert.equal(await evaluate("communityMarketNetwork.mutations.length"), mutationsBefore, "No package mutation request may be issued by the vault switch.");
    pass("root-fence", "The actual vault-selection callback switched to a disposable second root and back; the pre-switch selected plan was not retained or applied in either vault, and each vault's package and enablement bytes were unchanged.");

    // Real cached GitHub mount: read-only browsing with zero API/raw requests and refused mutation.
    const localRoot = await evaluate("app.vault.rootPath"), pageUrl = await evaluate("location.href");
    const readOnlyFixture = await mountCachedGitHub(evaluate, "community-marketplace", [
      ["Remote.md", "# Remote note\n"], [".obsidian/community-plugins.json", "[]"],
    ]);
    await wait(`app.vault.rootPath===${JSON.stringify(readOnlyFixture.mount.id)}&&app.vault.readOnly&&!app.changingVault`, "genuine cached GitHub vault");
    const counters = () => evaluate('(()=>{const s=app.githubVaults.state();return{api:s.counters.api,raw:s.counters.raw}})()');
    assert.deepEqual(await counters(), { api: 0, raw: 0 });
    await openBrowser();
    assert.match(await text("#community-browser"), /This GitHub vault is read-only/);
    assert.equal(await evaluate('document.querySelector("#community-check-updates").disabled'), true, "Bulk update planning must be unavailable on a read-only mount.");
    await click('[data-catalog-plugin="market.fresh"]');
    await wait('document.querySelector("#community-plugin-readme")&&!document.querySelector("#community-plugin-readme").textContent.includes("Loading")&&document.querySelector("#community-install-download")', "read-only browsing of release and README");
    assert.match(await text("#community-plugin-readme"), /Fresh/, "Read-only browsing may still read the public README.");
    assert.equal(await evaluate('document.querySelector("#community-install-download").disabled'), true, "Install must be disabled in a read-only vault.");
    assert.equal(await evaluate('Boolean(document.querySelector("#community-bulk-updates, #community-browser-uninstall"))'), false);
    await closeBrowser();
    const refusals = await evaluate(`(async()=>{const root=app.vault.rootPath,selection=app.plugins.selection,review={root,selection,id:"market.fresh",installed:null},refuse=async run=>{try{await run();return "allowed"}catch(error){return String(error.message??error)}};return{review:await refuse(()=>app.plugins.reviewInstalled("market.fresh")),install:await refuse(()=>app.plugins.installPackage({manifest:{id:"market.fresh"}},review)),uninstall:await refuse(()=>app.plugins.uninstallPlugin({...review,installed:{manifest:{id:"market.fresh"}}}))}})()`);
    for (const [name, message] of Object.entries(refusals)) { assert.match(message, /GitHub snapshots remain read-only/, name + " must be refused in a read-only GitHub vault."); }
    assert.deepEqual(await counters(), { api: 0, raw: 0 }, "Read-only marketplace browsing must not use GitHub vault API/raw fallback.");
    await assertCachedBlobsUnchanged(evaluate, readOnlyFixture.blobs);
    assert.equal(await evaluate("communityMarketNetwork.mutations.length"), mutationsBefore);
    report.communityMarketplace.requests = await requests();
    assert.ok((await requests()).every(request => request.credentials === "omit" || request.credentials === undefined), "No marketplace request may send credentials.");
    assert.ok((await requests()).every(request => request.mode !== "no-cors"), "No opaque no-cors request may be used.");
    pass("read-only-github", "An actual cached GitHub vault mount (not a plan-only fixture) allowed catalog/README browsing, disabled update planning and install, refused review/install/uninstall with the read-only message, used zero GitHub API/raw requests and left every cached blob byte unchanged.");
    await command("Page.navigate", { url: pageUrl });
    await afterReload();
    assert.equal(await evaluate("app.vault.rootPath"), localRoot);
    assert.equal(await evaluate("app.vault.readOnly"), false);
    assert.deepEqual(await readFile(enabledPath), enabledBefore);
  } finally {
    await closeBrowser();
    await command("Page.removeScriptToEvaluateOnNewDocument", { identifier });
    for (const id of installedIds) { await rm(join(plugins, id), { recursive: true, force: true }); }
    await rm(enabledPath, { force: true });
    if (other) { await rm(other, { recursive: true, force: true }); }
  }
}
