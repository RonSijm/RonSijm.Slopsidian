export function attachmentPath(value: string): string {
  if (!value || value.length > 4096 || value.split("/").some(part => !part || part.length > 255 || part.startsWith(".") || /[. ]$|[<>:"\\|?*\x00-\x1f]/.test(part) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])($|\.)/i.test(part))) { throw new Error("Use a valid relative attachment path without hidden, reserved or traversal segments."); }
  return value;
}
export function recordingFolder(value: unknown, source: string | null): string {
  if (value === undefined || value === "" || value === "." || value === "/") { return ""; }
  if (typeof value !== "string") { throw new Error("The attachment folder setting must be text."); }
  if (value.startsWith("./")) {
    if (!source) { throw new Error("Open a file before recording into a relative attachment folder."); }
    const folder = source.includes("/") ? source.slice(0, source.lastIndexOf("/") + 1) : "";
    const suffix = value.slice(2).replace(/\/+$/, "");
    return suffix ? attachmentPath(folder + suffix) : folder.replace(/\/$/, "");
  }
  return attachmentPath(value.replace(/\/+$/, ""));
}
export function recordingName(folder: string, extension: string, exists: (path: string) => boolean, now = new Date()): string {
  if (!["m4a", "webm", "ogg"].includes(extension) || !Number.isFinite(now.getTime())) { throw new Error("Invalid recording format or timestamp."); }
  const pad = (value: number): string => String(value).padStart(2, "0");
  const stem = "Recording " + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
  for (let index = 0; index < 1000; index++) {
    const path = (folder ? attachmentPath(folder) + "/" : "") + stem + (index ? " " + index : "") + "." + extension;
    if (!exists(path)) { return path; }
  }
  throw new Error("No available recording filename was found. Choose another attachment path.");
}
