import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRequire } from "node:module";

const { createPopupPolicy } = createRequire(import.meta.url)("../tools/web-smoke-popup-policy.cjs");
const origin = "http://127.0.0.1:5000";
const popout = { url: "about:blank", frameName: "slopsidian-popout-win-1", disposition: "new-window", referrer: { url: origin + "/" } };

test("the allowed policy admits only the app's named same-origin about:blank popouts", () => {
  const { windowOpenHandler } = createPopupPolicy(origin, true);
  const allowed = windowOpenHandler(popout);
  assert.equal(allowed.action, "allow");
  assert.deepEqual(allowed.overrideBrowserWindowOptions.webPreferences, { nodeIntegration: false, contextIsolation: true, sandbox: true });
  for (const changed of [
    { url: "https://example.com/" }, { url: origin + "/other" }, { frameName: "" }, { frameName: "_blank" }, { frameName: "slopsidian-popout-" },
    { frameName: "slopsidian-popout-../x" }, { referrer: { url: "https://evil.example/" } }, { referrer: undefined }, { disposition: "background-tab" },
  ]) {
    assert.equal(windowOpenHandler({ ...popout, ...changed }).action, "deny", JSON.stringify(changed));
  }
});

test("the default and blocked-control policies deny every window open", () => {
  for (const policy of [createPopupPolicy(origin, false), createPopupPolicy(origin, undefined)]) {
    assert.equal(policy.windowOpenHandler(popout).action, "deny");
  }
});

test("popups cannot open further windows or navigate away from about:blank", () => {
  const events = new Map(); let handler;
  createPopupPolicy(origin, true).guardPopup({ setWindowOpenHandler: value => { handler = value; }, on: (name, listener) => events.set(name, listener) });
  assert.equal(handler(popout).action, "deny");
  let prevented = 0; const event = { preventDefault: () => prevented++ };
  events.get("will-navigate")(event, origin + "/x"); events.get("will-navigate")(event, "about:blank");
  assert.equal(prevented, 1);
});

test("the host and runner wire the opt-in and keep a refusal-only run out of the full scope", async () => {
  const host = await readFile(new URL("../tools/web-smoke-host.cjs", import.meta.url), "utf8");
  assert.match(host, /--allow-app-popouts/);
  assert.match(host, /nodeIntegration: false, contextIsolation: true, sandbox: true/);
  const runner = await readFile(new URL("../tools/web-smoke.mjs", import.meta.url), "utf8");
  assert.match(runner, /groupsPopoutsOnly && !popupBlockedControlOnly \? \["--allow-app-popouts"\]/);
  assert.match(runner, /popupBlockedControlOnly \? "workspace-groups-popouts-refusal-control" : "workspace-groups-popouts"/);
  assert.match(runner, /popupPolicy: popupBlockedControlOnly \? "blocked" : "allowed"/);
  const scenario = await readFile(new URL("../tools/workspace-popout-scenarios.mjs", import.meta.url), "utf8");
  assert.match(scenario, /assert\.equal\(popupPolicy, "blocked"/);
});
