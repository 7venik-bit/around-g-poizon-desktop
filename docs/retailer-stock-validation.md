# Retailer stock collection

The stock collector follows the actual detail-page host, including official
stores reached through Naver. It has retailer profiles for the existing official
mall adapters, plus semantic/native-control discovery for other brands. A
profile is a collection strategy, not a claim of complete live brand coverage.

## Observed public pages during this change

| Retailer | Product | Observed stock evidence |
| --- | --- | --- |
| Nike Korea | IM8402-411 | XS/XXL disabled; S/M/L/XL selectable; exact counts not shown |
| SSG | FN3869-010, item 1000759016358 | 100/105 selectable; 085/090/095/110 `(매진)` |
| Naver outlet / Puma | 39884601, item 12460382307 | Black colour and 13 selectable sizes, 220–280; exact counts not shown |
| Lotte On | CD6404-002, LE1219586328 | 14 size options; 6 sold out; 230 says `5개 남음 (품절임박)` |
| Kolon Mall | K1756445756496072BK01 | `현재 구매할 수 없는 상품입니다.` and `품절` |
| Musinsa | SR123UPS11, item 4693117 | Search finds the exact black/white products; this public detail shows `회원 전용`, with no purchasable size controls |

Reference pages:
- https://www.nike.com/kr/t/나이키-스포츠웨어-여성-오버사이즈-트랙-재킷-SJOtPfpF
- https://www.ssg.com/item/itemView.ssg?itemId=1000759016358
- https://shopping.naver.com/window-products/outlet/12460382307
- https://www.lotteon.com/p/product/LE1219586328
- https://www.kolonmall.com/Product/K1756445756496072BK01
- https://www.musinsa.com/products/4693117

Live DOM reads were compared with the new capture functions. Nike, SSG, Naver
and Lotte option markup is retained under `tests/fixtures/retailer-stock/`; the
runtime tests execute the production collector against those structures. The
dependent-control tests simulate colour changes separately. They do not prove
authenticated Windows operation on every merchant or every brand.

## Regression requirements

- Retain numeric zero, nonzero quantities and missing quantity distinctly.
- Traverse dependent colour/size selects and accessible dropdown/radio groups.
- Deduplicate duplicate primary/sticky option widgets (SSG, Naver, Lotte).
- Keep a failed branch partial; never infer all sizes from one colour.
- Preserve completed product checkpoints on timeout and cancellation.
- New detail evidence takes precedence over API cards, particularly sold out.
- Render every captured option in the existing lower results list.
- Run stock strategy, retailer runtime, completion lifecycle, full regression,
  release-patched runtime, and Windows rendered-layout checks before release.
