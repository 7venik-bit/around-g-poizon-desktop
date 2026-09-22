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
  if([...data.querySelectorAll('td')].some(cell=>getComputedStyle(cell).textAlign!=='center'))errors.push('cells are not centered');
  if(q('#original-ledger-workbook > #workbook-cell-editor'))errors.push('separate editor returned');
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
    const selected=await win.webContents.executeJavaScript(`(()=>{document.querySelectorAll('#workbook-table tbody tr')[2].children[2].dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return {address:document.getElementById('workbook-selection').textContent,value:document.getElementById('workbook-cell-value').value,writes:window.ledgerFixtureWrites};})()`);
    if(selected.address!=='B3'||selected.value!==ledgerLayoutBook().sheets[0].displayValues[2][1]||selected.writes!==0)throw Error('Original link edit identity lost');
  }
  const recordedBook=ledgerLayoutBook(30),recordedSheet=recordedBook.sheets[0];
  for(const key of ['displayValues','formulas','rawValues','notes','backgrounds','fontColors','fontWeights']) {
    const sample=recordedSheet[key][2];
    recordedSheet[key]=recordedSheet[key].slice(0,2);
    while(recordedSheet[key].length<600)recordedSheet[key].push(sample.map(()=>key==='rawValues'?{type:'text',value:''}:''));
    for(let row=574;row<=576;row++)recordedSheet[key][row]=structuredClone(sample);
  }
  recordedSheet.rowCount=1002;
  await win.webContents.executeJavaScript(`window.ledgerFixtureFreshBook=${JSON.stringify(recordedBook)};window.ledgerFixtureReads=0;
window.aroundG.loadLedgerWorkbook=async()=>{window.ledgerFixtureReads++;return {ok:true,workbook:window.ledgerFixtureFreshBook};};
document.getElementById('workbook-cell-value').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
  win.setContentSize(1426,1032);win.webContents.setZoomFactor(1);await new Promise(resolve=>setTimeout(resolve,200));
  const location=await win.webContents.executeJavaScript('window.aroundGLedgerWorkbook.showRecordedRows([575,576,577])');
  if(!location.ok)throw Error('Recorded row navigation failed');
  await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const position=await win.webContents.executeJavaScript(`(()=>{
    const host=document.getElementById('workbook-table'),rows=[...host.querySelectorAll('.workbook-recorded-row')];
    const h=host.getBoundingClientRect(),first=rows[0]?.getBoundingClientRect(),last=rows.at(-1)?.getBoundingClientRect();
    return {rows:rows.map(row=>row.dataset.rowNumber),page:document.getElementById('workbook-page').textContent,
      visible:first?.top>=h.top+26 && last?.bottom<=h.bottom && h.bottom<=innerHeight,
      reads:window.ledgerFixtureReads,writes:window.ledgerFixtureWrites};
  })()`);
  if(position.rows.join(',')!=='575,576,577'||!position.page.includes('501–600')||!position.visible||position.reads!==1||position.writes!==0)
    throw Error('Recorded rows not visible: '+JSON.stringify(position));
  await writeFile(join(out,'ledger-record-location.png'),(await win.webContents.capturePage()).toPNG());
  await writeFile(join(out,'ledger-record-location.json'),JSON.stringify(position,null,2));
  await writeFile(join(out,'ledger-results.json'),JSON.stringify(results,null,2));
  const failed=results.filter(result=>result.errors.length);if(failed.length)throw Error(JSON.stringify(failed));
  console.log('PASS: 18 production-CSP ledger layouts; readable original values including bold long codes and 30 columns, compact rows, contained scrolling, aligned checkbox and sticky headings.');
  console.log('PASS: Freshly read purchase rows 575–577 are highlighted and visible on page 501–600 without another write.');
  // Exercise pointer/keyboard handlers and actual Chromium geometry with a disposable bridge.
  await win.webContents.executeJavaScript(`window.ledgerToolCalls=[];
window.aroundG.resizeLedgerWorkbook=async input=>{window.ledgerToolCalls.push({action:'resize',...input});const book=structuredClone(window.ledgerFixtureFreshBook),sheet=book.sheets[0];for(const change of input.changes)(sheet[change.axis==='column'?'columnWidths':'rowHeights']||={})[change.index]=change.pixels;window.ledgerFixtureFreshBook=book;return {ok:true,workbook:book};};
window.aroundG.copyLedgerWorkbookCells=async input=>{window.ledgerToolCalls.push({action:'copy',...input});return {ok:true};};
window.aroundG.clearLedgerWorkbookCells=async input=>{window.ledgerToolCalls.push({action:'clear',...input});return {ok:true,workbook:window.ledgerFixtureFreshBook};};void 0;`);
  const drag=async(selector,axis,delta)=>{
    const box=await win.webContents.executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
    await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new PointerEvent('pointerdown',{button:0,clientX:${box.x},clientY:${box.y},bubbles:true,cancelable:true}));window.dispatchEvent(new PointerEvent('pointermove',{clientX:${box.x+(axis==='x'?delta:0)},clientY:${box.y+(axis==='y'?delta:0)}}));window.dispatchEvent(new PointerEvent('pointerup',{clientX:${box.x+(axis==='x'?delta:0)},clientY:${box.y+(axis==='y'?delta:0)}}));`);
    await new Promise(resolve=>setTimeout(resolve,250));
  };
  await drag('#workbook-table thead th:nth-child(3) .workbook-column-resize','x',70);
  await drag('#workbook-table tr[data-row-number="575"] .workbook-row-resize','y',36);
  const resized=await win.webContents.executeJavaScript(`(()=>{const calls=window.ledgerToolCalls.filter(c=>c.action==='resize'),column=document.querySelector('#workbook-table thead th:nth-child(3)').getBoundingClientRect(),row=document.querySelector('#workbook-table tr[data-row-number="575"]').getBoundingClientRect();return {calls,column:column.width,row:row.height};})()`);
  if(resized.calls.length!==2||Math.abs(resized.column-resized.calls[0].changes[0].pixels)>1||Math.abs(resized.row-resized.calls[1].changes[0].pixels)>1)throw Error('Drag dimensions not saved/rendered: '+JSON.stringify(resized));
  await win.webContents.executeJavaScript(`document.querySelector('#workbook-table td[data-row="575"][data-column="2"]').click();document.querySelector('#workbook-table td[data-row="576"][data-column="3"]').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));`);
  await win.webContents.executeJavaScript(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'c',ctrlKey:true,bubbles:true,cancelable:true}));`);
  await new Promise(resolve=>setTimeout(resolve,150));
  await win.webContents.executeJavaScript(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true}));`);
  await new Promise(resolve=>setTimeout(resolve,150));
  const toolCalls=await win.webContents.executeJavaScript('window.ledgerToolCalls');
  if(toolCalls.filter(c=>c.action==='copy').length!==1||toolCalls.filter(c=>c.action==='clear').length!==1||toolCalls.at(-1).range.endRow!==576||toolCalls.at(-1).range.endColumn!==3)throw Error('Grid shortcuts lost selected range: '+JSON.stringify(toolCalls));
  await writeFile(join(out,'ledger-cell-tools.png'),(await win.webContents.capturePage()).toPNG());
  await writeFile(join(out,'ledger-cell-tools.json'),JSON.stringify({resized,toolCalls},null,2));
  console.log('PASS: Pointer column/row resizing and range copy/delete shortcuts preserve the selected coordinates and rendered sizes.');
  const destination=await win.webContents.executeJavaScript(`(()=>{
    const q=s=>document.querySelector(s),api=window.aroundGLedgerWorkbook;
    while(!q('#workbook-prev').disabled)q('#workbook-prev').click();
    q('td[data-row="42"][data-column="1"]').click();
    const selected=api.getPurchaseDestination(),label=q('#ledger-destination').textContent;
    const locked=api.beginPurchaseRecord();q('td[data-row="43"][data-column="1"]').click();
    const blocked=api.getPurchaseDestination().code,editorDisabled=q('#workbook-cell-clear').disabled;
    api.endPurchaseRecord(false);const restored=api.getPurchaseDestination();
    return {selected,label,locked,blocked,editorDisabled,restored};
  })()`);
  if(destination.selected.destination?.row!==42||destination.locked.destination?.row!==42||destination.restored.destination?.row!==42||destination.blocked!=='WORKBOOK_BUSY'||!destination.editorDisabled||!destination.label.includes('42행'))throw Error('Selected purchase destination lost: '+JSON.stringify(destination));
  await writeFile(join(out,'ledger-selected-row.json'),JSON.stringify(destination,null,2));
  console.log('PASS: The clicked purchase row is shown as row 42 and remains locked during recording, then restores on failure.');
  await win.webContents.executeJavaScript(`
    window.ledgerInlineWrites=[];
    window.ledgerFixtureFreshBook.sheets[0].rawValues[41][9]={type:'number',value:'75000'};
    window.ledgerFixtureFreshBook.sheets[0].displayValues[41][9]='75000';
    window.aroundG.editLedgerWorkbookCell=async edit=>{
      window.ledgerInlineWrites.push(edit);const book=structuredClone(window.ledgerFixtureFreshBook),sheet=book.sheets[0];book.revision+='x';
      sheet.rawValues[edit.row-1][edit.column-1]=edit.next;sheet.displayValues[edit.row-1][edit.column-1]=edit.next.value;
      window.ledgerFixtureFreshBook=book;return {ok:true,workbook:book};
    };
    document.getElementById('workbook-import').click();`);
  await new Promise(resolve=>setTimeout(resolve,150));
  const inline=await win.webContents.executeJavaScript(`(()=>{
    const cell=document.querySelector('td[data-row="42"][data-column="10"]');cell.scrollIntoView({block:'center'});cell.click();
    const value=cell.textContent;cell.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    const input=document.getElementById('workbook-cell-value'),a=cell.getBoundingClientRect(),b=input.getBoundingClientRect();
    return {value,raw:input.value,inside:input.closest('td')===cell&&Math.abs(a.width-b.width)<3&&Math.abs(a.height-b.height)<3,center:getComputedStyle(input).textAlign};
  })()`);
  if(inline.value!=='₩75,000'||inline.raw!=='75000'||!inline.inside||inline.center!=='center')throw Error('Inline editor or won display failed: '+JSON.stringify(inline));
  await writeFile(join(out,'ledger-inline-edit.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.getElementById('workbook-cell-value').select();`);
  await win.webContents.insertText('76000');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
  await new Promise(resolve=>setTimeout(resolve,150));
  const committed=await win.webContents.executeJavaScript(`({writes:window.ledgerInlineWrites,value:document.querySelector('td[data-row="42"][data-column="10"]').textContent,selected:document.getElementById('workbook-selection').textContent,editor:!!document.getElementById('workbook-cell-editor')})`);
  if(committed.writes.length!==1||committed.writes[0].next.type!=='number'||committed.writes[0].next.value!=='76000'||committed.value!=='₩76,000'||committed.selected!=='K42'||committed.editor)throw Error('Native Tab did not save the inline edit: '+JSON.stringify(committed));
  await writeFile(join(out,'ledger-inline-edit.json'),JSON.stringify({inline,committed},null,2));
  console.log('PASS: The editor stays inside J42, native typing and Tab save numeric 76000 once, show ₩76,000 and select K42.');
  await cleanup();app.exit(0);
})().catch(async error=>{console.error(error.stack||error);await cleanup();app.exit(1);});
