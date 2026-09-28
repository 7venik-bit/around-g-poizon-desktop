export const SELLER_PRODUCT_SEARCH_URL = 'https://seller.poizon.com/main/goods/search';

export function sellerProductId(product = {}) {
  if (!product || typeof product !== 'object') return '';
  // Seller Search labels globalSpuId as SPU_ID; exported workbooks call it spuId.
  // Public catalog records can also carry a different, local spuId.
  const value = product.globalSpuId ?? (product.source === 'kr-poizon-public-brand' ? '' : product.spuId);
  const raw = String(value ?? '').trim().replace(/\.0+$/, '');
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return '';
  return /^[1-9]\d{0,19}$/.test(raw) ? raw : '';
}

// Inspect only rendered controls. Returned coordinates are used by Electron's
// ordinary input events; no network endpoints or application state are read.
export function inspectSellerProductView({ spuId, stage, article = '' }) {
  const visible = el => !!el && el.getClientRects().length > 0
    && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
  const text = el => String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  const all = (selector, root = document) => [...root.querySelectorAll(selector)].filter(visible);
  const point = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    return x > 0 && y > 0 && x < innerWidth && y < innerHeight ? { x, y } : null;
  };
  if (location.href === 'about:blank') return { wait: true };
  if (location.origin !== 'https://seller.poizon.com') return { error: 'UNEXPECTED_PAGE' };
  if (all('input[type="password"]').length) return { error: 'LOGIN_REQUIRED' };
  const bodyText = text(document.body);
  if (/HTTP\s*403|access denied|접속이 제한|보안 인증|完成验证|captcha/i.test(bodyText)) return { error: 'ACCESS_RESTRICTED' };
  if (location.pathname !== '/main/goods/search') return { wait: true };
  if (all('.ant-spin-spinning,[aria-busy="true"]').length) return { wait: true };
  const rowId = row => text(row).match(/SPU[\s_]*ID\s*[:：]\s*(\d+)/i)?.[1];
  const rows = all('tbody tr').filter(row => rowId(row) === spuId);
  const exactButton = (root, pattern) => all('button,a,[role="button"]', root).find(el => pattern.test(text(el)));
  if (stage === 'detail') {
    const dialogs = all('[role="dialog"],.ant-drawer-content');
    const articlePattern = article && new RegExp('(?:^|[^a-z0-9])' + article.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[^a-z0-9])', 'i');
    const dialog = dialogs.find(el => articlePattern && articlePattern.test(text(el))
      && /거래 추이|거래 내역|최근 30일|Sales Trend|Transaction History|交易趋势/i.test(text(el)));
    return dialog ? { done: true } : { wait: true };
  }
  if (rows.length > 1) return { error: 'AMBIGUOUS_PRODUCT' };
  if (rows.length === 1) {
    const button = exactButton(rows[0], /^(?:상품\s*데이터|Product\s*Data|商品数据)$/i);
    // Take the article from the same rendered row used for the exact SPU match.
    const info = all('td', rows[0]).find(cell => rowId(cell) === spuId);
    const lines = String(info?.innerText || info?.textContent || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const articleLine = lines.findIndex(s => /상품\s*번호\s*[:：]|Article\s*(?:No|Number)\s*[:：]|货号\s*[:：]/i.test(s));
    const observedArticle = articleLine < 0 ? '' : lines[articleLine].replace(/^.*?(?:상품\s*번호|Article\s*(?:No|Number)|货号)\s*[:：]\s*/i, '').trim() || lines[articleLine + 1];
    if (button && observedArticle && point(button)) return { click: point(button), next: 'detail', article: observedArticle };
  }
  if (stage === 'results') return { wait: true };
  if (stage === 'mode') {
    const option = all('.ant-select-item-option,[role="option"]').find(el => /^SPU[\s_]*ID$/i.test(text(el)));
    return option && point(option) ? { click: point(option), next: 'input' } : { wait: true };
  }
  if (stage === 'input') {
    const inputs = all('input[id="globalSpuIdList"]').filter(el => !el.readOnly && !el.disabled);
    return inputs.length && point(inputs.at(-1)) ? { input: point(inputs.at(-1)), next: 'results' } : { wait: true };
  }
  const selects = all('.ant-select');
  const type = selects.find(el => /^(?:상품 정보|상품 번호|SPU_ID|SKU_ID|바코드|Product Information|Article Number)$/i.test(text(el)));
  if (type) return /^SPU_ID$/i.test(text(type)) ? { next: 'input' } : { click: point(type.querySelector('.ant-select-selector') || type), next: 'mode' };
  return { wait: true };
}

const messages = {
  INVALID_SPU: '이 상품의 포이즌 SPU가 없어 상세 화면을 열 수 없습니다.',
  LOGIN_REQUIRED: '판매자센터 로그인이 필요합니다. 열린 창에서 로그인한 뒤 상품 보기 버튼을 다시 눌러 주세요.',
  ACCESS_RESTRICTED: '포이즌 접속 확인이 필요해 자동 이동을 멈췄습니다. 열린 판매자센터 화면을 확인해 주세요.',
  AMBIGUOUS_PRODUCT: '같은 SPU의 상품이 여러 개 보여 자동 이동을 멈췄습니다.',
  UNEXPECTED_PAGE: '판매자센터 화면을 확인할 수 없어 자동 이동을 멈췄습니다.',
  WINDOW_CLOSED: '포이즌 상품 창이 닫혔습니다.',
  PRODUCT_NOT_CONFIRMED: '해당 SPU의 상품 데이터를 확인하지 못했습니다. 열린 판매자센터에서 확인해 주세요.',
};
export function createPoizonProductViewer({ BrowserWindow, icon, wait = ms => new Promise(r => setTimeout(r, ms)), timeoutMs = 30000, now = Date.now }) {
  const pending = new Map();
  const windows = new Set();
  const failure = code => ({ ok: false, code, message: messages[code] || messages.PRODUCT_NOT_CONFIRMED });
  async function openProduct(spuId) {
    let window;
    try {
      window = new BrowserWindow({ width: 1500, height: 940, show: true, icon,
        title: `POIZON 상품 보기 · SPU ${spuId}`, backgroundColor: '#ffffff',
        webPreferences: { partition: 'persist:around-g-poizon-seller', contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
      windows.add(window);
      window.on('closed', () => windows.delete(window));
      // This separate window never navigates an active export/verification window.
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, url) => {
        try { if (new URL(url).origin !== 'https://seller.poizon.com') event.preventDefault(); }
        catch { event.preventDefault(); }
      });
      void window.loadURL(SELLER_PRODUCT_SEARCH_URL).catch(() => {});
      let stage = 'start', article = '', stableDetail = '';
      const deadline = now() + timeoutMs;
      while (now() < deadline) {
        if (window.isDestroyed()) return failure('WINDOW_CLOSED');
        let timer;
        const state = await Promise.race([
          window.webContents.executeJavaScript(`(${inspectSellerProductView.toString()})(${JSON.stringify({ spuId, stage, article })})`, true).catch(() => null),
          new Promise(resolve => { timer = setTimeout(() => resolve(null), 2500); }),
        ]).finally(() => clearTimeout(timer));
        if (state?.error) return failure(state.error);
        if (state?.done) return { ok: true, spuId, message: `SPU ${spuId}의 포이즌 상품 데이터를 열었습니다.` };
        // Search can leave the previous rows mounted behind a loading overlay.
        // Require the same exact row/button position across settled observations.
        if (state?.next === 'detail') {
          const signature = JSON.stringify(state);
          if (stableDetail !== signature) {
            stableDetail = signature;
            await wait(600);
            continue;
          }
        } else stableDetail = '';
        const click = state?.click || state?.input;
        if (click) {
          if (window.isDestroyed()) return failure('WINDOW_CLOSED');
          window.webContents.sendInputEvent({ type: 'mouseMove', ...click });
          window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...click });
          window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...click });
          if (state.input) {
            await wait(150);
            if (window.isDestroyed()) return failure('WINDOW_CLOSED');
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] });
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] });
            await window.webContents.insertText(spuId);
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
          }
        }
        if (state?.article) article = state.article;
        if (state?.next) stage = state.next;
        await wait(300);
      }
      return failure('PRODUCT_NOT_CONFIRMED');
    } catch { return failure(window?.isDestroyed() ? 'WINDOW_CLOSED' : 'PRODUCT_NOT_CONFIRMED'); }
  }
  return { open(product) {
    const spuId = sellerProductId(product);
    if (!spuId) return Promise.resolve(failure('INVALID_SPU'));
    if (pending.has(spuId)) return pending.get(spuId);
    const task = openProduct(spuId).finally(() => pending.delete(spuId));
    pending.set(spuId, task);
    return task;
  } };
}
