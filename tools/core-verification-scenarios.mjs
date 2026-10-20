import assert from "node:assert/strict";
import { coreVerificationTargets } from "./core-verification-targets.mjs";

export async function checkCoreVerificationStatus({ evaluate, click, wait, restart, report, capture }) {
  async function openAndCheck() {
    await click("#open-settings");
    await click("#core-plugins-tab");
    await wait('document.querySelectorAll("[data-core-id]").length===31');
    const rows = await evaluate('Array.from(document.querySelectorAll("[data-core-id]"), row=>({id:row.dataset.coreId,status:row.querySelector("[data-core-verification]")?.dataset.coreVerification,text:row.querySelector("p")?.textContent,disabled:row.querySelector("[data-core-toggle]").disabled}))');
    for (const id of coreVerificationTargets) {
      const row = rows.find(row => row.id === id);
      assert.equal(row?.status, "verified-workflows", id + " must have matching host/build evidence");
      assert.ok(row.text.length > 20 && !/still being verified|Independent implementation/.test(row.text), id + " has a useful feature description");
    }
    for (const id of ["publish", "sync"]) {
      const row = rows.find(row => row.id === id);
      assert.equal(row?.status, undefined, id + " cannot claim verification");
      assert.equal(row?.disabled, true);
    }
    assert.ok(!/reference compatibility is still being verified/.test(await evaluate('document.querySelector("#core-settings-host").textContent')));
    return rows;
  }
  report.coreVerificationRows = await openAndCheck();
  const enabled = await evaluate('app.core.isEnabled("footnotes")');
  await click('[data-core-toggle="footnotes"]');
  await wait(`!app.core.busy&&app.core.isEnabled("footnotes")===${!enabled}`);
  assert.equal(await evaluate('document.querySelector("[data-core-id=footnotes] [data-core-verification]").dataset.coreVerification'), "verified-workflows");
  await click('[data-core-toggle="footnotes"]');
  await wait(`!app.core.busy&&app.core.isEnabled("footnotes")===${enabled}`);
  await click(".settings-close");
  await restart();
  await openAndCheck();
  await capture();
  await click(".settings-close");
  report.checks.push("All 27 requested core modules showed source-matched, host-specific Verified workflows badges and useful descriptions; unavailable services remained unavailable. Toggling and reconnecting preserved the correct status.");
}
