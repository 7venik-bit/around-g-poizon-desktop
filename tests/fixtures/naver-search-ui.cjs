// Network fixture only: production code must click the menu, type into the
// real field and submit this form to reach the result document.
module.exports = rawUrl => {
  const url = new URL(rawUrl);
  if (url.hostname !== 'shopping.naver.com') return null;
  const prefix = '<!doctype html><meta charset="utf-8"><style>input{width:400px;height:40px}button,a{display:inline-block;padding:15px}</style>';
  if (url.pathname === '/ns/home') return prefix + '<nav><a target="_blank" href="/window/main/fashion">패션타운</a></nav>';
  if (url.pathname === '/window/main/fashion') return prefix + '<title>패션타운</title><form action="/window/search/fashion-group"><input name="q" placeholder="상품명 또는 브랜드" aria-label="상품명 또는 브랜드"><button type="submit" aria-label="검색">검색</button></form>';
  return null;
};
