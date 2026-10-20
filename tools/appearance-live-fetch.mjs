import { build } from "esbuild";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

// Bounded, no-UI live check of the production catalog helpers against the real public raw.githubusercontent.com.
// It exercises the production fetchBounded/parseThemeCatalog/themeFileUrl/reviewThemeFiles code over Node's real
// network transport. It is NOT browser CORS evidence; it records an honest "unreachable" result without failing.
// Usage: node tools/appearance-live-fetch.mjs [--limit 8] [--out report.json]
const argument = name => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const limit = Math.max(1, Math.min(25, Number(argument("--limit") ?? 8)));
const root = resolve(import.meta.dirname, "..");
const folder = await mkdtemp(join(tmpdir(), "slopsidian-live-fetch-"));
const report = { scope: "appearance-live-catalog-fetch", startedAt: new Date().toISOString(), transport: "node global fetch (production appearance-catalog helpers)", browserCors: "not exercised", limit, themes: [] };
try {
  const outfile = join(folder, "catalog.mjs");
  await build({ entryPoints: [join(root, "client", "appearance-catalog.ts")], outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  const catalog = await import(pathToFileURL(outfile).href);
  const fetcher = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  const raw = await catalog.fetchBounded(fetcher, catalog.THEME_CATALOG_URL, catalog.THEME_CATALOG_BYTES);
  const parsed = catalog.parseThemeCatalog(new TextDecoder().decode(raw));
  report.catalog = { url: catalog.THEME_CATALOG_URL, bytes: raw.length, sha256: await catalog.sha256Hex(raw), entries: parsed.entries.length, skipped: parsed.skipped };
  // Deterministic sample: evenly spaced entries so the result is not biased to the first alphabetical themes.
  const step = Math.max(1, Math.floor(parsed.entries.length / limit));
  for (const entry of parsed.entries.filter((_, index) => index % step === 0).slice(0, limit)) {
    const item = { name: entry.name, repo: entry.repo };
    try {
      const css = await catalog.fetchBounded(fetcher, catalog.themeFileUrl(entry, "theme.css"), 8 * 1024 * 1024);
      const manifest = await catalog.fetchBounded(fetcher, catalog.themeFileUrl(entry, "manifest.json"), catalog.THEME_MANIFEST_BYTES);
      item.cssBytes = css.length; item.manifestBytes = manifest.length;
      const text = new TextDecoder("utf-8", { fatal: true }).decode(css);
      const refs = catalog.themeResourceReferences(text);
      const resources = new Map();
      for (const path of refs) { resources.set(path, await catalog.fetchBounded(fetcher, catalog.themeFileUrl(entry, path), 8 * 1024 * 1024)); }
      const review = await catalog.reviewThemeFiles(css, manifest, resources);
      item.outcome = "reviewable"; item.cssVersion = review.cssVersion; item.resources = refs.length; item.needsLocalResources = review.needsLocalResources;
    } catch (error) {
      item.outcome = "refused-or-failed"; item.reason = String(error?.message ?? error).slice(0, 200);
    }
    report.themes.push(item);
  }
  report.status = "completed";
} catch (error) {
  report.status = "unreachable-or-failed"; report.reason = String(error?.message ?? error).slice(0, 300);
} finally {
  await rm(folder, { recursive: true, force: true });
}
report.completedAt = new Date().toISOString();
report.summary = { reviewable: report.themes.filter(item => item.outcome === "reviewable").length, refusedOrFailed: report.themes.filter(item => item.outcome !== "reviewable").length };
const out = argument("--out");
if (out) { await mkdir(resolve(out, ".."), { recursive: true }); await writeFile(out, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify(report, null, 2));
