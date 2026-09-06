import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const target = new URL('src/live-poizon-crosscheck.js', root);
let source = (await readFile(target, 'utf8')).replace(/\r\n/g, '\n');

const replaceOnce = (before, after, label) => {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Live cross-check visible-row patch target missing: ${label}`);
  source = source.replace(before, after);
};

replaceOnce(
  '<label><input class="live-show-all" type="checkbox"> 조건 미충족 상품도 대조 내역 보기</label>',
  '<label><input class="live-show-all" type="checkbox" checked> 조건 미충족 상품도 대조 내역 보기</label>',
  'show-all default',
);

replaceOnce(
  "    const rows = (finished ? [...allRows.values()] : currentRows).filter((r) => get('.live-show-all').checked || r.qualified);",
  "    const rows = (finished ? [...allRows.values()] : currentRows).filter((r) => !finished || get('.live-show-all').checked || r.qualified);",
  'running rows must remain visible',
);

replaceOnce(
  "    get('.live-prev').disabled = page === 0; get('.live-next').disabled = (page + 1) * 20 >= rows.length;\n    get('.live-raw').disabled = !finished;\n    renderClock();",
  "    get('.live-prev').disabled = page === 0; get('.live-next').disabled = (page + 1) * 20 >= rows.length;\n    get('.live-raw').disabled = !finished;\n    if (!finished && currentRows.length) {\n      const tableHost = get('.live-table');\n      const scrollLatest = () => {\n        tableHost.scrollTop = tableHost.scrollHeight;\n        get('tbody tr:last-child')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });\n      };\n      if (typeof globalThis.requestAnimationFrame === 'function') globalThis.requestAnimationFrame(scrollLatest);\n      else scrollLatest();\n    }\n    renderClock();",
  'auto-scroll latest live row',
);

await writeFile(target, source, 'utf8');

if (!source.includes('class="live-show-all" type="checkbox" checked')) throw new Error('Show-all default verification failed');
if (!source.includes("!finished || get('.live-show-all').checked || r.qualified")) throw new Error('Running-row visibility verification failed');
if (!source.includes("typeof globalThis.requestAnimationFrame === 'function'")) throw new Error('Live auto-scroll fallback verification failed');

console.log('Live POIZON cross-check now shows current compared rows and auto-scrolls to the latest row.');
