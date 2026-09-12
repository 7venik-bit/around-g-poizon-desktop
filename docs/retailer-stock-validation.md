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

## Brand-specific resolution follow-up (2026-09-12)

The initial implementation had 17 dedicated official-search adapters and used
common controls for the rest of the catalog. Adding a stock profile did not
discover a missing official homepage. Domestic search now resolves the requested
catalog brand on demand, independently of the separate full-domain audit and
POIZON verification. A verified search form or interactive homepage is reused;
unconfirmed candidates stay pending. The discovery deadline is 75 seconds and
failed attempts are briefly reused for 15 minutes. Registry saving has a separate
two-second deadline and cannot discard a discovered route.

The curated route list now additionally includes The North Face, Skechers and
Lululemon. Exact aliases and host-first adapters prevent unrelated brands from
borrowing a route. English and Korean catalog identities participate in domain
discovery. A body mention of a brand alone cannot verify a reseller as its
official store.

Live checks in this follow-up:

| Brand | Search / detail | Observed result |
| --- | --- | --- |
| The North Face | `/search?q=NJ1DR65B` → `/product/NJ1DR65B` | One matching product; REAL_BLACK, seven selectable sizes 085(XS)–115(XXXL). The page says membership is required to purchase. |
| Skechers | `/search?q=SP0MRCGY051` → `/product/SP0MRCGY051` | One matching product; BBK, eleven sizes. 275/280/290/300/310 disabled; 250/255/260/265/270/320 selectable. |
| Lululemon | `/ko-kr/home` | Official domain confirmed through public official-site search results; this cloud browser received a Cloudflare access-denied page. Live product/stock capture is unverified. |

Reference pages: https://www.thenorthfacekorea.co.kr/product/NJ1DR65B,
https://www.skecherskorea.co.kr/product/SP0MRCGY051,
https://www.lululemon.co.kr/ko-kr/home.

The North Face search initially applies `sold_out=false` via an active
"품절 상품 제외" control. Clicking that actual control removed the filter.
The collector now disables an explicitly active exclusion before capturing
official results. Hidden restock-modal radios and related colour links identify
other states/SKUs and are excluded from this product. Native radio, select and
button-swatch combinations are traversed together, preserving colour and size.

Live DOM was read by the production capture functions. Product markup is saved
in `northface-options.html` and `skechers-options.html` for runtime regression
tests. This verifies these specific pages, not every product in the 3,300+
brand catalog; proprietary controls, authentication and site access restrictions
can still leave explicit pending/partial inventory.
