import { readFile, writeFile } from 'node:fs/promises';
const syncSource = await readFile(new URL('../services/poizon-screen-excel-sync.mjs', import.meta.url), 'utf8');
if (syncSource.includes("comparisonMode: 'POIZON_SCREEN_IS_SOURCE_OF_TRUTH'")) {
  console.log('Manual review newline patch skipped in screen-authoritative compare/correct mode.');
  process.exit(0);
}
const url = new URL('../src/renderer.js', import.meta.url);
const source = await readFile(url, 'utf8');
const bad = "return lines.join('\n');";
const good = String.raw`return lines.join('\n');`;
if (!source.includes(bad) && !source.includes(good)) throw new Error('Manual review newline target missing');
if (source.includes(bad)) await writeFile(url, source.replace(bad, good), 'utf8');
console.log('Manual review copy text newline escape verified.');
