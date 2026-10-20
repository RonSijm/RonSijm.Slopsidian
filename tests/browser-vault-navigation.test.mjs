import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./host.mjs";

let directory, BrowserVaultNavigation, resolveBrowserFile, linkedGitHubUrl;
before(async () => {
  await mkdir(join(root, ".runtime"), { recursive: true });
  directory = await mkdtemp(join(root, ".runtime", "browser-navigation-tests-"));
  const output = join(directory, "navigation.mjs");
  await build({ entryPoints: [join(root, "client/browser-vault-navigation.ts")], outfile: output, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  ({ BrowserVaultNavigation, resolveBrowserFile, linkedGitHubUrl } = await import(pathToFileURL(output).href));
});
after(async () => {
  if (directory) {
    assert.match(relative(root, directory).replaceAll("\\", "/"), /^\.runtime\/browser-navigation-tests-[^/]+$/);
    await rm(directory, { recursive: true });
  }
});

const baseUrl = "https://slopsidian.md/";
const route = baseUrl + "remote-vault/github.com/RonSijm/RonSijm.Slopsidian/tree/main/Example";
const paths = ["30 Projects/Garden.md", "30 Projects/Community workshop.md", "日本語/A + B & # 100%.md", "Upper.MD", "Assets/map.svg"];
const vault = { repository: "RonSijm/RonSijm.Slopsidian", ref: "main", folder: "Example", files: paths.map(path => ({ path })) };
const link = path => route + "?file=" + encodeURIComponent(path);
const tick = () => new Promise(resolve => setImmediate(resolve));
function gate() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
function fixture(url = route, active = null, open = async () => {}) {
  const entries = [url], writes = [], opens = [];
  let index = 0, changing = false;
  const navigation = new BrowserVaultNavigation({
    baseUrl, url: () => new URL(entries[index]), activeFile: () => active, changingVault: () => changing,
    write: (url, replace) => {
      writes.push({ url: url.href, replace });
      if (replace) entries[index] = url.href;
      else { entries.splice(++index); entries.push(url.href); }
    },
    openFile: async path => { opens.push(path); await open(path); active = path; navigation.fileChanged(); },
  });
  return {
    navigation, entries, writes, opens, url: () => entries[index], active: () => active,
    click(path) { active = path; navigation.fileChanged(); },
    changeVault(value) { changing = value; },
    back() { index--; return navigation.navigate(); }, forward() { index++; return navigation.navigate(); },
    visit(url) { entries.splice(++index); entries.push(url); return navigation.navigate(); },
  };
}

test("remote file links resolve vault-relative Markdown with or without its extension and decode special characters once", () => {
  for (const path of paths) {
    assert.equal(resolveBrowserFile(new URL(link(path)), vault.files), path);
    if (/\.md$/i.test(path)) assert.equal(resolveBrowserFile(new URL(link(path.slice(0, -3))), vault.files), path);
  }
  const literal = [{ path: "A%2FB.md" }];
  assert.equal(resolveBrowserFile(new URL(link("A%2FB")), literal), "A%2FB.md");
  assert.equal(resolveBrowserFile(new URL(route), vault.files), null);
});

test("invalid or missing remote targets refuse before opening a file or changing the requested URL", async () => {
  for (const path of ["", "/30 Projects/Garden", "../Garden", "30 Projects/../Garden", "30 Projects\\Garden", "30 Projects//Garden", "30 Projects/./Garden", "Garden\n", "Missing", ".obsidian/community-plugins.json"]) {
    const state = fixture(link(path), paths[1]);
    await assert.rejects(state.navigation.ready(vault), /relative path|does not exist/);
    assert.equal(state.active(), paths[1]); assert.deepEqual(state.opens, []); assert.deepEqual(state.writes, []);
  }
  const state = fixture(link(paths[0]) + "&file=other");
  await assert.rejects(state.navigation.ready(vault), /one file parameter/);
});

test("the initial file link overrides a restored note without creating an extra history entry", async () => {
  const state = fixture(link("30 Projects/Garden"), paths[1]);
  state.navigation.fileChanged();
  await state.navigation.ready(vault);
  assert.deepEqual(state.opens, [paths[0]]); assert.equal(state.active(), paths[0]);
  assert.equal(state.entries.length, 1); assert.deepEqual(state.writes, []);
  await state.navigation.navigate(); assert.equal(state.opens.length, 1);
});

test("clicking remote files updates encoded URLs, preserves other query values and avoids duplicate history entries", async () => {
  const state = fixture(route + "?view=reading#section"); await state.navigation.ready(vault);
  state.click(paths[0]);
  assert.equal(state.url(), route + "?view=reading&file=30%20Projects%2FGarden#section");
  state.click(paths[0]); assert.equal(state.entries.length, 2);
  state.click(paths[2]); assert.equal(new URL(state.url()).searchParams.get("file"), paths[2].slice(0, -3));
  assert.equal(state.url().includes("+"), false, "Spaces and literal plus signs must be encoded unambiguously");
  assert.equal(state.entries.length, 3);
});

test("browser Back and Forward reopen the corresponding files without remounting or adding history entries", async () => {
  const state = fixture(link("30 Projects/Garden")); await state.navigation.ready(vault);
  state.click(paths[1]); state.click(paths[2]);
  await state.back(); assert.equal(state.active(), paths[1]);
  await state.back(); assert.equal(state.active(), paths[0]);
  await state.forward(); assert.equal(state.active(), paths[1]);
  assert.equal(state.entries.length, 3); assert.equal(state.writes.length, 2);
  assert.deepEqual(state.opens, [paths[0], paths[1], paths[0], paths[1]]);
});

test("a restored active note canonicalizes by replacement and switching tabs or clearing the file stays in sync", async () => {
  const state = fixture(route, paths[0]); await state.navigation.ready(vault);
  assert.equal(state.url(), link("30 Projects/Garden")); assert.equal(state.entries.length, 1);
  assert.equal(state.writes[0].replace, true);
  state.click(paths[1]); state.click(paths[0]); state.click(null);
  assert.equal(state.url(), route); assert.equal(state.entries.length, 4);
});

test("Markdown shorthand retains explicit extensions when an extensionless file or another Markdown casing would collide", async () => {
  const files = ["Garden", "Garden.md", "Upper.md", "Upper.MD"].map(path => ({ path }));
  assert.equal(resolveBrowserFile(new URL(link("Garden")), files), "Garden");
  assert.equal(resolveBrowserFile(new URL(link("Upper")), files), "Upper.md");
  const state = fixture(route, "Garden.md"); await state.navigation.ready({ ...vault, files });
  assert.equal(state.url(), link("Garden.md"));
  state.click("Upper.MD"); assert.equal(state.url(), link("Upper.MD"));
});

test("a failed file open keeps the URL and existing note, and the next valid history request still works", async () => {
  const state = fixture(link("30 Projects/Garden"), paths[1], async path => {
    if (path === paths[0]) throw new Error("Uncached note is unavailable offline");
  });
  await assert.rejects(state.navigation.ready(vault), /unavailable offline/);
  assert.equal(state.active(), paths[1]); assert.deepEqual(state.writes, []);
  await state.visit(link(paths[2])); assert.equal(state.active(), paths[2]);
  assert.equal(state.entries.length, 2); assert.equal(state.writes.at(-1).replace, true);
});

test("newer history requests win over a slow download without rewriting the newer URL", async () => {
  const download = gate(), state = fixture(link(paths[0]), null, async path => { if (path === paths[0]) await download.promise; });
  const first = state.navigation.ready(vault); await tick();
  const second = state.visit(link(paths[1])); await tick();
  assert.deepEqual(state.opens, [paths[0]]);
  download.release(); await Promise.all([first, second]);
  assert.deepEqual(state.opens, [paths[0], paths[1]]); assert.equal(state.active(), paths[1]);
  assert.equal(state.url(), link(paths[1].slice(0, -3)));
  assert.equal(state.writes.length, 1); assert.equal(state.writes[0].replace, true);
});

test("vault changes and suspended restoration cannot open stale links or write an old file into the new URL", async () => {
  const state = fixture(link("30 Projects/Garden")); await state.navigation.ready(vault);
  state.changeVault(true); state.click(paths[1]); await state.navigation.navigate();
  assert.equal(state.url(), link("30 Projects/Garden")); assert.deepEqual(state.opens, [paths[0]]);
  state.changeVault(false); state.navigation.suspend(); state.click(paths[2]);
  await state.navigation.navigate(); assert.deepEqual(state.opens, [paths[0]]);
  await state.navigation.ready(null); assert.equal(state.url(), baseUrl);
  state.click(paths[0]); assert.equal(state.url(), baseUrl);
});

test("old workspace events cannot overwrite a browser history entry that belongs to another vault", async () => {
  const state = fixture(link("30 Projects/Garden")); await state.navigation.ready(vault);
  const destination = route.replace("/Example", "/AnotherVault") + "?file=Other";
  await state.visit(destination);
  state.click(paths[1]);
  assert.equal(state.url(), destination); assert.deepEqual(state.writes, []);
  assert.deepEqual(state.opens, [paths[0]]); assert.equal(state.navigation.matchesCurrentVault(), false);
});

test("mounting from the chooser creates a shareable route for the actual ref/folder, including a hosted base path", async () => {
  let url = new URL("https://example.com/slopsidian/"), active = null;
  const navigation = new BrowserVaultNavigation({
    baseUrl: url.href, url: () => url, write: value => { url = value; }, activeFile: () => active,
    openFile: async () => { throw new Error("No link target was supplied"); }, changingVault: () => false,
  });
  await navigation.ready({ ...vault, ref: "feature/links", folder: "My Vault/Notes" });
  assert.equal(url.href, "https://example.com/slopsidian/remote-vault/github.com/RonSijm/RonSijm.Slopsidian/tree/feature%2Flinks/My%20Vault/Notes");
  assert.equal(navigation.matchesCurrentVault(), true);
  active = paths[0]; navigation.fileChanged();
  assert.equal(url.searchParams.get("file"), "30 Projects/Garden");
  assert.equal(linkedGitHubUrl(url, "https://example.com/slopsidian/"), "https://github.com/RonSijm/RonSijm.Slopsidian/tree/feature%2Flinks/My%20Vault/Notes");
});

test("linked vault extraction keeps encoded ref segments, discards file query values and rejects other hosts or application roots", () => {
  assert.equal(linkedGitHubUrl(new URL(link("30 Projects/Garden")), baseUrl), route.replace(baseUrl + "remote-vault/", "https://"));
  for (const url of [baseUrl, "https://other.example/remote-vault/github.com/owner/repo", baseUrl + "remote-vault/gitlab.com/owner/repo", baseUrl + "remote-vault/github.com/owner/repo/blob/main/note.md"]) {
    assert.throws(() => linkedGitHubUrl(new URL(url), baseUrl), /remote vault|github.com|repository URL/);
  }
});
