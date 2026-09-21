(() => {
  const $ = id => document.getElementById(id);
  if (!$('original-ledger-workbook')) return;
  let workbook, active, selected, page = 0, busy = false, needsRefresh = false;
  const messages = {
    CELL_CONFLICT:'원본이 다른 곳에서 변경됐습니다. 다시 가져온 뒤 수정해 주세요.',
    CELL_PROTECTED:'보호된 셀이라 편집할 수 없습니다.',
    CELL_MERGED:'병합된 셀의 왼쪽 위 셀을 선택해 주세요.',
    CELL_NUMBER_INVALID:'금액·수량은 통화 기호와 쉼표 없이 숫자만 입력해 주세요. 최대 15자리입니다.',
    CELL_DATE_INVALID:'날짜를 YYYY-MM-DD 형식으로 확인해 주세요.',
    CELL_VALIDATION_REVIEW:'이 셀의 입력 규칙은 프로그램에서 확인할 수 없습니다. Google 시트에서 편집해 주세요.',
    CELL_VALIDATION_FAILED:'시트에 지정된 허용 값과 맞지 않습니다.',
    CELL_SAVED_REFRESH_REQUIRED:'Google 저장 후 전체 장부를 다시 가져오지 못했습니다. 다시 가져와 저장 내용을 확인해 주세요.',
    CELL_WRITE_VERIFY_FAILED:'저장 결과가 입력값과 다릅니다. 다시 가져와 확인해 주세요.',
    WORKBOOK_REFRESH_REQUIRED:'저장 결과 확인이 필요합니다. Google 장부를 다시 가져온 뒤 편집·내보내기를 이용해 주세요.',
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
  const columnName = index => {let name='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name;};
  function render() {
    const sheet = visible().find(s => s.id === active);
    const host = $('workbook-table'); host.replaceChildren();
    if (!sheet) return;
    const rows = sheet.displayValues, total = Math.max(rows.length,sheet.rowCount || 0), start = page * 100, end = Math.min(total,start+100);
    const table = document.createElement('table');table.style.cssText='border-collapse:collapse;white-space:pre-wrap;font-size:13px';
    table.setAttribute('aria-label',sheet.name);
    const header=document.createElement('tr');header.append(document.createElement('th'));
    const width=Math.max(sheet.columnCount || 0,...rows.map(row=>row.length));
    for(let c=0;c<width;c++){const th=document.createElement('th');th.textContent=columnName(c);header.append(th);}table.append(header);
    for(let r=start;r<end;r++) {
      const tr=document.createElement('tr'), label=document.createElement('th');label.textContent=String(r+1);tr.append(label);
      for(let c=0;c<Math.max(rows[r]?.length || 0,sheet.columnCount || 0);c++) {
        const cell=document.createElement('td');cell.textContent=rows[r]?.[c] || '';
        cell.tabIndex=0;cell.setAttribute("aria-label",`${sheet.name} ${r+1}행 ${c+1}열`);
        const select=()=>selectCell(sheet,r,c);
        cell.addEventListener("click",select);cell.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();select();}});
        cell.style.cssText='border:1px solid #ddd;padding:6px;min-width:80px;max-width:320px;overflow-wrap:anywhere';
        cell.style.backgroundColor=sheet.backgrounds?.[r]?.[c] || '';
        cell.style.color=sheet.fontColors?.[r]?.[c] || '';
        cell.style.fontWeight=sheet.fontWeights?.[r]?.[c] || '';
        cell.title=[sheet.formulas[r]?.[c],sheet.notes?.[r]?.[c]].filter(Boolean).join('\n');
        // Use textContent: sheet text and formulas must never execute in the app.
        tr.append(cell);
      }
      table.append(tr);
    }
    host.append(table);
    $('workbook-page').textContent=` ${start+1}–${end} / ${total}행 `;
    $('workbook-prev').disabled=page===0;
    $('workbook-next').disabled=end>=total;
  }
  function selectCell(sheet,r,c) {
    if(busy || needsRefresh)return;
    if (!Array.isArray(sheet.rawValues)) {status('편집용 데이터를 포함해 Google 장부를 다시 가져와 주세요.');return;}
    selected={sheetId:sheet.id,row:r+1,column:c+1,revision:workbook.revision,expected:sheet.rawValues[r]?.[c] || {type:'text',value:''}};
    $('workbook-cell-address').textContent=`${sheet.name} · ${columnName(c)}${r+1}`;
    $('workbook-cell-original').textContent=`현재 내용: ${sheet.displayValues[r]?.[c] || '(빈 셀)'}`;
    $('workbook-cell-type').value=selected.expected.type;
    let value=selected.expected.value;
    if(selected.expected.type==='date') {
      const parts=new Intl.DateTimeFormat('en-CA',{timeZone:workbook.timeZone || 'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
      const part=type=>parts.find(p=>p.type===type).value;value=`${part('year')}-${part('month')}-${part('day')}`;
    }
    $('workbook-cell-value').value=value;
    const options=sheet.validations?.[r]?.[c];
    $('workbook-cell-options-label').hidden=options?.type!=='list';
    $('workbook-cell-options').replaceChildren();
    if(options?.type==='list') {
      for(const item of [...new Set([value,...options.values])]) {
        const option=document.createElement('option');option.value=item;option.textContent=item || '(빈 값)';$('workbook-cell-options').append(option);
      }
      $('workbook-cell-options').value=value;
    }
    $('workbook-cell-editor').hidden=false;
    $('workbook-cell-value').focus();
  }
  function accept(book) {
    workbook=book;needsRefresh=false;selected=undefined;$('workbook-cell-editor').hidden=true;tabs();render();$('workbook-export').disabled=false;
    status(`${book.title} · ${book.sheets.length}개 시트 · 가져온 시각 ${book.capturedAt} · 원본 표시값 유지 (금액·수식 정확성 검증과 별도)`);
  }
  async function run(fn) {
    if(busy)return;busy=true;$('workbook-cell-save').disabled=true;$('workbook-import').disabled=true;$('workbook-export').disabled=true;
    try { await fn(); } catch {status('장부 처리에 실패했습니다. 다시 시도해 주세요.');}
    finally {busy=false;$('workbook-import').disabled=false;$('workbook-export').disabled=!workbook || needsRefresh;$('workbook-cell-save').disabled=needsRefresh;}
  }
  $('workbook-cell-options').addEventListener('change',()=>{$('workbook-cell-value').value=$('workbook-cell-options').value;});
  $('workbook-cell-cancel').addEventListener('click',()=>{selected=undefined;$('workbook-cell-editor').hidden=true;});
  $('workbook-cell-editor').addEventListener('submit',event=>{
    event.preventDefault();if(!selected || busy || needsRefresh)return;
    const edit={...selected,next:{type:$('workbook-cell-type').value,value:$('workbook-cell-value').value}};
    run(async()=>{
      needsRefresh=true;status('선택한 셀을 저장하고 Google 장부·엑셀을 다시 확인하는 중입니다.');
      const result=await window.aroundG.editLedgerWorkbookCell(edit);
      if(result.ok){accept(result.workbook);status('선택한 셀 저장 및 다시 읽기 완료. 엑셀 내보내기에 반영됐습니다.');}
      else {status(messages[result.code] || '저장 결과를 확인하지 못했습니다. 다시 가져와 주세요.');}
    });
  });
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
  run(async()=>{const result=await window.aroundG.loadLedgerWorkbook();if(result.ok){accept(result.workbook);needsRefresh=Boolean(result.needsRefresh);if(needsRefresh)status(messages.WORKBOOK_REFRESH_REQUIRED);}else status(messages[result.code] || '장부를 불러오지 못했습니다.');});
})();
