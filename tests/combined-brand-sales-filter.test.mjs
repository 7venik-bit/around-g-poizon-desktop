import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import * as columns from '../services/poizon-xlsx.mjs';
import * as sales from '../services/poizon-sales-filter.mjs';
import eccoSheet from './fixtures/ecco-original-sales.cjs';
import { popularSearchBrand, popularSearchArticle } from '../services/popular-search-identity.mjs';

const main = await readFile(new URL('../main.mjs', import.meta.url), 'utf8');
const renderer = await readFile(new URL('../src/renderer.js', import.meta.url), 'utf8');
const section = (source, start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};
const headers = ['SPU ID', '상품 번호', '상품명', 'SKU ID', '중국 총 판매량', '현지 판매자 총 판매량',
  'POIZON 상품 최근 30일 판매량', 'POIZON 상품 현지 판매자 최근 30일 판매량'];
const rows = [
  ['A', 'KEEP', '표시값 조건 충족', 'A1', 14, 10, '100+', '25'],
  ['A', 'KEEP', '낮은 판매량의 다른 사이즈', 'A2', 1, '<5', '100+', '25'],
  ['B', 'DROP', '원본 합계만 조건 충족', 'B1', '500+', 200, 99, 24],
  ['C', 'SPLIT', '별도 행에 기록된 상품 값', 'C1', 2, 1, '200+', ''],
  ['C', 'SPLIT', '별도 행에 기록된 상품 값', 'C2', 2, 1, '', '30'],
  ['D', 'UNKNOWN', '상품 최근 값 없음', 'D1', '500+', 100, '--', '--'],
  ['E', 'LESS', '현지 조건 미달', 'E1', 300, 50, '1,000+', '<25'],
];

function harness(sheet = [headers, ...rows]) {
  const context = createContext({ ...columns, ...sales, popularSearchBrand, popularSearchArticle, basename, excelPreviewCache: new Map(),
    stat: async () => ({ size: 100, mtimeMs: 1 }), readFile: async () => sheet,
    readFirstDataSheet: async (value) => value,
    brandImportPathKey: (value) => String(value || '').toLowerCase(),
  });
  runInContext(section(main, 'function excelPreviewCell(', 'async function scanBrandExportFolder('), context);
  runInContext(section(renderer, 'function mergeDomesticSearchProducts(', '// Plain Excel inspection'), context);
  return {
    context,
    preview: (filters = {}, offset = 0, limit = 100000) => context.previewExcelFile({ path: '/brand.xlsx', offset, limit,
      filters: { productView: true, productSales: true, selectionOnly: true, fixedTotalAnd: true, matchMode: 'all', ...filters } }),
    group: (result) => JSON.parse(JSON.stringify(context.mergeDomesticSearchProducts(result.products, { path: '/brand.xlsx' }))),
  };
}
const criteria = { minimumTotal: 100, minimumLocalTotal: 25 };

test('100/25 product filtering uses the recent-sales values shown in the full product list', async () => {
  const h = harness();
  const all = h.group(await h.preview());
  const expected = all.filter((p) => p.hasSalesData && p.hasLocalSalesData && p.sales30d >= 100 && p.localSales30d >= 25);
  const filtered = await h.preview(criteria);
  assert.equal(filtered.salesBasis, 'recent30');
  assert.deepEqual(h.group(filtered).map((p) => p.spuId), expected.map((p) => p.spuId));
  assert.deepEqual(h.group(filtered).map((p) => p.spuId), ['A', 'C']);
  assert.equal(h.group(filtered)[0].optionCount, 2, 'all source options of a qualifying product are preserved');
});

test('product grouping retains available values from later rows without adding sales counts', async () => {
  const h = harness();
  const products = h.group(await h.preview());
  const split = products.find((p) => p.spuId === 'C');
  assert.equal(split.hasLocalSalesData, true);
  assert.equal(split.sales30dRaw, '200+');
  assert.equal(split.localSales30dRaw, '30');
  assert.equal(products.find((p) => p.spuId === 'A').sales30d, 100);
});

test('an active recent-sales condition fails closed when its column is missing', async () => {
  const h = harness([headers.slice(0, -1), rows[0].slice(0, -1)]);
  assert.equal((await h.preview(criteria)).products.length, 0);
});

test('workbooks without recent-sales columns keep an explicit original-total basis', async () => {
  const h = harness([headers.slice(0, 6), ...rows.map((row) => row.slice(0, 6))]);
  const result = await h.preview(criteria);
  assert.equal(result.salesBasis, 'total');
  assert.deepEqual(h.group(result).map((p) => p.spuId), ['B', 'D', 'E']);
});

test('raw Excel filtering continues to compare both original values on the same row', async () => {
  const h = harness();
  const result = await h.preview({ ...criteria, productView: false, productSales: false, selectionOnly: false });
  assert.deepEqual(Array.from(result.rowNumbers), [4, 7, 8]);
});

test('full selection includes qualifying products beyond the first 100 display rows', async () => {
  const many = Array.from({ length: 151 }, (_, i) => [String(i), `ITEM-${i}`, '상품', `SKU-${i}`, 1, 1, '100+', 25]);
  const h = harness([headers, ...many]);
  const all = await h.preview(criteria);
  assert.equal(h.group(all).length, 151);
  const page = await h.preview({ ...criteria, selectionOnly: false }, 100, 100);
  assert.equal(page.products.length, 51);
  assert.equal(page.products[0].spuId, '100');
});

function uiHarness(sheets = { '/brand.xlsx': [headers, ...rows] }, storage = new Map()) {
  const nodes = new Map(), reads = [];
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', innerHTML: '', dataset: {},
      classList: { add() {} }, closest: () => ({ querySelector: () => $(`${id}-label`) }) });
    return nodes.get(id);
  };
  const sources = Object.fromEntries(Object.entries(sheets).map(([path, sheet]) => [path, harness(sheet)]));
  const context = createContext({ $, combinedBrandPreview: null, excelPreviewProductCache: new Map(),
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    excelPreviewSearchResults: new Map(), selectedExcelPreviewProducts: new Set(),
    brandImportPathKey: (path) => String(path || '').toLowerCase(), text: (value) => String(value ?? '').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])), money: String,
    excelPreviewStableSelectionKey: (p) => p._excelSelectionKey,
    updateExcelPreviewSelectionUi() {}, restoreSavedExcelSearchResults() {},
    openIntegratedBrandExcel: async () => {
      $('#excel-filter-min-total-label').textContent = '중국 총 판매량 (원본)';
    },
    window: { aroundG: { previewExcelFile: async (path, offset, limit, filters) => {
      reads.push({ path, filters });
      return sources[path].context.previewExcelFile({ path, offset, limit, filters });
    } } },
  });
  runInContext(section(renderer, 'function combinedProductSalesLabels(', '// Plain Excel inspection'), context);
  context.renderExcelProductRows = (file, products) => context.renderVerifiedSpuRows(file, products);
  runInContext(section(renderer, 'async function openCombinedSelectedBrandPreview(', 'async function openIntegratedPopularExcel('), context);
  return { context, nodes, reads, storage, open: (filters) => context.openCombinedSelectedBrandPreview(
    Object.keys(sheets).map((path) => ({ path, brandName: 'TEST' })), filters),
    html: () => $('#excel-preview-rows').innerHTML,
  };
}

test('reopening and restarting the combined view preserves an empty China threshold and the five original local25 rows', async () => {
  const sheets = { '/ecco.xlsx': eccoSheet }, h = uiHarness(sheets);
  await h.open({minimumTotal: '', minimumLocalTotal: '25'});
  await h.open();
  assert.equal(h.context.combinedBrandPreview.products.length, 5);
  assert.equal(h.nodes.get('#excel-filter-min-total').value, '');
  const restarted = uiHarness(sheets, h.storage);
  await restarted.open();
  assert.equal(restarted.context.combinedBrandPreview.products.length, 5);
  assert.deepEqual(JSON.parse(JSON.stringify(restarted.reads.at(-1).filters)).minimumLocalTotal, '25');
  await restarted.open({minimumTotal: '', minimumLocalTotal: ''});
  const showAllRestarted = uiHarness(sheets, h.storage);
  await showAllRestarted.open();
  assert.equal(showAllRestarted.context.combinedBrandPreview.products.length, eccoSheet.length - 1);
});

test('zero qualifying rows keep strict AND filtering and display the remedy above the wide table', async () => {
  const h = uiHarness({ '/ecco.xlsx': eccoSheet });
  await h.open(criteria);
  assert.equal(h.context.combinedBrandPreview.products.length, 0);
  assert.match(h.nodes.get('#excel-filter-status').textContent, /두 판매량 조건을 모두 충족하는 행이 없습니다.*전체 보기/);
});

test('damaged filter preferences do not prevent opening the original Excel view', async () => {
  for (const value of ['broken JSON', 'null', '[]', '{"minimumTotal":{},"minimumLocalTotal":-5}']) {
    const h = uiHarness(undefined, new Map([['around-g-combined-sales-filters-v1', value]]));
    await h.open();
    assert.equal(h.nodes.get('#excel-filter-min-total').value, '100');
    assert.equal(h.nodes.get('#excel-filter-min-local-total').value, '25');
  }
  const blocked = uiHarness();
  blocked.context.localStorage = {getItem(){throw Error('unavailable');},setItem(){throw Error('unavailable');}};
  await blocked.open({minimumTotal: '', minimumLocalTotal: ''});
  assert.equal(blocked.context.combinedBrandPreview.products.length, rows.length);
});

test('the actual combined-view action filters the full list and renders matching labels and sales cells', async () => {
  const h = uiHarness();
  await h.open({ minimumTotal: '', minimumLocalTotal: '' });
  assert.equal(h.context.combinedBrandPreview.products.length, 7);
  await h.open(criteria);
  assert.equal(h.reads.at(-1).filters.productSales, true);
  assert.equal(h.reads.at(-1).filters.originalRowView, true);
  assert.deepEqual(Array.from(h.context.combinedBrandPreview.products,p=>p.articleNumber), ['DROP','UNKNOWN','LESS']);
  assert.match(h.nodes.get('#excel-filter-min-total-label').textContent, /총 판매량 \(원본\)/);
  assert.match(h.html(), /class="excel-source-value">500\+</);
  assert.doesNotMatch(h.html(), /원본 사이즈|excel-original-sale|<small>EU/);
});

test('total-only rows render original totals instead of missing recent metrics', async () => {
  const h = uiHarness({ '/total.xlsx': [headers.slice(0, 6), ...rows.map((row) => row.slice(0, 6))] });
  await h.open(criteria);
  assert.match(h.nodes.get('#excel-filter-min-total-label').textContent, /총 판매량 \(원본\)/);
  assert.match(h.nodes.get('#excel-preview-columns').innerHTML, />현지 판매자 총 판매량 \(원본\)<\/th>/);
  assert.match(h.html(), /class="excel-source-value">500\+</);
  assert.match(h.html(), /class="excel-source-value">200</);
});

test('mixed workbooks keep original columns and compare original total counts', async () => {
  const h = uiHarness({ '/recent.xlsx': [headers, ...rows],
    '/total.xlsx': [headers.slice(0, 6), ...rows.map((row) => row.slice(0, 6))] });
  await h.open(criteria);
  assert.equal(h.context.combinedBrandPreview.salesBasis, 'total');
  assert.equal(h.context.combinedBrandPreview.products.length, 6);
  assert.equal(h.context.combinedBrandPreview.originalColumns.length,8);
  assert.match(h.nodes.get('#excel-filter-min-total-label').textContent, /총 판매량/);
  assert.doesNotMatch(h.html(), /<small>원본 총판매량<\/small>|<small>상품 최근 30일<\/small>/);
});

test('duplicate recent headers are unavailable, not an excuse to fall back to high original totals', async () => {
  const h = harness([[...headers, '중국 상품 최근 30일 판매량'], [...rows[1], 300]]);
  assert.equal((await h.preview(criteria)).products.length, 0);
});


test('five qualifying downloaded rows stay five separate rows with every source cell', async () => {
  const h = uiHarness({ '/ecco.xlsx': eccoSheet });
  await h.open({ minimumTotal: '', minimumLocalTotal: 25 });
  const products = h.context.combinedBrandPreview.products;
  assert.equal(products.length, 5);
  assert.deepEqual(Array.from(products,p=>p.localTotalSalesRaw), ['49','48','54','50','26']);
  for (const p of products) assert.deepEqual(Array.from(p.originalRow.values),eccoSheet[p.sourceRowNumber-1]);
  assert.equal(new Set(products.map(p=>p._excelSelectionKey)).size,5);
  assert.match(h.html(), /class="excel-source-value">49<\/span>/);
  assert.match(h.html(), /class="excel-source-value">색상:블랙;사이즈:EU 42<\/span>/);
  assert.doesNotMatch(h.html(), /<small>EU|excel-original-sale|원본 사이즈/);
  assert.doesNotMatch(h.html(), />254\+<|>70\+<|>54053401001</);
  assert.match(h.nodes.get('#excel-filter-status').textContent, /조건 충족 5행/);
  await h.open(criteria);
  assert.equal(h.context.combinedBrandPreview.products.length, 0);
  assert.match(h.html(), /원본 행/);
  assert.match(h.nodes.get('#excel-filter-status').textContent, /조건 충족 0행/);
  assert.match(h.nodes.get('#excel-preview-columns').innerHTML, /현지 판매자 총 판매량/);
});

test('show-all retains exact original values, censored counts and missing data', async () => {
  const h = uiHarness({ '/ecco.xlsx': eccoSheet });
  await h.open({ minimumTotal: '', minimumLocalTotal: '' });
  assert.equal(h.context.combinedBrandPreview.products.length,28);
  assert.deepEqual(Array.from(h.context.combinedBrandPreview.products,p=>Array.from(p.originalRow.values)),eccoSheet.slice(1));
  assert.match(h.html(), /class="excel-source-value">16<\/span>/);
  assert.doesNotMatch(h.html(), />49\+<|>254\+<|>70\+<|합계/);
});

test('page previews carry matching source values even when a page cuts through an SPU', async () => {
  const h = harness([headers.slice(0, 6),
    ...Array.from({ length: 151 }, (_, i) => ['ONE', 'MANY-SIZES', '상품', 'SKU-'+i, 100, 25])]);
  const all = h.group(await h.preview({ minimumLocalTotal: 25 }));
  const page = h.group(await h.preview({ minimumLocalTotal: 25, selectionOnly: false }, 100, 100));
  assert.equal(all[0].originalSalesRows.length, 151);
  assert.deepEqual(page[0].originalSalesRows,all[0].originalSalesRows);
  assert.equal(page[0].optionCount, 51);
});

test('same-path replacement and a newly downloaded file automatically reread source counts', async () => {
  let sheet = eccoSheet, revision = 1, reads = 0;
  const h = harness();
  h.context.stat = async () => ({size:100,mtimeMs:revision});
  h.context.readFile = async () => { reads++; return sheet; };
  assert.equal(h.group(await h.preview({minimumLocalTotal:25})).length,2);
  sheet = [eccoSheet[0], ['NEW','NEW-ITEM','새 상품','SKU-NEW',100,30,'사이즈:EU 40']];
  revision++;
  assert.deepEqual(h.group(await h.preview(criteria)).map(p=>p.articleNumber),['NEW-ITEM']);
  const result = await h.context.previewExcelFile({path:'/next-download.xlsx',filters:{productView:true,productSales:true,...criteria}});
  assert.equal(result.products[0].localTotalSalesRaw,'30');
  assert.equal(reads,3);
});

test('original view keeps row order, duplicate identifiers, blank cells and literal text', async () => {
  const rawHeaders = ['SPU ID','상품 번호','상품명','SKU ID','중국 총 판매량','현지 판매자 총 판매량','옵션','옵션',''];
  const rawRows = [
    ['S','ARTICLE','  원본 <상품>  ','DUP','100+','25','색상:블랙;사이즈:EU 40','  두 번째  ',''],
    ['S','ARTICLE','다른 상품명','DUP',101,26,'CN 250','',0],
  ];
  const h = uiHarness({'/literal.xlsx':[rawHeaders,...rawRows]});
  await h.open(criteria);
  assert.deepEqual(Array.from(h.context.combinedBrandPreview.products,p=>Array.from(p.originalRow.values)),rawRows);
  assert.equal(h.context.combinedBrandPreview.originalColumns.length,9);
  assert.equal(new Set(h.context.combinedBrandPreview.products.map(p=>p._excelSelectionKey)).size,2);
  assert.match(h.html(), /class="excel-source-value">  원본 &lt;상품&gt;  <\/span>/);
  assert.match(h.html(), /class="excel-source-value"><\/span>/);
  assert.match(h.html(), /class="excel-source-value">0<\/span>/);
  assert.doesNotMatch(h.html(), /<상품>|>숨김<|>미확인<|원본 사이즈/);
});

test('original row pagination preserves all 151 matching rows with the same product IDs', async () => {
  const sheet = [headers.slice(0,6), ...Array.from({length:151},(_,i)=>['ONE','ARTICLE','행 '+i,'DUP',100,25+i])];
  const h = uiHarness({'/many.xlsx':sheet});
  await h.open(criteria);
  assert.equal(h.context.combinedBrandPreview.products.length,151);
  assert.equal(h.context.excelPreviewProductCache.size,151);
  assert.equal((h.html().match(/class="excel-product-row excel-source-row"/g)||[]).length,100);
  h.context.renderCombinedBrandPreviewPage(100);
  assert.equal((h.html().match(/class="excel-product-row excel-source-row"/g)||[]).length,51);
  assert.match(h.html(), /data-source-row="102"/);
  assert.match(h.html(), /data-source-row="152"/);
});

test('source columns from another workbook stay aligned even when their order changes', async () => {
  const h = uiHarness({
    '/one.xlsx': [['상품 번호','상품명','현지 판매자 총 판매량'],['A','첫 상품',25]],
    '/two.xlsx': [['현지 판매자 총 판매량','상품명','상품 번호'],[30,'둘째 상품','B']],
  });
  await h.open({minimumTotal:'',minimumLocalTotal:25});
  assert.equal(h.context.combinedBrandPreview.products.length,2);
  assert.deepEqual(Array.from(h.context.combinedBrandPreview.originalColumns,c=>c.header),['상품 번호','상품명','현지 판매자 총 판매량']);
  const displayed = [...h.html().matchAll(/class="excel-source-value">([^<]*)<\/span>/g)].map(m=>m[1]);
  assert.deepEqual(displayed,['A','첫 상품','25','30','둘째 상품','B'], 'expanded fields retain each workbook column order');
  const document = new JSDOM('<table>'+h.html()+'</table>').window.document;
  assert.deepEqual([...document.querySelectorAll('.excel-source-local')].map(c=>c.textContent),['25','30']);
  assert.deepEqual([...document.querySelectorAll('.excel-source-title')].map(c=>c.textContent),['첫 상품','둘째 상품']);
});

test('existing and newly downloaded brands always use the same ten product columns and six-column retailer result area', async () => {
  const variants = [
    eccoSheet,
    [['상품 번호','상품명','현지 판매자 총 판매량','중국 총 판매량','SPU 이미지','상품 브랜드','최근 30일간 평균 거래가'],
      ['NEW-001','신규 브랜드 상품',30,105,'https://example.test/new.jpg','새 브랜드','KRW115,000']],
    [['새로운 추가 열','상품 브랜드','현지 판매자 총 판매량','상품명','상품 번호','SPU 이미지','중국 총 판매량','최근 30일간 평균 거래가'],
      ['원본 추가 데이터','다른 브랜드',26,'다른 상품','OTHER-001','https://example.test/other.jpg',110,0]],
  ];
  let expectedHeaders;
  for (const [index, sheet] of variants.entries()) {
    const h = uiHarness({['/download-'+index+'.xlsx']:sheet});
    await h.open({minimumTotal:'',minimumLocalTotal:25});
    const headings = h.nodes.get('#excel-preview-columns').innerHTML;
    expectedHeaders ??= headings;
    assert.equal(headings,expectedHeaders, 'brand and extra workbook columns cannot alter the search layout');
    const product = h.context.combinedBrandPreview.products[0];
    h.context.renderDomestic = () => '<div class="domestic-inline-results"><div class="domestic-inline-head">판매처 상품명 사이즈·재고 품번 가격 링크</div><button data-url="https://example.test/product">열기</button></div>';
    h.context.excelPreviewSearchResults.set(product._excelSelectionKey,{products:[],partial:true});
    h.nodes.get('#excel-preview-grid').scrollLeft = 2400;
    h.context.renderCombinedBrandPreviewPage(0);
    const document = new JSDOM('<table><thead>'+headings+'</thead><tbody>'+h.html()+'</tbody></table>').window.document;
    assert.equal(document.querySelectorAll('thead th').length,10);
    assert.equal(document.querySelector('.excel-source-row').children.length,10);
    assert.equal(document.querySelector('.excel-product-search-detail td').colSpan,10);
    assert.equal(document.querySelector('.domestic-inline-results').closest('tr').previousElementSibling.dataset.sourceRow,String(product.sourceRowNumber));
    assert.ok(document.querySelector('.domestic-inline-results [data-url]'));
    assert.equal(document.querySelector('.excel-source-details').open,false);
    assert.equal(document.querySelectorAll('.excel-source-row')[0].querySelectorAll('.excel-source-field').length,sheet[0].length);
    assert.equal(h.nodes.get('#excel-preview-grid').scrollLeft,0);
    if (index) {
      assert.equal(document.querySelector('.excel-verified-image').getAttribute('src'),index===1?'https://example.test/new.jpg':'https://example.test/other.jpg');
      assert.equal(document.querySelector('.excel-source-price').textContent,index===1?'KRW115,000':'0');
      assert.equal(document.querySelector('.excel-source-local').textContent,index===1?'30':'26');
    }
  }
});
