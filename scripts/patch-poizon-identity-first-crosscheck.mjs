import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async (path) => (await readFile(new URL(path, root), 'utf8')).replace(/\r\n/g, '\n');
const save = async (path, value) => { if (value !== await read(path)) await writeFile(new URL(path, root), value, 'utf8'); };

let identity = await read('services/poizon-product-identity.mjs');
if (!identity.includes('export const normalizedSpu')) {
  identity = identity.replace(
    "export const cleanId = (value) => String(value ?? '').normalize('NFKC').trim();\nexport const normalizedArticle = (value) => cleanId(value).toUpperCase().replace(/[^\\p{L}\\p{N}]/gu, '');\nexport const productSpu = (p = {}) => cleanId(p.spuId || p.globalSpuId);",
    "export const cleanId = (value) => String(value ?? '').normalize('NFKC').replace(/[\\u200B-\\u200D\\uFEFF]/g, '').trim();\nexport const normalizedArticle = (value) => cleanId(value).toUpperCase().replace(/[^\\p{L}\\p{N}]/gu, '');\nexport const normalizedSpu = (value) => {\n  const raw = cleanId(value).replace(/\\s+/g, '');\n  if (/^\\d+\\.0+$/.test(raw)) return raw.replace(/\\.0+$/, '');\n  if (/^[+-]?\\d+(?:\\.\\d+)?e[+-]?\\d+$/i.test(raw)) {\n    const n = Number(raw);\n    if (Number.isSafeInteger(n) && n >= 0) return String(n);\n  }\n  return raw;\n};\nexport const productSpu = (p = {}) => normalizedSpu(p.spuId || p.globalSpuId);"
  );
}
// Workbook writes keep the strict SPU-conflict policy. Only the live recognition layer
// may display a unique exact-article fallback as "recognized but SPU needs confirmation".
await save('services/poizon-product-identity.mjs', identity);

let live = await read('services/live-poizon-crosscheck.mjs');
// Earlier release patches may already add the two-function import using double quotes.
// Collapse every identity import into one canonical import to prevent duplicate bindings.
live = live.replace(/^import \{[^\n]*\} from ['\"]\.\/poizon-product-identity\.mjs['\"];\n/gm, '');
live = "import { indexProductIdentities, resolveProductIdentity, normalizedArticle, productSpu } from './poizon-product-identity.mjs';\n" + live;
live = live.replace(
  "const article = (p) => String(p?.articleNumber || p?.productCode || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');\nconst spu = (p) => String(p?.spuId || p?.globalSpuId || '').trim();",
  "const article = (p) => normalizedArticle(p?.articleNumber || p?.productCode || '');\nconst spu = (p) => productSpu(p || {});"
);
if (!live.includes('const identityIndex = indexProductIdentities(excelProducts);')) {
  live = live.replace(
    "  const bySpu = new Map(), byArticle = new Map(), compared = new Map();",
    "  const identityIndex = indexProductIdentities(excelProducts);\n  const bySpu = new Map(), byArticle = new Map(), compared = new Map();"
  );
}
const newMatchBlock = `    // 1) identify the product first, without looking at sales values.\n    // SPU exact match wins. If strict identity rejects only because the POIZON SPU differs,\n    // an exact normalized article may still be recognized for display when it resolves to one SPU.\n    let resolvedIdentity = resolveProductIdentity({\n      spuId: product?.spuId || product?.globalSpuId,\n      articleNumber: product?.articleNumber || product?.productCode,\n      brandId: product?.brandId || product?.brandCode,\n    }, identityIndex);\n    let candidates = resolvedIdentity.products || [];\n    let matchBy = resolvedIdentity.matchBy || resolvedIdentity.reason || '상품 없음';\n    if (!candidates.length && article(product)) {\n      const queryBrand = String(product?.brandId || product?.brandCode || '').trim();\n      const articleCandidates = (byArticle.get(article(product)) || []).filter((p) => {\n        const excelBrand = String(p?.brandId || p?.brandCode || '').trim();\n        return !queryBrand || !excelBrand || queryBrand === excelBrand;\n      });\n      const articleSpus = new Set(articleCandidates.map(spu).filter(Boolean));\n      if (articleCandidates.length && articleSpus.size <= 1) {\n        candidates = articleCandidates;\n        matchBy = spu(product) && articleSpus.size === 1 && !articleSpus.has(spu(product))\n          ? '상품번호(고유·SPU불일치)' : '상품번호(고유)';\n      }\n    }\n\n    // 2) only after identity is established, compare recent-30-day values.\n    const source = [recentMetric(product), recentMetric(product, true)];`;
live = live.replace(/    (?:let|const) resolvedIdentity = resolveProductIdentity\([\s\S]*?    const source = \[recentMetric\(product\), recentMetric\(product, true\)\];/, newMatchBlock);
live = live.replace(/    let candidates = bySpu\.get\(spu\(product\)\) \|\| \[\];[\s\S]*?    const source = \[recentMetric\(product\), recentMetric\(product, true\)\];/, newMatchBlock);

live = live.replace(
  ": equal ? '일치 · 수정 없음'\n      : missingSides ? `Excel 누락 ${missingSides}개 · POIZON 값으로 수정 대상`\n      : '값 다름 · POIZON 값으로 수정 대상';",
  ": /SPU불일치/.test(matchBy) ? '상품 인식 완료 · SPU 불일치 · 자동수정 보류'\n      : equal ? '상품 인식 완료 · 판매량 일치 · 수정 없음'\n      : missingSides ? `상품 인식 완료 · 판매량 누락 ${missingSides}개 · POIZON 값으로 수정 대상`\n      : '상품 인식 완료 · 판매량 값 다름 · POIZON 값으로 수정 대상';"
);
live = live.replace(
  ": equal ? '상품 인식 완료 · 판매량 일치 · 수정 없음'\n      : missingSides ? `상품 인식 완료 · 판매량 누락 ${missingSides}개 · POIZON 값으로 수정 대상`\n      : '상품 인식 완료 · 판매량 값 다름 · POIZON 값으로 수정 대상';",
  ": /SPU불일치/.test(matchBy) ? '상품 인식 완료 · SPU 불일치 · 자동수정 보류'\n      : equal ? '상품 인식 완료 · 판매량 일치 · 수정 없음'\n      : missingSides ? `상품 인식 완료 · 판매량 누락 ${missingSides}개 · POIZON 값으로 수정 대상`\n      : '상품 인식 완료 · 판매량 값 다름 · POIZON 값으로 수정 대상';"
);
await save('services/live-poizon-crosscheck.mjs', live);

let view = await read('src/poizon-review-workspace.js');
view = view.replace('<span data-tone="equal">일치</span><span data-tone="different">값 다름</span><span data-tone="missing">연결 불가</span>', '<span data-tone="equal">판매량 일치</span><span data-tone="different">판매량 수정</span><span data-tone="missing">Excel 누락</span>');
view = view.replace('`POIZON ${event.pageNum}/${event.pageCount}페이지 · 동일 상품 ${currentRows.length}개 대조 완료`', '`POIZON ${event.pageNum}/${event.pageCount}페이지 · 상품 식별 및 판매량 대조 ${currentRows.length}개 완료`');
view = view.replace(
  "`누적 대조 ${number(state.checkedProducts)} · 일치 ${number(state.equalProducts)} · 차이/미확인 ${number(state.differentProducts)} · 연결 불가 ${number(state.missingProducts)}`",
  "`누적 ${number(state.checkedProducts)} · 상품 인식 ${number(state.matchedProducts)} · 판매량 일치 ${number(state.equalProducts)} · 판매량 수정/확인 ${number(state.differentProducts)} · Excel 누락 ${number(state.missingProducts)}`"
);
await save('src/poizon-review-workspace.js', view);

let tests = await read('tests/live-poizon-crosscheck.test.mjs');
tests = tests.replace("assert.equal(result.rows[0].qualified, true); assert.equal(result.rows[0].status, '값 다름 · POIZON 값으로 수정 대상');", "assert.equal(result.rows[0].qualified, true); assert.equal(result.rows[0].status, '상품 인식 완료 · 판매량 값 다름 · POIZON 값으로 수정 대상');");
tests = tests.replace(/test\('SPU identity is preserved and same-code different-SPU matches are rejected',[\s\S]*?\n\}\);/, `test('SPU is first priority and a unique exact article can be recognized without treating it as Excel-missing', () => {\n  assert.equal(session().acceptPage([product(83, { articleNumber: 'OTHER' })]).matchedProducts, 1);\n  const uniqueArticle = session().acceptPage([product(83, { spuId: '99' })]);\n  assert.equal(uniqueArticle.matchedProducts, 1);\n  assert.equal(uniqueArticle.rows[0].matchBy, '상품번호(고유·SPU불일치)');\n  assert.equal(uniqueArticle.rows[0].status, '상품 인식 완료 · SPU 불일치 · 자동수정 보류');\n\n  const conflictExcel = [product(83, { spuId:'11' }), product(83, { spuId:'12', sourceRowNumber:3 })];\n  const conflict = session(conflictExcel).acceptPage([product(83, { spuId:'99' })]);\n  assert.equal(conflict.matchedProducts, 0);\n  assert.equal(conflict.rows[0].status, '식별자 충돌 · 자동수정 보류');\n});`);
tests = tests.replace(/test\('SPU is first priority and a unique exact article safely recognizes the same product when SPU text differs',[\s\S]*?\n\}\);/, `test('SPU is first priority and a unique exact article can be recognized without treating it as Excel-missing', () => {\n  assert.equal(session().acceptPage([product(83, { articleNumber: 'OTHER' })]).matchedProducts, 1);\n  const uniqueArticle = session().acceptPage([product(83, { spuId: '99' })]);\n  assert.equal(uniqueArticle.matchedProducts, 1);\n  assert.equal(uniqueArticle.rows[0].matchBy, '상품번호(고유·SPU불일치)');\n  assert.equal(uniqueArticle.rows[0].status, '상품 인식 완료 · SPU 불일치 · 자동수정 보류');\n\n  const conflictExcel = [product(83, { spuId:'11' }), product(83, { spuId:'12', sourceRowNumber:3 })];\n  const conflict = session(conflictExcel).acceptPage([product(83, { spuId:'99' })]);\n  assert.equal(conflict.matchedProducts, 0);\n  assert.equal(conflict.rows[0].status, '식별자 충돌 · 자동수정 보류');\n});`);
if (!tests.includes("numeric-form SPU normalization")) {
  tests = tests.replace("test('each of 150 pages is compared independently", `test('numeric-form SPU normalization recognizes Excel and POIZON as the same product', () => {\n  const excel = [product(83, { spuId:'25942988.0' })];\n  const result = session(excel).acceptPage([product(83, { spuId:'2.5942988E+7' })]);\n  assert.equal(result.matchedProducts, 1);\n  assert.equal(result.equalProducts, 1);\n});\n\ntest('each of 150 pages is compared independently`);
}
await save('tests/live-poizon-crosscheck.test.mjs', tests);

let categoryTests = await read('tests/favorite-category-search-v2.10.294.test.mjs');
categoryTests = categoryTests.replace("'POIZON 37/150페이지 · 동일 상품 20개 대조 완료'", "'POIZON 37/150페이지 · 상품 식별 및 판매량 대조 20개 완료'");
await save('tests/favorite-category-search-v2.10.294.test.mjs', categoryTests);

console.log('POIZON identity-first crosscheck applied safely: product recognition is separated from sales comparison, strict workbook write conflicts remain blocked.');
