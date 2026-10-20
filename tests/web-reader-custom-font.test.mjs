import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { root, startHost } from "./host.mjs";

let temporary, readerAppearance, readerDocument;
before(async () => {
  await mkdir(join(root, ".runtime"), {recursive:true}); temporary = await mkdtemp(join(root, ".runtime", "reader-custom-font-tests-"));
  const entry = join(temporary, "custom-font.mjs");
  await build({stdin:{contents:'export {readerAppearance} from "./client/web-reader-appearance";export {readerDocument} from "./client/web-reader-frame";',resolveDir:root},outfile:entry,bundle:true,format:"esm",platform:"node",logLevel:"silent"});
  ({readerAppearance, readerDocument} = await import(pathToFileURL(entry).href));
});
after(async () => { if (temporary) { const path = relative(join(root, ".runtime"), temporary); assert.ok(path && !isAbsolute(path) && !path.startsWith("..")); await rm(temporary, {recursive:true}); } });
const article = {url:"https://example.com/story",title:"Custom font 中文",byline:"Author",content:"<p>First paragraph 中文 😀.</p><p>Second paragraph.</p>",textLength:500,lang:"en",dir:"ltr"};
const validNames = ["Arial", "Times New Roman", "Segoe UI", "Noto Sans CJK SC", "中文字体", "Font 123-Name_Pro (Text).", "O'Brien", "Cafe\u0301", "\u{10400} Font", "A".repeat(100)];
const invalid = [null,true,false,0,[],{},"","   ","123","A".repeat(101),"Arial, serif",'Arial"',"Arial\\", "Arial\n", "Arial\t", "Arial\0", "Arial\u0085", "Arial\u2028", "Arial\ufeff", "\ud800", "url(https://bad.example)","Arial; color:red","</style><script>bad()</script>"];

test("Reader custom fonts retain Serif/Georgia defaults, normalize only outside ASCII spaces without mutation and accept bounded Unicode names while rejecting stacks, CSS and coercion", () => {
  const input={future:{keep:[false,"中文"]}}, original=structuredClone(input), appearance=readerAppearance(input);
  assert.equal(appearance.readerFont,"serif"); assert.equal(appearance.readerCustomFont,"Georgia"); assert.deepEqual(input,original);
  for(const readerCustomFont of validNames) { assert.equal(readerAppearance({readerFont:"custom",readerCustomFont}).readerCustomFont,readerCustomFont); }
  assert.equal(readerAppearance({readerCustomFont:"  Arial  "}).readerCustomFont,"Arial");
  for(const readerCustomFont of invalid) { for(const readerFont of ["serif","custom"]) { assert.throws(()=>readerAppearance({readerFont,readerCustomFont}),/Reader custom font/i); } }
});

test("Reader HTML quotes a single local font with a serif fallback, preserves preset stacks, article HTML and typography and never adds a font resource or relaxes CSP", () => {
  for(const [readerFont,readerCustomFont,font] of [["serif","Arial","Georgia,serif"],["sans-serif","Arial","system-ui,sans-serif"],["monospace","Arial","Consolas,monospace"],...validNames.map(name=>["custom",name,JSON.stringify(name)+",serif"])]) {
    const html=readerDocument(article,"a".repeat(36),"https://editor.example",false,1.5,readerAppearance({readerFont,readerCustomFont,readerWidth:"custom",readerCustomWidth:81,readerFontSize:26,readerLineHeight:2.1,readerParagraphSpacing:1.8,readerLetterSpacing:.07}));
    assert.ok(html.includes("--reader-font:"+font+";--reader-width:81ch;")); assert.ok(html.includes("--reader-font-size:26px;--reader-line-height:2.1;--reader-paragraph-spacing:1.8em;--reader-letter-spacing:0.07em;"));
    assert.ok(html.includes(":root{zoom:1.5;")); assert.ok(html.includes("<article>"+article.content+"</article>")); assert.ok(html.includes("default-src 'none'")); assert.ok(html.includes("connect-src 'none'")); assert.doesNotMatch(html,/@font-face|@import|url\(/i);
  }
  for(const readerCustomFont of invalid) { assert.throws(()=>readerDocument(article,"a".repeat(36),"https://editor.example",false,1,{readerFont:"custom",readerCustomFont}),/Reader custom font/i); }
});

test("The actual opaque-frame bootstrap authenticates complete eight-value font updates, rejects invalid/missing names atomically and preserves progress through custom/preset changes", () => {
  const token="a".repeat(36),origin="https://editor.example",events=new Map(),messages=[],frames=new Map(),styles=new Map(); let serial=0;
  const viewport={clientHeight:200,scrollHeight:1200,scrollTop:0,style:{getPropertyValue:key=>styles.get(key)??"",setProperty:(key,value)=>styles.set(key,value)}};
  const parent={postMessage:data=>messages.push(data)},code=readerDocument(article,token,origin,false).match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1];
  runInNewContext(code,{parent,document:{addEventListener(){},querySelector:()=>({checkVisibility:()=>true}),scrollingElement:viewport,documentElement:viewport},ResizeObserver:class{observe(){}},addEventListener:(key,callback)=>events.set(key,callback),requestAnimationFrame:callback=>{frames.set(++serial,callback);return serial},cancelAnimationFrame:id=>frames.delete(id)});
  const send=(data,extra={})=>events.get("message")({source:parent,origin,data:{channel:"slopsidian-reader",token,...data},...extra});
  const render=()=>{for(let step=0;step<2;step++){const pending=[...frames.values()];frames.clear();for(const callback of pending)callback()}};
  send({kind:"restore-progress",progress:.6});render();
  const valid={kind:"appearance",readerFont:"custom",readerCustomFont:"Arial",readerWidth:"custom",readerCustomWidth:81,readerFontSize:26,readerLineHeight:2.1,readerParagraphSpacing:1.8,readerLetterSpacing:.07};
  for(const [data,extra] of [[valid,{source:{}}],[valid,{origin:"https://other.example"}],[{...valid,token:"wrong"},{}],...[undefined,...invalid].map(readerCustomFont=>[{...valid,readerCustomFont},{}]),[{...valid,readerFont:"constructor"},{}],[{...valid,readerCustomWidth:80.5},{}]]) {send(data,extra);assert.equal(styles.size,0)}
  send(valid);assert.equal(styles.get("--reader-font"),'"Arial",serif');assert.equal(styles.get("--reader-width"),"81ch");viewport.scrollHeight=2200;render();assert.equal(viewport.scrollTop,1200);assert.equal(messages.at(-1).progress,.6);
  const before=[...styles];send({...valid,readerWidth:"narrow",readerCustomFont:"Arial, serif"});assert.deepEqual([...styles],before);
  for(const readerCustomFont of validNames) {send({...valid,readerCustomFont});render();assert.equal(styles.get("--reader-font"),JSON.stringify(readerCustomFont)+",serif");assert.equal(viewport.scrollTop,1200)}
  send({...valid,readerFont:"monospace"});viewport.scrollHeight=1200;render();assert.equal(styles.get("--reader-font"),"Consolas,monospace");assert.equal(viewport.scrollTop,600);
  send({...valid,readerFont:"monospace",readerCustomFont:"Times New Roman"});assert.equal(frames.size,0,"Inactive custom name must not reflow a preset");
});

test("Native custom-font metadata exposes a Custom choice and text field without creating an absent settings file",async t=>{
  const directory=await mkdtemp(join(temporary,"absent-")),host=await startHost(directory);t.after(()=>host.stop());
  const state=(await(await host.request("/api/core")).json()).plugins.find(plugin=>plugin.id==="webviewer"),field=state.fields.find(field=>field.key==="readerCustomFont");
  assert.equal(state.settings.readerFont,"serif");assert.equal(state.settings.readerCustomFont,"Georgia");assert.deepEqual(state.fields.find(field=>field.key==="readerFont").options,["serif","sans-serif","monospace","custom"]);
  assert.ok(field);assert.equal(field.label,"Reader custom font family");assert.equal(field.type,"text");await assert.rejects(readFile(join(directory,".obsidian","webviewer.json")),{code:"ENOENT"});
});

test("Native custom-font validation matches Unicode/spacing policy, rejects invalid mixed patches atomically, retains opaque settings and rejects stale roots through full host restart",async t=>{
  const directory=await mkdtemp(join(temporary,"settings-")),path=join(directory,".obsidian","webviewer.json");await mkdir(join(directory,".obsidian"));
  const original={readerFont:"serif",readerWidth:"custom",readerCustomWidth:81,readerLetterSpacing:.07,future:{keep:[false,"中文"]}};await writeFile(path,JSON.stringify(original));
  let host=await startHost(directory);t.after(()=>host.stop());
  for(const readerCustomFont of invalid) {assert.equal((await host.request("/api/core/webviewer/settings","PUT",{root:directory,values:{readerWidth:"wide",readerFont:"custom",readerCustomFont}})).status,400,JSON.stringify(readerCustomFont));assert.equal(await readFile(path,"utf8"),JSON.stringify(original))}
  for(const readerCustomFont of validNames) {assert.equal((await host.request("/api/core/webviewer/settings","PUT",{root:directory,values:{readerFont:"custom",readerCustomFont}})).status,200,readerCustomFont)}
  assert.equal((await host.request("/api/core/webviewer/settings","PUT",{root:directory,values:{readerFont:"custom",readerCustomFont:"  Arial  "}})).status,200);
  const expected={...original,readerFont:"custom",readerCustomFont:"Arial"};assert.deepEqual(JSON.parse(await readFile(path,"utf8")),expected);
  assert.equal((await host.request("/api/core/webviewer/settings","PUT",{root:"D:\\stale-custom-font-vault",values:{readerCustomFont:"Georgia"}})).status,409);assert.deepEqual(JSON.parse(await readFile(path,"utf8")),expected);
  await host.stop();host=await startHost(directory);const state=(await(await host.request("/api/core")).json()).plugins.find(plugin=>plugin.id==="webviewer");for(const [key,value] of Object.entries(expected))assert.deepEqual(state.settings[key],value);
});

test("Imported custom names retain exact BOM/CRLF/Unicode settings, reject malformed names without rewriting and keep inactive preset choices",async t=>{
  const directory=await mkdtemp(join(temporary,"imported-")),path=join(directory,".obsidian","webviewer.json");await mkdir(join(directory,".obsidian"));
  const bytes=Buffer.from('\ufeff{\r\n "readerFont":"custom","readerCustomFont":"中文字体","future":{"keep":"中文 😀"}\r\n}\r\n');await writeFile(path,bytes);
  const host=await startHost(directory);t.after(()=>host.stop());let state=(await(await host.request("/api/core")).json()).plugins.find(plugin=>plugin.id==="webviewer");assert.equal(readerAppearance(state.settings).readerCustomFont,"中文字体");assert.deepEqual(await readFile(path),bytes);
  const invalidBytes=Buffer.from('\ufeff{"readerFont":"custom","readerCustomFont":"Arial, serif","future":{"keep":"中文 😀"}}\r\n');await writeFile(path,invalidBytes);assert.equal((await host.request("/api/core")).status,400);assert.deepEqual(await readFile(path),invalidBytes);
  const inactiveBytes=Buffer.from('\ufeff{"readerFont":"monospace","readerCustomFont":"  Arial  ","future":{"keep":"中文 😀"}}\r\n');await writeFile(path,inactiveBytes);state=(await(await host.request("/api/core")).json()).plugins.find(plugin=>plugin.id==="webviewer");assert.equal(state.settings.readerFont,"monospace");assert.equal(state.settings.readerCustomFont,"Arial");assert.deepEqual(await readFile(path),inactiveBytes);
});
