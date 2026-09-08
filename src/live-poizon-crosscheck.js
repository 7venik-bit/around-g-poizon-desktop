import { normalizeVerificationConditions, verificationConditionLabel, createPageCrossCheck } from '../services/live-poizon-crosscheck.mjs';

let active = null;
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const number = (value) => Number(value || 0).toLocaleString('ko-KR');
const value = (node) => node?.value === '' || !node ? null : Number(node.value);

export function installVerificationControls(doc = document) {
  if (!doc.getElementById('poizon-verification-controls')) {
    const host = doc.getElementById('explorer-files');
    if (!host) return;
    const panel = doc.createElement('section');
    panel.id = 'poizon-verification-controls';
    panel.innerHTML = `<strong>POIZON·Excel 공통 검증 조건</strong><small>최근 30일 판매량 · 두 조건 모두 충족 (AND) · 빈칸은 조건 없음</small>
      <div class="live-condition-inputs"><label>중국 최근 30일 최소<input id="poizon-verification-china" type="number" min="0" step="1" placeholder="조건 없음"></label>
      <label>현지 판매자 최근 30일 최소<input id="poizon-verification-local" type="number" min="0" step="1" placeholder="조건 없음"></label></div>`;
    host.prepend(panel);
    doc.getElementById('poizon-verification-china').value = doc.getElementById('category-min-china-sales-30')?.value ?? '';
    doc.getElementById('poizon-verification-local').value = doc.getElementById('category-min-local-sales-30')?.value ?? '';
  }
  if (!doc.getElementById('poizon-verification-css')) {
    const style = doc.createElement('style'); style.id = 'poizon-verification-css';
    style.textContent = `
#poizon-verification-controls{padding:14px;margin:0 0 16px;border:1px solid #8eb5dc;border-radius:10px;background:#f2f8ff;color:#142d48;font-size:14px}
#poizon-verification-controls small{display:block;margin:6px 0}.live-condition-inputs{display:flex;gap:12px;flex-wrap:wrap}.live-condition-inputs label{flex:1;min-width:150px}.live-condition-inputs input{width:100%;box-sizing:border-box;margin-top:5px}
#excel-preview.poizon-live-mode>:not(#poizon-live-check){display:none!important}
#poizon-live-check{display:block!important;background:white;color:#142d48;font:14px/1.55 system-ui,sans-serif;min-width:0}
#poizon-live-check .live-head{position:sticky;top:0;z-index:20;background:#eef6ff;border:1px solid #8eb5dc;border-radius:8px;padding:12px}
#poizon-live-check h3{font-size:17px;margin:0 0 6px}#poizon-live-check p{margin:6px 0;overflow-wrap:anywhere}
#poizon-live-check .live-metrics{display:flex;flex-wrap:wrap;gap:6px 14px;margin:8px 0}#poizon-live-check .live-metrics b{font-size:16px}
#poizon-live-check .live-table{overflow:auto;max-height:55vh;margin-top:10px}#poizon-live-check table{width:100%;border-collapse:collapse;table-layout:auto!important}
#poizon-live-check th,#poizon-live-check td{font-size:13px!important;padding:8px!important;min-width:64px;white-space:normal!important;border-bottom:1px solid #dce4ed;text-align:left}
#poizon-live-check th{position:sticky;top:0;background:#e8f0f8;color:#142d48}#poizon-live-check td small{display:block;color:#53667c}
#poizon-live-check tr.live-different{background:transparent}#poizon-live-check tr.live-missing{background:#fde8e8}#poizon-live-check button{margin:6px 5px 0 0;padding:6px 10px;font-size:13px}#poizon-live-check .live-error{color:#9b391b;font-weight:700}
#poizon-live-check .live-clock{color:#526779;font-size:12px}.poizon-live-mode #poizon-live-check input[readonly]{background:#fff;color:#142d48}
`;
    doc.head.append(style);
  }
}

export function readVerificationConditions(doc = document) {
  installVerificationControls(doc);
  return normalizeVerificationConditions({
    minimumChinaSales30: value(doc.getElementById('poizon-verification-china')),
    minimumLocalSales30: value(doc.getElementById('poizon-verification-local')),
  });
}

export function beginLiveVerification({ file, brandName, excelProducts, conditions, api = window.aroundG, doc = document }) {
  if (active?.running) throw new Error('다른 POIZON 교차 검증이 진행 중입니다.');
  active?.dispose();
  installVerificationControls(doc);
  const frozen = normalizeVerificationConditions(conditions);
  const runId = globalThis.crypto?.randomUUID?.() || `verify-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const input = { runId, brandName, fileName: file.name || '', excelProducts, conditions: frozen };
  const preview = doc.getElementById('excel-preview');
  if (!preview) throw new Error('Excel 검증 화면을 찾을 수 없습니다.');
  doc.getElementById('poizon-live-check')?.remove();
  const panel = doc.createElement('section'); panel.id = 'poizon-live-check';
  panel.innerHTML = `<div class="live-head"><h3>POIZON ↔ Excel 실시간 교차 검증</h3><p class="live-file"></p>
    <div class="live-condition-inputs"><label>중국 최근 30일 최소<input class="live-china" type="number" readonly></label><label>현지 판매자 최근 30일 최소<input class="live-local" type="number" readonly></label></div>
    <p class="live-condition"></p><p class="live-phase" role="status" aria-live="polite"></p><div class="live-metrics"></div><p class="live-clock"></p>
    <small>POIZON 화면값을 최종 기준으로 사용합니다. Excel 누락 또는 값 불일치는 POIZON 값으로 원본 셀을 수정하고 저장 후 다시 읽어 일치 여부를 재검증합니다.</small></div>
    <p class="live-current"></p><label><input class="live-show-all" type="checkbox" checked> 조건 미충족 상품도 대조 내역 보기</label>
    <div class="live-table"><table><thead><tr><th>상품번호 / Excel 행</th><th>중국 최근 30일<br>Excel → POIZON</th><th>현지 최근 30일<br>Excel → POIZON</th><th>대조·수정 결과</th></tr></thead><tbody></tbody></table></div>
    <div><button class="live-prev" type="button">이전</button><span class="live-page"></span><button class="live-next" type="button">다음</button><button class="live-raw" type="button">원본 Excel 보기</button></div>`;
  preview.prepend(panel); preview.hidden = false; preview.classList.add('poizon-live-mode');
  const get = (selector) => panel.querySelector(selector);
  get('.live-file').textContent = `${brandName} · ${file.name || file.path}`;
  get('.live-china').value = frozen.minimumChinaSales30 ?? '';
  get('.live-local').value = frozen.minimumLocalSales30 ?? '';
  get('.live-condition').textContent = `양쪽 동일 조건: ${verificationConditionLabel(frozen)}`;
  const disabled = ['poizon-verification-china', 'poizon-verification-local', 'excel-preview-close', 'import-button', 'category-search'].map((id) => doc.getElementById(id)).filter(Boolean).map((node) => [node, node.disabled]);
  disabled.forEach(([node]) => { node.disabled = true; });
  const allRows = new Map();
  let state = { checkedProducts: 0, equalProducts: 0, differentProducts: 0, missingProducts: 0, qualifiedProducts: 0, pageNum: 0, pageCount: 0 };
  let phase = '준비 중 · 아직 비교한 상품이 없습니다.', lastUpdate = Date.now(), lastData = 0, currentRows = [], page = 0, finished = false, failed = false, stopped = false;
  const start = Date.now();
  const renderClock = () => {
    const now = Date.now();
    get('.live-clock').textContent = `경과 ${Math.floor((now - start) / 1000)}초 · 마지막 상태 갱신 ${Math.floor((now - lastUpdate) / 1000)}초 전${lastData ? ` · 마지막 상품 대조 ${new Date(lastData).toLocaleTimeString('ko-KR')}` : ' · 상품 대조 대기'}`;
  };
  const render = () => {
    get('.live-phase').textContent = phase;
    get('.live-phase').className = failed ? 'live-phase live-error' : 'live-phase';
    get('.live-metrics').innerHTML = `대조 <b>${number(state.checkedProducts)}</b>상품 · 일치 <b>${number(state.equalProducts)}</b> · 수정 대상/확인 보류 <b>${number(state.differentProducts)}</b> · 연결 불가 <b>${number(state.missingProducts)}</b> · 조건 충족 <b>${number(state.qualifiedProducts)}</b>`;
    get('.live-current').textContent = finished ? `누적 대조 결과 · POIZON ${state.pageNum}/${state.pageCount || '?'}페이지 확인`
      : `현재 POIZON ${state.pageNum || 0}/${state.pageCount || '?'}페이지와 동일 상품 대조 · 페이지당 결과 표시`;
    const rows = (finished ? [...allRows.values()] : currentRows).filter((r) => !finished || get('.live-show-all').checked || r.qualified);
    page = Math.min(page, Math.max(0, Math.ceil(rows.length / 20) - 1));
    get('tbody').innerHTML = rows.slice(page * 20, page * 20 + 20).map((r) => `<tr class="${!r.matched && !r.identityConflict ? 'live-missing' : ''}"><td><b>${escape(r.articleNumber || r.spuId || '식별자 없음')}</b><small>SPU ${escape(r.spuId || '-')} · 행 ${escape((r.excelRows || []).join(', ') || '연결 안됨')}</small></td><td>${escape(r.excelChina)} → <b>${escape(r.sourceChina)}</b></td><td>${escape(r.excelLocal)} → <b>${escape(r.sourceLocal)}</b></td><td>${escape(r.status)}<small>${r.qualified ? '조건 충족' : '조건 미충족'}</small>${r.afterStatus ? `<small>${escape(r.afterStatus)}</small>` : ''}</td></tr>`).join('') || `<tr><td colspan="4">${finished && !failed ? '동일 조건으로 대조한 결과에 표시할 상품이 없습니다.' : state.pageNum ? '이번 대조 범위에서 조건에 맞는 상품이 없습니다. 아직 전체 검색 결과는 아닙니다.' : 'POIZON의 첫 페이지를 읽으면 실제 비교 결과가 표시됩니다.'}</td></tr>`;
    get('.live-page').textContent = ` ${page + 1} / ${Math.max(1, Math.ceil(rows.length / 20))} · ${number(rows.length)}상품 `;
    get('.live-prev').disabled = page === 0; get('.live-next').disabled = (page + 1) * 20 >= rows.length;
    get('.live-raw').disabled = !finished;
    if (!finished && currentRows.length) {
      const tableHost = get('.live-table');
      const scrollLatest = () => {
        tableHost.scrollTop = tableHost.scrollHeight;
        get('tbody tr:last-child')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
      };
      if (typeof globalThis.requestAnimationFrame === 'function') globalThis.requestAnimationFrame(scrollLatest);
      else scrollLatest();
    }
    renderClock();
  };
  const unsubscribe = api.onSellerVerificationProgress((event) => {
    if (stopped || event.runId !== runId) return;
    lastUpdate = Date.now();
    if (event.phase === 'page-compared') {
      state = event; lastData = Date.now(); currentRows = event.rows || []; page = 0;
      for (const [key, row] of allRows) if (row.pageNum === event.pageNum) allRows.delete(key);
      for (const row of currentRows) allRows.set(row.key, row);
      phase = currentRows.some((row) => !row.matched && !row.identityConflict)
        ? `POIZON ${event.pageNum}/${event.pageCount}페이지 · Excel 누락 확인 · 수정/저장/재검증 완료 전에는 다음 페이지로 이동하지 않습니다.`
        : `POIZON ${event.pageNum}/${event.pageCount}페이지 · 상품 대조 완료 · 수정/저장/재검증 확인 중`;
    } else if (event.message) phase = event.message;
    render();
  });
  const timer = setInterval(renderClock, 1000);
  get('.live-show-all').onchange = () => { page = 0; render(); };
  get('.live-prev').onclick = () => { page -= 1; render(); };
  get('.live-next').onclick = () => { page += 1; render(); };
  get('.live-raw').onclick = () => { preview.classList.remove('poizon-live-mode'); panel.remove(); };
  const dispose = () => { if (stopped) return; stopped = true; clearInterval(timer); unsubscribe?.(); disabled.forEach(([node, was]) => { node.disabled = was; }); };
  const handle = {
    input, running: true, dispose,
    saving() { phase = '페이지별 검증 완료 후 최종 전체 재검증 중 · 원본 백업은 유지합니다.'; lastUpdate = Date.now(); render(); },
    finish(result = {}) {
      if (stopped) return;
      finished = true; handle.running = false; lastUpdate = Date.now(); failed = result.ok !== true;
      if (result.ok && Array.isArray(result.afterProducts) && Array.isArray(result.screenProducts)) {
        const reread = createPageCrossCheck({ runId: runId + ':reread', excelProducts: result.afterProducts, conditions: frozen });
        const after = reread.acceptPage(result.screenProducts, { pageNum: state.pageNum, pageCount: state.pageCount });
        const afterByKey = new Map(after.rows.map((row) => [row.key, row]));
        for (const row of allRows.values()) row.afterStatus = afterByKey.get(row.key)?.equal ? 'POIZON 값으로 수정 후 일치 확인' : '수정 후 추가 확인 필요';
        failed = after.differentProducts + after.missingProducts > 0;
        phase = `${failed ? '대조·수정 완료 · 추가 확인 필요' : '대조·수정·재검증 완료'} · Excel 수정 ${number(result.changedRows)}행 · 재읽기 일치 ${number(after.equalProducts)}상품 · 추가 확인 ${number(after.differentProducts + after.missingProducts)}상품`;
      } else phase = result.ok ? '대조 완료 · Excel과 POIZON 값이 이미 일치하여 수정 없음' : `검증 미완료 · ${result.message || 'POIZON 화면 수집에 실패했습니다.'} · 부분 결과를 완료로 저장하지 않았습니다.`;
      render(); dispose();
    },
  };
  active = handle; render(); return handle;
}
