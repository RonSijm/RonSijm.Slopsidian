import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
export const additionalReleases = [
  { id: "obsidian-admonition", version: "12.0.11", sha256: "6a1df01446e9dd3e2165173a1c237707414aa2e92ff0589ab1152921b6404f8b" },
  { id: "obsidian-git", version: "2.42.0", sha256: "dae3ecea527725d04f8660fb14b0b720c84aad87b6d51b3afa799091d325a96d" },
  { id: "obsidian-icon-folder", version: "2.14.7", sha256: "b68bcfd318d678892f671736e54396fd72414180736e58f164fb17a3f72a22e1" },
  { id: "obsidian-kanban", version: "2.0.51", sha256: "458574296f9c50bf5ac078ad28f37724a2520ae45e8ad2144c6769f4062453e4" },
  { id: "obsidian-linter", version: "1.34.2", sha256: "6a591c50345a5cedc709c1d6a76a03f5f73d690eae74772a5b2afd8a95592008" },
  { id: "nldates-obsidian", version: "0.6.4", sha256: "aa5fcc3163889def1b51e2dd1b89ea937fbb3d5bd366d7e3bd9135f7f3510629" },
  { id: "note-refactor-obsidian", version: "1.8.2", sha256: "aabda14d29ee42a70b9d7ef8a591e03c48d2f81bd27c470301a1feeb25633b23" },
  { id: "omnisearch", version: "1.31.0", sha256: "d35f440ac513e057e06f4b32d06960abc1de0bd6feaa7188587feb1b86c428f4" },
  { id: "quickadd", version: "2.32.1", sha256: "6d6deb67254d1b73999a0dd72490e52086f1adddf9d55026a1a72ae111b827b1" },
  { id: "templater-obsidian", version: "2.26.0", sha256: "c41ea9f4990934faa8efacabeda12222714d1d4c823e22724c8cc14789fa834e" },
];

export async function prepareAdditionalPluginAssets() {
  const directory = join(root, ".runtime", "compatibility", "additional-example-plugins");
  const releases = [];
  for (const release of additionalReleases) {
    const source = join(root, "Example", ".obsidian", "plugins", release.id);
    const manifest = JSON.parse((await readFile(join(source, "manifest.json"), "utf8")).replace(/^\ufeff/, ""));
    assert.equal(manifest.id, release.id);
    assert.equal(manifest.version, release.version);
    const target = join(directory, release.id + "-" + release.version);
    await mkdir(target, { recursive: true });
    const assets = [];
    for (const name of ["main.js", "manifest.json", "styles.css"]) {
      let bytes;
      try { bytes = await readFile(join(source, name)); }
      catch (error) { if (name === "styles.css" && error.code === "ENOENT") { continue; } throw error; }
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (name === "main.js") { assert.equal(sha256, release.sha256, "The tested main.js must match the operator-provided pinned bundle."); }
      try { await copyFile(join(source, name), join(target, name), constants.COPYFILE_EXCL); }
      catch (error) { if (error.code !== "EEXIST") { throw error; } }
      assert.deepEqual(await readFile(join(target, name)), bytes, "Never overwrite or accept a different cached asset.");
      assets.push({ name, bytes: bytes.length, sha256 });
    }
    releases.push({ ...release, directory: target, minAppVersion: manifest.minAppVersion, assets, provenance: "operator-provided Example assets; plugin data.json excluded" });
  }
  return { directory, releases };
}
