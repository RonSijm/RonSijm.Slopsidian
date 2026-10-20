import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script, createContext, runInContext } from 'node:vm';
import { EditorState, Text } from '@codemirror/state';
import { history, undoDepth, redoDepth, undo, insertNewlineAndIndent } from '@codemirror/commands';

const root=fileURLToPath(new URL('../',import.meta.url)),directory=new URL('../.runtime/canvas-markdown-export-tests/',import.meta.url);
await mkdir(directory,{recursive:true});
async function bundle(contents,name,resolveDir=root){const result=await build({stdin:{contents,resolveDir,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',write:false,logLevel:'silent'}),path=new URL(name,directory);await writeFile(path,result.outputFiles[0].text);return import(pathToFileURL(fileURLToPath(path)).href);}
const model=await bundle('export * from "./client/canvas-export";export * from "./client/canvas-export-markdown";','current.mjs');
const {captureCanvasExport,captureCanvasExportLocalContent,serializeCanvasExport,readCanvasExportSettings,layoutCanvasExportMarkdown,serializeCanvasMarkdownLayout,canvasMarkdownExportLimits}=model;
const settings={scope:'whole',background:'white',width:1000,height:700},node=(text,extra={})=>({id:'text',type:'text',x:0,y:0,width:550,height:650,text,...extra}),frame=(nodes)=>captureCanvasExport({nodes,edges:[]},'Formatting Ω',new Set()),svg=(text,extra={})=>serializeCanvasExport(frame([node(text)]),{...settings,formattedMarkdown:true,...extra}),texts=layout=>layout.lines.map(l=>l.runs.map(r=>r.text).join('')).join('\n');

test('Formatting is explicit, boolean-validated, immutable and omitted from existing settings by default',()=>{
  assert.deepEqual(readCanvasExportSettings(settings),settings);assert.equal(readCanvasExportSettings({...settings,formattedMarkdown:true}).formattedMarkdown,true);
  assert.equal(readCanvasExportSettings({...settings,formattedMarkdown:false}).formattedMarkdown,false);
  for(const value of ['true',1,null,{}])assert.throws(()=>readCanvasExportSettings({...settings,formattedMarkdown:value}),/format supported Markdown/);
  const plain=serializeCanvasExport(frame([node('# Heading\n**literal**')]),settings);assert.equal(plain.markdown,undefined);assert.match(plain.text,/\*\*literal\*\*/);assert.doesNotMatch(plain.text,/<tspan/);
});

test('Default literal SVG output retains the pre-formatting bytes across all three backgrounds',()=>{
  // Captured from the independently bundled pre-feature implementation, rather than from this renderer.
  const expected={white:['f8700ed2a197deebbcba3df83e5f61d9ae30a8de8ef955a266703e965db6b777',2098],dark:['bfa574fe672117c84a6c7133b130fe4eba98e84f98688a2fa2bb868b46089862',2098],transparent:['aac46447d13cb654433992bab4cc2079cd95aefd8457f96e32f75a1787911503',2049]},data={nodes:[node('## Title Ω\nLiteral **text** & <script> 😀.\r\nNext.',{height:90}),{id:'file',type:'file',x:580,y:10,width:250,height:180,file:'Target.md'},{id:'website',type:'link',x:20,y:200,width:230,height:150,url:'https://example.invalid'}],edges:[{id:'a',fromNode:'text',toNode:'file',label:'Ω & 😀'}]};
  for(const [background,[hash,bytes]]of Object.entries(expected)){const current=serializeCanvasExport(captureCanvasExport(data,'Board',new Set(['text'])),{...settings,background});assert.equal(createHash('sha256').update(current.text).digest('hex'),hash);assert.equal(current.bytes,bytes);assert.equal(current.clippedCards,1);}
});

test('Common block and inline formatting produces escaped inert SVG text with no resources or active elements',()=>{
  const value=svg('# Heading\nA **strong** and *emphasis* with ~~struck~~ and `code`.\n[Link label](javascript:alert)\n> Quote\n- Item\n1. Ordered\n- [x] Task\n```js\nconst a = "<&>";\n```');
  assert.match(value.text,/font-size="22"/);assert.match(value.text,/<tspan font-weight="700">strong<\/tspan>/);assert.match(value.text,/<tspan font-style="italic">emphasis<\/tspan>/);assert.match(value.text,/text-decoration="line-through">struck/);assert.match(value.text,/font-family="monospace">code/);assert.match(value.text,/Link label/);assert.match(value.text,/• Item/);assert.match(value.text,/☒ Task/);assert.match(value.text,/&lt;&amp;&gt;/);assert.doesNotMatch(value.text,/<(?:script|foreignObject|a|style|image)\b|(?:href|src|onload)=|javascript:alert/);assert.equal(value.markdown.cards,1);assert.ok(value.markdown.pieces>0);assert.equal(value.bytes,Buffer.byteLength(value.text));assert.equal(Object.isFrozen(value.markdown.rows),true);
});

test('Unsupported constructs retain exact visible literal source and a per-card explanation',()=>{
  for(const source of ['<img src="https://bad.invalid/a" onerror="attack()">','![Alt](https://bad.invalid/image.png)','![[Target.md]]','[[Target|Alias]]','$x$','$$','> [!danger] Title','| A | B |','    indented code']){
    const layout=layoutCanvasExportMarkdown(source,1000,600),value=svg(source);assert.equal(texts(layout),source);assert.ok(layout.warnings.some(s=>s.includes('retained as literal source')));assert.ok(value.markdown.rows.some(s=>s.includes('literal source')));assert.doesNotMatch(value.text,/<(?:img|script|foreignObject|a|style|image)\b|\s(?:href|src|onerror)="/);assert.match(value.text,/<tspan>/);
  }
});

test('Unclosed fences remain literal, closed backtick/tilde fences preserve code instead of parsing its Markdown',()=>{
  const unclosed=layoutCanvasExportMarkdown('```ts\n**keep**',400,400);assert.equal(texts(unclosed),'```ts\n**keep**');assert.ok(unclosed.warnings.some(s=>s.includes('Unclosed')));
  for(const marker of ['```','~~~~']){const layout=layoutCanvasExportMarkdown(marker+' js\n**keep** <script>\n'+marker,400,400);assert.equal(texts(layout),'**keep** <script>');assert.equal(layout.lines[0].code,true);assert.equal(layout.lines[0].runs[0].code,true);}
});

test('Simple escaped delimiters, nested styles, inert link labels and Unicode survive without exposing destinations',()=>{
  const layout=layoutCanvasExportMarkdown('\\*literal\\* **bold *inside*** Ω 😀 e\u0301 [**Label**](https://example.invalid)',1200,500),text=texts(layout);
  assert.match(text,/\*literal\*/);assert.match(text,/Ω 😀 e\u0301 Label/);assert.doesNotMatch(text,/https:/);assert.ok(layout.lines.flatMap(l=>l.runs).some(r=>r.text==='Label'&&r.bold));
});

test('Malformed Unicode, bidi controls, line separators and tabs are explicit and cannot hide direction-changing text',()=>{
  const layout=layoutCanvasExportMarkdown('Safe\u202eattack\u2066\ud800\r\nΩ\t😀\u2028Next',800,500);assert.equal(texts(layout),'Safe�attack��\nΩ    😀\nNext');assert.ok(layout.warnings.some(s=>s.includes('bidirectional')));assert.ok(layout.warnings.some(s=>s.includes('Tabs')));assert.doesNotMatch(serializeCanvasMarkdownLayout(layout,0,0,800,'#24242a','#4c4c5c','#eeeeee'),/[\u202e\u2066\ud800]/u);
  assert.match(svg('Captured\ud800').markdown.rows[0],/Malformed Unicode/);
});

test('Wrapping uses code points and combining marks, finite card clipping is explicit and immutable',()=>{
  const source='😀e\u0301 '.repeat(80),layout=layoutCanvasExportMarkdown(source,45,70);assert.equal(layout.clipped,true);assert.ok(layout.lines.length>0&&layout.lines.length<10);assert.match(texts(layout),/…$/);assert.ok(layout.warnings.some(s=>s.includes('clipped')));assert.equal(Object.isFrozen(layout.lines[0].runs[0]),true);assert.doesNotMatch(texts(layout),/[\ud800-\udbff](?![\udc00-\udfff])/u);
  const tiny=layoutCanvasExportMarkdown('Text',0,0);assert.equal(tiny.clipped,true);assert.equal(tiny.lines.length,0);for(const dimensions of [[NaN,10],[-1,10],[10,Infinity]])assert.throws(()=>layoutCanvasExportMarkdown('x',...dimensions));
});

test('Captured text truncation and long local notes are both declared in the formatted review',()=>{
  const value=svg('a'.repeat(17000));assert.ok(value.markdown.rows[0].includes('first 16,384'));assert.equal(value.clippedCards,1);
  const f=frame([{id:'note',type:'file',x:0,y:0,width:400,height:300,file:'Long.md'}]),local=captureCanvasExportLocalContent(f,[{id:'note',kind:'text',content:'b'.repeat(20000),summary:'Included note'}]),out=serializeCanvasExport(f,{...settings,formattedMarkdown:true,localContent:true},local);assert.ok(out.markdown.rows[0].includes('first 16,384'));assert.equal(out.markdown.cards,1);assert.equal(out.localContent.notes,1);
});

test('Only text and explicitly included note cards are formatted, selection and local provenance remain exact',()=>{
  const data={nodes:[node('**Text**'),{id:'note',type:'file',x:600,y:0,width:350,height:350,file:'Target.md',subpath:'#Section'},{id:'other',type:'link',x:0,y:700,width:250,height:150,url:'https://invalid'}],edges:[]},before=JSON.stringify(data),f=captureCanvasExport(data,'B',new Set(['note']));
  assert.equal(serializeCanvasExport(f,{...settings,formattedMarkdown:true}).markdown.cards,1);const local=captureCanvasExportLocalContent(f,[{id:'note',kind:'text',content:'# Section\n**Included**',summary:'Included saved text'}]),out=serializeCanvasExport(f,{...settings,scope:'selection',formattedMarkdown:true,localContent:true},local);assert.equal(out.cards,1);assert.equal(out.markdown.cards,1);assert.match(out.text,/font-weight="700">Included/);assert.match(out.markdown.rows[0],/Target.md#Section/);assert.doesNotMatch(out.text,/https:\/\/invalid/);assert.equal(JSON.stringify(data),before);
  const empty=serializeCanvasExport(captureCanvasExport({nodes:[data.nodes[1]],edges:[]},'B',new Set()),{...settings,formattedMarkdown:true});assert.equal(empty.markdown.cards,0);assert.match(empty.markdown.rows[0],/no text cards/);
});

test('Formatted parse and board budgets refuse bounded work while literal output remains available',()=>{
  assert.throws(()=>layoutCanvasExportMarkdown('x\n'.repeat(513),400,600),/512 source lines/);
  assert.throws(()=>layoutCanvasExportMarkdown('**a** *b* '.repeat(600),400,600),/1,024 inline pieces/);
  const many=frame(Array.from({length:65},(_,i)=>node('text',{id:'n'+i,x:i*10})));assert.throws(()=>serializeCanvasExport(many,{...settings,formattedMarkdown:true}),/at most 64/);assert.equal(serializeCanvasExport(many,settings).cards,65);
  const long=frame(Array.from({length:33},(_,i)=>node('a'.repeat(16384),{id:'n'+i,x:i*10})));assert.throws(()=>serializeCanvasExport(long,{...settings,formattedMarkdown:true}),/524,288/);
  const busy=frame(Array.from({length:20},(_,i)=>node('**a** *b* '.repeat(70),{id:'n'+i,x:i*10})));assert.throws(()=>serializeCanvasExport(busy,{...settings,formattedMarkdown:true}),/8,192 inline pieces/);
  assert.deepEqual(Object.keys(canvasMarkdownExportLimits),['cards','characters','totalCharacters','sourceLines','pieces','totalPieces','depth','visibleLines']);
});

test('White/dark/transparent formatted SVGs retain inert contrast and dimension/byte contracts',()=>{
  for(const background of ['white','dark','transparent']){const value=svg('# Heading\n```\nCode\n```\n> Quote',{background});assert.equal(value.bytes,Buffer.byteLength(value.text));assert.ok(value.bytes<8*1024*1024);assert.match(value.text,background==='dark'?/fill="#eeeeee"/:/fill="#24242a"/);if(background==='transparent')assert.doesNotMatch(value.text,/width="100%"/);assert.equal(value.width,1000);assert.equal(value.height,700);}
});

test('Real-host formatting scenarios retain CRLF cached fixtures, validated PNG pixels and valid renderer expressions',async()=>{
  const helper=await import('../tools/canvas-markdown-export-scenarios.mjs'),fixture=helper.canvasMarkdownExportReadOnlyFixture;
  assert.equal(fixture.sourceAddition.replaceAll('\r\n','').includes('\n'),false);assert.equal(fixture.files.filter(([path])=>path.endsWith('.canvas')).length,1);
  const image=fixture.files.find(([path])=>path.endsWith('.PNG'))[1],proof=helper.inspectCanvasMarkdownDownloadedPng(image);assert.equal(proof.redPixels,16*16);assert.equal(proof.width,16);assert.equal(proof.height,16);assert.equal(proof.rgbaSha256,createHash('sha256').update(Buffer.from(Array.from({length:256},()=>[255,0,0,255]).flat())).digest('hex'));
  let expression;await helper.inspectCanvasMarkdownRendering({evaluate(code){new Script(code);expression=code;return Promise.resolve({});}},'retained-leaf');assert.match(expression,/getImageData/);assert.match(expression,/regionSha256/);assert.match(expression,/bitmap\?\.close/);assert.match(expression,/crypto.subtle.digest/);
});

const modalBuild=await build({stdin:{contents:'export {CanvasExportModal} from "./client/canvas-export-modal";export {captureCanvasExport} from "./client/canvas-export";',resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',write:false,logLevel:'silent',plugins:[{name:'formatting-modal-stub',setup(b){b.onResolve({filter:/^\.\/ui$/},a=>({path:a.path,namespace:'formatting-modal-stub'}));b.onLoad({filter:/.*/,namespace:'formatting-modal-stub'},()=>({contents:'export class Modal {constructor(app){this.app=app;this.modalEl=document.createElement("div");this.contentEl=document.createElement("div");this.containerEl=this.modalEl;this.isOpen=false;}setTitle(){}open(){this.isOpen=true;this.onOpen?.()}close(){this.isOpen=false;this.onClose?.()}}',loader:'js'}));}}]});
const modalFile=new URL('modal.mjs',directory);await writeFile(modalFile,modalBuild.outputFiles[0].text);const modalModel=await import(pathToFileURL(fileURLToPath(modalFile)).href);
function domFixture(){
  const state={urls:new Map(),created:[],revoked:[],links:0};
  class Element{constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.isConnected=true;this.hidden=false;this.disabled=false;this.checked=false;this.value='';this.listeners=new Map();this.ownerDocument=document;this.classList={add(){},remove(){}};}append(...children){this.children.push(...children);if(this.tagName==='select'&&!this.value)this.value=this.children[0]?.value??'';}replaceChildren(...children){this.children=children;}setAttribute(key,value){this.attributes[key]=value;}removeAttribute(key){delete this.attributes[key];if(key==='src')this._src='';}addEventListener(type,listener){this.listeners.set(type,listener);}set src(value){this._src=value;this.complete=true;this.naturalWidth=1000;}get src(){return this._src;}click(){if(this.tagName==='a')state.links++;else this.listeners.get('click')?.();}}
  const document={createElement:tag=>new Element(tag)},prior={document:globalThis.document,create:URL.createObjectURL,revoke:URL.revokeObjectURL};globalThis.document=document;URL.createObjectURL=blob=>{const url='blob:formatting-'+state.created.length;state.created.push(url);state.urls.set(url,blob);return url;};URL.revokeObjectURL=url=>{state.revoked.push(url);state.urls.delete(url);};return{state,restore(){globalThis.document=prior.document;URL.createObjectURL=prior.create;URL.revokeObjectURL=prior.revoke;}};
}
const appFixture=()=>({core:{on:()=>({emitter:{offref(){}}})},vault:{readOnly:true}});
test('Actual modal exposes separate opt-in and reviewed fallback rows, and checks the exact formatting choice before download',async()=>{
  const dom=domFixture();let modal;
  try{modal=new modalModel.CanvasExportModal(appFixture(),modalModel.captureCanvasExport({nodes:[node('# Title\n**Strong**\n![[literal]]')],edges:[]},'B',new Set()),{current:()=>true,closed(){}});modal.open();await new Promise(resolve=>setImmediate(resolve));assert.equal(modal.formattedMarkdown.checked,false);assert.equal(modal.localContent.disabled,true);assert.equal(modal.prepared.svg.markdown,undefined);modal.formattedMarkdown.checked=true;await modal.prepare();assert.equal(modal.action.disabled,false);assert.equal(modal.markdownSources.hidden,false);assert.match(modal.markdownSources.children[0].textContent,/literal source/);assert.match(modal.prepared.svg.text,/<tspan font-weight="700">Strong/);assert.match(modal.preview.alt,/supported Markdown/);const before=dom.state.created.length;modal.formattedMarkdown.checked=false;await modal.download();assert.equal(modal.stale,true);assert.match(modal.error.textContent,/choices changed/);assert.equal(modal.prepared,null);assert.equal(dom.state.links,0);assert.equal(dom.state.created.length,before);assert.equal(dom.state.urls.size,0);}finally{modal?.close();dom.restore();}
});
test('Actual modal bounded-formatting failure releases its prior preview and allows an explicit literal fallback',async()=>{
  const dom=domFixture();let modal;
  try{modal=new modalModel.CanvasExportModal(appFixture(),modalModel.captureCanvasExport({nodes:[node('x\n'.repeat(513))],edges:[]},'B',new Set()),{current:()=>true,closed(){}});modal.open();await new Promise(resolve=>setImmediate(resolve));assert.equal(modal.action.disabled,false);modal.formattedMarkdown.checked=true;await modal.prepare();assert.match(modal.error.textContent,/512 source lines/);assert.equal(modal.action.disabled,true);assert.equal(modal.prepared,null);assert.equal(modal.previewUrl,null);assert.equal(modal.markdownSources.hidden,true);assert.equal(dom.state.urls.size,0);assert.equal(modal.stale,false);modal.formattedMarkdown.checked=false;await modal.prepare();assert.equal(modal.action.disabled,false);assert.equal(modal.prepared.svg.markdown,undefined);modal.close();assert.equal(dom.state.urls.size,0);assert.equal(dom.state.created.length,dom.state.revoked.length);}finally{modal?.close();dom.restore();}
});

function typingFixture({autosave=false,moveCaret=true}={}){
  const path='Fixture/Target.MD',beforeText='# Parent Ω\r\nKeep 😀.\r\n',suffix='\r\n**Live formatting Ω 😀.**',saved={content:beforeText,version:'v1',hasBom:true},session={text:beforeText,dirty:false,document:saved},cm={state:EditorState.create({doc:beforeText,extensions:[EditorState.lineSeparator.of('\r\n'),history()]}),hasFocus:true},view={file:{path},session,editor:{cm},getEditingMode:()=> 'source'},leaf={view,id:'target'},keys=[],context=createContext({app:{vault:{readOnly:false},markdownAutosave:{enabled:autosave},plugins:{modules:{'@codemirror/commands':{undoDepth,redoDepth}}},workspace:{activeLeaf:leaf,getLeafById:id=>id==='target'?leaf:null}},requestAnimationFrame:callback=>callback()}),commands=[];
  const update=transaction=>{cm.state=transaction.state;session.text=cm.state.sliceDoc();session.dirty=session.text!==beforeText;};
  const tools={report:{},async evaluate(code){const value=await runInContext(code,context);return value===undefined?undefined:JSON.parse(JSON.stringify(value));},async press(key,code,virtual,modifiers){keys.push([key,code,virtual,modifiers]);if(key==='End'){assert.deepEqual([key,code,virtual,modifiers],['End','End',35,2]);if(moveCaret)cm.state=cm.state.update({selection:{anchor:cm.state.doc.length}}).state;}else{assert.deepEqual([key,code,virtual,modifiers],['Enter','Enter',13,undefined]);assert.equal(insertNewlineAndIndent({state:cm.state,dispatch:update}),true);}},async command(method,input){assert.equal(method,'Input.insertText');commands.push(input);const from=cm.state.selection.main.head,insert=Text.of(input.text.split('\n'));update(cm.state.update({changes:{from,insert},selection:{anchor:from+insert.length},userEvent:'input.type'}));},async wait(code){assert.equal(await this.evaluate(code),true);}};
  return{path,beforeText,suffix,saved,session,cm,view,leaf,context,commands,keys,tools,update};
}
test('Trusted live-source helper uses ordinary Enter plus inline text and proves exact CRLF, caret, owners and one-step history',async()=>{
  const {appendCanvasMarkdownLiveText}=await import('../tools/canvas-markdown-export-scenarios.mjs'),f=typingFixture(),initial=f.cm.state;
  // Downstream Text conversion explains a retained CR; it does not model Chromium's treatment of leading LF in insertText.
  const wrong=initial.update({changes:{from:initial.doc.length,insert:Text.of(f.suffix.split('\n'))}}).state;assert.equal(wrong.sliceDoc(),f.beforeText+f.suffix.replace('\r\n','\r\r\n'));
  const proof=await appendCanvasMarkdownLiveText(f.tools,'target',{path:f.path,beforeText:f.beforeText,suffix:f.suffix});assert.equal(proof.status,'passed');assert.deepEqual(f.keys,[['End','End',35,2],['Enter','Enter',13,undefined]]);assert.deepEqual(f.commands,[{text:f.suffix.slice(2)}]);assert.equal(f.session.text,f.beforeText+f.suffix);assert.equal(f.session.document,f.saved);assert.equal(proof.before.autosave,false);assert.equal(proof.positioned.selection.ranges[0].head,initial.doc.length);assert.equal(proof.after.undo,1);assert.equal(proof.after.sameSession,true);assert.equal(proof.after.sameSaved,true);assert.equal(Object.hasOwn(f.context,'canvasMarkdownTypingOwner'),false);
  assert.equal(undo({state:f.cm.state,dispatch:f.update}),true);assert.equal(f.session.text,f.beforeText);assert.equal(f.session.dirty,false);assert.equal(undoDepth(f.cm.state),0);
});
test('Trusted live-source helper refuses enabled autosave or a misplaced caret before any text injection, retaining the exact owner',async()=>{
  const {appendCanvasMarkdownLiveText}=await import('../tools/canvas-markdown-export-scenarios.mjs');for(const options of [{autosave:true},{moveCaret:false}]){const f=typingFixture(options),before=f.cm.state.doc;await assert.rejects(()=>appendCanvasMarkdownLiveText(f.tools,'target',{path:f.path,beforeText:f.beforeText,suffix:f.suffix}));assert.deepEqual(f.commands,[]);assert.equal(f.session.text,f.beforeText);assert.equal(f.session.dirty,false);assert.equal(f.cm.state.doc,before);assert.equal(f.session.document,f.saved);assert.equal(Object.hasOwn(f.context,'canvasMarkdownTypingOwner'),false);assert.equal(f.tools.report.canvasMarkdownExportTyping[0].status,'failed');}
});
