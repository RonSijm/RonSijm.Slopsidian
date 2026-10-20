export interface RecentFilesOptions {
  showMarkdown?: boolean;
  showNonAttachments?: boolean;
  showNonImageAttachments?: boolean;
  showImages?: boolean;
  maxCount?: number;
}

function category(path: string): "markdown" | "document" | "image" | "other" {
  const dot = path.lastIndexOf(".");
  const extension = dot > 0 ? path.slice(dot + 1).toLowerCase() : "";
  return extension === "md" ? "markdown" : extension === "canvas" || extension === "base" ? "document"
    : ["bmp", "png", "jpg", "jpeg", "gif", "svg", "webp", "avif"].includes(extension ?? "") ? "image" : "other";
}

export class RecentFiles {
  private paths: string[] = [];

  load(value: unknown = []): void {
    if (!Array.isArray(value) || value.length > 512 || !value.every(path =>
      typeof path === "string" && path.length > 0 && path.length <= 4096 && !/[\\\0]/.test(path) &&
      path.split("/").every(part => part && part !== "." && part !== ".."))) {
      throw new Error("Recent files must be an array of vault-relative file paths.");
    }
    this.paths = [...new Set<string>(value)];
  }

  serialize(): string[] { return [...this.paths]; }

  collect(path: string): boolean {
    if (this.paths[0] === path) { return false; }
    const remaining = { markdown: 25, document: 10, image: 10, other: 10 };
    const paths = [path];
    for (const previous of this.paths) {
      const kind = previous.toLowerCase().endsWith(".base") ? "other" : category(previous);
      if (previous !== path && remaining[kind] > 0) { paths.push(previous); remaining[kind]--; }
    }
    this.paths = paths;
    return true;
  }

  rename(oldPath: string, newPath: string): boolean {
    const paths = this.paths.map(path => path === oldPath ? newPath
      : path.startsWith(oldPath + "/") ? newPath + path.slice(oldPath.length) : path);
    if (paths.every((path, index) => path === this.paths[index])) { return false; }
    this.paths = [...new Set(paths)];
    return true;
  }

  getRecentFiles(options: RecentFilesOptions = {}): string[] {
    if (!options || typeof options !== "object" || Array.isArray(options)) { throw new Error("Recent-file options must be an object."); }
    const { showMarkdown = true, showNonAttachments = true, showNonImageAttachments = false, showImages = false, maxCount = 10 } = options;
    if (![showMarkdown, showNonAttachments, showNonImageAttachments, showImages].every(value => typeof value === "boolean")) {
      throw new Error("Recent-file visibility options must be Boolean.");
    }
    if (!Number.isSafeInteger(maxCount) || maxCount < 0) { throw new Error("The recent-file limit must be a nonnegative integer."); }
    const visible = { markdown: showMarkdown, document: showNonAttachments, image: showImages, other: showNonImageAttachments };
    return this.paths.filter(path => visible[category(path)]).slice(0, maxCount);
  }
}
