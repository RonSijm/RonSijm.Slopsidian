import assert from 'node:assert/strict';

function readExplorerOptions(selector) {
  const roots = [...document.querySelectorAll(selector)], root = roots.length === 1 ? roots[0] : null;
  const details = root ? [...root.children].filter(node => node.matches('details[data-explorer-options]')) : [];
  const options = details.length === 1 ? details[0] : null;
  const summaries = options ? [...options.children].filter(node => node.tagName === 'SUMMARY') : [];
  const summary = summaries.length === 1 ? summaries[0] : null;
  const id = root?.dataset.fileExplorer ?? null, leaf = id ? app.workspace.getLeafById(id) : null, view = leaf?.view;
  const sort = root?.querySelector('[data-explorer-sort]');
  const state = {
    roots: roots.length, id, details: details.length, summaries: summaries.length,
    label: summary?.textContent.trim() ?? null, open: options?.open === true,
    summaryFocused: summary !== null && document.activeElement === summary,
    connected: root?.isConnected === true && options?.isConnected === true && summary?.isConnected === true,
    currentDocument: root?.ownerDocument === document && view?.containerEl?.ownerDocument === document,
    currentOwner: view?.getViewType?.() === 'file-explorer' && view.contentEl === root && view.isLoaded === true
      && view.containerEl?.isConnected === true && view.sourceRoot === app.vault.rootPath,
    ownedControls: options?.closest('[data-file-explorer]') === root && summary?.parentElement === options,
    inert: Boolean(root?.closest('[inert]')), visible: summary?.checkVisibility() === true,
    sortEnabled: sort?.disabled === false,
  };
  state.ready = state.roots === 1 && state.details === 1 && state.summaries === 1
    && state.label === 'More file options' && state.connected && state.currentDocument && state.currentOwner
    && state.ownedControls && !state.inert && state.visible && state.sortEnabled;
  return state;
}

export const explorerOptionsStateExpression = selector => '(' + readExplorerOptions.toString() + ')(' + JSON.stringify(selector) + ')';

/** Icon and label descendants are part of the exact button; foreign overlays are not. */
export function explorerOwnHit(control, hit) { return Boolean(control && hit && (hit === control || control.contains(hit))); }

/** Open only the requested live Files owner's native disclosure, using trusted input. */
export async function openExplorerOptions(tools, selector, { input = 'pointer' } = {}) {
  assert.ok(input === 'pointer' || input === 'keyboard', 'Known native disclosure input mode');
  const expression = explorerOptionsStateExpression(selector), before = await tools.evaluate(expression);
  assert.equal(before.ready, true, 'The requested Files disclosure has one current interactive owner: ' + JSON.stringify(before));
  const summary = selector + ' > details[data-explorer-options] > summary';
  let tabs = 0;
  if (!before.open) {
    if (input === 'keyboard') {
      assert.equal(typeof tools.press, 'function', 'Native keyboard input is available');
      let focused = before;
      while (!focused.summaryFocused && tabs < 32) {
        await tools.press('Tab', 'Tab', 9, 8);
        tabs++;
        focused = await tools.evaluate(expression);
        assert.equal(focused.ready, true, 'Keyboard navigation retains the requested live Files owner');
        assert.equal(focused.id, before.id, 'Keyboard navigation retains the requested Files identity');
      }
      assert.equal(focused.summaryFocused, true, 'Bounded native reverse-Tab reaches More file options');
      await tools.press('Enter', 'Enter', 13);
    } else {
      await tools.click(summary);
    }
  }
  await tools.wait('((state)=>state.ready&&state.open&&state.id===' + JSON.stringify(before.id) + ')(' + expression + ')', 'The requested Files native More file options disclosure is open');
  const after = await tools.evaluate(expression);
  assert.equal(after.ready, true); assert.equal(after.open, true); assert.equal(after.id, before.id);
  const receipt = { selector, input, alreadyOpen: before.open, tabs, before, after };
  if (tools.report) (tools.report.explorerOptionsInteractions ??= []).push(receipt);
  return receipt;
}
