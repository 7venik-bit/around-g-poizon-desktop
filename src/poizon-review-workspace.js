import { normalizeVerificationConditions, verificationConditionLabel } from '../services/live-poizon-crosscheck.mjs';
import { indexProductIdentities, resolveProductIdentity } from '../services/poizon-product-identity.mjs';
import { reviewTone, reviewReportText } from '../services/poizon-review-session.mjs';

let active = null, latestReport = null;
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const number = (value) => Number(value || 0).toLocaleString('ko-KR');
const safeImage = (url) => /^https?:\/\//i.test(String(url || '')) ? String(url) : '';
export const reviewIsRunning = () => active?.running === true;

export async function openReviewPopup(hostWindow = window) {
  const popup = hostWindow.open('./poizon-review-popup.html', 'around-g-poizon-review', 'popup=yes,width=1080,height=860');
  if (!popup) throw new Error('POIZON 대조 알림창을 열지 못했습니다. 팝업 허용 상태를 확인해 주세요.');
  const started = Date.now();
  // window.open initially exposes a ready about:blank document. Do not draw
  // into it: navigation to the real review page would immediately erase UI.
  while (Date.now() - started < 10_000) {
    const loadedReviewPage = /poizon-review-popup\.html(?:[?#]|$)/.test(String(popup.location?.href || ''));
    if (loadedReviewPage && popup.document?.body && popup.document.readyState === 'complete') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!/poizon-review-popup\.html(?:[?#]|$)/.test(String(popup.location?.href || '')) || !popup.document?.body) {
    popup.close();
    throw new Error('POIZON 대조 알림창 준비에 실패했습니다.');
  }
  popup.focus();
  return popup.document;
}

export function installVerificationControls(doc = document) {
  // A self-hosted CSS file works under the application's style-src 'self' CSP.
  if (!doc.getElementById('poizon-review-styles')) {
    const link = doc.createElement('link'); link.id = 'poizon-review-styles';
    link.rel = 'stylesheet'; link.href = './poizon-review-workspace.css'; doc.head.append(link);
  }
  if (!doc.getElementById('poizon-verification-controls')) {
    const host = doc.getElementById('explorer-files');
    if (!host) return;
    const panel = doc.createElement('section'); panel.id = 'poizon-verification-controls';
    panel.innerHTML = '<strong>POIZON 대조 조건</strong><label>중국 최근 30일<input id="poizon-verification-china" type="number" min="0" placeholder="전체"></label><label>현지 최근 30일<input id="poizon-verification-local" type="number" min="0" placeholder="전체"></label>';
    host.prepend(panel);
    doc.getElementById('poizon-verification-china').value = doc.getElementById('category-min-china-sales-30')?.value ?? '';
    doc.getElementById('poizon-verification-local').value = doc.getElementById('category-min-local-sales-30')?.value ?? '';
  }
}
export function readVerificationConditions(doc = document) {
  installVerificationControls(doc);
  const read = (id) => doc.getElementById(id)?.value ?? '';
  return normalizeVerificationConditions({ minimumChinaSales30: read('poizon-verification-china'), minimumLocalSales30: read('poizon-verification-local') });
}

export function showReviewReport(report = latestReport, doc = document) {
  if (!report) return;
  latestReport = report;
  let dialog = doc.getElementById('poizon-review-report');
  if (!dialog) {
    dialog = doc.createElement('dialog'); dialog.id = 'poizon-review-report';
    dialog.innerHTML = '<h3>전체 대조 결과 · 자동 교정</h3><p>POIZON 화면값을 기준으로 Excel을 수정하고 저장 후 재검증합니다.</p><textarea readonly aria-label="복사할 대조 결과"></textarea><footer><span role="status"></span><button type="button" class="review-copy">전체 복사</button><button type="button" class="review-dismiss">닫기</button></footer>';
    doc.body.append(dialog);
    dialog.querySelector('.review-dismiss').onclick = () => dialog.close();
    dialog.querySelector('.review-copy').onclick = async () => {
      const area = dialog.querySelector('textarea'); const status = dialog.querySelector('[role="status"]');
      try { await doc.defaultView.navigator.clipboard.writeText(area.value); status.textContent = '복사 완료'; }
      catch { area.focus(); area.select(); status.textContent = doc.execCommand?.('copy') ? '복사 완료' : 'Ctrl+C로 복사해 주세요.'; }
    };
  }
  dialog.querySelector('textarea').value = reviewReportText(report);
  dialog.querySelector('[role="status"]').textContent = '';
  if (!dialog.open) dialog.showModal();
}

export function beginLiveVerification({ file, brandName, excelProducts = [], snapshot, conditions = {}, api = window.aroundG, doc = document }) {
  if (active?.running) throw new Error('다른 교차 검증이 진행 중입니다.');
  active?.dispose();
  installVerificationControls(doc);
  const products = snapshot?.products || excelProducts;
  const headers = snapshot?.headers || [];
  const frozen = normalizeVerificationConditions(conditions);
  const runId = globalThis.crypto?.randomUUID?.() || `review-${Date.now()}-${Math.random()}`;
  const verificationFilePath = String(file.path || file.filePath || file.fullPath || snapshot?.file?.path || snapshot?.path || '').trim();
  const input = { runId, brandName, fileName: file.name || '', filePath: verificationFilePath, screenOnly: true, conditions: frozen,
    excelProducts: products.map(({ sourceValues, ...p }) => p) };
  const index = indexProductIdentities(products);
  const pageEvents = new Map();
  const completedActions = new Set();
  let currentRows = [], cumulative = [], pageOffset = 0, finished = false, stopped = false, lastData = 0, lastStatus = Date.now();
  let state = { checkedProducts: 0, equalProducts: 0, differentProducts: 0, missingProducts: 0, deferredProducts: 0, pageNum: 0, pageCount: 0 };
  const started = Date.now();
  doc.getElementById('poizon-review-workspace')?.remove();
  const panel = doc.createElement('section'); panel.id = 'poizon-review-workspace'; panel.setAttribute('aria-label', 'Excel 실시간 대조 목록');
  panel.innerHTML = `<header class="review-top"><div><h2>Excel 대조 목록</h2><p class="review-file"></p></div><button type="button" class="review-close" disabled>닫기</button></header>
    <div class="review-brief"><span class="review-condition"></span><span class="review-loaded"></span></div>
    <div class="review-status"><strong class="review-phase" role="status" aria-live="polite">전체 Excel 읽기 완료 · POIZON 첫 페이지 대기</strong><span class="review-clock"></span></div>
    <div class="review-tools"><span class="review-counters"></span><label><input class="review-follow" type="checkbox" checked>자동 따라가기</label></div>
    <div class="review-legend"><span data-tone="equal">일치</span><span data-tone="different">값 다름</span><span data-tone="missing">Excel 상품 없음/추가</span><span data-tone="unknown">기준·값 미확인</span></div>
    <div class="review-table-scroll" tabindex="0"><table class="review-table"><thead><tr><th>Excel 상품 · 원본 행</th><th>중국 최근 30일<br>Excel → POIZON</th><th>현지 최근 30일<br>Excel → POIZON</th><th>대조 결과</th></tr></thead><tbody></tbody></table></div>
    <footer class="review-bottom"><button class="review-prev" type="button">이전</button><span class="review-page"></span><button class="review-next" type="button">다음</button><button class="review-auto-all" type="button">전체 자동 수정 시작</button><button class="review-report" type="button" disabled>대조 결과</button><small>POIZON 기준 자동 교정</small></footer>`;
  doc.body.append(panel); doc.body.classList.add('poizon-review-open');
  const get = (s) => panel.querySelector(s);
  get('.review-file').textContent = `${brandName || file.brandName || ''} · ${file.name || file.path}`;
  get('.review-condition').textContent = verificationConditionLabel(frozen);
  get('.review-loaded').textContent = `Excel 전체 ${number(products.length)}행 읽기 완료`;
  const matches = (r) => resolveProductIdentity({ spuId: r.spuId, articleNumber: r.articleNumber }, index).products;
  const frame = (fn) => doc.defaultView?.requestAnimationFrame ? doc.defaultView.requestAnimationFrame(fn) : setTimeout(fn, 0);
  const renderClock = () => {
    get('.review-clock').textContent = `경과 ${Math.floor((Date.now() - started) / 1000)}초 · ${lastData ? '최근 대조 ' + Math.floor((Date.now() - lastData) / 1000) + '초 전' : '대조 대기'}`;
  };
  const renderRows = (follow = false) => {
    const rows = finished ? cumulative : currentRows;
    pageOffset = Math.max(0, Math.min(pageOffset, Math.max(0, Math.floor((rows.length - 1) / 50) * 50)));
    const visible = rows.slice(pageOffset, pageOffset + 50);
    get('tbody').innerHTML = visible.map((r, position) => {
      const originals = matches(r), product = originals[0] || {}, image = safeImage(product.logoUrl);
      const options = originals.length ? `<details data-review-options="${position}"><summary>원본 Excel ${number(originals.length)}행 보기</summary><div class="review-original"></div></details>` : '';
      const activeRow = state.activeKey && r.key === state.activeKey ? ' data-active="true"' : '';
      const action = r.requiredAction === 'correct' ? '<b class="review-auto-pending">전체 자동 수정 대기</b>'
        : r.requiredAction === 'add' ? '<b class="review-auto-pending">전체 자동 추가 대기</b>'
        : r.actionComplete || r.equal ? '<b class="review-ok">OK</b>' : '<button type="button" disabled>확인 필요</button>';
      return `<tr data-tone="${reviewTone(r)}" data-review-key="${escape(r.key)}"${activeRow}><td>${image ? `<img class="review-image" src="${escape(image)}" alt="">` : ''}<b>${escape(product.articleNumber || r.articleNumber || r.spuId || '식별자 없음')}</b><small>${escape(product.title || r.title || '')}</small><small>SPU ${escape(r.spuId || '-')} · 원본 행 ${escape((r.excelRows || []).join(', ') || '없음')}</small>${options}</td><td>${escape(r.excelChina)}<br>→ <b>${escape(r.sourceChina)}</b></td><td>${escape(r.excelLocal)}<br>→ <b>${escape(r.sourceLocal)}</b></td><td>${escape(r.status)}<small>${r.qualified ? '조건 충족' : '조건 미충족/미확인'}</small>${action}</td></tr>`;
    }).join('') || '<tr><td colspan="4">전체 Excel 목록을 읽었습니다. POIZON 첫 페이지를 읽으면 동일 상품을 화면 순서대로 표시합니다.</td></tr>';
    for (const detail of panel.querySelectorAll('[data-review-options]')) {
      const originals = matches(visible[Number(detail.dataset.reviewOptions)]);
      const draw = (offset = 0) => {
        const host = detail.querySelector('.review-original');
        const head = headers.length ? headers : ['행', '상품번호', '옵션', '중국 총판매량(원본)', '현지 총판매량(원본)'];
        host.innerHTML = `<div class="review-original-scroll"><table><thead><tr><th>원본 행</th>${head.map((h) => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${originals.slice(offset, offset + 100).map((p) => `<tr><td>${p.sourceRowNumber}</td>${(p.sourceValues || [p.sourceRowNumber, p.articleNumber, p.option, p.totalSalesRaw, p.localTotalSalesRaw]).map((v) => `<td>${escape(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><button class="original-prev" type="button" ${offset ? '' : 'disabled'}>이전 100행</button><span>${offset + 1}~${Math.min(originals.length, offset + 100)} / ${originals.length}행</span><button class="original-next" type="button" ${offset + 100 < originals.length ? '' : 'disabled'}>다음 100행</button>`;
        host.querySelector('.original-prev').onclick = () => draw(Math.max(0, offset - 100));
        host.querySelector('.original-next').onclick = () => draw(offset + 100);
      };
      detail.ontoggle = () => { if (detail.open && !detail.querySelector('.review-original').innerHTML) draw(); };
    }
    get('.review-page').textContent = `${finished ? '누적 결과' : 'POIZON 화면 순서'} · ${state.pageNum}/${state.pageCount || '?'}페이지 · ${number(rows.length)}상품`;
    get('.review-prev').disabled = pageOffset === 0;
    get('.review-next').disabled = pageOffset + 50 >= rows.length;
    if (follow && get('.review-follow').checked) frame(() => {
      if (!panel.isConnected || stopped && !finished) return;
      const box = get('.review-table-scroll'); box.scrollTop = box.scrollHeight;
    });
  };
  const unsubscribe = api.onSellerVerificationProgress((event) => {
    if (stopped || event.runId !== runId) return;
    lastStatus = Date.now();
    if (event.phase === 'page-compared') {
      state = event; currentRows = (event.rows || []).map((row) => completedActions.has(row.key)
        ? { ...row, requiredAction:'', actionComplete:true, equal:true, status:'수정·추가 및 재검증 완료 · OK' } : row); lastData = Date.now();
      pageEvents.set(Number(event.pageNum), event); pageOffset = 0;
      get('.review-phase').textContent = `POIZON ${event.pageNum}/${event.pageCount}페이지 · 상품 ${event.pageReadCount || currentRows.length}/${event.pageProductCount || currentRows.length} 실시간 검색·대조 중`;
      get('.review-counters').textContent = `누적 ${number(state.checkedProducts)} · 상품 인식 ${number(state.matchedProducts)} · 판매량 일치 ${number(state.equalProducts)} · 판매량 수정/확인 ${number(state.differentProducts)} · 옵션 비교 보류 ${number(state.deferredProducts)} · 기타 미확인 ${number(Math.max(0, Number(state.unconfirmedProducts || 0) - Number(state.deferredProducts || 0)))} · Excel 누락 ${number(state.missingProducts)}`;
      renderRows(true);
    } else if (event.phase === 'product-action-required') {
      currentRows = currentRows.map((row) => row.key === event.productKey ? { ...row, requiredAction:event.requiredAction } : row);
      state = { ...state, activeKey:event.activeKey }; renderRows(true);
      get('.review-phase').textContent = event.message;
      doc.defaultView?.focus();
    } else if (event.phase === 'product-action-complete') {
      completedActions.add(event.productKey);
      currentRows = currentRows.map((row) => row.key === event.productKey ? { ...row, requiredAction:'', actionComplete:true, equal:true, status:event.message } : row);
      state = { ...state, activeKey:event.activeKey }; renderRows(true);
      get('.review-phase').textContent = event.message;
    } else if (event.message) {
      if (event.activeKey === '') { state = { ...state, activeKey:'' }; renderRows(); }
      get('.review-phase').textContent = event.message;
    }
    renderClock();
  });
  const timer = setInterval(renderClock, 1000);
  const dispose = () => { if (stopped) return; stopped = true; clearInterval(timer); unsubscribe?.(); if (active?.input.runId === runId) active.running = false; };
  get('.review-prev').onclick = () => { pageOffset -= 50; get('.review-follow').checked = false; renderRows(); };
  get('.review-next').onclick = () => { pageOffset += 50; get('.review-follow').checked = false; renderRows(); };
  get('.review-auto-all').onclick = async () => {
    const button = get('.review-auto-all');
    button.disabled = true; button.textContent = '전체 자동 수정 실행 중';
    const result = await api.confirmSellerVerificationAction({ runId, productKey:'__ALL__', action:'auto' });
    if (!result?.ok) { button.disabled = false; button.textContent = '전체 자동 수정 시작'; }
    else get('.review-phase').textContent = '전체 자동 수정 승인 완료 · 페이지별 일괄 저장 및 재검증 중';
  };
  get('.review-report').onclick = () => showReviewReport(latestReport, doc);
  const handle = {
    input, running: true, dispose,
    events: () => [...pageEvents.values()],
    saving() { get('.review-phase').textContent = '전체 대조 완료 · POIZON 값으로 Excel 수정 및 저장 후 재검증 중'; },
    finish(result = {}) {
      finished = true; cumulative = [...pageEvents].sort((a, b) => a[0] - b[0]).flatMap(([, e]) => e.rows)
        .map((row) => result.corrected && (reviewTone(row) === 'different' || /새 행 추가 대상/.test(row.status || ''))
          ? { ...row, matched: true, equal: true, status: /새 행 추가 대상/.test(row.status || '')
            ? 'POIZON 값으로 새 행 추가 완료 · 저장 후 재검증 완료'
            : 'POIZON 값으로 수정 완료 · 저장 후 재검증 완료' } : row);
      pageOffset = 0;
      get('.review-phase').textContent = result.ok ? `대조 완료 · 기존 ${Number(result.changedRows || 0).toLocaleString('ko-KR')}행 수정 · 누락 ${Number(result.addedRows || 0).toLocaleString('ko-KR')}행 추가 · 재검증 완료` : `검증 미완료 · ${result.message || '전체 페이지 확인 실패'}`;
      get('.review-close').disabled = false; renderRows(); dispose();
    },
    showReport(report) { latestReport = report; get('.review-report').disabled = false; showReviewReport(report, doc); },
  };
  get('.review-close').onclick = async () => {
    if (handle.running) return;
    dispose(); panel.remove(); doc.body.classList.remove('poizon-review-open');
    await api.endSellerExcelVerification?.();
    if (doc.defaultView && doc.defaultView !== window) doc.defaultView.close();
  };
  active = handle; renderRows(); renderClock(); return handle;
}
