import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mountCachedGitHub, assertCachedBlobsUnchanged } from "./cached-github-fixture.mjs";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures", "viewers");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

// Proves the three gaps left by the first viewer pair: a committed AVIF decodes without any
// in-page AV1 encoder, a seekable VP9 WebM honours #t= with observed frames, and the same media
// opens from a genuine cache-only read-only GitHub mount with no API/raw access.
export async function checkViewerProofs({ directory, evaluate, command, wait, report, afterReload, capture }) {
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const manifest = JSON.parse(await readFile(join(fixtures, "manifest.json"), "utf8"));
  const bytes = {};
  for (const name of ["Split.avif", "Seek.webm"]) {
    bytes[name] = await readFile(join(fixtures, name));
    assert.equal(sha(bytes[name]), manifest[name].sha256, name + " fixture drifted from its provenance manifest");
    assert.equal(bytes[name].length, manifest[name].bytes);
  }
  report.viewerProofs = { fixtures: Object.fromEntries(Object.entries(bytes).map(([name, value]) => [name, { bytes: value.length, sha256: sha(value) }])), provenance: manifest._provenance };

  const open = path => evaluate(`app.openFile(${JSON.stringify(path)},true)`);
  const link = target => evaluate(`app.workspace.openLinkText(${JSON.stringify(target)},"",true)`);
  const activeIs = (type, key, path) => `app.workspace.activeLeaf?.view?.getViewType()===${JSON.stringify(type)}&&app.workspace.activeLeaf.view.bodyEl.dataset.${key}==="ready"&&app.workspace.activeLeaf.view.file?.path===${JSON.stringify(path)}`;
  const pixels = (selector, points, video) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const w=${video ? "e.videoWidth" : "e.naturalWidth"},h=${video ? "e.videoHeight" : "e.naturalHeight"};const c=document.createElement("canvas");c.width=w;c.height=h;const g=c.getContext("2d");g.drawImage(e,0,0);return {w,h,samples:${JSON.stringify(points)}.map(([x,y])=>Array.from(g.getImageData(x,y,1,1).data))}})()`);
  const near = (actual, expected, tolerance = 40) => expected.every((value, index) => Math.abs(actual[index] - value) <= tolerance);
  const RED = [220, 30, 30], BLUE = [30, 30, 220];
  const stage = ".workspace-tabs.mod-active .workspace-leaf:not([hidden]) ";

  async function proveAvif(path, label) {
    await open(path); await wait(activeIs("image", "imageStatus", path), label + " AVIF decoded");
    const sampled = await pixels(stage + "img", [[2, 8], [29, 8]], false);
    assert.deepEqual([sampled.w, sampled.h], [32, 16], label + " AVIF natural size");
    assert.ok(near(sampled.samples[0], RED) && near(sampled.samples[1], BLUE), label + " AVIF pixels " + JSON.stringify(sampled.samples));
    return sampled;
  }

  async function proveSeekable(path, label) {
    await open(path); await wait(activeIs("video", "videoStatus", path), label + " video metadata");
    const info = await evaluate(`(()=>{const v=document.querySelector(${JSON.stringify(stage + "video")});return {w:v.videoWidth,h:v.videoHeight,duration:v.duration,seekable:v.seekable.length?[v.seekable.start(0),v.seekable.end(0)]:null}})()`);
    assert.deepEqual([info.w, info.h], [64, 48]);
    assert.ok(Math.abs(info.duration - 4) < 0.2, label + " finite duration " + info.duration);
    assert.ok(info.seekable && info.seekable[1] >= 3.8, label + " seekable range " + JSON.stringify(info.seekable));
    const frame = async (time, colour, how) => {
      await link(path + "#t=" + time);
      await wait(`(()=>{const v=document.querySelector(${JSON.stringify(stage + "video")});return v&&!v.seeking&&v.readyState>=2&&Math.abs(v.currentTime-${time})<0.3})()`, label + " " + how + " #t=" + time);
      const sampled = await pixels(stage + "video", [[32, 24]], true);
      assert.ok(near(sampled.samples[0], colour), label + " frame at t=" + time + " " + JSON.stringify(sampled.samples[0]));
      return evaluate(`document.querySelector(${JSON.stringify(stage + "video")}).currentTime`);
    };
    const times = [await frame(3, BLUE, "loaded"), await frame(1, RED, "loaded")];
    await evaluate(`(async()=>{for(const leaf of app.workspace.leaves().filter(l=>l.view?.file?.path===${JSON.stringify(path)}))await app.workspace.closeLeaf(leaf);})()`);
    times.push(await frame(3, BLUE, "fresh-load"));
    return { info, times };
  }

  // Local actual-folder/native vault.
  const folder = "Viewer proofs";
  await mkdir(join(directory, folder), { recursive: true });
  for (const [name, value] of Object.entries(bytes)) { await writeFile(join(directory, folder, name), value); }
  await evaluate("app.vault.refresh()");
  const avif = await proveAvif(folder + "/Split.avif", "local");
  assert.equal(sha(await readFile(join(directory, folder, "Split.avif"))), manifest["Split.avif"].sha256);
  pass("A committed deterministic AVIF (AV1 still, no in-page encoder) decodes at 32x16 with left-red/right-blue pixels and unchanged bytes.");
  const video = await proveSeekable(folder + "/Seek.webm", "local");
  assert.equal(sha(await readFile(join(directory, folder, "Seek.webm"))), manifest["Seek.webm"].sha256);
  pass(`A committed seekable VP9 WebM reports duration ${video.info.duration.toFixed(2)} s with seekable range ${JSON.stringify(video.info.seekable)}; #t=3 shows the blue frame (currentTime ${video.times[0].toFixed(2)}), #t=1 the red frame (${video.times[1].toFixed(2)}), and a fresh load honours #t=3 (${video.times[2].toFixed(2)}).`);
  await evaluate(`(async()=>{for(const leaf of app.workspace.leaves().filter(l=>(l.view?.file?.path||"").startsWith(${JSON.stringify(folder + "/")})))await app.workspace.closeLeaf(leaf);})()`);
  await rm(join(directory, folder), { recursive: true, force: true });
  await evaluate("app.vault.refresh()");

  // Genuine cache-only GitHub mount: the viewer reads cached blobs and nothing else.
  const root = await evaluate("app.vault.rootPath"), url = await evaluate("location.href");
  const remote = await mountCachedGitHub(evaluate, "readonly-media", [
    ["Media/Split.avif", bytes["Split.avif"]], ["Media/Seek.webm", bytes["Seek.webm"]], ["Media/Note.md", "# Cached media\n\n![[Split.avif]]\n"],
    [".obsidian/core-plugins.json", '["file-explorer"]'], [".obsidian/community-plugins.json", "[]"],
  ]);
  await wait(`app.vault.rootPath===${JSON.stringify(remote.mount.id)}&&!app.changingVault`);
  assert.equal(await evaluate("app.vault.readOnly"), true);
  const cached = await evaluate(`(async()=>{const out={};for(const name of ["Split.avif","Seek.webm"]){const b=new Uint8Array(await app.vault.readBinary(app.vault.getFileByPath("Media/"+name)));out[name]=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",b)),x=>x.toString(16).padStart(2,"0")).join("")}return out})()`);
  assert.deepEqual(cached, { "Split.avif": manifest["Split.avif"].sha256, "Seek.webm": manifest["Seek.webm"].sha256 });
  const readOnlyAvif = await proveAvif("Media/Split.avif", "read-only");
  const readOnlyVideo = await proveSeekable("Media/Seek.webm", "read-only");
  await open("Media/Split.avif");
  const rejected = await evaluate(`app.vault.createBinary("Media/Should-not-exist.bin",new Uint8Array([1]).buffer).then(()=>false,()=>true)`);
  assert.equal(rejected, true, "read-only mount must reject binary writes");
  const counters = await evaluate("app.githubVaults.state()");
  assert.equal(counters.counters.api, 0); assert.equal(counters.counters.raw, 0);
  await assertCachedBlobsUnchanged(evaluate, remote.blobs);
  await capture?.("viewer-proofs");
  await evaluate(`(async()=>{for(const leaf of app.workspace.leaves().filter(l=>(l.view?.file?.path||"").startsWith("Media/")))await app.workspace.closeLeaf(leaf);})()`);
  pass("A real cache-only GitHub mount (readOnly=true) serves AVIF and seekable WebM from cached blobs with the same pixels/frames, binary writes rejected, zero api/raw requests and every cached blob byte-identical.");
  await command("Page.navigate", { url }); await afterReload();
  assert.equal(await evaluate("app.vault.rootPath"), root); assert.equal(await evaluate("app.vault.readOnly"), false);
  await assertCachedBlobsUnchanged(evaluate, remote.blobs);
  report.viewerProofs.results = { avifLocal: avif, avifReadOnly: readOnlyAvif, video: video.info, videoTimes: video.times, readOnlyVideoTimes: readOnlyVideo.times, cacheOnlyCounters: counters.counters, returnedToLocal: true };
}
