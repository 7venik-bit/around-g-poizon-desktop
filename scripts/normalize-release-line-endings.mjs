import { readFile, writeFile } from "node:fs/promises";

const targets = [
  new URL("../main.mjs", import.meta.url),
  new URL("../preload.cjs", import.meta.url),
  new URL("../relay/domestic-search.mjs", import.meta.url),
];

let changed = 0;
for (const target of targets) {
  const source = await readFile(target, "utf8");
  const normalized = source.replace(/\r\n/g, "\n");
  if (normalized === source) continue;
  await writeFile(target, normalized, "utf8");
  changed += 1;
}

console.log(`Normalized release patch line endings for ${changed} file(s).`);
