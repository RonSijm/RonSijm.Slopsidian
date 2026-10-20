/** Keep connected view nodes connected while changing the workspace tree. */
export function syncWorkspaceChildren(parent: HTMLElement, children: readonly HTMLElement[], removeOthers = true): void {
  let next = parent.firstChild;
  for (const child of children) {
    if (child === next) { next = next.nextSibling; continue; }
    // Chromium's state-preserving move retains iframe documents and focus.
    const host = parent as HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void };
    if (host.moveBefore && parent.isConnected && child.isConnected) { host.moveBefore(child, next); }
    else { parent.insertBefore(child, next); }
  }
  if (removeOthers) {
    const desired = new Set<Node>(children);
    for (const child of [...parent.childNodes]) { if (!desired.has(child)) { parent.removeChild(child); } }
  }
}
