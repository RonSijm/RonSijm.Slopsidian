import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

const scopes = [
  ["--presentation-structure-layout", "presentation-structure-layout"],
  ["--groups-cross-properties-arrange", "groups-cross-properties-arrange"],
  ["--summaries-transfers-backgrounds", "summaries-transfers-backgrounds"],
  ["--formulas-flow-tables", "formulas-flow-tables"],
  ["--filters-position-formatting", "filters-position-formatting"],
  ["--config-multiline-export", "config-multiline-export"],
  ["--views-scale-links", "views-scale-links"],
  ["--navigation-creation", "navigation-creation"],
  ["--editable-data", "editable-data"],
  ["--visual-authoring", "visual-authoring"],
  ["--graphs", "graphs"],
  ["--canvases", "canvases"],
  ["--export-handoff-history", "export-handoff-history"],
  ["--inline-structure-audio", "inline-structure-audio"],
  ["--embeds-typed-bulk", "embeds-typed-bulk"],
  ["--cards-audio-bulk", "cards-audio-bulk"],
  ["--views-inputs", "views-inputs"],
  ["--authoring-controls", "authoring-controls"],
  ["--rich-editing", "rich-editing"],
  ["--structured-recovery", "structured-recovery"],
  ["--workflow-controls", "workflow-controls"],
  ["--properties-reading", "properties-reading"],
  ["--authoring-transfers", "authoring-transfers"],
  ["--note-management", "note-management"],
  ["--authoring-organization", "authoring-organization"],
  ["--link-authoring", "link-authoring"],
  ["--note-continuity", "note-continuity"],
  ["--markdown-polish", "markdown-polish"],
  ["--markdown-interaction", "markdown-interaction"],
  ["--editor-assistance", "editor-assistance"],
  ["--note-navigation", "note-navigation"],
  ["--reading-tools", "reading-tools"],
  ["--note-workflows", "note-workflows"],
  ["--editor-workflows", "editor-workflows"],
  ["--reading-discovery", "reading-discovery"],
  ["--editor-productivity", "editor-productivity"],
  ["--note-authoring", "note-authoring"],
  ["--editor-improvements", "editor-improvements"],
  ["--appearance", "appearance"],
  ["--appearance-resources", "appearance-resources"],
  ["--appearance-themes", "appearance-themes"],
  ["--appearance-watch-diagnostic", "appearance-watch-diagnostic"],
  ["--appearance-catalog-diagnostic", "appearance-catalog-diagnostic"],
  ["--outline-panes", "outline-panes"],
  ["--viewers", "viewers"],
  ["--viewer-proofs", "viewer-proofs"],
  ["--configuration-lifecycle", "configuration-lifecycle"],
  ["--history", "history"],
  ["--github-index-ui", "github-index-ui"],
  ["--native-recents", "native-recents"],
  ["--original-floating-import", "original-floating-import"],
  ["--groups-popouts", "groups-popouts"],
  ["--system-trash", "system-trash"],
  ["--attachments", "attachments"],
  ["--community-install", "community-install"],
  ["--properties", "properties"],
  ["--persistent-drafts", "persistent-drafts"],
  ["--persistent-drafts-text-diagnostic", "persistent-drafts-text-diagnostic"],
  ["--math-embeds", "math-embeds"],
  ["--hotkeys-secrets", "hotkeys-secrets"],
];

for (const host of ["desktop", "web"]) {
  const file = host === "desktop" ? "smoke.mjs" : "web-smoke.mjs";
  const source = await readFile(new URL(`../tools/${file}`, import.meta.url), "utf8");
  const declarations = [];
  for (const line of source.split(/\r?\n/)) {
    const declaration = /^const (\w+) = .+;$/.exec(line);
    if (!declaration) continue;
    const name = declaration[1];
    if (name.endsWith("Only") || ["community", "focused", "throughChooser", "reportName"].includes(name)) {
      declarations.push(line);
    }
    if (name === "reportName") break;
  }

  for (const [flag, prefix] of scopes) {
    test(`${host} ${flag} retains its focused report identity`, () => {
      const result = runInNewContext(declarations.join("\n") + "\n({ reportName, focused });", {
        process: { argv: ["node", file, flag], env: {} },
      });
      assert.equal(result.reportName, prefix + (host === "web" ? "-web-smoke" : "-smoke"));
      assert.ok(result.focused);
      if (host === "desktop") assert.equal(result.focused, 1);
    });
  }

  test(`${host} presentation-structure-layout has real input/restart/capture bindings and no microphone`, async () => {
    const synthetic=source.split(/\r?\n/).find(line=>line.startsWith("const syntheticAudio = "));assert.ok(synthetic);
    const flags=runInNewContext(declarations.join("\n")+"\n"+synthetic+"\n({syntheticAudio,focused});",{process:{argv:["node",file,"--presentation-structure-layout"],env:{}}});assert.equal(flags.syntheticAudio,false);assert.ok(flags.focused);
    const body=/(?:} else )?if \(presentationStructureLayoutOnly\) \{\r?\n([\s\S]*?)\r?\n  }/.exec(source)?.[1];assert.ok(body);
    const hook=body.replace('await import("./presentation-structure-layout-scenarios.mjs")',"await loadScenario()");assert.notEqual(hook,body);let options;const actions=[];
    await runInNewContext(`(async()=>{${hook}})()`,{report:{checks:[]},vault:"C:/owned/vault",parent:"C:/owned/parent",root:"C:/repo",evidence:"C:/repo/.runtime/evidence",join,Buffer,evaluate(){},click(){},press(){},wait(){},waitExpression(){},handleDialog(){},command:async name=>{actions.push(name);return{data:"AA=="};},restartDesktop:async()=>actions.push("native-restart"),waitForDesktopReady:async()=>actions.push("native-ready"),afterFeatureReload:async()=>actions.push("browser-ready"),writeFile:async path=>actions.push(path),loadScenario:async()=>({checkPresentationStructureLayout:async value=>{options=value;}})});
    assert.equal(options.host,host);for(const name of ["evaluate","command","click","press","wait","handleDialog","afterReload","capture"])assert.equal(typeof options[name],"function",name);if(host==="desktop"){await options.restart();assert.ok(actions.includes("native-restart"));}await options.afterReload();await options.capture("review");assert.ok(actions.includes(host==="desktop"?"native-ready":"browser-ready"));assert.ok(actions.includes("Page.captureScreenshot"));assert.ok(actions.some(value=>value.endsWith(`presentation-structure-layout-review-${host}.png`)));
  });

  test(`${host} configuration, multiline and export does not acquire a synthetic microphone`, () => {
    const synthetic = source.split(/\r?\n/).find(line => line.startsWith("const syntheticAudio = "));
    assert.ok(synthetic);
    const result = runInNewContext(declarations.join("\n") + "\n" + synthetic + "\n({ syntheticAudio, focused });", {process:{argv:["node",file,"--config-multiline-export"],env:{}}});
    assert.equal(result.syntheticAudio,false); assert.ok(result.focused);
  });

  test(`${host} views, scale and links does not acquire a synthetic microphone`, () => {
    const synthetic = source.split(/\r?\n/).find(line => line.startsWith("const syntheticAudio = "));
    assert.ok(synthetic);
    const result = runInNewContext(declarations.join("\n") + "\n" + synthetic + "\n({ syntheticAudio, focused });", {process:{argv:["node",file,"--views-scale-links"],env:{}}});
    assert.equal(result.syntheticAudio,false); assert.ok(result.focused);
  });

  test(`${host} navigation and creation does not acquire a synthetic microphone`, () => {
    const synthetic = source.split(/\r?\n/).find(line => line.startsWith("const syntheticAudio = "));
    assert.ok(synthetic);
    const result = runInNewContext(declarations.join("\n") + "\n" + synthetic + "\n({ syntheticAudio, focused });", {process:{argv:["node",file,"--navigation-creation"],env:{}}});
    assert.equal(result.syntheticAudio,false); assert.ok(result.focused);
  });

  test(`${host} editable data does not acquire a synthetic microphone`, () => {
    const synthetic = source.split(/\r?\n/).find(line => line.startsWith("const syntheticAudio = "));
    assert.ok(synthetic);
    const result = runInNewContext(declarations.join("\n") + "\n" + synthetic + "\n({ syntheticAudio, focused });", {process:{argv:["node",file,"--editable-data"],env:{}}});
    assert.equal(result.syntheticAudio,false); assert.ok(result.focused);
  });

  test(`${host} visual authoring does not acquire a synthetic microphone`, () => {
    const synthetic = source.split(/\r?\n/).find(line => line.startsWith("const syntheticAudio = "));
    assert.ok(synthetic);
    const result = runInNewContext(declarations.join("\n") + "\n" + synthetic + "\n({ syntheticAudio, focused });", {process:{argv:["node",file,"--visual-authoring"],env:{}}});
    assert.equal(result.syntheticAudio,false); assert.ok(result.focused);
  });

  test(`${host} export, handoff and recovery scope does not acquire a synthetic microphone`, () => {
    const synthetic = source.split(/\r?\n/).find(line => line.startsWith("const syntheticAudio = "));
    assert.ok(synthetic);
    const result = runInNewContext(declarations.join("\n") + "\n" + synthetic + "\n({ syntheticAudio, focused });", {process:{argv:["node",file,"--export-handoff-history"],env:{}}});
    assert.equal(result.syntheticAudio,false); assert.ok(result.focused);
  });

  test(`${host} inline Bases, structured operations and saved audio use only the synthetic microphone`, () => {
    const synthetic = source.split(/\r?\n/).find(line => line.startsWith("const syntheticAudio = "));
    assert.ok(synthetic);
    const result = runInNewContext(declarations.join("\n") + "\n" + synthetic + "\n({ syntheticAudio, focused });", {process:{argv:["node",file,"--inline-structure-audio"],env:{}}});
    assert.equal(result.syntheticAudio,true); assert.ok(result.focused);
  });

  test(`${host} embeds and authoring scope does not acquire a synthetic microphone`, () => {
    const synthetic = source.split(/\r?\n/).find(line => line.startsWith("const syntheticAudio = "));
    assert.ok(synthetic);
    const result = runInNewContext(declarations.join("\n") + "\n" + synthetic + "\n({ syntheticAudio, focused });", { process: { argv: ["node", file, "--embeds-typed-bulk"], env: {} } });
    assert.equal(result.syntheticAudio, false); assert.ok(result.focused);
  });

  test(`${host} cards, waveforms and bulk mentions explicitly uses the synthetic microphone`, () => {
    const synthetic = source.split(/\r?\n/).find(line => line.startsWith("const syntheticAudio = "));
    assert.ok(synthetic);
    const result = runInNewContext(declarations.join("\n") + "\n" + synthetic + "\n({ syntheticAudio, focused });", {
      process: { argv: ["node", file, "--cards-audio-bulk"], env: {} },
    });
    assert.equal(result.syntheticAudio, true);
    assert.ok(result.focused);
  });

  test(`${host} authoring controls explicitly uses the synthetic microphone`, () => {
    const synthetic = source.split(/\r?\n/).find(line => line.startsWith("const syntheticAudio = "));
    assert.ok(synthetic);
    const result = runInNewContext(declarations.join("\n") + "\n" + synthetic + "\n({ syntheticAudio, focused });", {
      process: { argv: ["node", file, "--authoring-controls"], env: {} },
    });
    assert.equal(result.syntheticAudio, true);
    assert.ok(result.focused);
  });



  test(`${host} views and inputs explicitly uses the synthetic microphone`, () => {
    const synthetic = source.split(/\r?\n/).find(line => line.startsWith("const syntheticAudio = "));
    assert.ok(synthetic);
    const result = runInNewContext(declarations.join("\n") + "\n" + synthetic + "\n({ syntheticAudio, focused });", {
      process: { argv: ["node", file, "--views-inputs"], env: {} },
    });
    assert.equal(result.syntheticAudio, true);
    assert.ok(result.focused);
  });

  test(`${host} config-multiline-export hook supplies real input, restart and capture bindings`, async () => {
    const body = /(?:} else )?if \(configMultilineExportOnly\) \{\r?\n([\s\S]*?)\r?\n  }/.exec(source)?.[1];
    assert.ok(body);
    const hook = body.replace('await import("./config-multiline-export-scenarios.mjs")', "await loadScenario()");
    assert.notEqual(hook,body);
    let options;
    const actions=[];
    await runInNewContext(`(async()=>{${hook}})()`, {
      report:{checks:[]},vault:"C:\\owned\\vault",parent:"C:\\owned\\parent",root:"C:\\repo",evidence:"C:\\repo\\.runtime\\evidence",join,Buffer,
      evaluate(){},click(){},press(){},wait(){},waitExpression(){},handleDialog(){},
      command:async name=>{actions.push(name);return {data:"AA=="};},
      restartDesktop:async()=>{actions.push("native-restart");},
      waitForDesktopReady:async()=>{actions.push("native-ready");},
      afterFeatureReload:async()=>{actions.push("browser-ready");},
      writeFile:async path=>{actions.push(path);},
      loadScenario:async()=>({checkConfigMultilineExport:async value=>{options=value;}}),
    });
    assert.equal(options.host,host);
    for(const name of ["evaluate","command","click","press","wait","handleDialog","afterReload","capture"])assert.equal(typeof options[name],"function",name);
    if(host==="desktop"){assert.equal(typeof options.restart,"function");await options.restart();}
    await options.afterReload();await options.capture("review");
    assert.ok(actions.includes(host==="desktop"?"native-ready":"browser-ready"));
    assert.ok(actions.includes("Page.captureScreenshot"));
    assert.ok(actions.some(value=>value.endsWith(`config-multiline-export-review-${host}.png`)));
  });

  test(`${host} views-scale-links hook supplies real input, restart and capture bindings`, async () => {
    const body = /(?:} else )?if \(viewsScaleLinksOnly\) \{\r?\n([\s\S]*?)\r?\n  }/.exec(source)?.[1];
    assert.ok(body);
    const hook = body.replace('await import("./views-scale-links-scenarios.mjs")', "await loadScenario()");
    assert.notEqual(hook,body);
    let options;
    const actions=[];
    await runInNewContext(`(async()=>{${hook}})()`, {
      report:{checks:[]},vault:"C:\\owned\\vault",parent:"C:\\owned\\parent",root:"C:\\repo",evidence:"C:\\repo\\.runtime\\evidence",join,Buffer,
      evaluate(){},click(){},press(){},wait(){},waitExpression(){},handleDialog(){},
      command:async name=>{actions.push(name);return {data:"AA=="};},
      restartDesktop:async()=>{actions.push("native-restart");},
      waitForDesktopReady:async()=>{actions.push("native-ready");},
      afterFeatureReload:async()=>{actions.push("browser-ready");},
      writeFile:async path=>{actions.push(path);},
      loadScenario:async()=>({checkViewsScaleLinks:async value=>{options=value;}}),
    });
    assert.equal(options.host,host);
    for(const name of ["evaluate","command","click","press","wait","handleDialog","afterReload","capture"])assert.equal(typeof options[name],"function",name);
    if(host==="desktop"){assert.equal(typeof options.restart,"function");await options.restart();}
    await options.afterReload();await options.capture("review");
    assert.ok(actions.includes(host==="desktop"?"native-ready":"browser-ready"));
    assert.ok(actions.includes("Page.captureScreenshot"));
    assert.ok(actions.some(value=>value.endsWith(`views-scale-links-review-${host}.png`)));
  });

  test(`${host} navigation-creation hook supplies real input, restart and capture bindings`, async () => {
    const body = /(?:} else )?if \(navigationCreationOnly\) \{\r?\n([\s\S]*?)\r?\n  }/.exec(source)?.[1];
    assert.ok(body);
    const hook = body.replace('await import("./navigation-creation-scenarios.mjs")', "await loadScenario()");
    assert.notEqual(hook,body);
    let options;
    const actions=[];
    await runInNewContext(`(async()=>{${hook}})()`, {
      report:{checks:[]},vault:"C:\\owned\\vault",parent:"C:\\owned\\parent",root:"C:\\repo",evidence:"C:\\repo\\.runtime\\evidence",join,Buffer,
      evaluate(){},click(){},press(){},wait(){},waitExpression(){},handleDialog(){},
      command:async name=>{actions.push(name);return {data:"AA=="};},
      restartDesktop:async()=>{actions.push("native-restart");},
      waitForDesktopReady:async()=>{actions.push("native-ready");},
      afterFeatureReload:async()=>{actions.push("browser-ready");},
      writeFile:async path=>{actions.push(path);},
      loadScenario:async()=>({checkNavigationCreation:async value=>{options=value;}}),
    });
    assert.equal(options.host,host);
    for(const name of ["evaluate","command","click","press","wait","handleDialog","afterReload","capture"])assert.equal(typeof options[name],"function",name);
    if(host==="desktop"){assert.equal(typeof options.restart,"function");await options.restart();}
    await options.afterReload();await options.capture("review");
    assert.ok(actions.includes(host==="desktop"?"native-ready":"browser-ready"));
    assert.ok(actions.includes("Page.captureScreenshot"));
    assert.ok(actions.some(value=>value.endsWith(`navigation-creation-review-${host}.png`)));
  });

  test(`${host} editable-data hook supplies real input, restart and capture bindings`, async () => {
    const body = /(?:} else )?if \(editableDataOnly\) \{\r?\n([\s\S]*?)\r?\n  }/.exec(source)?.[1];
    assert.ok(body);
    const hook = body.replace('await import("./editable-data-scenarios.mjs")', "await loadScenario()");
    assert.notEqual(hook,body);
    let options;
    const actions=[];
    await runInNewContext(`(async()=>{${hook}})()`, {
      report:{checks:[]},vault:"C:\\owned\\vault",parent:"C:\\owned\\parent",root:"C:\\repo",evidence:"C:\\repo\\.runtime\\evidence",join,Buffer,
      evaluate(){},click(){},press(){},wait(){},waitExpression(){},handleDialog(){},
      command:async name=>{actions.push(name);return {data:"AA=="};},
      restartDesktop:async()=>{actions.push("native-restart");},
      waitForDesktopReady:async()=>{actions.push("native-ready");},
      afterFeatureReload:async()=>{actions.push("browser-ready");},
      writeFile:async path=>{actions.push(path);},
      loadScenario:async()=>({checkEditableData:async value=>{options=value;}}),
    });
    assert.equal(options.host,host);
    for(const name of ["evaluate","command","click","press","wait","handleDialog","afterReload","capture"])assert.equal(typeof options[name],"function",name);
    if(host==="desktop"){assert.equal(typeof options.restart,"function");await options.restart();}
    await options.afterReload();await options.capture("review");
    assert.ok(actions.includes(host==="desktop"?"native-ready":"browser-ready"));
    assert.ok(actions.includes("Page.captureScreenshot"));
    assert.ok(actions.some(value=>value.endsWith(`editable-data-review-${host}.png`)));
  });

  test(`${host} visual-authoring hook supplies real input, restart and capture bindings`, async () => {
    const body = /(?:} else )?if \(visualAuthoringOnly\) \{\r?\n([\s\S]*?)\r?\n  }/.exec(source)?.[1];
    assert.ok(body);
    const hook = body.replace('await import("./visual-authoring-scenarios.mjs")', "await loadScenario()");
    assert.notEqual(hook,body);
    let options;
    const actions=[];
    await runInNewContext(`(async()=>{${hook}})()`, {
      report:{checks:[]},vault:"C:\\owned\\vault",parent:"C:\\owned\\parent",root:"C:\\repo",evidence:"C:\\repo\\.runtime\\evidence",join,Buffer,
      evaluate(){},click(){},press(){},wait(){},waitExpression(){},handleDialog(){},
      command:async name=>{actions.push(name);return {data:"AA=="};},
      restartDesktop:async()=>{actions.push("native-restart");},
      waitForDesktopReady:async()=>{actions.push("native-ready");},
      afterFeatureReload:async()=>{actions.push("browser-ready");},
      writeFile:async path=>{actions.push(path);},
      loadScenario:async()=>({checkVisualAuthoring:async value=>{options=value;}}),
    });
    assert.equal(options.host,host);
    for(const name of ["evaluate","command","click","press","wait","handleDialog","afterReload","capture"])assert.equal(typeof options[name],"function",name);
    if(host==="desktop"){assert.equal(typeof options.restart,"function");await options.restart();}
    await options.afterReload();await options.capture("review");
    assert.ok(actions.includes(host==="desktop"?"native-ready":"browser-ready"));
    assert.ok(actions.includes("Page.captureScreenshot"));
    assert.ok(actions.some(value=>value.endsWith(`visual-authoring-review-${host}.png`)));
  });

  test(`${host} original-floating hook executes with only its real runner bindings`, async () => {
    const body = /\} else if \(originalFloatingOnly\) \{([\s\S]*?)\n  \} else if \(nativeRecentsOnly\)/.exec(source)?.[1];
    assert.ok(body);
    const hook = body.replace('await import("./original-floating-import-scenario.mjs")', "await loadScenario()");
    assert.notEqual(hook, body);
    const report = { checks: [] };
    const detail = { imported: true };
    let options;
    const restarted = [];
    await runInNewContext(`(async()=>{${hook}})()`, {
      report, vault: "C:\\owned\\vault", parent: "C:\\owned\\parent", join,
      evaluate: async () => "http://127.0.0.1:1234", command: async name => { restarted.push(name); }, wait() {}, waitExpression() {},
      restartDesktop: async () => { restarted.push("native-restart"); },
      waitForDesktopReady: async () => { restarted.push("native-ready"); },
      afterFeatureReload: async () => { restarted.push("browser-ready"); },
      errorAudit: { flush: async () => { restarted.push("audit-flushed"); } },
      loadScenario: async () => ({
        checkOriginalFloatingImport: async args => { options = args; args.report(detail); },
      }),
    });
    assert.equal(report.checks.length, 1);
    assert.equal(report.originalFloatingImport, detail);
    assert.equal(options.mode, host === "desktop" ? "desktop" : "browser");
    assert.equal(options.directory, host === "desktop" ? "C:\\owned\\vault" : join("C:\\owned\\parent", "Created in browser"));
    assert.equal(typeof options.command, "function");
    assert.equal(typeof options.restart, "function");
    await options.restart();
    assert.ok(restarted.includes(host === "desktop" ? "native-restart" : "Page.navigate"));
    assert.ok(restarted.includes(host === "desktop" ? "native-ready" : "browser-ready"));
  });
}

for (const host of ["desktop", "web"]) {
  const file = host === "desktop" ? "smoke.mjs" : "web-smoke.mjs";
  const source = await readFile(new URL(`../tools/${file}`, import.meta.url), "utf8");
  test(`${host} popout diagnostics and refusal controls never share the full collection's report name or scope`, () => {
    const declarations = [];
    for (const line of source.split(/\r?\n/)) {
      const declaration = /^const (\w+) = .+;$/.exec(line);
      if (!declaration) continue;
      const name = declaration[1];
      if (name.endsWith("Only") || ["community", "focused", "throughChooser", "reportName"].includes(name)) declarations.push(line);
      if (name === "reportName") break;
    }
    const scopeLine = source.split(/\r?\n/).find(line => line.includes('report.scope = groupsPopoutsOnly'));
    assert.ok(scopeLine);
    const run = env => runInNewContext(declarations.join("\n") + `\nlet report = {}; ${scopeLine.trim()}\n({ reportName, scope: report.scope });`, { process: { argv: ["node", file, "--groups-popouts"], env } });
    const full = run({}), barrier = run({ SLOPSIDIAN_GROUPS_POPOUTS_ONLY: "barrier" });
    assert.equal(full.scope, "workspace-groups-popouts");
    assert.equal(barrier.scope, "workspace-groups-popouts-barrier-diagnostic");
    assert.notEqual(barrier.scope, full.scope);
    assert.equal(barrier.reportName, "groups-popouts-barrier-diagnostic" + (host === "web" ? "-web-smoke" : "-smoke"));
    assert.equal(full.reportName, "groups-popouts" + (host === "web" ? "-web-smoke" : "-smoke"));
    if (host === "desktop") {
      const forced = run({ SLOPSIDIAN_GROUPS_POPOUTS_ONLY: "forced-close" });
      assert.equal(forced.scope, "workspace-groups-popouts-forced-close-diagnostic");
      assert.equal(forced.reportName, "groups-popouts-forced-close-diagnostic-smoke");
      const osDrag = run({ SLOPSIDIAN_GROUPS_POPOUTS_ONLY: "os-drag" });
      assert.equal(osDrag.scope, "workspace-groups-popouts-native-os-drag");
      assert.equal(osDrag.reportName, "groups-popouts-os-drag-smoke");
    } else {
      const blocked = run({ SLOPSIDIAN_WEB_POPUP: "blocked" });
      assert.equal(blocked.scope, "workspace-groups-popouts-refusal-control");
      assert.equal(blocked.reportName, "groups-popouts-refusal-control-web-smoke");
    }
  });
}
