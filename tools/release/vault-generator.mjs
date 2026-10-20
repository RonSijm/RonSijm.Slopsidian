import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Small deterministic xorshift generator so every run produces byte-identical vaults.
function generator(seed) {
  let state = seed >>> 0 || 1;
  return () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 0x100000000; };
}

const words = "alpha beta gamma delta epsilon zeta theta iota kappa lambda sigma omega vault note graph plugin canvas search index render theme sync daily project review draft archive reading planning research design memory".split(" ");

export function noteText(index, count, random) {
  const pick = () => words[Math.floor(random() * words.length)];
  const links = Array.from({ length: 3 + Math.floor(random() * 4) }, () => `[[Note ${String(Math.floor(random() * count)).padStart(6, "0")}]]`);
  const tags = Array.from({ length: 1 + Math.floor(random() * 3) }, () => "#" + pick());
  const paragraphs = Array.from({ length: 4 + Math.floor(random() * 5) }, () => Array.from({ length: 30 + Math.floor(random() * 40) }, pick).join(" ") + ".");
  return [
    "---", `title: Note ${index}`, `status: ${pick()}`, `rating: ${Math.floor(random() * 10)}`, `tags: [${pick()}, ${pick()}]`, "---",
    `# Note ${index}`, "", paragraphs[0], "", `See ${links.join(", ")}. ${tags.join(" ")}`, "",
    "## Details", "", ...paragraphs.slice(1).flatMap(text => ["- " + text, ""]), "```js", `const value${index} = ${Math.floor(random() * 1000)};`, "```", "",
  ].join("\n");
}

export async function generateVault(directory, { notes = 1000, foldersOf = 50, seed = 20260101 } = {}) {
  const random = generator(seed);
  await mkdir(join(directory, ".obsidian"), { recursive: true });
  await writeFile(join(directory, ".obsidian", "app.json"), "{}\n");
  let bytes = 0;
  const folders = new Set();
  for (let index = 0; index < notes; index++) {
    const folder = "Folder " + String(Math.floor(index / foldersOf)).padStart(4, "0");
    if (!folders.has(folder)) { folders.add(folder); await mkdir(join(directory, folder), { recursive: true }); }
    const text = noteText(index, notes, random);
    bytes += Buffer.byteLength(text);
    await writeFile(join(directory, folder, `Note ${String(index).padStart(6, "0")}.md`), text);
  }
  return { notes, folders: folders.size, bytes };
}
