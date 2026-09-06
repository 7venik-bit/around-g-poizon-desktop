import { readFile, writeFile } from 'node:fs/promises';
const url = new URL('../src/renderer.js', import.meta.url);
const source = await readFile(url, 'utf8');
const bad = "return lines.join('\n');";
const good = String.raw`return lines.join('\n');`;
if (!source.includes(bad) && !source.includes(good)) throw new Error('Manual review newline target missing');
if (source.includes(bad)) await writeFile(url, source.replace(bad, good), 'utf8');
console.log('Manual review copy text newline escape verified.');
