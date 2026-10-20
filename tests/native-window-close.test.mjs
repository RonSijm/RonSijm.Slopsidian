import assert from "node:assert/strict";
import test from "node:test";
import { postNativeUserClose } from "../tools/native-window-close.mjs";

test("the native user-close helper validates identity and refuses when no exact owned window matches", async () => {
  await assert.rejects(postNativeUserClose(0, "x"), /process id/);
  await assert.rejects(postNativeUserClose(process.pid, ""), /title/);
  if (process.platform === "win32") {
    await assert.rejects(postNativeUserClose(process.pid, "slopsidian-no-such-window-" + Date.now()), /Expected exactly one visible window/);
  }
});
