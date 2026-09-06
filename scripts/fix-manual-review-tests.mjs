import { readFile, writeFile } from 'node:fs/promises';
const url = new URL('../tests/poizon-value-integrity.test.mjs', import.meta.url);
let source = (await readFile(url, 'utf8')).replace(/\r\n/g, '\n');
const oldStart = "test('production combined workflow reads all rows before filtering, saves/rereads and groups sizes into one SPU'";
const nextStart = "test('failed capture cannot write or report complete; incomplete local paging cannot silently omit products'";
const start = source.indexOf(oldStart);
if (start >= 0) {
  const end = source.indexOf(nextStart, start);
  if (end < 0) throw new Error('Legacy combined workflow test end not found');
  source = source.slice(0, start) + source.slice(end);
}
const manualStart = source.indexOf("test('production combined workflow reads all rows, compares POIZON, never writes, and returns copyable changes'");
if (manualStart < 0) throw new Error('Manual combined workflow test missing');
const manualEnd = source.indexOf(nextStart, manualStart);
let block = source.slice(manualStart, manualEnd);
block = block.replace("assert.equal(result.products.length, 1); assert.ok(result.manualChanges.some((c) => c.poizonValue === '83'));",
  "assert.ok(result.products.some((p) => p.spuId === '11')); assert.ok(result.manualChanges.some((c) => c.poizonValue === '83'));" );
source = source.slice(0, manualStart) + block + source.slice(manualEnd);
await writeFile(url, source, 'utf8');
console.log('Legacy auto-save assertions removed; manual-review no-write assertions retained.');
