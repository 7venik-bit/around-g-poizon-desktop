import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPoizonPreviewRows } from '../services/poizon-sales-filter.mjs';
import sheet from './fixtures/ecco-original-sales.cjs';
const [headers, ...rows] = sheet;
const filter = (extra = {}, data = rows) => filterPoizonPreviewRows(headers, data, { salesMetric: 'total', matchMode: 'all', ...extra });

test('local >=25 matches five original SKU rows in two products without changing raw values', () => {
  const before = structuredClone(rows);
  const result = filter({ minimumLocalTotal: 25 });
  const groups = [...new Map(result.entries.map(e => [e.values[0], e.originalSalesRows])).values()];
  assert.equal(result.filteredProducts, 2);
  assert.equal(result.entries.length, 18, 'all options remain available to inspect');
  assert.deepEqual(groups.flat().map(r => r.localTotalSalesRaw), ['49','48','54','50','26']);
  assert.deepEqual(groups.flat().map(r => r.totalSalesRaw), ['70','70','78','57','31']);
  assert.deepEqual(rows, before);
});

test('China >=100 AND local >=25 cannot qualify by adding sizes or combining different rows', () => {
  assert.equal(filter({ minimumTotal: 100, minimumLocalTotal: 25 }).filteredProducts, 0);
  const split = [['A','SPLIT','product','A1',100,1], ['A','SPLIT','product','A2',1,25]];
  assert.equal(filter({ minimumTotal: 100, minimumLocalTotal: 25 }, split).filteredProducts, 0);
  assert.equal(filter({ minimumTotal: 100, minimumLocalTotal: 25, matchMode: 'any' }, split).filteredProducts, 1);
});

test('censored and missing quantities cannot invent a qualifying count', () => {
  const data = ['<5','--','25+','24','0','２５'].map((v,i)=>[String(i),'SHOE','shoe',String(i),100,v]);
  assert.deepEqual(filter({ minimumLocalTotal: 25 }, data).entries.map(e=>e.values[5]), ['25+','２５']);
  assert.deepEqual(filter({ maximumLocalTotal: 24 }, data).entries.map(e=>e.values[5]), ['<5','24','0']);
  assert.deepEqual(filter({ minimumLocalTotal: 3 }, data).entries.map(e=>e.values[5]), ['25+','24','２５']);
  assert.equal(filter({},data).entries.length, data.length);
  assert.equal(filter({ minimumLocalTotal: 0 }, data).entries.some(e=>e.values[5]==='--'), false);
});

test('raw Excel and grouped original view select exactly the same source rows', () => {
  for (const criteria of [{minimumLocalTotal:25},{minimumTotal:100,minimumLocalTotal:25},{maximumLocalTotal:24}]) {
    const raw = filter({...criteria,rowLevel:true}).entries.map(e=>e.sourceRowNumber);
    const grouped = [...new Map(filter(criteria).entries.map(e=>[e.values[0],e.originalSalesRows])).values()].flat().map(r=>r.sourceRowNumber);
    assert.deepEqual(grouped, raw);
  }
});

test('column reordering and normalized headers work for new downloads without fixed letters', () => {
  const order = [5,2,6,0,4,1,3];
  const h = order.map(i=>headers[i].replaceAll(' ','\n'));
  const result = filterPoizonPreviewRows(h,rows.map(row=>order.map(i=>row[i])),{salesMetric:'total',minimumLocalTotal:25});
  assert.equal(result.filteredProducts,2);
  assert.equal(result.localTotalSalesColumn,0);
  assert.equal(result.entries[0].originalSalesRows[0].localTotalSalesRaw,'49');
});

test('missing local column fails closed and row identity does not depend on a SKU ID', () => {
  assert.equal(filterPoizonPreviewRows(headers.slice(0,5), rows.map(r=>r.slice(0,5)),
    {salesMetric:'total',requireSalesColumns:true,minimumLocalTotal:25}).filteredProducts,0);
  const data = rows.map(r=>r.map((v,i)=>i===3?'':v));
  assert.equal(filter({minimumLocalTotal:25},data).filteredProducts,2);
});
