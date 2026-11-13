import type { ExplorerOpenSelection } from "./file-explorer-model";
import type { TFile, TFolder } from "./vault";

/** An app-local gesture, never a serialized file list or an OS transfer. */
export interface ExplorerNoteDrag {
  readonly source: object;
  readonly root: string;
  readonly token: string;
  readonly plan: ExplorerOpenSelection<TFile>;
  readonly current: () => boolean;
  readonly review: (folder: TFolder, destinationCurrent: () => boolean) => void;
  readonly cleanups: Set<() => void>;
}

const active = new WeakMap<object, ExplorerNoteDrag>();

export function retireExplorerNoteDrag(app: object, drag = active.get(app)): void {
  if (!drag) { return; }
  if (active.get(app) === drag) { active.delete(app); }
  const cleanups = [...drag.cleanups]; drag.cleanups.clear();
  for (const cleanup of cleanups) { cleanup(); }
}

export function publishExplorerNoteDrag(app: object, drag: ExplorerNoteDrag): void {
  retireExplorerNoteDrag(app); active.set(app, drag);
}

export function currentExplorerNoteDrag(app: object): ExplorerNoteDrag | null {
  const drag = active.get(app);
  if (!drag) { return null; }
  if (!drag.current()) { retireExplorerNoteDrag(app, drag); return null; }
  return drag;
}
