import { modalTabStops } from "./modal-focus";

/** Preserve focus explicitly placed by onOpen, including nested dialogs. */
export function focusModalInitialInput(root: HTMLElement): void {
  if (root.ownerDocument.activeElement !== root) { return; }
  const stops = modalTabStops(root);
  const target = stops.find(element => element.hasAttribute("autofocus")) ?? stops.find(element => {
    if (element.isContentEditable) { return true; }
    if (element.tagName === "SELECT") { return true; }
    if (element.tagName === "TEXTAREA") { return !(element as HTMLTextAreaElement).readOnly; }
    return element.tagName === "INPUT" && !(element as HTMLInputElement).readOnly
      && !["hidden", "button", "submit", "reset", "image"].includes((element as HTMLInputElement).type);
  });
  target?.focus({ preventScroll: true });
}
