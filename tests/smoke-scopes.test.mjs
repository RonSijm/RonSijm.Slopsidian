import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

const scopes = [
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
