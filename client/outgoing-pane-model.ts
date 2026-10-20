import { copyViewData } from "./contracts";
import { LinkCreationError, newLinkedNotePath, type OutgoingLink } from "./links";

export interface OutgoingPaneState {
  file: string;
  followActiveFile: boolean;
  linksCollapsed: boolean;
  unlinkedCollapsed: boolean;
}

export function outgoingPaneState(value: unknown): OutgoingPaneState {
  const state = copyViewData(value), file = state.file === undefined ? "" : state.file;
  if (typeof file !== "string" || file.length > 4096 || file && (/[\\\x00-\x1f]/.test(file) || file.split("/").some(part => !part || part.startsWith(".")))) {
    throw new Error("Outgoing links needs a visible relative vault file path.");
  }
  const boolean = (key: string, fallback: boolean): boolean => {
    if (state[key] === undefined) { return fallback; }
    if (typeof state[key] !== "boolean") { throw new Error("Outgoing links " + key + " must be Boolean."); }
    return state[key];
  };
  return { file, followActiveFile: boolean("followActiveFile", true), linksCollapsed: boolean("linksCollapsed", false), unlinkedCollapsed: boolean("unlinkedCollapsed", true) };
}

export function outgoingLinkAction<T extends { path: string; extension: string }>(
  link: OutgoingLink<T>, source: string, viewType: (extension: string) => string | null, readOnly: boolean,
  newNotePath: (path: string, source: string) => string = (path, source) => newLinkedNotePath({ path, subpath: "" }, source),
): { reason: string | null; createPath: string | null } {
  if (link.error) { return { reason: link.error, createPath: null }; }
  if (!link.target) { return { reason: "This link has no supported target.", createPath: null }; }
  if (link.destination) {
    if (!viewType(link.destination.extension)) {
      return { reason: `No view is registered for .${link.destination.extension || "(no extension)"} files.`, createPath: null };
    }
    return { reason: link.destination.extension.toLowerCase() !== "md" && link.target.subpath ? "Subpaths are not supported for this attachment view." : null, createPath: null };
  }
  if (link.target.subpath) {
    return { reason: "The linked note is missing. Create it and its heading or block before following this link.", createPath: null };
  }
  try {
    const createPath = newNotePath(link.target.path, source);
    return readOnly ? { reason: "This vault is read-only. Copy it locally to create missing notes.", createPath: null } : { reason: null, createPath };
  } catch (error) {
    if (!(error instanceof LinkCreationError)) { throw error; }
    return { reason: error.message, createPath: null };
  }
}
