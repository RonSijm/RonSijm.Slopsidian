import assert from "node:assert/strict";
import { expectErrors } from "./error-log-audit.mjs";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function checkErrorLogging(tools) {
  const { evaluate, click, report, command, downloadDirectory } = tools;
  const pass = text => { report.checks.push(text); console.log("PASS " + text); };
  assert.deepEqual(await evaluate(`(async()=>{
    const node=document.createElement("div"), inherited=node.onWindowMigrated;
    node.onWindowMigrated=function(callback){return inherited.call(this,callback)};
    const frame=document.createElement("iframe");frame.src="about:blank";
    const loaded=new Promise(resolve=>frame.addEventListener("load",resolve,{once:true}));document.body.append(node,frame);await loaded;
    let migrated=0;const stop=node.onWindowMigrated(view=>{if(view===frame.contentWindow)migrated++});
    frame.contentDocument.body.appendChild(node);await new Promise(resolve=>setTimeout(resolve,30));stop();node.remove();frame.remove();
    return {overridden:Object.hasOwn(node,"onWindowMigrated"),migrated,writable:Object.getOwnPropertyDescriptor(HTMLElement.prototype,"onWindowMigrated").writable};
  })()`), { overridden: true, migrated: 1, writable: true });
  pass("DOM helpers allow instance overrides and still deliver an actual same-origin document migration callback.");

  await evaluate(`(()=>{const {Menu}=app.plugins.modules.obsidian;const menu=new Menu();menu.addItem(item=>{item.setTitle("Diagnostic failure fixture");item.dom.dataset.errorLogProbe="true";item.onClick(()=>{throw new Error("Intentional notification logging probe",{cause:new TypeError("Original plugin cause")})})});menu.showAtPosition({x:200,y:200})})()`);
  await expectErrors(tools, [{ source: "notification", message: "Intentional notification logging probe" }], () => click('[data-error-log-probe="true"]'), "Verify the caught menu-error notification is written with its original cause");
  const notification = (await evaluate("slopsidianDiagnostics.current()")).at(-1);
  assert.match(notification.error.stack, /Intentional notification/); assert.match(notification.error.cause.stack, /Original plugin cause/);
  await expectErrors(tools, [{ source: "window-error", message: "Intentional window handler probe" }, { source: "unhandled-rejection", message: "Intentional rejection handler probe" }],
    () => evaluate(`(()=>{window.dispatchEvent(new ErrorEvent("error",{message:"Intentional window handler probe",filename:"error-log-probe.js",lineno:17,colno:9}));window.dispatchEvent(new PromiseRejectionEvent("unhandledrejection",{reason:new Error("Intentional rejection handler probe"),promise:Promise.resolve()}))})()`),
    "Exercise both global error handlers using controlled events");
  const messageOnly = (await evaluate("slopsidianDiagnostics.current()")).find(record => record.error.message === "Intentional window handler probe");
  assert.equal(messageOnly.error.stackOrigin, "reported"); assert.match(messageOnly.error.stack, /Reported here/);
  assert.equal(messageOnly.context.filename, "error-log-probe.js"); assert.equal(messageOnly.context.line, 17); assert.equal(messageOnly.context.column, 9);
  const flushed = await evaluate("slopsidianDiagnostics.flush()"); assert.equal(flushed.storageFailure, null);
  const saved = (await evaluate("slopsidianDiagnostics.read()")).split("\n").filter(Boolean).map(JSON.parse);
  assert.ok(saved.some(record => record.id === notification.id && record.error.cause.stack === notification.error.cause.stack));
  assert.deepEqual(saved.find(record => record.id === messageOnly.id), messageOnly);
  pass("Caught notifications, message-only window errors and rejection events persist stacks, origins, browser locations, active view context and causes in the application logfile.");
  await mkdir(downloadDirectory, { recursive: true });
  const download = await mkdtemp(join(downloadDirectory, "export-"));
  await command("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: download });
  await click("#client-errors button");
  let exported;
  for (let attempt = 0; attempt < 50; attempt++) {
    exported = await readFile(join(download, "slopsidian-errors.jsonl"), "utf8").catch(error => { if (error.code !== "ENOENT") throw error; return null; });
    if (exported !== null) break; await delay(100);
  }
  assert.ok(exported, "The actual Download log button must save a logfile.");
  assert.ok(exported.split("\n").filter(Boolean).map(JSON.parse).some(record => record.id === notification.id && record.error.cause.stack === notification.error.cause.stack));
  report.downloadedErrorLog = join(download, "slopsidian-errors.jsonl");
  pass("The error notification's actual Download log button exports the persisted records and original cause stack.");
  await evaluate('document.getElementById("client-errors").replaceChildren()');
}
