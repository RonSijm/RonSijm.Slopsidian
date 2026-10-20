// Regression gate: compares fresh evidence in .runtime/package/evidence to tools/release/budgets.json.
// Evidence must be bound to the current release-manifest artifacts and the current source fingerprint.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { repositoryRoot as root, sourceFingerprint } from "./release/lib.mjs";

export function evaluate(budgets, evidence, manifest) {
  const results = [];
  const check = (name, actual, limit, kind = "max") => {
    const ok = typeof actual === "number" && (kind === "max" ? actual <= limit : actual === limit);
    results.push({ name, actual: actual ?? null, limit, ok });
  };
  const zipSha = manifest?.artifacts?.portableZip?.sha256;
  for (const [name, item] of Object.entries(evidence)) {
    results.push({ name: `${name} evidence bound to current portable ZIP`, actual: item?.artifacts?.portableZip?.sha256 ?? null, limit: zipSha, ok: Boolean(zipSha) && item?.artifacts?.portableZip?.sha256 === zipSha });
  }
  const bundles = evidence.bundles, vault = evidence["large-vault"], startup = evidence.startup;
  if (bundles) {
    const limits = budgets.bundles;
    check("portable ZIP bytes", manifest.artifacts.portableZip.bytes, limits.portableZipBytes);
    check("installer bytes", manifest.artifacts.setup?.bytes, limits.setupBytes);
    check("desktop tree bytes", bundles.desktop.totalBytes, limits.desktopTreeBytes);
    check("UI asset bytes", bundles.desktop.categories["ui-assets"].bytes, limits.uiAssetsBytes);
    if (bundles.web?.measured) {
      check("WASM framework brotli bytes", bundles.web.frameworkBrotliBytes, limits.webFrameworkBrotliBytes);
      check("WASM js brotli bytes", bundles.web.jsBrotliBytes, limits.webJsBrotliBytes);
      check("WASM runtime brotli bytes", bundles.web.wasmBrotliBytes, limits.webWasmBrotliBytes);
    }
  }
  if (vault) {
    const limits = budgets.largeVault;
    check("large-vault note count", vault.notes, limits.notes, "min-exact");
    check("client parse-all ms", vault.client.parseAllMs, limits.clientParseAllMs);
    for (const [name, search] of Object.entries(vault.client.searches)) { check(`client search '${name}' max ms`, search.maxMs, limits.clientSearchMaxMs); }
    check("host ready ms", vault.host?.readyMs, limits.hostReadyMs);
    check("host /api/vault ms", vault.host?.calls?.vault?.ms, limits.hostVaultCallMs);
    check("host /api/metadata/documents ms", vault.host?.calls?.metadata?.ms, limits.hostMetadataCallMs);
    check("host working set bytes", vault.host?.workingSetBytes, limits.hostWorkingSetBytes);
    results.push({ name: "host endpoints returned 200", actual: vault.host?.allOk ?? false, limit: true, ok: vault.host?.allOk === true });
  }
  if (startup) {
    const limits = budgets.startup;
    check("cold interactive ms", startup.cold?.median, limits.coldInteractiveMs);
    check("warm interactive median ms", startup.warmInteractiveMs?.median, limits.warmInteractiveMedianMs);
    check("startup working set bytes", startup.workingSetBytesMedian, limits.workingSetBytes);
    results.push({ name: "startup launches all succeeded", actual: startup.allLaunchesSucceeded, limit: true, ok: startup.allLaunchesSucceeded === true });
  }
  const installedStartup = evidence["startup-installed"];
  if (installedStartup) {
    const limits = budgets.startup;
    check("installed cold interactive ms", installedStartup.cold?.median, limits.coldInteractiveMs);
    results.push({ name: "installed launches all succeeded", actual: installedStartup.allLaunchesSucceeded, limit: true, ok: installedStartup.allLaunchesSucceeded === true });
    results.push({ name: "installed user data outside install, install tree unchanged", actual: installedStartup.dataOutsideInstall?.installTreeUnchanged ?? false, limit: true, ok: installedStartup.dataOutsideInstall?.profileCreated === true && installedStartup.dataOutsideInstall?.installTreeUnchanged === true });
    results.push({ name: "installed uninstall removed install and preserved user data", actual: installedStartup.uninstallSucceeded ?? false, limit: true, ok: installedStartup.uninstallSucceeded === true });
  }
  return { results, ok: results.length > 0 && results.every(item => item.ok) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const evidenceDirectory = join(root, ".runtime", "package", "evidence");
  const manifest = JSON.parse(await readFile(join(root, ".runtime", "package", "out", "release-manifest.json"), "utf8"));
  const budgets = JSON.parse(await readFile(new URL("./release/budgets.json", import.meta.url), "utf8"));
  const requireStartup = process.argv.includes("--require-startup");
  const requireInstalled = process.argv.includes("--require-installed");
  const evidence = {};
  for (const name of ["bundles", "large-vault", "startup", "startup-installed"]) {
    try { evidence[name] = JSON.parse(await readFile(join(evidenceDirectory, name + ".json"), "utf8")); }
    catch { if ((name === "startup" && requireStartup) || (name === "startup-installed" && requireInstalled) || !name.startsWith("startup")) { console.error(`Missing evidence: ${name}.json`); process.exitCode = 1; } }
  }
  const current = await sourceFingerprint();
  const stale = Object.entries(evidence).filter(([, item]) => item.source?.sha256 !== manifest.source.sha256);
  const { results, ok } = evaluate(budgets, evidence, manifest);
  for (const item of results) { console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}: ${item.actual} (limit ${item.limit})`); }
  for (const [name] of stale) { console.error(`FAIL  ${name} evidence was produced from a different source fingerprint than the package`); }
  if (current.sha256 !== manifest.source.sha256) { console.warn(`WARN  working tree changed since packaging (package ${manifest.source.sha256.slice(0, 12)}, now ${current.sha256.slice(0, 12)}); rebuild before treating evidence as current.`); }
  if (!evidence.startup) { console.warn("WARN  startup evidence absent: launch measurements are not part of this gate result."); }
  if (!evidence["startup-installed"]) { console.warn("WARN  installed-copy startup evidence absent."); }
  process.exitCode = ok && !stale.length && !process.exitCode ? 0 : 1;
}
