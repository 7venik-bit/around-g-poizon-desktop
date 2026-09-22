(() => {
  const $ = id => document.getElementById(id);
  if (!$('original-ledger-workbook')) return;
  let workbook, active, selected, page = 0, busy = false, needsRefresh = false;
  let recordedLocation;
  const messages = {
    CELL_CONFLICT:'원본이 다른 곳에서 변경됐습니다. 다시 가져온 뒤 수정해 주세요.',
    CELL_PROTECTED:'보호된 셀이라 편집할 수 없습니다.',
    CELL_MERGED:'병합된 셀의 왼쪽 위 셀을 선택해 주세요.',
    CELL_NUMBER_INVALID:'금액·수량은 통화 기호와 쉼표 없이 숫자만 입력해 주세요. 최대 15자리입니다.',
    CELL_DATE_INVALID:'날짜를 YYYY-MM-DD 형식으로 확인해 주세요.',
    CELL_VALIDATION_REVIEW:'이 셀의 입력 규칙은 프로그램에서 확인할 수 없습니다. 지원되지 않는 입력 규칙입니다. 원본 값은 유지됩니다.',
    CELL_VALIDATION_FAILED:'시트에 지정된 허용 값과 맞지 않습니다.',
    CELL_SAVED_REFRESH_REQUIRED:'저장된 내부 장부를 다시 확인하지 못했습니다. 다시 가져와 저장 내용을 확인해 주세요.',
    CELL_WRITE_VERIFY_FAILED:'저장 결과가 입력값과 다릅니다. 다시 가져와 확인해 주세요.',
    WORKBOOK_REFRESH_REQUIRED:'저장 결과 확인이 필요합니다. 내부 장부를 다시 가져온 뒤 편집·내보내기를 이용해 주세요.',
    WORKBOOK_NOT_IMPORTED:'아직 가져온 장부가 없습니다.',
    WORKBOOK_BRIDGE_UPDATE_REQUIRED:'내부 장부 연결 스크립트 업데이트가 필요합니다. 원본은 변경되지 않았습니다.',
    LEDGER_NOT_CONNECTED:'연동관리에서 내부 장부 파일을 확인해 주세요.',
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
  const columnTypes = [
    [/^(?:모델명|상품명|제품명)$/, 'model', 170],
    [/^(?:품번|상품번호|제품번호|품목코드|SKU)$/i, 'code', 105],
    [/^(?:구매링크|상품링크|링크|URL)$/i, 'link', 100],
    [/^(?:판매가(?:\(원화\))?|구매가|예상수수료|택배비|간이마진|부가세환급|일반마진|매입가|배송비)$/, 'money', 84],
    [/^(?:구매가|판매가)(?:기준|대비|비)?마진율$/, 'percent', 84],
    [/^(?:EU사이즈|한국사이즈|사이즈)$/i, 'size', 60],
    [/^(?:판매일자|구매일자|주문일자|날짜)$/, 'date', 60],
    [/^(?:사진|상품사진|이미지)$/, 'image', 62],
    [/^(?:성별|카드)$/, 'short', 42],
    [/^(?:판매량|수량)$/, 'count', 52],
    [/^상태$/, 'status', 84],
    [/^브랜드$/, 'brand', 76],
  ];
  function sheetColumns(sheet,width) {
    const rows=sheet.displayValues;
    const match=value=>columnTypes.find(([pattern])=>pattern.test(String(value || '').replace(/\s/g,'')));
    // The original ledger can have a totals row above its real headings.
    let header=-1, score=1;
    rows.slice(0,10).forEach((row,index)=>{const count=row.filter(value=>match(value)).length;if(count>score){header=index;score=count;}});
    const columns=Array.from({length:width},(_,c)=>{
      const type=header>=0 && match(rows[header][c]);
      if(type) {
        let weight=type[2];
        if(!['model','link','image'].includes(type[1])) {
          // Reserve readable space for the actual original values, including
          // bold article codes, currency and Korean brand/status names.
          const longest=rows.reduce((max,row,r)=>r===header?max:Math.max(max,
            [...String(row[c] || '')].reduce((size,char)=>size+(/[^\x00-\x7f]/.test(char)?12:8),0)),0);
          weight=Math.max(weight,Math.min(240,(longest+10)/0.8));
        }
        return {kind:type[1],weight};
      }
      const used=rows.some((row,r)=>row[c] || sheet.formulas?.[r]?.[c]);
      return {kind:'text',weight:used?84:24};
    });
    return {header,columns};
  }
  function photoUrl(value,formula) {
    // Recognize only a literal IMAGE URL, never evaluate sheet expressions.
    const literal=String(formula || '').match(/^=IMAGE\("(https:\/\/[^"\r\n]+)"(?:[,;]\s*1)?\)$/i);
    if(formula && !literal)return '';
    try {const url=new URL(literal?literal[1]:String(value || ''));return url.protocol==='https:' && !url.username && !url.password && !/\.svg$/i.test(url.pathname)?url.href:'';}catch{return '';}
  }
  function render() {
    const sheet = visible().find(s => s.id === active);
    const host = $('workbook-table'); host.replaceChildren();
    if (!sheet) return;
    const rows = sheet.displayValues, total = Math.max(rows.length,sheet.rowCount || 0);
    page=Math.min(page,Math.max(0,Math.ceil(total/100)-1));
    const start = page * 100, end = Math.min(total,start+100);
    const table = document.createElement('table');
    table.setAttribute('aria-label',sheet.name);
    const width=Math.max(sheet.columnCount || 0,...rows.map(row=>row.length));
    const layout=sheetColumns(sheet,width),weights=[34,...layout.columns.map(column=>column.weight)];
    const totalWeight=weights.reduce((sum,value)=>sum+value,0),colgroup=document.createElement('colgroup');
    if(width>=16)table.style.minWidth=`${Math.ceil(totalWeight*0.8)}px`;
    for(const weight of weights){const col=document.createElement('col');col.style.width=`${weight/totalWeight*100}%`;colgroup.append(col);}
    table.dataset.wideSheet=String(width>=16);table.append(colgroup);
    const thead=document.createElement('thead'),header=document.createElement('tr');header.append(document.createElement('th'));
    for(let c=0;c<width;c++){const th=document.createElement('th');th.scope='col';th.textContent=columnName(c);header.append(th);}thead.append(header);table.append(thead);
    const body=document.createElement('tbody');
    for(let r=start;r<end;r++) {
      const tr=document.createElement('tr'), label=document.createElement('th');label.scope='row';label.textContent=String(r+1);tr.append(label);
      tr.dataset.rowNumber=String(r+1);
      if(r===layout.header)tr.className='workbook-data-header';
      if(recordedLocation?.sheetId===sheet.id && recordedLocation.rows.includes(r+1))tr.classList.add('workbook-recorded-row');
      for(let c=0;c<width;c++) {
        const cell=document.createElement('td'),content=document.createElement('span');
        content.className='workbook-cell-text';content.textContent=rows[r]?.[c] || '';cell.append(content);
        cell.dataset.columnKind=layout.columns[c].kind;
        const embedded=sheet.images?.find(image=>image.row===r+1&&image.column===c+1);
        if(embedded || layout.columns[c].kind==='image' && r>layout.header) {
          const url=/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(embedded?.url || '')?embedded.url:photoUrl(rows[r]?.[c],sheet.formulas?.[r]?.[c]);
          if(url) {
            const image=document.createElement('img');image.className='workbook-product-photo';image.alt='상품 사진';image.loading='lazy';image.referrerPolicy='no-referrer';image.src=url;
            content.hidden=true;cell.append(image);
            image.addEventListener('error',()=>{image.remove();content.hidden=false;content.textContent=rows[r]?.[c] || '사진 확인 필요';});
          }
        }
        cell.tabIndex=0;cell.setAttribute("aria-label",`${sheet.name} ${r+1}행 ${c+1}열`);
        const select=()=>selectCell(sheet,r,c);
        cell.addEventListener("click",select);cell.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();select();}});
        cell.style.backgroundColor=sheet.backgrounds?.[r]?.[c] || '';
        cell.style.color=sheet.fontColors?.[r]?.[c] || '';
        cell.style.fontWeight=sheet.fontWeights?.[r]?.[c] || '';
        cell.title=[rows[r]?.[c],sheet.formulas?.[r]?.[c],sheet.notes?.[r]?.[c]].filter(Boolean).join('\n');
        // Use textContent: sheet text and formulas must never execute in the app.
        tr.append(cell);
      }
      body.append(tr);
    }
    table.append(body);
    host.append(table);
    $('workbook-page').textContent=` ${start+1}–${end} / ${total}행 `;
    $('workbook-prev').disabled=page===0;
    $('workbook-next').disabled=end>=total;
  }
  function selectCell(sheet,r,c) {
    if(busy || needsRefresh)return;
    if (!Array.isArray(sheet.rawValues)) {status('편집용 데이터를 포함해 내부 장부를 다시 가져와 주세요.');return;}
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
    status(`${book.title} · ${book.sheets.length}개 시트 · 수식 ${book.calculation?.formulaCount ?? 0}개 · PC 내부 저장 · Google 연동 없음`);
  }
  async function run(fn) {
    if(busy)return {ok:false,code:'WORKBOOK_BUSY'};busy=true;$('workbook-cell-save').disabled=true;$('workbook-import').disabled=true;$('workbook-export').disabled=true;
    try { return await fn(); } catch {status('장부 처리에 실패했습니다. 다시 시도해 주세요.');return {ok:false,code:'WORKBOOK_READ_FAILED'};}
    finally {busy=false;$('workbook-import').disabled=false;$('workbook-export').disabled=!workbook || needsRefresh;$('workbook-cell-save').disabled=needsRefresh;}
  }
  // Reload the committed local workbook before jumping; never resubmit a purchase.
  async function showRecordedRows(numbers) {
    const rows=[...new Set((Array.isArray(numbers)?numbers:[]).filter(Number.isSafeInteger).filter(n=>n>0))].sort((a,b)=>a-b);
    if(!rows.length)return {ok:false,code:'WORKBOOK_RECORD_LOCATION_MISSING'};
    if(busy)return {ok:false,code:'WORKBOOK_BUSY'};
    if(selected)return {ok:false,code:'WORKBOOK_EDIT_PENDING'};
    return run(async()=>{
      needsRefresh=true;status('기록한 행을 확인하기 위해 내부 장부를 새로 불러오고 있습니다.');
      const result=await window.aroundG.loadLedgerWorkbook();
      if(!result?.ok){status('내부 장부를 새로 불러오지 못했습니다. 기록 내역의 기록 위치 보기를 다시 눌러주세요.');return {ok:false,code:result?.code || 'WORKBOOK_READ_FAILED'};}
      const sheet=result.workbook.sheets.find(s=>s.name==='1-구매완료');
      const total=sheet && Math.max(sheet.displayValues.length,sheet.rowCount || 0);
      if(!sheet || rows.some(row=>row>total)) {
        accept(result.workbook);status('기록 위치가 현재 장부 범위를 벗어납니다. 내부 장부의 행을 확인해 주세요.');
        return {ok:false,code:'WORKBOOK_RECORD_LOCATION_MISSING'};
      }
      active=sheet.id;page=Math.floor((rows[0]-1)/100);recordedLocation={sheetId:sheet.id,rows};
      if(sheet.hidden)$('workbook-hidden').checked=true;
      accept(result.workbook);
      status(`${sheet.name} · 기록 위치 ${rows.join(', ')}행 · 내부 장부 새로 불러오기 완료`);
      $('original-ledger-workbook').scrollIntoView({block:'start'});
      const host=$('workbook-table'),target=host.querySelector(`[data-row-number="${rows[0]}"]`);
      host.scrollLeft=0;
      if(target)host.scrollTop+=target.getBoundingClientRect().top-host.getBoundingClientRect().top-(host.querySelector('thead')?.offsetHeight || 26)-12;
      return {ok:true,rows,sheetId:sheet.id};
    });
  }
  window.aroundGLedgerWorkbook={showRecordedRows};
  $('workbook-cell-options').addEventListener('change',()=>{$('workbook-cell-value').value=$('workbook-cell-options').value;});
  $('workbook-cell-cancel').addEventListener('click',()=>{selected=undefined;$('workbook-cell-editor').hidden=true;});
  $('workbook-cell-editor').addEventListener('submit',event=>{
    event.preventDefault();if(!selected || busy || needsRefresh)return;
    const edit={...selected,next:{type:$('workbook-cell-type').value,value:$('workbook-cell-value').value}};
    run(async()=>{
      needsRefresh=true;status('선택한 셀을 저장하고 내부 수식과 Excel 값을 다시 계산하는 중입니다.');
      const result=await window.aroundG.editLedgerWorkbookCell(edit);
      if(result.ok){accept(result.workbook);status('선택한 셀 저장 및 다시 읽기 완료. 엑셀 내보내기에 반영됐습니다.');}
      else {status(messages[result.code] || '저장 결과를 확인하지 못했습니다. 다시 가져와 주세요.');}
    });
  });
  $('workbook-import').addEventListener('click',()=>run(async()=>{
    status('전체 시트와 엑셀을 가져오는 중입니다.');
    const result=await window.aroundG.loadLedgerWorkbook();
    if(result.ok)accept(result.workbook);else status(messages[result.code] || `가져오기 실패: ${result.code || '알 수 없는 오류'}`);
  }));
  $('workbook-export').addEventListener('click',()=>run(async()=>{
    const result=await window.aroundG.exportLedgerWorkbook();
    if(result.ok)status('Excel 내보내기 완료. 모든 시트·수식과 내부에서 저장한 수정 내용이 포함되었습니다.');
    else if(!result.canceled)status(messages[result.code] || '엑셀 내보내기에 실패했습니다.');
  }));
  $('workbook-hidden').addEventListener('change',()=>{page=0;tabs();render();});
  $('workbook-prev').addEventListener('click',()=>{if(page>0){page--;render();}});
  $('workbook-next').addEventListener('click',()=>{page++;render();});
  run(async()=>{const result=await window.aroundG.loadLedgerWorkbook();if(result.ok){accept(result.workbook);needsRefresh=Boolean(result.needsRefresh);if(needsRefresh)status(messages.WORKBOOK_REFRESH_REQUIRED);}else status(messages[result.code] || '장부를 불러오지 못했습니다.');});
})();
