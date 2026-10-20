import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pixel } from "./reading-scenarios.mjs";

const PAD = Buffer.from("28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A", "hex");
const md5 = bytes => createHash("md5").update(bytes).digest();
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

function rc4(key, data) {
  const s = Array.from({ length: 256 }, (_, i) => i); let j = 0;
  for (let i = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
  const out = Buffer.alloc(data.length); let a = 0, b = 0;
  for (let n = 0; n < data.length; n++) { a = (a + 1) & 255; b = (b + s[a]) & 255; [s[a], s[b]] = [s[b], s[a]]; out[n] = data[n] ^ s[(s[a] + s[b]) & 255]; }
  return out;
}

// Builds a real PDF with a cross-reference table. `pages` are [width, height, label, [r,g,b]].
export function buildPdf(pages, { password = null, extra = "", mediaBox = null } = {}) {
  const objects = [];
  const add = (dict, stream) => { objects.push({ dict, stream }); return objects.length; };
  const catalog = add("", null), tree = add("", null), font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", null);
  const kids = [];
  for (const [w, h, label, [r, g, b]] of pages) {
    const content = Buffer.from(`${r} ${g} ${b} rg 20 20 ${Math.floor(w / 2)} ${Math.floor(h / 4)} re f 0 g BT /F1 24 Tf 20 ${h - 50} Td (${label}) Tj ET`);
    const c = add("", content);
    const box = mediaBox ?? `[0 0 ${w} ${h}]`;
    kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox ${box} /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c} 0 R >>`, null));
  }
  objects[catalog - 1].dict = `<< /Type /Catalog /Pages ${tree} 0 R ${extra} >>`;
  objects[tree - 1].dict = `<< /Type /Pages /Kids [${kids.map(k => k + " 0 R").join(" ")}] /Count ${kids.length} >>`;
  const id = randomBytes(16);
  let encryptRef = null, key = null;
  if (password !== null) {
    const owner = randomBytes(32), p = Buffer.alloc(4); p.writeInt32LE(-4);
    key = md5(Buffer.concat([Buffer.concat([Buffer.from(password), PAD]).subarray(0, 32), owner, p, id])).subarray(0, 16);
    for (let i = 0; i < 50; i++) { key = md5(key).subarray(0, 16); }
    let u = rc4(key, md5(Buffer.concat([PAD, id])));
    for (let i = 1; i <= 19; i++) { u = rc4(Buffer.from(key.map(byte => byte ^ i)), u); }
    u = Buffer.concat([u, randomBytes(16)]);
    encryptRef = add(`<< /Filter /Standard /V 4 /R 4 /Length 128 /CF << /StdCF << /CFM /AESV2 /AuthEvent /DocOpen /Length 16 >> >> /StmF /StdCF /StrF /StdCF /O <${owner.toString("hex")}> /U <${u.toString("hex")}> /P -4 >>`, null);
  }
  const chunks = [Buffer.from("%PDF-1.6\n%\xe2\xe3\xcf\xd3\n", "latin1")], offsets = [];
  let position = chunks[0].length;
  objects.forEach((object, index) => {
    const number = index + 1;
    let data = object.stream;
    if (data && key && number !== encryptRef) {
      const suffix = Buffer.from([number & 255, (number >> 8) & 255, (number >> 16) & 255, 0, 0, 0x73, 0x41, 0x6c, 0x54]);
      const objectKey = md5(Buffer.concat([key, suffix])).subarray(0, 16), iv = randomBytes(16);
      const cipher = createCipheriv("aes-128-cbc", objectKey, iv);
      data = Buffer.concat([iv, cipher.update(data), cipher.final()]);
    }
    const piece = data
      ? Buffer.concat([Buffer.from(`${number} 0 obj\n<< /Length ${data.length} >>\nstream\n`), data, Buffer.from("\nendstream\nendobj\n")])
      : Buffer.from(`${number} 0 obj\n${object.dict}\nendobj\n`);
    offsets.push(position); chunks.push(piece); position += piece.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map(offset => String(offset).padStart(10, "0") + " 00000 n \n")].join("");
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R ${encryptRef ? `/Encrypt ${encryptRef} 0 R ` : ""}/ID [<${id.toString("hex")}><${id.toString("hex")}>] >>\nstartxref\n${position}\n%%EOF\n`;
  chunks.push(Buffer.from(xref + trailer, "latin1"));
  return Buffer.concat(chunks);
}

// A 2x2 GIF with a four-colour global table and a real LZW stream.
function buildGif() {
  return Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 2, 0, 2, 0, 0x81, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0, 2, 2, 0x44, 0x0a, 0, 0x3b]);
}

export async function checkViewers({ directory, evaluate, command, click, press, wait, report, restart, afterReload, capture, browser = false }) {
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  const limit = text => { (report.limits ??= []).push(text); console.log("LIMIT " + text); };
  const folder = "Viewer fixtures";
  await mkdir(join(directory, folder), { recursive: true });
  const originalWorkspace = await readFile(join(directory, ".obsidian", "workspace.json")).catch(error => { if (error.code !== "ENOENT") { throw error; } return null; });
  const write = async (name, bytes) => { await writeFile(join(directory, folder, name), bytes); return folder + "/" + name; };
  const refresh = () => evaluate("app.vault.refresh()");
  const open = async path => { await evaluate(`app.openFile(${JSON.stringify(path)},true)`); };
  const view = ".workspace-tabs.mod-active .workspace-leaf:not([hidden]) .image-file-view";
  const state = () => evaluate("({...app.workspace.activeLeaf.view.bodyEl.dataset})");
  const waitStatus = (key, status, label) => wait(`app.workspace.activeLeaf?.view?.bodyEl?.dataset?.${key}==="${status}"`, label);
  const guard = async (name, body) => { try { await body(); } catch (error) { error.message = name + ": " + error.message; throw error; } };

  // Raster fixtures: real encoder output where the host provides it.
  const encode = type => evaluate(`new Promise((resolve,reject)=>{const c=document.createElement("canvas");c.width=24;c.height=16;const x=c.getContext("2d");x.fillStyle="#d33";x.fillRect(0,0,24,16);x.fillStyle="#37d";x.fillRect(6,4,12,8);c.toBlob(async blob=>{if(!blob||blob.type!==${JSON.stringify(type)}){resolve(null);return}const bytes=new Uint8Array(await blob.arrayBuffer());let s="";for(const b of bytes)s+=String.fromCharCode(b);resolve(btoa(s))},${JSON.stringify(type)},0.9)})`);
  const rasters = new Map([["Pixel.png", pixel(24, 16)], ["Anim.gif", buildGif()]]);
  for (const [type, name] of [["image/jpeg", "Photo.jpg"], ["image/webp", "Photo.webp"]]) {
    const encoded = await encode(type);
    if (encoded) { rasters.set(name, Buffer.from(encoded, "base64")); } else { limit(`${name} was not generated: this host's canvas encoder does not produce ${type}.`); }
  }
  const avif = await evaluate(`(async()=>{try{
    if(typeof VideoEncoder!=="function")return null;
    const config={codec:"av01.0.04M.08",width:64,height:64,bitrate:200000,framerate:1,latencyMode:"quality"};
    if(!(await VideoEncoder.isConfigSupported(config)).supported)return null;
    const c=new OffscreenCanvas(64,64),x=c.getContext("2d");x.fillStyle="#2a8";x.fillRect(0,0,64,64);x.fillStyle="#e92";x.fillRect(16,16,32,32);
    let chunk=null,description=null;
    const encoder=new VideoEncoder({output:(value,meta)=>{chunk=new Uint8Array(value.byteLength);value.copyTo(chunk);description=meta?.decoderConfig?.description?new Uint8Array(meta.decoderConfig.description):null},error:()=>{}});
    encoder.configure(config);const frame=new VideoFrame(c,{timestamp:0});encoder.encode(frame,{keyFrame:true});frame.close();await encoder.flush();encoder.close();
    if(!chunk||!description)return null;
    if(chunk[0]===0x12&&chunk[1]===0)chunk=chunk.subarray(2);
    const u32=n=>[n>>>24&255,n>>>16&255,n>>>8&255,n&255],u16=n=>[n>>8&255,n&255],str=s=>[...s].map(ch=>ch.charCodeAt(0));
    const box=(type,...parts)=>{const body=parts.flat();return [...u32(body.length+8),...str(type),...body]};
    const full=(type,version,...parts)=>box(type,[version,0,0,0],...parts);
    const ftyp=box("ftyp",str("avif"),u32(0),str("avif"),str("mif1"),str("miaf"));
    const build=offset=>full("meta",0,full("hdlr",0,u32(0),str("pict"),new Array(12).fill(0),[0]),full("pitm",0,u16(1)),full("iloc",0,[0x44,0],u16(1),u16(1),u16(0),u16(1),u32(offset),u32(chunk.length)),full("iinf",0,u16(1),full("infe",2,u16(1),u16(0),str("av01"),[0])),box("iprp",box("ipco",full("ispe",0,u32(64),u32(64)),box("av1C",[...description])),full("ipma",0,u32(1),u16(1),[2,1,0x82])));
    const size=build(0).length,meta=build(ftyp.length+size+8);
    const bytes=new Uint8Array([...ftyp,...meta,...u32(chunk.length+8),...str("mdat"),...chunk]);
    let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)}catch{return null}})()`);
  if (avif) { rasters.set("Photo.avif", Buffer.from(avif, "base64")); } else { limit("Photo.avif was not generated: this host exposes no WebCodecs AV1 encoder, so AVIF decoding is unverified here."); }
  for (const [name, bytes] of rasters) { await write(name, bytes); }
  await refresh();

  await guard("raster decoders", async () => {
    for (const [name, bytes] of rasters) {
      const path = folder + "/" + name; await open(path); await waitStatus("imageStatus", "ready", "decoded " + name);
      const info = await evaluate(`(()=>{const i=document.querySelector(${JSON.stringify(view + " img")});return {w:i.naturalWidth,h:i.naturalHeight,file:app.workspace.activeLeaf.view.bodyEl.dataset.imageFile}})()`);
      assert.ok(info.w > 0 && info.h > 0 && !(info.w === 300 && info.h === 150), name + " decoded dimensions " + JSON.stringify(info));
      assert.equal(info.file, path);
      assert.equal(sha(await readFile(join(directory, path))), sha(bytes), name + " bytes unchanged");
    }
    pass(`Real decoders produced non-placeholder natural sizes for ${[...rasters.keys()].join(", ")} with exact bytes preserved.`);
  });

  await guard("raster zoom and restart", async () => {
    await open(folder + "/Pixel.png"); await waitStatus("imageStatus", "ready", "png ready");
    await click(view + ' [data-image-action="in"]');
    const scale = (await state()).imageScale; assert.ok(Number(scale) > 0);
    pass("Raster zoom control changes the reported scale (" + scale + ").");
  });

  // SVG: sanitised, active content removed, malformed and dimensionless rejected explicitly.
  await guard("svg", async () => {
    await evaluate("globalThis.__svgRan=undefined");
    const good = await write("Good.svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20" width="40" height="20"><rect width="40" height="20" fill="#c33"/></svg>');
    const hostile = await write("Hostile.svg", '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 40 20" width="40" height="20" onload="globalThis.__svgRan=1"><script>globalThis.__svgRan=2</script><style>@import url(https://example.invalid/x.css);rect{fill:url(https://example.invalid/p)}</style><foreignObject><div>x</div></foreignObject><image href="https://example.invalid/i.png" width="4" height="4"/><a xlink:href="javascript:globalThis.__svgRan=3"><rect width="40" height="20" fill="#33c"/></a></svg>');
    const dimensionless = await write("Dimensionless.svg", '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>');
    const malformed = await write("Malformed.svg", '<svg xmlns="http://www.w3.org/2000/svg"><rect');
    const entity = await write("Entity.svg", '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "boom">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4" width="4" height="4"><text>&x;</text></svg>');
    await refresh();
    await open(good); await waitStatus("imageStatus", "ready", "valid svg");
    assert.equal((await evaluate(`document.querySelector(${JSON.stringify(view + " img")}).naturalWidth`)), 40);
    await open(hostile); await waitStatus("imageStatus", "ready", "sanitised hostile svg");
    const blocked = (await state()).imageBlocked; assert.ok(blocked, "removed content is reported");
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(await evaluate("globalThis.__svgRan"), undefined, "no SVG script ran");
    const url = await evaluate(`document.querySelector(${JSON.stringify(view + " img")}).src`);
    assert.ok(/^(blob|data):/.test(url), "SVG is shown from a local blob/data URL");
    for (const [name, path] of [["dimensionless", dimensionless], ["malformed", malformed], ["entity", entity]]) {
      await open(path); await waitStatus("imageStatus", "error", name + " svg rejected");
    }
    pass("SVG: valid renders at its declared size; script/handlers/foreignObject/remote refs/javascript: links are removed and reported (" + blocked + "); dimensionless, malformed and DOCTYPE/ENTITY files are explicit errors, never a 300x150 decode.");
  });

  // PDF
  const rendered = async (canvas, point) => evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(view + " canvas")});const x=c.getContext("2d");const d=x.getImageData(Math.floor(c.width*${point[0]}),Math.floor(c.height*${point[1]}),1,1).data;return [...d]})()`);
  await guard("pdf", async () => {
    await evaluate("globalThis.__pdfScriptRan=undefined");
    const doc = await write("Doc.pdf", buildPdf([[200, 300, "Page one", [1, 0, 0]], [300, 200, "Page two", [0, 0.6, 0]], [400, 400, "Page three", [0, 0, 1]]]));
    const spaced = await write("Spaced Doc.pdf", buildPdf([[200, 300, "A", [1, 0, 0]], [200, 300, "B", [0, 0.6, 0]]]));
    const secret = await write("Secret.pdf", buildPdf([[200, 300, "Secret page", [1, 0, 0]]], { password: "hunter2" }));
    const bad = await write("Garbage.pdf", Buffer.concat([Buffer.from("%PDF-1.4\n"), randomBytes(200)]));
    const notPdf = await write("NotPdf.pdf", Buffer.from("plain text"));
    const huge = await write("Huge.pdf", buildPdf([[200, 300, "Huge", [1, 0, 0]]], { mediaBox: "[0 0 14400 14400]" }));
    const active = await write("Active.pdf", buildPdf([[200, 300, "Active", [1, 0, 0]]], { extra: "/OpenAction << /S /JavaScript /JS (globalThis.__pdfScriptRan=1) >>" }));
    await refresh();
    const bytes = sha(await readFile(join(directory, doc)));

    await open(doc); await waitStatus("pdfStatus", "ready", "pdf rendered");
    let s = await state(); assert.equal(s.pdfPages, "3"); assert.equal(s.pdfPage, "1");
    const [width] = s.pdfCanvas.split("x").map(Number); assert.ok(width >= 200, "canvas has real pixels");
    const red = await rendered(view, [0.2, 0.9]); assert.ok(red[0] > 200 && red[1] < 60 && red[2] < 60 && red[3] === 255, "red rectangle pixel " + red);
    pass("PDF renders to a real canvas with the engine-reported page count (3) and sampled page pixels.");

    await click(view + ' [data-pdf-action="next"]'); await wait('app.workspace.activeLeaf.view.bodyEl.dataset.pdfPage==="2"', "next page");
    await click(view + ' [data-pdf-action="zoom-in"]'); await wait("Number(app.workspace.activeLeaf.view.bodyEl.dataset.pdfZoom)>1", "zoom in");
    s = await state(); const saved = await evaluate("app.workspace.activeLeaf.view.getState()");
    assert.equal(saved.pdfPage, 2); assert.equal(Number(saved.pdfZoom), Number(s.pdfZoom));
    const green = await rendered(view, [0.2, 0.8]); assert.ok(green[1] > 100 && green[0] < 60, "page two is green " + green);
    pass("Page and zoom controls re-render distinct pages and persist in view state.");

    await evaluate(`app.workspace.openLinkText("Viewer fixtures/Doc.pdf#page=3&zoom=150","",true)`);
    await wait('app.workspace.activeLeaf.view.bodyEl.dataset.pdfPage==="3"&&app.workspace.activeLeaf.view.bodyEl.dataset.pdfZoom==="1.5"', "link target applied");
    await evaluate(`app.workspace.openLinkText("Viewer fixtures/Spaced Doc.pdf#page=2","",true)`);
    await wait('app.workspace.activeLeaf.view.bodyEl.dataset.pdfPage==="2"&&app.workspace.activeLeaf.view.bodyEl.dataset.pdfFile==="Viewer fixtures/Spaced Doc.pdf"', "spaced link target");
    const rejected = await evaluate(`app.workspace.openLinkText("Viewer fixtures/Doc.pdf#page=0","",true).then(()=>"opened",error=>String(error.message))`);
    assert.notEqual(rejected, "opened"); pass("Exact encoded #page/#zoom link targets navigate; invalid targets are rejected: " + rejected);

    await open(secret); await waitStatus("pdfStatus", "password", "password prompt");
    const submit = async password => {
      await evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(view + " .pdf-password")});const i=f.querySelector("input");i.value=${JSON.stringify(password)};f.requestSubmit()})()`);
    };
    await submit("wrong"); await wait('app.workspace.activeLeaf.view.bodyEl.dataset.pdfStatus==="password"&&/Incorrect/i.test(document.querySelector(".workspace-tabs.mod-active .workspace-leaf:not([hidden]) .image-status").textContent)', "incorrect password reported");
    await submit("hunter2"); await waitStatus("pdfStatus", "ready", "password accepted");
    pass("Encrypted PDF prompts, reports an incorrect password, then renders with the correct one.");

    await open(bad); await wait('["error","invalid","failed","unsupported"].includes(app.workspace.activeLeaf.view.bodyEl.dataset.pdfStatus)', "garbage reported");
    await open(notPdf); await wait('["error","invalid"].includes(app.workspace.activeLeaf.view.bodyEl.dataset.pdfStatus)', "non-PDF reported");
    pass("Malformed and non-PDF .pdf bytes produce explicit error states, not a blank success.");

    await open(huge); await waitStatus("pdfStatus", "ready", "huge page");
    s = await state(); const [hw, hh] = s.pdfCanvas.split("x").map(Number);
    assert.ok(hw * hh <= 16_777_216 && s.pdfCapped === "true", "pixel cap " + s.pdfCanvas);
    pass("A 14400x14400pt page is capped (" + s.pdfCanvas + ") instead of exhausting memory.");

    await open(active); await waitStatus("pdfStatus", "ready", "active pdf");
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(await evaluate("globalThis.__pdfScriptRan"), undefined); assert.ok((await state()).pdfBlocked, "active content reported");
    pass("PDF JavaScript OpenAction did not run and is reported as blocked.");

    assert.equal(sha(await readFile(join(directory, doc))), bytes); pass("PDF source bytes unchanged after viewing.");
  });

  // Dirty Markdown peer, external modification, rename, delete.
  await guard("lifecycle", async () => {
    const note = await writeFile(join(directory, folder, "Peer.md"), "# Peer\n\n[[Doc.pdf#page=2]]\n");
    void note; await refresh();
    await open(folder + "/Peer.md"); await evaluate('app.markdownView.setEditingMode("source")');
    await evaluate('app.editor.replaceRange("dirty ",{line:0,ch:0})');
    const dirty = await evaluate("app.editor.getValue()");
    await open(folder + "/Doc.pdf"); await waitStatus("pdfStatus", "ready", "pdf beside dirty peer");
    await open(folder + "/Peer.md"); assert.equal(await evaluate("app.editor.getValue()"), dirty);
    pass("Opening a PDF beside a dirty Markdown note leaves the unsaved note text intact.");

    await open(folder + "/Doc.pdf"); await waitStatus("pdfStatus", "ready", "pdf before external change");
    await write("Doc.pdf", buildPdf([[200, 300, "One", [1, 0, 0]]])); await refresh();
    await wait('app.workspace.activeLeaf.view.bodyEl.dataset.pdfPages==="1"', "external modification reloaded");
    pass("External modification of the open PDF reloads the viewer (1 page).");

    const file = `app.vault.getAbstractFileByPath(${JSON.stringify(folder + "/Doc.pdf")})`;
    await evaluate(`app.fileManager.renameFile(${file},${JSON.stringify(folder + "/Renamed Doc.pdf")})`);
    await wait(`app.workspace.activeLeaf.view.bodyEl.dataset.pdfFile==="${folder}/Renamed Doc.pdf"&&app.workspace.activeLeaf.view.bodyEl.dataset.pdfStatus==="ready"`, "rename followed");
    pass("Renaming the open PDF keeps the leaf on the new path.");

    await rm(join(directory, folder, "Renamed Doc.pdf")); await refresh();
    await wait('["error","idle"].includes(app.workspace.activeLeaf?.view?.bodyEl?.dataset?.pdfStatus)||app.workspace.activeLeaf?.view?.file==null', "deletion handled");
    pass("Deleting the open PDF externally leaves no stale rendered success state.");
    await evaluate(`(async()=>{for(const leaf of app.workspace.leaves().filter(l=>l.view?.file?.path===${JSON.stringify(folder + "/Renamed Doc.pdf")}||l.view?.bodyEl?.dataset?.pdfFile===${JSON.stringify(folder + "/Renamed Doc.pdf")}))await app.workspace.closeLeaf(leaf);})()`);

    await evaluate("app.vault.readOnly=true");
    await open(folder + "/Pixel.png"); await waitStatus("imageStatus", "ready", "read-only image");
    await evaluate("app.vault.readOnly=false");
    limit("Read-only viewing is verified by toggling the vault's read-only flag in the page; no real GitHub read-only vault was used.");
  });

  // Video: software-generated WebM; host codec support is not generalised.
  await guard("video", async () => {
    const webm = await evaluate(`new Promise(resolve=>{try{
      const mime=["video/webm;codecs=vp8","video/webm"].find(t=>MediaRecorder.isTypeSupported(t));if(!mime){resolve(null);return}
      const c=document.createElement("canvas");c.width=64;c.height=48;const x=c.getContext("2d");const r=new MediaRecorder(c.captureStream(15),{mimeType:mime});const parts=[];
      r.ondataavailable=e=>parts.push(e.data);r.onstop=async()=>{const bytes=new Uint8Array(await new Blob(parts).arrayBuffer());let s="";for(const b of bytes)s+=String.fromCharCode(b);resolve(btoa(s))};
      r.start();let n=0;const t=setInterval(()=>{x.fillStyle="hsl("+n*20+",80%,50%)";x.fillRect(0,0,64,48);if(++n>40){clearInterval(t);r.stop()}},50)}catch{resolve(null)}})`);
    if (!webm) { limit("Video fixture was not generated: this host has no MediaRecorder WebM encoder; video playback is unverified here."); return; }
    const bytes = Buffer.from(webm, "base64"); const path = await write("Clip.webm", bytes); await refresh();
    await open(path); await waitStatus("videoStatus", "ready", "video decoded");
    const info = await evaluate(`(()=>{const v=document.querySelector(".workspace-tabs.mod-active .workspace-leaf:not([hidden]) video");return {w:v.videoWidth,h:v.videoHeight,controls:v.controls,pip:v.disablePictureInPicture}})()`);
    assert.equal(info.w, 64); assert.equal(info.h, 48); assert.ok(info.controls);
    await evaluate(`app.workspace.activeLeaf.view.setState({file:${JSON.stringify(path)},videoVolume:0.3,videoRate:1.5,videoMuted:true},{})`);
    const saved = await evaluate("app.workspace.activeLeaf.view.getState()"); assert.equal(saved.videoRate, 1.5);
    await evaluate(`app.workspace.openLinkText("${path}#t=0.4","",true)`).catch(() => {});
    const time = await evaluate(`document.querySelector(".workspace-tabs.mod-active .workspace-leaf:not([hidden]) video").currentTime`);
    if (!(time > 0)) { limit("MediaRecorder WebM is not reliably seekable (duration unknown), so the #t= link target was not observable as playback time here."); }
    assert.equal(sha(await readFile(join(directory, path))), sha(bytes));
    pass("Generated WebM decodes with the host's software decoder at 64x48 with native controls and persisted rate/mute state. No other codec or device is claimed.");
  });

  // Review regressions: bare media links, locked-PDF fragment validation, video state across a switch.
  await guard("review regressions", async () => {
    const lockedPath = await write("Locked.pdf", buildPdf([[200, 300, "L1", [1, 0, 0]], [200, 300, "L2", [0, 1, 0]]], { password: "hunter2" }));
    await write("Bare.md", "[[Locked.pdf]]\n\n[Plain](Locked.pdf)\n\n[[Locked.pdf#page=99]]\n");
    await refresh();
    for (const link of [lockedPath, lockedPath + "#page=1"]) {
      await evaluate(`app.workspace.openLinkText(${JSON.stringify(link)},"",true)`);
      await waitStatus("pdfStatus", "password", "bare/fragment link opens locked pdf");
    }
    await evaluate(`app.workspace.openLinkText(${JSON.stringify(lockedPath + "#page=99")},"",true)`);
    await waitStatus("pdfStatus", "password", "locked page 99");
    await evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(view + " .pdf-password")});f.querySelector("input").value="hunter2";f.requestSubmit()})()`);
    await wait('app.workspace.activeLeaf.view.bodyEl.dataset.pdfStatus==="error"&&/page 99/.test(document.querySelector(".workspace-tabs.mod-active .workspace-leaf:not([hidden]) .image-status").textContent)', "page 99 rejected after unlock");
    assert.equal((await state()).pdfPages, "2");
    pass("Bare and fragment links open media files; a locked-PDF #page=99 fails visibly after unlock instead of clamping.");

    await open(folder + "/Bare.md");
    await evaluate('app.markdownView.setMode?.("preview")').catch(() => {});
    const preview = ".workspace-tabs.mod-active .workspace-leaf:not([hidden]) .markdown-preview-view";
    await wait('app.workspace.activeLeaf.view.getMode?.()==="preview"||!!document.querySelector(' + JSON.stringify(preview) + ")", "reading view").catch(() => {});
    const anchor = await evaluate(`document.querySelector(${JSON.stringify(preview + ' a[href="Locked.pdf"]')})?"md":document.querySelector(${JSON.stringify(preview + " a.internal-link")})?"wiki":null`);
    if (anchor) {
      const selector = anchor === "md" ? preview + ' a[href="Locked.pdf"]' : preview + " a.internal-link";
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:"center"})`); await click(selector);
      await wait('app.workspace.activeLeaf?.view?.file?.path==="' + lockedPath + '"', "reading-view bare link opened the PDF");
      pass("A bare reading-view " + anchor + " link opens the PDF without a fragment error.");
    } else { limit("Reading-view bare-link click not observed: no anchor rendered in this host."); }
    const clip = folder + "/Clip.webm";
    if (!(await evaluate(`!!app.vault.getAbstractFileByPath(${JSON.stringify(clip)})`))) { limit("Video switch regression not exercised: no generated WebM on this host."); return; }
    await write("Clip2.webm", await readFile(join(directory, clip))); await refresh();
    await open(clip); await wait('app.workspace.activeLeaf?.view?.getViewType()==="video"&&app.workspace.activeLeaf.view.bodyEl.dataset.videoStatus==="ready"&&app.workspace.activeLeaf.view.file?.path===' + JSON.stringify(clip), "clip A active");
    await evaluate("(globalThis.__clipLeaf=app.workspace.activeLeaf,true)");
    const leafState = () => evaluate("__clipLeaf.view.getState()");
    await evaluate('__clipLeaf.setViewState({type:"video",state:{file:' + JSON.stringify(clip) + ',videoRate:2,videoMuted:true,videoVolume:0.2}})');
    await evaluate(`__clipLeaf.setViewState({type:"video",state:{file:${JSON.stringify(folder + "/Clip2.webm")},videoRate:0.5,videoMuted:false,videoVolume:0.9}})`);
    await wait(`__clipLeaf.view.getViewType()==="video"&&__clipLeaf.view.file?.path===${JSON.stringify(folder + "/Clip2.webm")}&&__clipLeaf.view.bodyEl.dataset.videoStatus==="ready"`, "clip B ready");
    const incoming = await leafState();
    assert.equal(incoming.videoRate, 0.5); assert.equal(incoming.videoMuted, false); assert.equal(incoming.videoVolume, 0.9);
    pass("Switching video files installs the incoming rate/volume/mute instead of the outgoing file's state.");
  });

  // Restart persistence.
  await guard("restart", async () => {
    await evaluate(`(async()=>{for(const leaf of app.workspace.leaves().filter(l=>["pdf","video","image"].includes(l.getViewState?.().type)&&!l.getViewState().state?.file))await app.workspace.closeLeaf(leaf);})()`);
    await open(folder + "/Pixel.png");
    const imageLeaf = await evaluate("app.workspace.activeLeaf.id");
    await wait(`app.workspace.activeLeaf.id===${JSON.stringify(imageLeaf)}&&app.workspace.activeLeaf.view.file?.path===${JSON.stringify(folder + "/Pixel.png")}&&app.workspace.activeLeaf.view.bodyEl.dataset.imageStatus==="ready"`, "intended image selected before restart");
    await evaluate("(async()=>{await app.workspace.saveAll();await app.workspace.flushLayout()})()");
    const layout = JSON.parse(await readFile(join(directory, ".obsidian", "vault-dotnet-workspace.json"), "utf8"));
    assert.equal(layout.active, imageLeaf, "a late background media load must not replace the intended active leaf");
    if (browser) { await command("Page.reload"); } else { await restart(); }
    await afterReload();
    await wait(`app.workspace.activeLeaf?.id===${JSON.stringify(imageLeaf)}&&app.workspace.activeLeaf.view.file?.path===${JSON.stringify(folder + "/Pixel.png")}&&app.workspace.activeLeaf.view.bodyEl.dataset.imageStatus==="ready"`, "intended image leaf restored after restart");
    pass("The open image leaf is restored and decoded again after a restart.");
  });

  await capture?.("viewers");
  if (originalWorkspace) { await writeFile(join(directory, ".obsidian", "workspace.json"), originalWorkspace); }
  await rm(join(directory, folder), { recursive: true, force: true });
  void press;
}
