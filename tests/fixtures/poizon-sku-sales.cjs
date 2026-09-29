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
  const sheet = require('./ecco-original-sales.cjs');
  const context = createContext({ ...columns, ...sales, basename, excelPreviewCache: new Map(),
    stat: async () => ({ size: 100, mtimeMs: 1 }), readFile: async () => sheet,
    readFirstDataSheet: async (value) => value,
  });
  runInContext(section(readFileSync(resolve(root, 'main.mjs'), 'utf8'), 'function excelPreviewCell(', 'async function scanBrandExportFolder('), context);
  ipcMain.handle('sales-fixture-preview', (_event, filters) => context.previewExcelFile({
    path: '/fixture.xlsx', limit: 100000,
    filters: { productView: true, productSales: true, originalRowView: true, selectionOnly: true, ...filters },
  }));
  const preload = resolve(profile, 'sales-preload.cjs');
  writeFileSync(preload, `require('electron').contextBridge.exposeInMainWorld('salesFixture', {read: n => require('electron').ipcRenderer.invoke('sales-fixture-preview', n)});`);
  const win = new BrowserWindow({ show: false, width: 1200, height: 800,
    webPreferences: { preload, sandbox: true, backgroundThrottling: false } });
  try {
    const css = ['style.css','excel-column-layout.css','domestic-inline-results.css'].map(name=>readFileSync(resolve(root,'src',name),'utf8')).join('\n');
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8">
      <style>${css}</style><body style="display:block;padding:24px"><label>중국 최소 판매량 <input id="china" type="number" value=""></label><label>현지 최소 판매량 <input id="minimum" type="number" value="25"></label><button id="apply">필터 적용</button>
      <output id="count"></output><section id="excel-preview" class="product-view"><div id="excel-preview-grid" class="excel-preview-grid"><table><thead id="excel-preview-columns"></thead><tbody id="excel-preview-rows"></tbody></table></div></section>`));
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
        const result = await window.salesFixture.read({minimumTotal:$('#china').value, minimumLocalTotal:$('#minimum').value});
        const products = mergeDomesticSearchProducts(result.products, {path:'/fixture.xlsx'});
        combinedBrandPreview.originalColumns = originalExcelColumns([{originalRow:{headers:result.headers}}]);
        renderOriginalExcelRows({}, products);
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

    const visible = () => win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.excel-source-row')).map(r=>({source:Number(r.dataset.sourceRow),values:Array.from(r.querySelectorAll('.excel-source-value'),e=>e.textContent),key:r.querySelector('input').dataset.excelProductSelect}))`);
    await waitFor(1);
    let rows = await visible();
    assert.deepEqual(rows.map(r=>r.values[5]), ['49','48','54','50','26']);
    assert.deepEqual(rows.map(r=>r.values[4]), ['70','70','78','57','31']);
    for (const row of rows) assert.deepEqual(row.values,sheet[row.source-1].map(String));
    assert.equal(new Set(rows.map(r=>r.key)).size,5);
    const layout = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.excel-source-row')).flatMap(row=>Array.from(row.querySelectorAll('.excel-source-value'),e=>{const r=e.getBoundingClientRect(), cell=e.parentElement.getBoundingClientRect();return {inside:r.top>=cell.top&&r.bottom<=cell.bottom,width:r.width}}))`);
    assert.ok(layout.length === 35 && layout.every(e=>e.inside && e.width>0), JSON.stringify(layout));
    const apply = async (china, local, n) => {
      for (const [id, value] of [['china',china],['minimum',local]]) {
        await win.webContents.executeJavaScript(`document.getElementById('${id}').focus();document.getElementById('${id}').select()`);
        if (value) await win.webContents.insertText(value);
        else win.webContents.delete();
        // Editing commands work in a hidden test window; unfocused keyboard
        // events may be ignored. Confirm the actual input before clicking.
        assert.equal(await win.webContents.executeJavaScript(`document.getElementById('${id}').value`), value);
      }
      const point = await win.webContents.executeJavaScript(`(()=>{const r=$('#apply').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})`+'()');
      win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
      win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
      await waitFor(n);
    };
    await apply('', '30', 2);
    rows = await visible();
    assert.deepEqual(rows.map(r=>r.values[5]), ['49','48','54','50']);
    await apply('100', '25', 3);
    assert.equal((await visible()).length, 0);
    await apply('', '', 4);
    rows = await visible();
    assert.equal(rows.length, 28);
    assert.deepEqual(rows.map(r=>r.values),sheet.slice(1).map(row=>row.map(String)));
    console.log(JSON.stringify({offline:true,minimum25Rows:5,matchingValues:[49,48,54,50,26],minimum30Rows:4,china100Local25Rows:0,showAllRows:28,allSourceCellsPreserved:true,separateRowKeys:true,cellsUnclipped:true,nativeFilterClick:true}));
  } finally { win.destroy(); ipcMain.removeHandler('sales-fixture-preview'); }
  clearTimeout(timer); app.exit(0);
}).catch((error) => { console.error(error.stack); clearTimeout(timer); app.exit(1); });
