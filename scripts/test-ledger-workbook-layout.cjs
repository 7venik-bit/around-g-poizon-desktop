// Offline geometry checks using the production page, stylesheet and renderer.
const {app,BrowserWindow,session}=require('electron');
const {readFile,writeFile,mkdir,rm}=require('node:fs/promises');
const {join,resolve}=require('node:path');
const {ledgerLayoutBook}=require('../tests/fixtures/ledger-layout-data.cjs');
const root=resolve(__dirname,'..'),out=join(root,'layout-artifacts');
const fixture=join(root,'src','.ledger-layout-fixture.html'),bootstrap=join(root,'src','.ledger-layout-bootstrap.js');
app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
let win;
const deadline=setTimeout(()=>{console.error('Ledger layout timed out');app.exit(1);},60000);
function measure() {
  const q=s=>document.querySelector(s),errors=[];
  const host=q('#workbook-table'),table=host.querySelector('table'),rows=[...table.querySelectorAll('tbody tr')];
  const box=e=>e.getBoundingClientRect();
  if(document.documentElement.scrollWidth>innerWidth+1)errors.push('page has horizontal overflow');
  if(getComputedStyle(host).overflowX!=='auto'||getComputedStyle(host).overflowY!=='auto')errors.push('ledger scroll is not contained');
  if(innerWidth>=1920&&window.ledgerFixtureBook.sheets[0].columnCount===20&&table.scrollWidth>host.clientWidth+1)errors.push('ledger does not fit desktop width');
  if(innerWidth<=1426&&window.ledgerFixtureBook.sheets[0].columnCount===30&&table.scrollWidth<=host.clientWidth)errors.push('wide original ledger squeezed instead of scrolling');
  if(rows.length!==100||rows.some(row=>row.children.length!==window.ledgerFixtureBook.sheets[0].columnCount+1))errors.push('original cells or rows missing');
  const data=rows[2],link=data.children[2],article=data.children[3],model=data.children[4],gender=data.children[5];
  if(innerWidth>=1920&&window.ledgerFixtureBook.sheets[0].columnCount===30&&box(data.children[22]).right>box(host).right-12)errors.push('used ledger columns do not fit the large screen');
  if(box(model).width<=box(article).width||box(article).width<=box(gender).width)errors.push('equal-width columns returned');
  if(box(data).height>56)errors.push('URL or model inflates row height');
  if(getComputedStyle(link.firstChild).whiteSpace!=='nowrap'||getComputedStyle(link.firstChild).textOverflow!=='ellipsis')errors.push('link is not compact');
  if(link.title!==window.ledgerFixtureBook.sheets[0].displayValues[2][1])errors.push('full URL tooltip lost');
  if(getComputedStyle(model.firstChild).webkitLineClamp!=='2')errors.push('model is not bounded to two lines');
  for(const cell of data.querySelectorAll('[data-column-kind="money"],[data-column-kind="code"],[data-column-kind="status"],[data-column-kind="brand"],[data-column-kind="percent"]')) {
    if(cell.firstChild.scrollWidth>cell.firstChild.clientWidth+1)errors.push('important value clipped: '+cell.dataset.columnKind);
  }
  if(getComputedStyle(data.children[10]).backgroundColor!=='rgb(255, 230, 153)')errors.push('source cell colour changed');
  const toggle=q('.workbook-hidden-toggle'),checkbox=q('#workbook-hidden'),a=box(toggle),b=box(checkbox);
  if(b.width>18||b.left<a.left||Math.abs((a.top+a.height/2)-(b.top+b.height/2))>2||a.width>250)errors.push('checkbox detached from its label');
  const h=box(host),letters=box(table.querySelector('thead th')),head=box(table.querySelector('.workbook-data-header td'));
  if(Math.abs(letters.top-h.top-1)>1||Math.abs(head.top-letters.bottom)>1)errors.push('column headings not sticky');
  if(Math.abs(box(table.querySelector('.workbook-data-header th')).top-head.top)>1)errors.push('sticky header row number lost');
  if(window.ledgerFixtureWrites!==0)errors.push('layout triggered a workbook write');
  return {viewport:innerWidth,columns:window.ledgerFixtureBook.sheets[0].columnCount,rowHeight:box(data).height,tableWidth:box(table).width,hostWidth:host.clientWidth,modelWidth:box(model).width,articleWidth:box(article).width,errors};
}
async function cleanup(){clearTimeout(deadline);if(win&&!win.isDestroyed())win.destroy();await Promise.all([fixture,bootstrap].map(path=>rm(path,{force:true})));}
(async()=>{
  await app.whenReady();await mkdir(out,{recursive:true});
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}));
  const html=(await readFile(join(root,'src/index.html'),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  await writeFile(fixture,html.replace('</body>','<script src=".ledger-layout-bootstrap.js"></script><script src="ledger-workbook.js"></script></body>'));
  win=new BrowserWindow({show:false,width:1920,height:1032,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,offscreen:true,backgroundThrottling:false}});
  const results=[];
  for(const count of [20,26,30]) {
    await writeFile(bootstrap,`document.querySelectorAll('.view').forEach(el=>el.classList.remove('active'));
document.getElementById('ledger').classList.add('active');document.getElementById('purchase-ledger-form').hidden=true;
document.querySelector('.nav.active').classList.remove('active');document.querySelector('[data-view="ledger"]').classList.add('active');
window.ledgerFixtureBook=${JSON.stringify(ledgerLayoutBook(count))};window.ledgerFixtureWrites=0;
window.aroundG={loadLedgerWorkbook:async()=>({ok:true,workbook:window.ledgerFixtureBook}),editLedgerWorkbookCell:async()=>{window.ledgerFixtureWrites++;throw Error('No workbook writes allowed');}};`);
    await win.loadFile(fixture);await win.webContents.executeJavaScript('document.fonts.ready');
    for(const width of [980,1426,1920])for(const scale of [1,1.25]) {
      win.setContentSize(width,1032);await new Promise(resolve=>setTimeout(resolve,120));
      // Native resize and Chromium zoom settle asynchronously on Windows.
      // Require the requested CSS viewport, not just a successful set call.
      let viewport=0;
      for(let attempt=0;attempt<20;attempt++) {
        win.webContents.setZoomFactor(scale);await new Promise(resolve=>setTimeout(resolve,60));
        viewport=await win.webContents.executeJavaScript('innerWidth');
        if(Math.abs(viewport-width/scale)<=1)break;
      }
      if(Math.abs(viewport-width/scale)>1)throw Error('Requested ledger viewport did not settle');
      await win.webContents.executeJavaScript('document.getElementById("workbook-table").scrollTop=200');
      await new Promise(resolve=>setTimeout(resolve,30));
      results.push({width,scale,...await win.webContents.executeJavaScript('('+measure.toString()+')()')});
      await win.webContents.executeJavaScript('document.getElementById("workbook-table").scrollTop=0');
      win.webContents.invalidate();
      await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await new Promise(resolve=>setTimeout(resolve,120));
      if(count===20&&scale===1&&[1426,1920].includes(width))await writeFile(join(out,'ledger-screen-fit-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
      if(count===30&&width===1920&&scale===1)await writeFile(join(out,'ledger-readable-30-columns.png'),(await win.webContents.capturePage()).toPNG());
    }
    const selected=await win.webContents.executeJavaScript(`(()=>{document.querySelectorAll('#workbook-table tbody tr')[2].children[2].click();return {address:document.getElementById('workbook-cell-address').textContent,value:document.getElementById('workbook-cell-value').value,writes:window.ledgerFixtureWrites};})()`);
    if(selected.address!=='1-구매완료 · B3'||selected.value!==ledgerLayoutBook().sheets[0].displayValues[2][1]||selected.writes!==0)throw Error('Original link edit identity lost');
  }
  await writeFile(join(out,'ledger-results.json'),JSON.stringify(results,null,2));
  const failed=results.filter(result=>result.errors.length);if(failed.length)throw Error(JSON.stringify(failed));
  console.log('PASS: 18 production-CSP ledger layouts; readable original values including bold long codes and 30 columns, compact rows, contained scrolling, aligned checkbox and sticky headings.');
  await cleanup();app.exit(0);
})().catch(async error=>{console.error(error.stack||error);await cleanup();app.exit(1);});
