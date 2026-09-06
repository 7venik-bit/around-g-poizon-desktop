const { app, BrowserWindow } = require('electron');
const { join } = require('node:path');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
const fail = (error) => { console.error(error?.stack || String(error)); app.exit(1); };
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width:780, height:800, show:false, webPreferences:{ contextIsolation:true, nodeIntegration:false, sandbox:true } });
  await win.loadFile(join(__dirname, 'poizon-review-smoke.html'));
  const result = await win.webContents.executeJavaScript(`(async () => {
    const { beginLiveVerification } = await import('../../src/poizon-review-workspace.js');
    const { createPageCrossCheck } = await import('../../services/live-poizon-crosscheck.mjs');
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const original = (id, local) => ({ spuId:String(id), articleNumber:'ITEM-' + id, title:'실제 원본 상품 ' + id,
      sourceRowNumber:id + 1, sales30dRaw:'100', localSales30dRaw:String(local), salesScope:'spu', hasSalesData:true, hasLocalSalesData:true,
      sourceValues:[String(id), '원본 옵션', '40'] });
    const before = Array.from({ length:50 }, (_, i) => original(i + 1, 10));
    let listener, removed = 0, ended = 0;
    const view = beginLiveVerification({ file:{ path:'test.xlsx', name:'test.xlsx' }, brandName:'TEST',
      snapshot:{ products:before, headers:['SPU ID','옵션','현지 총판매량(원본)'] }, conditions:{ minimumLocalSales30:999 },
      api:{ onSellerVerificationProgress:(fn) => { listener = fn; return () => removed++; }, endSellerExcelVerification:async()=>{ ended++; } } });
    const sources = before.slice().reverse().map((p) => ({ ...p, localSales30dRaw:p.spuId === '50' ? '10' : '83' }));
    const page = createPageCrossCheck(view.input).acceptPage(sources, { pageNum:1, pageCount:1 });
    listener(page); await wait(150);
    const panel = document.getElementById('poizon-review-workspace');
    const rows = panel.querySelectorAll('.review-table > tbody > tr[data-review-key]');
    check(rows.length === 50, 'all non-qualifying products must be visible');
    check(rows[0].dataset.reviewKey === 'SPU:50' && rows[49].dataset.reviewKey === 'SPU:1', 'source order is not preserved');
    check(getComputedStyle(rows[0]).backgroundColor === 'rgb(234, 247, 239)', 'equal color missing under CSP');
    check(getComputedStyle(rows[1]).backgroundColor === 'rgb(255, 243, 223)', 'different color missing under CSP');
    check(getComputedStyle(document.querySelector('.shell')).display === 'none', 'old header/filters remain visible');
    check(panel.querySelectorAll('input[type=number]').length === 0, 'duplicate conditions in live view');
    check(panel.querySelector('.review-table-scroll').clientHeight > 100, 'comparison list has no visible height');
    check(panel.querySelector('.review-table-scroll').scrollTop > 0, 'automatic follow did not scroll the list');
    listener({ ...page, runId:'stale', checkedProducts:9999, rows:[] });
    check(!panel.querySelector('.review-counters').textContent.includes('9999'), 'stale run changed current rows');
    const detail = rows[0].querySelector('details'); detail.open = true; await wait(50);
    check(detail.textContent.includes('40') && detail.textContent.includes('현지 총판매량(원본)'), 'original row values missing');
    check(!document.getElementById('poizon-review-report'), 'notification must not open on a page event');
    view.finish({ ok:true, manualReview:true });
    check(removed === 1 && !view.running, 'listener not disposed');
    view.showReport({ complete:true, files:[{ file:'test.xlsx', complete:true, changes:[], summary:{checked:50,equal:1,different:49,unknown:0,missing:0,absentRows:0} }] });
    const dialog = document.getElementById('poizon-review-report');
    check(dialog.open && dialog.querySelector('textarea').value.includes('원본 Excel 자동 수정 없음'), 'final copyable report missing');
    dialog.close(); panel.querySelector('.review-close').click(); await wait(25);
    check(ended === 1 && !document.body.classList.contains('poizon-review-open'), 'review layout not restored');
    return { rows:50, sourceOrder:true, colors:true, originalValues:true, finalDialog:true, restored:true };
  })()`);
  console.log('REVIEW_BROWSER_SMOKE_OK ' + JSON.stringify(result));
  win.destroy(); app.exit(0);
}).catch(fail);
