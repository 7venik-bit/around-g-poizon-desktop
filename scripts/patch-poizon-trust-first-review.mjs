import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async (path) => (await readFile(new URL(path, root), 'utf8')).replace(/\r\n/g, '\n');
const save = async (path, value) => {
  const current = await read(path);
  if (value !== current) await writeFile(new URL(path, root), value, 'utf8');
};

let view = await read('src/live-poizon-crosscheck.js');

const oldCss = '#poizon-live-check tr.live-different{background:#fff3df}';
const newCss = '#poizon-live-check tr.live-different{background:transparent}#poizon-live-check tr.live-missing{background:#fde8e8}';
if (view.includes(oldCss)) view = view.replace(oldCss, newCss);
else if (!view.includes('tr.live-missing{background:#fde8e8}')) throw new Error('trust-first UI CSS target missing');

const oldRowClass = '<tr class="${r.equal ? \'\' : \'live-different\'}">';
const newRowClass = '<tr class="${!r.matched && !r.identityConflict ? \'live-missing\' : \'\'}">';
if (view.includes(oldRowClass)) view = view.replace(oldRowClass, newRowClass);
else if (!view.includes("!r.matched && !r.identityConflict ? 'live-missing' : ''")) throw new Error('trust-first row class target missing');

view = view.replace(
  'phase = `교차 검증 중 · ${event.pageNum}/${event.pageCount}페이지 상품 대조 완료 · 다음 페이지 대기`;',
  "phase = currentRows.some((row) => !row.matched && !row.identityConflict)\n        ? `POIZON ${event.pageNum}/${event.pageCount}페이지 · Excel 누락 확인 · 수정/저장/재검증 완료 전에는 다음 페이지로 이동하지 않습니다.`\n        : `POIZON ${event.pageNum}/${event.pageCount}페이지 · 상품 대조 완료 · 수정/저장/재검증 확인 중`;"
);

view = view.replace(
  "saving() { phase = '전체 POIZON 화면 수집 완료 · 원본 백업 후 누락/불일치 Excel 셀을 POIZON 값으로 수정·재검증 중';",
  "saving() { phase = '페이지별 검증 완료 후 최종 전체 재검증 중 · 원본 백업은 유지합니다.';"
);

await save('src/live-poizon-crosscheck.js', view);

let service = await read('services/live-poizon-crosscheck.mjs');
service = service.replace(
  "'상품 인식 완료 · 옵션별 판매량 존재 · SPU 자동수정 제외 · 다음 페이지 진행'",
  "'상품 인식 완료 · 옵션별 판매량 존재 · SPU 자동수정 제외'"
);
await save('services/live-poizon-crosscheck.mjs', service);

console.log('POIZON trust-first review applied: existing products keep the original background; only true Excel-missing products are red.');
