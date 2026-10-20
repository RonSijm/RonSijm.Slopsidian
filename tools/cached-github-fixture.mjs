import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export async function mountCachedGitHub(evaluate, label, inputs) {
  const repository = "slopsidian-fixtures/" + label + "-" + Date.now();
  const mount = { repository, ref: "main", folder: "", commit: "c".repeat(40), savedAt: Date.now(), files: [], configurationFiles: [] };
  mount.id = "github-vault:" + encodeURIComponent(JSON.stringify([repository, "main", ""]));
  const blobs = inputs.map(([path, input]) => {
    const bytes = Buffer.from(input), sha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    (path.startsWith(".obsidian/") ? mount.configurationFiles : mount.files).push({ path, repositoryPath: path, sha, size: bytes.length });
    return { key: "blob:" + sha, base64: bytes.toString("base64") };
  });
  await evaluate(`(async()=>{const r=indexedDB.open("slopsidian-github-vault-v1",1);r.onupgradeneeded=()=>r.result.createObjectStore("entries",{keyPath:"key"});const db=await new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});try{await new Promise((ok,no)=>{const tx=db.transaction("entries","readwrite"),s=tx.objectStore("entries");for(const b of ${JSON.stringify(blobs)})s.put({key:b.key,value:Uint8Array.from(atob(b.base64),c=>c.charCodeAt(0)).buffer});s.put({key:${JSON.stringify("mount:" + mount.id)},value:${JSON.stringify(mount)}});tx.oncomplete=()=>ok();tx.onerror=tx.onabort=()=>no(tx.error);});}finally{db.close();}await app.githubVaults.open({url:${JSON.stringify(repository)},cached:true});})()`);
  return { mount, blobs };
}

export async function assertCachedBlobsUnchanged(evaluate, blobs) {
  for (const blob of blobs) {
    const saved = await evaluate(`(async()=>{const r=indexedDB.open("slopsidian-github-vault-v1",1),db=await new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});try{const r=db.transaction("entries").objectStore("entries").get(${JSON.stringify(blob.key)}),v=await new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result.value);r.onerror=()=>no(r.error);});return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",v)),b=>b.toString(16).padStart(2,"0")).join("");}finally{db.close();}})()`);
    assert.equal(saved, createHash("sha256").update(Buffer.from(blob.base64, "base64")).digest("hex"), "Remote cache blob changed: " + blob.key);
  }
}
