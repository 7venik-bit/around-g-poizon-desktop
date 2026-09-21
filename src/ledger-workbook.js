(() => {
  const $ = id => document.getElementById(id);
  if (!$('original-ledger-workbook')) return;
  let workbook, active, page = 0, busy = false;
  const messages = {
    WORKBOOK_NOT_IMPORTED:'아직 가져온 장부가 없습니다.',
    WORKBOOK_BRIDGE_UPDATE_REQUIRED:'Google 장부 연결 스크립트 업데이트가 필요합니다. 원본은 변경되지 않았습니다.',
    LEDGER_NOT_CONNECTED:'연동관리에서 Google 구매장부 연결을 먼저 확인해 주세요.',
    WORKBOOK_CHANGED_DURING_READ:'가져오는 동안 원본이 변경됐습니다. 다시 가져와 주세요.',
    WORKBOOK_EXPORT_CHECKSUM_FAILED:'엑셀 데이터 검증 실패: 기존 장부를 유지합니다.',
    WORKBOOK_READ_FAILED:'저장된 원본 장부를 읽지 못했습니다. 기존 파일은 유지됩니다.'
  };
  const status = value => { $('workbook-status').textContent = value; };
  const visible = () => (workbook?.sheets || []).filter(s => !s.hidden || $('workbook-hidden').checked);
  function tabs() {
    const sheets = visible();
    if (!sheets.some(s => s.id === active)) active = sheets[0]?.id;
    $('workbook-tabs').replaceChildren(...sheets.map(s => {
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = s.name + (s.hidden ? ' (숨김)' : '');
      button.setAttribute('role','tab'); button.setAttribute('aria-selected',String(s.id === active));
      button.addEventListener('click',() => {active=s.id;page=0;tabs();render();});
      return button;
    }));
  }
  function render() {
    const sheet = visible().find(s => s.id === active);
    const host = $('workbook-table'); host.replaceChildren();
    if (!sheet) return;
    const rows = sheet.displayValues, start = page * 100, end = Math.min(rows.length,start+100);
    const table = document.createElement('table');table.style.cssText='border-collapse:collapse;white-space:pre-wrap;font-size:13px';
    table.setAttribute('aria-label',sheet.name);
    for(let r=start;r<end;r++) {
      const tr=document.createElement('tr'), label=document.createElement('th');label.textContent=String(r+1);tr.append(label);
      for(let c=0;c<rows[r].length;c++) {
        const cell=document.createElement('td');cell.textContent=rows[r][c];
        cell.style.cssText='border:1px solid #ddd;padding:6px;min-width:80px;max-width:320px;overflow-wrap:anywhere';
        cell.style.backgroundColor=sheet.backgrounds?.[r]?.[c] || '';
        cell.style.color=sheet.fontColors?.[r]?.[c] || '';
        cell.style.fontWeight=sheet.fontWeights?.[r]?.[c] || '';
        cell.title=[sheet.formulas[r][c],sheet.notes?.[r]?.[c]].filter(Boolean).join('\n');
        // Use textContent: sheet text and formulas must never execute in the app.
        tr.append(cell);
      }
      table.append(tr);
    }
    host.append(table);
    $('workbook-page').textContent=` ${start+1}–${end} / ${rows.length}행 `;
    $('workbook-prev').disabled=page===0;
    $('workbook-next').disabled=end>=rows.length;
  }
  function accept(book) {
    workbook=book;active=undefined;page=0;tabs();render();$('workbook-export').disabled=false;
    status(`${book.title} · ${book.sheets.length}개 시트 · 가져온 시각 ${book.capturedAt} · 원본 표시값 유지 (금액·수식 정확성 검증과 별도)`);
  }
  async function run(fn) {
    if(busy)return;busy=true;$('workbook-import').disabled=true;$('workbook-export').disabled=true;
    try { await fn(); } catch {status('장부 처리에 실패했습니다. 다시 시도해 주세요.');}
    finally {busy=false;$('workbook-import').disabled=false;$('workbook-export').disabled=!workbook;}
  }
  $('workbook-import').addEventListener('click',()=>run(async()=>{
    status('전체 시트와 엑셀을 가져오는 중입니다.');
    const result=await window.aroundG.importLedgerWorkbook();
    if(result.ok)accept(result.workbook);else status(messages[result.code] || `가져오기 실패: ${result.code || '알 수 없는 오류'}`);
  }));
  $('workbook-export').addEventListener('click',()=>run(async()=>{
    const result=await window.aroundG.exportLedgerWorkbook();
    if(result.ok)status('엑셀 내보내기 완료. 가져온 시점의 파일과 바이트 단위로 일치합니다.');
    else if(!result.canceled)status(messages[result.code] || '엑셀 내보내기에 실패했습니다.');
  }));
  $('workbook-hidden').addEventListener('change',()=>{page=0;tabs();render();});
  $('workbook-prev').addEventListener('click',()=>{if(page>0){page--;render();}});
  $('workbook-next').addEventListener('click',()=>{page++;render();});
  run(async()=>{const result=await window.aroundG.loadLedgerWorkbook();if(result.ok)accept(result.workbook);else status(messages[result.code] || '장부를 불러오지 못했습니다.');});
})();
