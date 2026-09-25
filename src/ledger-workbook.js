(() => {
  const $ = id => document.getElementById(id);
  if (!$('original-ledger-workbook')) return;
  let workbook, active, selected, page = 0, busy = false, needsRefresh = false;
  let recordedLocation;
  let selection,anchor,editor,purchaseRecording=false;
  let categoryReviewRow;
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
    WORKBOOK_READ_FAILED:'저장된 원본 장부를 읽지 못했습니다. 기존 파일은 유지됩니다.',
    CELL_RANGE_TOO_LARGE:'한 번에 최대 5,000개 셀을 선택해 주세요.',
    CELL_ADDRESS_INVALID:'붙여넣을 내용이 장부 범위를 벗어납니다. 시작 셀을 확인해 주세요.',
    CELL_CLIPBOARD_EMPTY:'복사된 내용이 없습니다. 먼저 셀이나 텍스트를 복사해 주세요.',
    CELL_CLIPBOARD_INVALID:'복사한 셀을 읽을 수 없습니다. 다시 복사해 주세요.',
    CELL_DIMENSION_INVALID:'열 너비는 32~600, 행 높이는 24~400 픽셀로 입력해 주세요.'
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
      button.addEventListener('click',() => afterEdit(()=>{clearSelection();active=s.id;page=0;tabs();render();}));
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
    [/^카테고리$/, 'category', 150],
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
            [...displayCell(sheet,r,c,type[1])].reduce((size,char)=>size+(/[^\x00-\x7f]/.test(char)?12:8),0)),0);
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
  function categoryReviewContext() {
    const sheet=workbook?.sheets?.find(s=>s.id===selection?.sheetId);
    if(sheet?.name!=='1-구매완료'||!selection||selection.row<3||selection.row!==selection.endRow)return null;
    const row=selection.row,values=sheet.rawValues?.[row-1]||[];
    if(![0,1,2,3,13].some(c=>String(values[c]?.value??'').trim()))return null;
    const column=workbook.local?.categories?.[sheet.id]?.column;
    if(!column)return null;
    const image=sheet.images?.find(item=>item.row===row&&item.column===8);
    const embedded=/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(image?.url||'')?image.url:'';
    return {sheet,row,column,values,photo:embedded||photoUrl(sheet.displayValues?.[row-1]?.[7],sheet.formulas?.[row-1]?.[7])};
  }
  function showCategoryReview() {
    const context=categoryReviewContext();
    if(!context)return;
    categoryReviewRow={sheetId:context.sheet.id,row:context.row};
    const photo=$('workbook-category-photo');
    photo.hidden=!context.photo;photo.removeAttribute('src');
    if(context.photo)photo.src=context.photo;
    photo.onerror=()=>{photo.hidden=true;$('workbook-category-hint').textContent='상품 사진을 불러올 수 없습니다. 상품 링크와 품번을 확인해 주세요.';};
    $('workbook-category-product').textContent=`${context.values[0]?.value||''} · ${context.values[3]?.value||''} · ${context.values[2]?.value||''}`;
    const current=String(context.values[context.column-1]?.value||'').trim();
    const choice=$('workbook-category-choice');
    choice.value=[...choice.options].some(option=>option.value===current)?current:'';
    $('workbook-category-hint').textContent=context.photo
      ?`장부 ${context.row}행의 상품 사진을 확인하세요. 현재 분류: ${current||'확인 필요'}. 저장하면 해당 행의 수수료와 마진을 다시 계산합니다.`
      :`장부 ${context.row}행에 확인할 사진이 없습니다. 상품 링크와 품번을 확인한 뒤 카테고리를 선택하세요.`;
    $('workbook-category-panel').hidden=false;
  }
  const won=new Intl.NumberFormat('ko-KR',{style:'currency',currency:'KRW',maximumFractionDigits:2});
  function displayCell(sheet,r,c,kind) {
    const display=sheet.displayValues[r]?.[c] || '',raw=sheet.rawValues?.[r]?.[c],calculated=sheet.calculatedValues?.[r]?.[c];
    if(kind!=='money')return display;
    const numericText=raw?.type==='text'&&/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw.value)&&raw.value.replace(/[-.]/g,'').replace(/^0+/,'').length<=15;
    const value=raw?.type==='number'||numericText?Number(raw.value):calculated?.type==='number'?calculated.value:undefined;
    return Number.isFinite(value)?won.format(value):display;
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
    const custom=Object.keys(sheet.columnWidths||{}).length>0;
    const baseWidth=Math.max(host.clientWidth,width>=16?totalWeight*0.8:0);
    const widths=weights.map((weight,c)=>c&&sheet.columnWidths?.[c]||weight/totalWeight*baseWidth);
    if(custom){table.style.width=`${widths.reduce((sum,n)=>sum+n,0)}px`;table.style.minWidth='0';}
    for(const [c,weight] of weights.entries()){const col=document.createElement('col');col.style.width=custom?`${widths[c]}px`:`${weight/totalWeight*100}%`;colgroup.append(col);}
    table.dataset.wideSheet=String(width>=16);table.append(colgroup);
    const thead=document.createElement('thead'),header=document.createElement('tr');header.append(document.createElement('th'));
    for(let c=0;c<width;c++){const th=document.createElement('th');th.scope='col';th.textContent=columnName(c);th.append(resizeHandle(sheet,'column',c+1));header.append(th);}thead.append(header);table.append(thead);
    const body=document.createElement('tbody');
    for(let r=start;r<end;r++) {
      const tr=document.createElement('tr'), label=document.createElement('th');label.scope='row';label.textContent=String(r+1);tr.append(label);
      label.append(resizeHandle(sheet,'row',r+1));
      tr.dataset.rowNumber=String(r+1);
      if(sheet.rowHeights?.[r+1]){tr.dataset.customHeight='true';tr.style.setProperty('--workbook-row-height',`${sheet.rowHeights[r+1]}px`);}
      if(r===layout.header)tr.className='workbook-data-header';
      if(recordedLocation?.sheetId===sheet.id && recordedLocation.rows.includes(r+1))tr.classList.add('workbook-recorded-row');
      for(let c=0;c<width;c++) {
        const cell=document.createElement('td'),content=document.createElement('span');
        content.className='workbook-cell-text';content.textContent=displayCell(sheet,r,c,layout.columns[c].kind);cell.append(content);
        cell.dataset.columnKind=layout.columns[c].kind;
        cell.dataset.row=String(r+1);cell.dataset.column=String(c+1);
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
        cell.addEventListener('click',event=>{if(event.target.closest('#workbook-cell-editor'))return;afterEdit(()=>selectCell(workbook.sheets.find(s=>s.id===sheet.id),r,c,event.shiftKey));});
        cell.addEventListener('dblclick',()=>{if(!editor){selectCell(sheet,r,c);startEdit();}});
        cell.style.backgroundColor=sheet.backgrounds?.[r]?.[c] || '';
        cell.style.color=sheet.fontColors?.[r]?.[c] || '';
        cell.style.fontWeight=sheet.fontWeights?.[r]?.[c] || '';
        cell.title=[rows[r]?.[c],sheet.formulas?.[r]?.[c],sheet.notes?.[r]?.[c]].filter(Boolean).join('\n');
        const categoryState=workbook.local?.categories?.[sheet.id],category=categoryState?.rows?.[r+1];
        if(c+1===categoryState?.column&&category) {
          const explanation=category.status==='missing'?'저장된 POIZON Excel에 일치하는 품번이 없습니다.':category.status==='conflict'?'저장된 POIZON Excel의 카테고리가 서로 다릅니다.':category.source;
          cell.title=[cell.title,explanation].filter(Boolean).join('\n');
          if(!rows[r]?.[c])content.textContent='확인 필요';
        }
        const fee=workbook.local?.fees?.[sheet.id]?.rows?.[r+1];
        if(c===15&&fee) {
          const explanation=fee.status==='category-required'?'카테고리를 입력하면 수수료와 마진이 자동 계산됩니다.':fee.status==='manual'?'직접 입력한 수수료입니다.':`${fee.rate*100}% · 최소 ${fee.minimum.toLocaleString('ko-KR')}원 · 최대 ${fee.maximum.toLocaleString('ko-KR')}원`;
          cell.title=[cell.title,explanation,fee.source].filter(Boolean).join('\n');
          if(fee.status==='category-required'&&!rows[r]?.[c])content.textContent='카테고리 확인';
        }
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
    paintSelection();
  }
  function selectCell(sheet,r,c,extend=false,restoring=false) {
    if(busy&&!restoring || needsRefresh)return;
    if (!Array.isArray(sheet.rawValues)) {status('편집용 데이터를 포함해 내부 장부를 다시 가져와 주세요.');return;}
    if(!extend||!anchor||selection?.sheetId!==sheet.id)anchor={row:r+1,column:c+1};
    selection={sheetId:sheet.id,row:Math.min(anchor.row,r+1),column:Math.min(anchor.column,c+1),endRow:Math.max(anchor.row,r+1),endColumn:Math.max(anchor.column,c+1),focusRow:r+1,focusColumn:c+1};
    if(categoryReviewRow&&(categoryReviewRow.sheetId!==sheet.id||categoryReviewRow.row!==r+1)){$('workbook-category-panel').hidden=true;categoryReviewRow=undefined;}
    paintSelection();
    const focus=$('workbook-table').querySelector(`td[data-row="${r+1}"][data-column="${c+1}"]`);focus?.focus({preventScroll:true});
    if(selection.row!==selection.endRow||selection.column!==selection.endColumn){selected=undefined;announcePurchaseDestination();return;}
    selected={sheetId:sheet.id,row:r+1,column:c+1,revision:workbook.revision,expected:sheet.rawValues[r]?.[c] || {type:'text',value:''}};
    announcePurchaseDestination();
  }
  function startEdit(replacement,restoring=false) {
    if(!selected||editor||busy&&!restoring||needsRefresh)return;
    const cell=$('workbook-table').querySelector(`td[data-row="${selected.row}"][data-column="${selected.column}"]`);
    if(!cell)return;
    const sheet=workbook.sheets.find(s=>s.id===selected.sheetId),rule=sheet.validations?.[selected.row-1]?.[selected.column-1];
    let value=selected.expected.value;
    if(selected.expected.type==='date') {
      const parts=new Intl.DateTimeFormat('en-CA',{timeZone:workbook.timeZone || 'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
      const part=type=>parts.find(p=>p.type===type).value;value=`${part('year')}-${part('month')}-${part('day')}`;
    }
    const form=document.createElement('form'),input=document.createElement(rule?.type==='list'?'input':'textarea');
    form.id='workbook-cell-editor';input.id='workbook-cell-value';input.value=replacement??value;input.autocomplete='off';input.spellcheck=false;
    input.setAttribute('aria-label',`${sheet.name} ${columnName(selected.column-1)}${selected.row} 편집`);
    input.title='Enter 저장 · Tab 저장 후 다음 셀 · Esc 취소 · 수식은 =로 시작';
    if(input.tagName==='TEXTAREA')input.rows=1;
    form.append(input);
    if(rule?.type==='list') {
      const list=document.createElement('datalist');list.id='workbook-cell-options';input.setAttribute('list',list.id);
      for(const item of rule.values){const option=document.createElement('option');option.value=item;list.append(option);}form.append(list);
    }
    editor={form,input,cell,target:{...selected},original:String(value),kind:cell.closest('.workbook-data-header')?'text':cell.dataset.columnKind,composing:false};
    cell.classList.add('workbook-editing');cell.append(form);
    form.addEventListener('submit',event=>{event.preventDefault();commitEdit([1,0]);});
    input.addEventListener('input',()=>{input.removeAttribute('aria-invalid');announcePurchaseDestination();});
    input.addEventListener('compositionstart',()=>{if(editor)editor.composing=true;});
    input.addEventListener('compositionend',()=>{if(editor)editor.composing=false;});
    input.addEventListener('keydown',event=>{
      if(event.isComposing||event.keyCode===229||editor?.composing)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancelEdit();}
      else if(event.key==='Tab'||event.key==='Enter'&&!event.altKey){event.preventDefault();event.stopPropagation();commitEdit(event.key==='Tab'?[0,event.shiftKey?-1:1]:[event.shiftKey?-1:1,0]);}
    });
    input.addEventListener('blur',()=>{
      if(busy)return;
      // A clicked cell/toolbar gets to choose its action before plain focus loss saves.
      const current=editor;queueMicrotask(()=>{if(current&&editor===current&&!busy&&!current.composing&&!current.input.hasAttribute('aria-invalid'))commitEdit();});
    });
    input.focus({preventScroll:true});if(replacement===undefined)input.select();
    announcePurchaseDestination();
  }
  function removeEditor(){if(!editor)return;const current=editor;editor=undefined;current.form.remove();current.cell.classList.remove('workbook-editing');}
  function cancelEdit(){const cell=editor?.cell;removeEditor();cell?.focus({preventScroll:true});announcePurchaseDestination();}
  function inferredInput(draft) {
    const value=draft.input.value,trimmed=value.trim(),previous=draft.target.expected;
    if(value==='')return {type:'text',value:''};
    if(value.startsWith("'"))return {type:'text',value:value.slice(1)};
    if(value.startsWith('='))return {type:'formula',value};
    if(['code','link','image','size'].includes(draft.kind))return {type:'text',value};
    if(previous.type==='date'||draft.kind==='date')return {type:'date',value:trimmed};
    if(previous.type==='boolean'||/^(true|false)$/i.test(trimmed))return {type:'boolean',value:trimmed.toLowerCase()};
    let number=trimmed;
    if(draft.kind==='money'&&/^-?₩?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*원?$/.test(trimmed))number=trimmed.replace(/[₩,원\s]/g,'');
    if(previous.type==='number'||draft.kind==='money'||draft.kind==='count')return {type:'number',value:number};
    if(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(number)&&number.replace(/[-.]/g,'').replace(/^0+/,'').length<=15)return {type:'number',value:number};
    return {type:'text',value};
  }
  async function commitEdit(delta,then) {
    if(!editor){then?.();return true;}if(busy||needsRefresh||editor.composing)return false;
    const draft=editor;
    if(draft.input.value===draft.original){removeEditor();if(delta)moveSelection(delta);then?.();return true;}
    const edit={...draft.target,next:inferredInput(draft)},host=$('workbook-table'),scroll={top:host.scrollTop,left:host.scrollLeft};
    let saved=false;
    await run(async()=>{
      needsRefresh=true;status('셀을 저장하고 수식을 다시 계산하는 중입니다.');
      const result=await window.aroundG.editLedgerWorkbookCell(edit);
      if(result.ok){accept(result.workbook);const sheet=workbook.sheets.find(s=>s.id===edit.sheetId);selectCell(sheet,edit.row-1,edit.column-1,false,true);host.scrollTop=scroll.top;host.scrollLeft=scroll.left;saved=true;status('셀 저장 완료 · Excel 내보내기에 반영됐습니다.');}
      else {
        if(/^CELL_(?:ADDRESS_INVALID|MERGED|PROTECTED|VALIDATION_|NUMBER_INVALID|DATE_INVALID|VALUE_INVALID|FORMULA_INVALID)/.test(result.code))needsRefresh=false;
        draft.input.setAttribute('aria-invalid','true');status(messages[result.code]||'저장 결과를 확인하지 못했습니다. 내부 장부를 다시 불러와 주세요.');
      }
    });
    if(saved){if(delta)moveSelection(delta);then?.();}else if(!needsRefresh)draft.input.focus({preventScroll:true});
    return saved;
  }
  function afterEdit(fn){if(busy||needsRefresh)return;if(editor)return commitEdit(undefined,fn);fn();}
  function clearSelection() {removeEditor();selection=anchor=selected=categoryReviewRow=undefined;$('workbook-category-panel').hidden=true;paintSelection();}
  function paintSelection() {
    for(const tab of $('workbook-tabs').querySelectorAll('button'))tab.disabled=busy;
    $('workbook-hidden').disabled=busy;
    const current=workbook?.sheets?.find(s=>s.id===active),total=current&&Math.max(current.rowCount||0,current.displayValues.length);
    $('workbook-prev').disabled=busy||page===0;$('workbook-next').disabled=busy||!total||(page+1)*100>=total;
    for(const cell of $('workbook-table').querySelectorAll('td')) {
      const r=Number(cell.dataset.row),c=Number(cell.dataset.column),inside=selection?.sheetId===active&&r>=selection.row&&r<=selection.endRow&&c>=selection.column&&c<=selection.endColumn;
      cell.classList.toggle('workbook-selected',Boolean(inside));cell.setAttribute('aria-selected',String(Boolean(inside)));
    }
    $('workbook-selection').textContent=selection?`${columnName(selection.column-1)}${selection.row}${selection.row!==selection.endRow||selection.column!==selection.endColumn?`:${columnName(selection.endColumn-1)}${selection.endRow}`:''}`:'셀을 선택하세요';
    for(const id of ['workbook-cell-clear','workbook-cell-copy','workbook-cell-paste','workbook-size-save'])$(id).disabled=!selection||busy||needsRefresh;
    $('workbook-category-review').disabled=!categoryReviewContext()||busy||needsRefresh;
    if(selection) {
      const sheet=workbook.sheets.find(s=>s.id===active),table=$('workbook-table').querySelector('table');
      $('workbook-column-width').value=sheet.columnWidths?.[selection.column]||Math.round(table?.querySelectorAll('thead th')[selection.column]?.getBoundingClientRect().width||0)||'';
      $('workbook-row-height').value=sheet.rowHeights?.[selection.row]||Math.round(table?.querySelector(`[data-row-number="${selection.row}"]`)?.getBoundingClientRect().height||0)||'';
    }
    if(editor)editor.input.disabled=busy||needsRefresh;
    announcePurchaseDestination();
  }
  function hasPendingEdit() {return Boolean(editor&&editor.input.value!==editor.original);}
  function getPurchaseDestination() {
    if(busy)return {ok:false,code:'WORKBOOK_BUSY'};
    if(needsRefresh)return {ok:false,code:'WORKBOOK_REFRESH_REQUIRED'};
    if(hasPendingEdit())return {ok:false,code:'WORKBOOK_EDIT_PENDING'};
    const sheet=workbook?.sheets.find(s=>s.id===selection?.sheetId);
    if(!selection)return {ok:false,code:'PURCHASE_DESTINATION_REQUIRED'};
    if(sheet?.name!=='1-구매완료'||selection.row<3||selection.row!==selection.endRow)return {ok:false,code:'PURCHASE_DESTINATION_INVALID'};
    return {ok:true,destination:{sheetId:sheet.id,row:selection.row,revision:workbook.revision}};
  }
  function announcePurchaseDestination() {
    const label=$('ledger-destination'),result=getPurchaseDestination();
    if(label)label.textContent=result.ok?`입력 위치: 1-구매완료 · ${result.destination.row}행부터 수량별 한 행씩 기록합니다.`
      :purchaseRecording?'선택한 행에 기록 중입니다.'
      :result.code==='WORKBOOK_EDIT_PENDING'?'편집 중인 셀을 먼저 저장하거나 취소해 주세요.'
      :result.code==='PURCHASE_DESTINATION_INVALID'?'1-구매완료 시트에서 입력할 빈 행 하나를 선택해 주세요. 제목 행에는 기록할 수 없습니다.'
      :'위 장부에서 입력할 빈 행의 셀을 클릭해 주세요. 선택한 행부터 수량별로 한 행씩 기록합니다.';
    window.dispatchEvent(new Event('aroundg:ledger-selection'));
  }
  function beginPurchaseRecord() {
    const result=getPurchaseDestination();if(!result.ok)return result;
    purchaseRecording=busy=true;paintSelection();$('workbook-import').disabled=true;$('workbook-export').disabled=true;
    return result;
  }
  function endPurchaseRecord(committed=false) {
    if(!purchaseRecording)return;
    purchaseRecording=busy=false;if(committed)clearSelection();
    $('workbook-import').disabled=false;$('workbook-export').disabled=!workbook||needsRefresh;paintSelection();
  }
  const selectionInput=()=>({sheetId:selection.sheetId,revision:workbook.revision,range:{row:selection.row,column:selection.column,endRow:selection.endRow,endColumn:selection.endColumn}});
  async function changeCells(method,message,input=selection&&selectionInput()) {
    if(!input||busy||needsRefresh)return;
    const draft=method==='resizeLedgerWorkbook'&&editor?{row:selected.row,column:selected.column,value:editor.input.value}:undefined;
    const previous=selection&&{...selection},host=$('workbook-table'),scroll={top:host.scrollTop,left:host.scrollLeft};
    await run(async()=>{
      needsRefresh=true;status('내부 장부에 저장하고 수식을 다시 계산하는 중입니다.');
      const result=await window.aroundG[method](input);
      if(result.ok) {
        accept(result.workbook);selection=previous;anchor=previous&&{row:previous.row,column:previous.column};paintSelection();
        if(previous&&previous.row===previous.endRow&&previous.column===previous.endColumn)selectCell(workbook.sheets.find(s=>s.id===active),previous.row-1,previous.column-1,false,true);
        if(draft)startEdit(draft.value,true);
        host.scrollTop=scroll.top;host.scrollLeft=scroll.left;host.focus({preventScroll:true});status(message);
      } else {
        // Validation failures have not written any cells. Storage failures require a reread.
        if(/^CELL_(?:ADDRESS_INVALID|CONFLICT|MERGED|RANGE_TOO_LARGE|CLIPBOARD_|DIMENSION_INVALID|VALIDATION_|NUMBER_INVALID|DATE_INVALID|VALUE_INVALID|FORMULA_INVALID)/.test(result.code))needsRefresh=false;
        render();status(messages[result.code]||'저장 결과를 확인하지 못했습니다. 내부 장부를 새로 불러와 주세요.');
      }
    });
  }
  function resizeHandle(sheet,axis,index) {
    const handle=document.createElement('button');handle.type='button';handle.className=`workbook-resize-handle workbook-${axis}-resize`;handle.tabIndex=-1;
    handle.setAttribute('aria-label',axis==='column'?`${columnName(index-1)}열 너비 조절`:`${index}행 높이 조절`);
    handle.addEventListener('pointerdown',event=>{
      if(busy||needsRefresh||event.button!==0)return;event.preventDefault();event.stopPropagation();
      const table=handle.closest('table'),row=handle.closest('tr'),cols=[...table.querySelectorAll('col')],headers=[...table.querySelectorAll('thead th')];
      const widths=headers.map(th=>th.getBoundingClientRect().width),start=axis==='column'?event.clientX:event.clientY,original=axis==='column'?widths[index]:row.getBoundingClientRect().height;
      let pixels=Math.round(original);
      const move=e=>{
        pixels=Math.round(Math.max(axis==='column'?32:24,Math.min(axis==='column'?600:400,original+(axis==='column'?e.clientX:e.clientY)-start)));
        if(axis==='column'){const next=widths.map((n,c)=>c===index?pixels:n);table.style.minWidth='0';table.style.width=`${next.reduce((a,b)=>a+b,0)}px`;cols.forEach((col,c)=>col.style.width=`${next[c]}px`);}
        else {row.dataset.customHeight='true';row.style.setProperty('--workbook-row-height',`${pixels}px`);}
      };
      const finish=e=>{
        window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',finish);
        if(e.type==='pointercancel'||Math.abs(pixels-original)<1){render();return;}
        changeCells('resizeLedgerWorkbook','칸 크기를 저장했습니다. 다음 실행과 Excel 내보내기에 반영됩니다.',{sheetId:sheet.id,revision:workbook.revision,changes:[{axis,index,pixels}]});
      };
      window.addEventListener('pointermove',move);window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',finish);
    });
    return handle;
  }
  function accept(book) {
    workbook=book;needsRefresh=false;clearSelection();tabs();render();$('workbook-export').disabled=false;
    status(`${book.title} · ${book.sheets.length}개 시트 · 수식 ${book.calculation?.formulaCount ?? 0}개 · PC 내부 저장 · Google 연동 없음`);
  }
  async function run(fn) {
    if(busy)return {ok:false,code:'WORKBOOK_BUSY'};busy=true;paintSelection();$('workbook-import').disabled=true;$('workbook-export').disabled=true;
    try { return await fn(); } catch {status('장부 처리에 실패했습니다. 다시 시도해 주세요.');return {ok:false,code:'WORKBOOK_READ_FAILED'};}
    finally {busy=false;$('workbook-import').disabled=false;$('workbook-export').disabled=!workbook || needsRefresh;paintSelection();}
  }
  // Reload the committed local workbook before jumping; never resubmit a purchase.
  async function showRecordedRows(numbers) {
    const rows=[...new Set((Array.isArray(numbers)?numbers:[]).filter(Number.isSafeInteger).filter(n=>n>0))].sort((a,b)=>a-b);
    if(!rows.length)return {ok:false,code:'WORKBOOK_RECORD_LOCATION_MISSING'};
    if(busy)return {ok:false,code:'WORKBOOK_BUSY'};
    if(hasPendingEdit())return {ok:false,code:'WORKBOOK_EDIT_PENDING'};
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
  window.aroundGLedgerWorkbook={showRecordedRows,getPurchaseDestination,beginPurchaseRecord,endPurchaseRecord};
  $('workbook-category-review').addEventListener('click',()=>afterEdit(showCategoryReview));
  $('workbook-category-save').addEventListener('click',()=>afterEdit(async()=>{
    const context=categoryReviewContext(),category=$('workbook-category-choice').value;
    if(!context||!category||categoryReviewRow?.row!==context.row){status('상품 사진을 확인하고 수수료 카테고리를 선택해 주세요.');return;}
    const current=context.values[context.column-1]||{type:'text',value:''};
    const edit={sheetId:context.sheet.id,row:context.row,column:context.column,revision:workbook.revision,
      expected:current,next:{type:'text',value:category}};
    await run(async()=>{
      needsRefresh=true;status('카테고리와 수수료를 저장하고 다시 계산합니다.');
      const result=await window.aroundG.editLedgerWorkbookCell(edit);
      if(result.ok){accept(result.workbook);status(`${context.row}행 카테고리 ${category} 저장 완료. 수수료와 마진을 다시 계산했습니다.`);}
      else{needsRefresh=!/^CELL_(?:ADDRESS_INVALID|MERGED|PROTECTED|VALIDATION_|VALUE_INVALID)/.test(result.code);status(messages[result.code]||'카테고리를 저장하지 못했습니다. 장부를 새로 불러와 다시 확인해 주세요.');}
    });
  }));
  $('workbook-cell-clear').addEventListener('click',()=>afterEdit(()=>changeCells('clearLedgerWorkbookCells','선택한 셀의 내용을 지웠습니다. 셀 위치와 서식은 유지됩니다.')));
  $('workbook-cell-paste').addEventListener('click',()=>afterEdit(()=>changeCells('pasteLedgerWorkbookCells','붙여넣기 및 수식 계산 완료. Excel 내보내기에 반영됐습니다.')));
  $('workbook-cell-copy').addEventListener('click',()=>afterEdit(()=>{if(!selection||busy||needsRefresh)return;const input=selectionInput();run(async()=>{
    const result=await window.aroundG.copyLedgerWorkbookCells(input);status(result.ok?'셀을 복사했습니다. 붙여넣을 셀을 선택하고 Ctrl+V를 누르세요.':messages[result.code]||'셀을 복사하지 못했습니다.');
  });}));
  $('workbook-size-save').addEventListener('click',()=>{
    if(!selection)return;const changes=[],width=$('workbook-column-width').value,height=$('workbook-row-height').value;
    if(width)for(let index=selection.column;index<=selection.endColumn;index++)changes.push({axis:'column',index,pixels:Number(width)});
    if(height)for(let index=selection.row;index<=selection.endRow;index++)changes.push({axis:'row',index,pixels:Number(height)});
    changeCells('resizeLedgerWorkbook','선택한 칸 크기를 저장했습니다. 다음 실행과 Excel 내보내기에 반영됩니다.',{sheetId:selection.sheetId,revision:workbook.revision,changes});
  });
  $('workbook-table').addEventListener('keydown',event=>{
    if(!selection||busy||needsRefresh||event.target.closest('input,textarea,select'))return;
    const modifier=event.ctrlKey||event.metaKey,key=event.key.toLowerCase();
    if(modifier&&['c','v'].includes(key)){event.preventDefault();$(key==='c'?'workbook-cell-copy':'workbook-cell-paste').click();return;}
    if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();$('workbook-cell-clear').click();return;}
    if(event.key==='Enter'||event.key==='F2'){event.preventDefault();startEdit();return;}
    if(event.key==='Tab'){event.preventDefault();moveSelection([0,event.shiftKey?-1:1]);return;}
    if(!modifier&&!event.altKey&&(event.key.length===1||event.key==='Process'||event.key==='Unidentified')) {
      if(event.key.length===1)event.preventDefault();startEdit(event.key.length===1?event.key:'');return;
    }
    const delta={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]}[event.key];
    if(delta){event.preventDefault();moveSelection(delta,event.shiftKey);}
  });
  function moveSelection(delta,extend=false) {
    if(!selection)return;
    const sheet=workbook.sheets.find(s=>s.id===active),r=Math.max(1,Math.min(sheet.rowCount||sheet.displayValues.length,(selection.focusRow||selection.row)+delta[0])),c=Math.max(1,Math.min(sheet.columnCount||Math.max(...sheet.displayValues.map(row=>row.length)),(selection.focusColumn||selection.column)+delta[1]));
    const nextPage=Math.floor((r-1)/100);if(nextPage!==page){page=nextPage;render();}selectCell(sheet,r-1,c-1,extend);
    $('workbook-table').querySelector('td[data-row="'+r+'"][data-column="'+c+'"]')?.scrollIntoView?.({block:'nearest',inline:'nearest'});
  }
  // Keep a draft focused until its clicked action has saved or deliberately retained it.
  $('original-ledger-workbook').addEventListener('pointerdown',event=>{
    if(editor&&!event.target.closest('#workbook-cell-editor')&&event.target.closest('td,button'))event.preventDefault();
  });
  function reloadWorkbook(){return run(async()=>{
    status('전체 시트와 엑셀을 가져오는 중입니다.');
    const result=await window.aroundG.loadLedgerWorkbook();
    if(result.ok)accept(result.workbook);else status(messages[result.code] || `가져오기 실패: ${result.code || '알 수 없는 오류'}`);
  });}
  $('workbook-import').addEventListener('click',()=>needsRefresh?reloadWorkbook():afterEdit(reloadWorkbook));
  $('workbook-export').addEventListener('click',()=>afterEdit(()=>run(async()=>{
    const result=await window.aroundG.exportLedgerWorkbook();
    if(result.ok)status('Excel 내보내기 완료. 모든 시트·수식과 내부에서 저장한 수정 내용이 포함되었습니다.');
    else if(!result.canceled)status(messages[result.code] || '엑셀 내보내기에 실패했습니다.');
  })));
  $('workbook-hidden').addEventListener('change',()=>afterEdit(()=>{clearSelection();page=0;tabs();render();}));
  $('workbook-prev').addEventListener('click',()=>afterEdit(()=>{if(page>0){clearSelection();page--;render();}}));
  $('workbook-next').addEventListener('click',()=>afterEdit(()=>{clearSelection();page++;render();}));
  const poizonStatus=payload=>{
    if(!payload)return;
    $('workbook-poizon-sync-status').textContent=payload.message||'포이즌 주문 확인 대기 중';
    $('workbook-poizon-sync').disabled=payload.state==='running';
    const review=Array.isArray(payload.review)?payload.review:[];
    $('workbook-poizon-review').hidden=!review.length;
    $('workbook-poizon-review-count').textContent=String(review.length);
    $('workbook-poizon-review-list').replaceChildren(...review.slice(0,100).map(item=>{
      const li=document.createElement('li');li.textContent=`주문 ${item.orderNumber||'번호 없음'} · ${item.reason}`;return li;
    }));
    if(payload.state==='complete'&&payload.updated&&!busy&&!hasPendingEdit())run(async()=>{
      const result=await window.aroundG.loadLedgerWorkbook();
      if(result.ok)accept(result.workbook);
    });
  };
  window.aroundG.onPoizonLedgerSyncProgress?.(poizonStatus);
  window.aroundG.getPoizonLedgerSyncStatus?.().then(poizonStatus).catch(()=>{});
  $('workbook-poizon-open').addEventListener('click',()=>window.aroundG.openSellerCenter());
  $('workbook-poizon-sync').addEventListener('click',()=>window.aroundG.syncPoizonLedgerSales().then(result=>poizonStatus(result.status)).catch(error=>{
    $('workbook-poizon-sync-status').textContent=`포이즌 주문 확인 실패: ${error.message}`;
  }));
  run(async()=>{const result=await window.aroundG.loadLedgerWorkbook();if(result.ok){accept(result.workbook);needsRefresh=Boolean(result.needsRefresh);if(needsRefresh)status(messages.WORKBOOK_REFRESH_REQUIRED);}else status(messages[result.code] || '장부를 불러오지 못했습니다.');});
})();
