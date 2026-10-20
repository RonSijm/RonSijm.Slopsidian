/** Refuses to remember a vault unless the client's live vault is still exactly the one the switch confirmed. */
export function confirmedNativeRoot(currentRoot: string | null, openedRoot: unknown): string {
  if (typeof openedRoot !== "string" || openedRoot.length === 0) { throw new Error("A confirmed vault path is required."); }
  if (currentRoot !== openedRoot) { throw new Error("The selected vault changed before it could be remembered; recent vaults were not changed."); }
  return openedRoot;
}
