// Self-contained: serialized into the controlled Seller Center renderer.
export function paintReviewPage(document, payload) {
  const palette = { equal: '#eaf7ef', different: '#fff3df', missing: '#fff0ee', unknown: '#f0f3f7' };
  const color = { equal: '#27845b', different: '#ad7417', missing: '#b5453b', unknown: '#728096' };
  const rows = payload.rows || [];
  const normalize = (s) => String(s || '').normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
  for (const element of document.querySelectorAll('table tbody tr')) {
    // React may reuse the same tr for a different product on the next page.
    // A missing/ambiguous identifier must not inherit the previous green state.
    if (element.dataset.aroundGReviewStyle) {
      try { Object.assign(element.style, JSON.parse(element.dataset.aroundGReviewStyle)); } catch {}
      delete element.dataset.aroundGReviewStyle;
      delete element.dataset.aroundGVerification;
      delete element.dataset.aroundGReviewKey;
    }
    const text = String(element.innerText || '');
    const spu = text.match(/SPU\s*[_\s]*ID\s*[:：]\s*([\d]+)/i)?.[1];
    const code = text.match(/(?:상품\s*번호|货号)\s*[:：]\s*([^\s]+)/)?.[1];
    const candidates = spu ? rows.filter((r) => String(r.spuId) === spu)
      : code ? rows.filter((r) => normalize(r.articleNumber) === normalize(code)) : [];
    const match = candidates.length === 1 ? candidates[0] : null;
    if (!match) continue;
    const tone = !match.matched ? 'missing' : match.equal ? 'equal' : /미확인|기준|없음/.test(match.status || '') ? 'unknown' : 'different';
    element.dataset.aroundGReviewStyle = JSON.stringify({
      backgroundColor: element.style.backgroundColor || '', outline: element.style.outline || '', outlineOffset: element.style.outlineOffset || '',
    });
    element.style.backgroundColor = palette[tone];
    element.style.outline = '2px solid ' + color[tone]; element.style.outlineOffset = '-2px';
    element.dataset.aroundGVerification = tone;
    element.dataset.aroundGReviewKey = match.key;
  }
  let banner = document.getElementById('around-g-live-verification');
  if (!banner) {
    banner = document.createElement('div'); banner.id = 'around-g-live-verification';
    banner.style.position = 'sticky'; banner.style.top = '0'; banner.style.zIndex = '2147483000';
    banner.style.backgroundColor = '#eef5ff'; banner.style.color = '#173456';
    banner.style.padding = '8px 12px'; banner.style.fontSize = '13px'; document.body.prepend(banner);
  }
  banner.textContent = `Excel 대조 ${payload.pageNum}/${payload.pageCount}페이지 · 초록 일치 / 주황 값 다름 / 빨강 연결 불가 / 회색 기준·값 미확인`;
}
