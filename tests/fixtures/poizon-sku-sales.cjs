// Offline Electron integration: production preview, grouping and renderer;
// native input submits the filter, then the visible sales cells are checked.
const { app, BrowserWindow, ipcMain } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { resolve, basename } = require('node:path');
const { pathToFileURL } = require('node:url');
const { createContext, runInContext } = require('node:vm');
const assert = require('node:assert/strict');
const profile = process.env.AROUNDG_STOCK_TEST_PROFILE;
app.setPath('userData', profile);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});
const timer = setTimeout(() => app.exit(1), 30000);
const section = (source, start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a); return source.slice(a, b);
};
app.whenReady().then(async () => {
  const root = resolve(__dirname, '../..');
  const columns = await import(pathToFileURL(resolve(root, 'services/poizon-xlsx.mjs')));
  const sales = await import(pathToFileURL(resolve(root, 'services/poizon-sales-filter.mjs')));
  const sheet = [['SPU ID', '상품 번호', '상품명', 'SKU ID', '중국 총 판매량', '현지 판매자 총 판매량'],
    ...[5, 16, 15, 8, 5, '<5', '<5', '--'].map((n, i) => ['A', '54053401001', '사이즈 합계', `A-${i}`, 20, n]),
    ...[13, 17, 14, 26].map((n, i) => ['B', '85082354477', '사이즈 합계', `B-${i}`, 30, n]),
    ...Array.from({ length: 7 }, (_, i) => ['C', 'UNCERTAIN', '미확정 수량', `C-${i}`, 10, '<5']),
  ];
  const context = createContext({ ...columns, ...sales, basename, excelPreviewCache: new Map(),
    stat: async () => ({ size: 100, mtimeMs: 1 }), readFile: async () => sheet,
    readFirstDataSheet: async (value) => value,
  });
  runInContext(section(readFileSync(resolve(root, 'main.mjs'), 'utf8'), 'function excelPreviewCell(', 'async function scanBrandExportFolder('), context);
  ipcMain.handle('sales-fixture-preview', (_event, minimumLocalTotal) => context.previewExcelFile({
    path: '/fixture.xlsx', limit: 100000,
    filters: { productView: true, productSales: true, selectionOnly: true, minimumLocalTotal },
  }));
  const preload = resolve(profile, 'sales-preload.cjs');
  writeFileSync(preload, `require('electron').contextBridge.exposeInMainWorld('salesFixture', {read: n => require('electron').ipcRenderer.invoke('sales-fixture-preview', n)});`);
  const win = new BrowserWindow({ show: false, width: 1200, height: 800,
    webPreferences: { preload, sandbox: true, backgroundThrottling: false } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8">
      <label>현지 최소 판매량 <input id="minimum" value="25"></label><button id="apply">필터 적용</button>
      <output id="count"></output><table><thead id="excel-preview-columns"></thead><tbody id="excel-preview-rows"></tbody></table>`));
    const renderer = readFileSync(resolve(root, 'src/renderer.js'), 'utf8');
    await win.webContents.executeJavaScript(`
      const $ = s => document.querySelector(s);
      const text = v => String(v ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
      const money = String, brandImportPathKey = v => String(v || '').toLowerCase();
      const excelPreviewStableSelectionKey = p => p._excelSelectionKey;
      const excelPreviewProductCache = new Map(), excelPreviewSearchResults = new Map();
      let combinedBrandPreview = {salesBasis:'total'};
      ${section(renderer, 'function combinedProductSalesLabels(', '// Plain Excel inspection')}
      async function filter() {
        const result = await window.salesFixture.read($('#minimum').value);
        const products = mergeDomesticSearchProducts(result.products, {path:'/fixture.xlsx'});
        renderVerifiedSpuRows({}, products);
        $('#count').textContent = products.length;
        window.completedFilters = (window.completedFilters || 0) + 1;
      }
      $('#apply').onclick = filter;
      filter();
    `);
    const waitFor = async (n) => {
      for (let i = 0; i < 100; i++) {
        if (await win.webContents.executeJavaScript(`window.completedFilters >= ${n}`)) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw Error('filter did not complete');
    };
    const visible = () => win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.excel-product-row')).map(r=>({article:r.cells[2].querySelector('b').textContent,local:r.cells[7].textContent,options:r.querySelector('details').textContent}))`);
    await waitFor(1);
    let rows = await visible();
    assert.deepEqual(rows.map((r) => [r.article, r.local]), [['54053401001', '49+'], ['85082354477', '70']]);
    assert.match(rows[0].options, /원본 현지 총판매 16/);
    assert.match(rows[0].options, /원본 현지 총판매 <5/);
    assert.match(rows[0].options, /원본 현지 총판매 --/);
    await win.webContents.executeJavaScript(`$('#minimum').focus();$('#minimum').select()`);
    await win.webContents.insertText('60');
    const point = await win.webContents.executeJavaScript(`(()=>{const r=$('#apply').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    await waitFor(2);
    rows = await visible();
    assert.deepEqual(rows.map((r) => [r.article, r.local]), [['85082354477', '70']]);
    console.log(JSON.stringify({ offline: true, minimum25Products: 2, minimum60Products: 1, partialSum: '49+', uncertainSumExcluded: true, rawOptionsPreserved: true, nativeFilterClick: true }));
  } finally { win.destroy(); ipcMain.removeHandler('sales-fixture-preview'); }
  clearTimeout(timer); app.exit(0);
}).catch((error) => { console.error(error.stack); clearTimeout(timer); app.exit(1); });
