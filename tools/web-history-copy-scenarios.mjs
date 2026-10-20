import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function clipboardFixture(host, action) {
  await host.evaluate(`(()=>{
    if(globalThis.historyCopyProbe)throw Error("History clipboard fixture already installed");
    const probe=globalThis.historyCopyProbe={original:Object.getOwnPropertyDescriptor(navigator,"clipboard"),writes:[],reads:0,text:"Fixture clipboard",mode:"ok"};
    probe.api={writeText:value=>{
      if(probe.mode==="deny")return Promise.reject(Error("Expected clipboard permission rejection"));
      probe.writes.push(value);
      if(probe.mode==="pending")return new Promise(resolve=>{probe.finish=()=>{probe.text=value;resolve()}});
      probe.text=value;return Promise.resolve();
    },readText:()=>{probe.reads++;throw Error("Clipboard reads are forbidden in this fixture")}};
    Object.defineProperty(navigator,"clipboard",{configurable:true,value:probe.api});
  })()`);
  try { await action(); assert.equal(await host.evaluate("historyCopyProbe.reads"), 0); }
  finally {
    await host.evaluate('(()=>{const probe=globalThis.historyCopyProbe;if(probe.original)Object.defineProperty(navigator,"clipboard",probe.original);else delete navigator.clipboard;delete globalThis.historyCopyProbe})()');
  }
}

export async function checkHistoryCopy({ host, context, menuItem, active, entries, historyPath, idle, pass, capture }) {
  const before = await readFile(historyPath), leaf = await host.evaluate("app.workspace.activeLeaf.id"), leaves = await host.evaluate("app.workspace.leaves().length");
  await clipboardFixture(host, async () => {
    await context("menu-unicode"); await capture("copy-menu"); await host.click(menuItem("Copy link address"));
    await host.wait('document.querySelector("[data-web-history-status]").textContent==="Link address copied."', "mouse copy succeeds");
    assert.equal(await host.evaluate("historyCopyProbe.text"), entries[3].url);
    await host.evaluate("app.workspace.activeLeaf.setPinned(true)");
    try {
      await context("menu-two", true); await host.press("ArrowDown", "ArrowDown", 40);
      assert.equal(await host.evaluate("document.activeElement.dataset.menuTitle"), "Copy link address");
      await host.press("Enter", "Enter", 13); await host.wait(`historyCopyProbe.text===${JSON.stringify(entries[1].url)}`, "pinned keyboard copy succeeds");
    } finally { await host.evaluate(`app.workspace.getLeafById(${JSON.stringify(leaf)}).setPinned(false)`); }
    assert.deepEqual(await host.evaluate("historyCopyProbe.writes"), [entries[3].url, entries[1].url]);
    assert.equal(await host.evaluate("app.workspace.activeLeaf.id"), leaf); assert.equal(await host.evaluate("app.workspace.leaves().length"), leaves);
    await idle(); assert.deepEqual(await readFile(historyPath), before);
    pass("Real mouse and Shift+F10/arrow/Enter Copy link address actions write exactly the selected URL through a bounded clipboard fixture, work while pinned and preserve history/leaf state without reading or changing the system clipboard");

    await host.evaluate('historyCopyProbe.mode="deny"'); await context("menu-keep"); await host.click(menuItem("Copy link address"));
    await host.wait('document.querySelector("[data-web-history-error]").textContent.includes("Expected clipboard permission rejection")&&document.querySelector("[data-web-history-status]").textContent==="Link address was not copied."', "copy permission failure visible");
    await capture("copy-error"); assert.equal(await host.evaluate("historyCopyProbe.text"), entries[1].url);
    await host.evaluate('Object.defineProperty(navigator,"clipboard",{configurable:true,value:undefined})');
    await context("menu-keep", true); await host.press("ArrowDown", "ArrowDown", 40); await host.press("ArrowDown", "ArrowDown", 40); await host.press("Enter", "Enter", 13);
    await host.wait('document.querySelector("[data-web-history-error]").textContent.includes("Clipboard access is unavailable")&&document.querySelector("[data-web-history-status]").textContent==="Link address was not copied."', "unsupported clipboard failure visible");
    await host.evaluate('historyCopyProbe.mode="pending";Object.defineProperty(navigator,"clipboard",{configurable:true,value:historyCopyProbe.api})');
    await context("menu-keep"); await host.click(menuItem("Copy link address")); await host.wait('typeof historyCopyProbe.finish==="function"', "copy awaits clipboard acknowledgement");
    assert.equal(await host.evaluate(`${active}.status.textContent`), "Copying link address…");
    await host.click('[data-web-history-action="refresh"]'); await idle();
    const refreshed = await host.evaluate(`${active}.status.textContent`);
    await host.evaluate('historyCopyProbe.finish()');
    assert.equal(await host.evaluate(`${active}.status.textContent`), refreshed, "A late clipboard acknowledgement cannot replace refreshed history feedback");
    await host.evaluate('historyCopyProbe.mode="ok"'); await context("menu-keep"); await host.click(menuItem("Copy link address"));
    await host.wait('document.querySelector("[data-web-history-status]").textContent==="Link address copied."&&!document.querySelector("[data-web-history-error]").textContent', "copy retry clears error after success");
    assert.equal(await host.evaluate("historyCopyProbe.text"), entries[4].url); assert.equal(await host.evaluate("historyCopyProbe.writes.length"), 4);
    await idle(); assert.deepEqual(await readFile(historyPath), before);
    assert.equal(await host.evaluate('document.querySelector("#client-errors").textContent'), "");
    pass("Denied/unavailable clipboard writes fail visibly without changes, a successful retry recovers, and late completion cannot replace refreshed feedback; clipboard reads, native permission prompts and OS clipboard access remain unexercised");
  });
}

export async function checkRestoredHistoryCopy({ host, context, menuItem, url }) {
  await clipboardFixture(host, async () => {
    await context("menu-keep", true); await host.click(menuItem("Copy link address"));
    await host.wait(`historyCopyProbe.text===${JSON.stringify(url)}`, "copy restored after enabled or disabled restart");
    assert.deepEqual(await host.evaluate("historyCopyProbe.writes"), [url]);
  });
}

export async function checkStaleHistoryCopy(host, expression) {
  await clipboardFixture(host, async () => {
    await host.evaluate(expression); assert.deepEqual(await host.evaluate("historyCopyProbe.writes"), []);
    assert.equal(await host.evaluate("historyCopyProbe.text"), "Fixture clipboard");
  });
}
