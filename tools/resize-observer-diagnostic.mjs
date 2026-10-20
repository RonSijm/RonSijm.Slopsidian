import assert from "node:assert/strict";

// Idempotent per-realm recorder. It wraps ResizeObserver without changing callback arguments, `this` or return values.
export const resizeObserverHookSource = `(()=>{if(window.__roDiag){return true}const log=window.__roDiag={observers:[],errors:[],realm:location.href},Real=window.ResizeObserver,meta=new WeakMap();
  const nodes=new Map(),MAX=200;log.deliveries=[];log.live=[];
  const owner=node=>{try{let found=null;window.app?.workspace?.iterateAllLeaves?.(leaf=>{if(!found&&leaf.view?.editor?.cm?.scrollDOM===node){found={leaf:leaf.id,view:leaf.view.getViewType?.(),cm:true}}});return found}catch(error){return {error:String(error)}}};
  const describe=node=>{const view=node.ownerDocument&&node.ownerDocument.defaultView;return{tag:node.tagName,className:String(node.className).slice(0,80),doc:node.ownerDocument===document?"own":"foreign",window:view===window?"main":view?String(view.location&&view.location.href):"detached",windowClosed:view?Boolean(view.closed):null,connected:node.isConnected,owner:owner(node)}};
  const refresh=()=>{log.live=[];nodes.forEach((list,id)=>list.forEach(node=>log.live.push({observer:id,...describe(node)})));return log.live};log.refresh=refresh;
  window.ResizeObserver=class extends Real{constructor(callback){const rec={id:log.observers.length,stack:new Error().stack.split("\\n").slice(2,9).map(s=>s.trim()),created:Date.now(),callbacks:0,targets:[]};log.observers.push(rec);super(function(entries,observer){rec.callbacks++;rec.last=Date.now();try{const at=Date.now();for(const entry of entries){const box=entry.borderBoxSize&&entry.borderBoxSize[0];log.deliveries.push({observer:rec.id,at,width:entry.contentRect.width,height:entry.contentRect.height,borderInline:box&&box.inlineSize,borderBlock:box&&box.blockSize,...describe(entry.target)});}if(log.deliveries.length>MAX){log.deliveries.splice(0,log.deliveries.length-MAX)}}catch(error){log.recordError=String(error)}return callback.call(this,entries,observer)});meta.set(this,rec)}
    observe(node,options){const rec=meta.get(this);if(!nodes.has(rec.id)){nodes.set(rec.id,[])}nodes.get(rec.id).push(node);rec.targets.push({...describe(node),at:Date.now()});return super.observe(node,options)}};
  window.addEventListener("error",event=>{if(String(event.message).includes("ResizeObserver")){log.errors.push({at:Date.now(),callbacks:log.observers.filter(o=>o.callbacks).map(o=>({id:o.id,callbacks:o.callbacks,last:o.last})),live:refresh().filter(t=>t.owner)})}});return true})()`;

/** Tracks one hook per realm: reinstalls on new documents, asserts presence, and retains snapshots before a realm goes away. */
export function createResizeObserverDiagnostic() {
  const sessions = new Map(), snapshots = [];
  const present = async (label, session) => assert.equal(await session.evaluate("Boolean(window.__roDiag)"), true, `the ResizeObserver diagnostic hook is missing in ${label}`);
  return {
    snapshots,
    async install(label, session) {
      await session.command("Page.addScriptToEvaluateOnNewDocument", { source: resizeObserverHookSource });
      await session.evaluate(resizeObserverHookSource);
      sessions.set(label, session);
      await present(label, session);
    },
    assertAll: async () => { for (const [label, session] of sessions) { await present(label, session); } },
    async assertOne(label) { await present(label, sessions.get(label)); },
    async retain(label, session = sessions.get(label)) {
      await present(label, session);
      snapshots.push({ label, at: Date.now(), data: await session.evaluate("(window.__roDiag.refresh(),JSON.parse(JSON.stringify(window.__roDiag)))") });
    },
    release(label) { sessions.delete(label); },
  };
}
