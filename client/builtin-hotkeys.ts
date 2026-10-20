import type { Hotkey } from "./hotkeys";

/** Default shortcuts of the application's own commands; they go through the same manager as plugin hotkeys. */
export interface BuiltinHotkey { hotkeys: Hotkey[]; inModal: boolean }

const mod = (key: string, ...modifiers: Hotkey["modifiers"]): Hotkey[] => [{ modifiers: ["Mod", ...modifiers], key }];

export const BUILTIN_HOTKEYS: Readonly<Record<string, BuiltinHotkey>> = Object.freeze({
  "command-palette:open": { hotkeys: mod("p"), inModal: true },
  "switcher:open": { hotkeys: mod("o"), inModal: true },
  "workspace:new-file": { hotkeys: mod("n"), inModal: true },
  "workspace:new-tab": { hotkeys: mod("t"), inModal: true },
  "workspace:close": { hotkeys: mod("w"), inModal: true },
  "editor:save-file": { hotkeys: mod("s"), inModal: true },
  "app:open-settings": { hotkeys: mod(","), inModal: true },
  "workspace:split-vertical": { hotkeys: mod("\\"), inModal: true },
  "markdown:toggle-preview": { hotkeys: mod("e"), inModal: true },
  "graph:open": { hotkeys: mod("g"), inModal: true },
  "global-search:open": { hotkeys: mod("f", "Shift"), inModal: true },
  "workspace:move-tab-left": { hotkeys: mod("PageUp", "Shift"), inModal: false },
  "workspace:move-tab-right": { hotkeys: mod("PageDown", "Shift"), inModal: false },
  "workspace:go-back": { hotkeys: [{ modifiers: ["Alt"], key: "ArrowLeft" }], inModal: true },
  "workspace:go-forward": { hotkeys: [{ modifiers: ["Alt"], key: "ArrowRight" }], inModal: true },
});
