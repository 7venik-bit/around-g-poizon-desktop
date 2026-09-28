(() => {
  if (globalThis.AroundGPoizonProductView) return;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function button(product = {}) {
    if (!product || typeof product !== 'object') return '';
    const value = product.globalSpuId ?? (product.source === 'kr-poizon-public-brand' ? '' : product.spuId);
    const id = String(value ?? '').trim().replace(/\.0+$/, '');
    if (!/^[1-9]\d{0,19}$/.test(id) || typeof value === 'number' && !Number.isSafeInteger(value)) return '';
    return `<button type="button" class="poizon-product-view" data-poizon-product-spu="${id}" title="SPU ${id} · 판매자센터 상품 데이터 보기" aria-label="${escape(product.articleNumber || product.title || id)} 포이즌 상품 보기">포이즌 상품 보기</button>`;
  }
  document.addEventListener('click', async event => {
    const target = event.target.closest('[data-poizon-product-spu]');
    if (!target || target.disabled) return;
    event.preventDefault();
    target.disabled = true;
    target.textContent = '포이즌 여는 중…';
    let status = document.getElementById('poizon-product-view-status');
    if (!status) {
      status = document.createElement('span');
      status.className = 'poizon-product-view-status';
      status.id = 'poizon-product-view-status';
      status.setAttribute('role', 'status');
      document.body.append(status);
    }
    status.textContent = '';
    try {
      const result = await window.aroundG.openPoizonProduct({ globalSpuId: target.dataset.poizonProductSpu });
      status.textContent = result?.message || '포이즌 상품 화면을 확인하지 못했습니다.';
      status.dataset.state = result?.ok ? 'success' : 'error';
    } catch {
      status.textContent = '포이즌 상품 창을 열지 못했습니다. 다시 눌러 주세요.';
      status.dataset.state = 'error';
    } finally {
      target.disabled = false;
      target.textContent = '포이즌 상품 보기';
    }
  });
  globalThis.AroundGPoizonProductView = { button };
})();
