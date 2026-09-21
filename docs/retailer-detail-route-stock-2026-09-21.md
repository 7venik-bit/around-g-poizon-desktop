# Detail-route and option collection diagnosis, 2026-09-21

The reported SR123UPS11 search stopped at `product_detail_not_ready` with
`https://dk-on.com/DESCENTE/BEST` as its last detail URL. The separate Naver
result reported `naver_rate_limited` at `login_preflight`.

## Observed product pages

- The installed Windows package identifies itself as **2.10.781**. Its official
  candidate predicate matches the permissive predicate in the source before
  this correction. The installed application has not been modified.
- DK's [exact-code search](https://dk-on.com/DESCENTE/search?keyword=SR123UPS11)
  returned two products, with WHT0 and BLK0 product routes. BEST and newArrival
  are navigation links in the same document, not additional product details.
- On the [white detail](https://dk-on.com/DESCENTE/product/SR123UPS11/WHT0), the
  rendered size radios expose `data-stock-qty`; purchase/gift allowance is a
  separate attribute. The collectors dropped the explicit stock quantity.
- Edge opened the [Naver detail](https://shopping.naver.com/window-products/brandfashion/12842936435)
  through its search card without a restriction. White options 110, 115 and 120
  and black option 85 were selectable; other displayed sizes for those two
  colours said sold out. The remaining four Naver colours were not checked.
  Availability is a point-in-time observation, not a guarantee of future stock.
- Naver's upper and sticky purchase panels both contain colour and size
  `aria-haspopup="listbox"` controls. They have no child input name, but share
  `data-shp-page-key`, `data-shp-area-id="optselect"`, and the stable dimension
  in `data-shp-contents-type`. The previous deduplication retained four groups,
  making the two copies look like independent colour/size dimensions.

## Corrected behavior

1. DK navigation cannot enter the official detail queue by inheriting nearby
   article, image or price text. Product routes and existing goods/detail-shaped
   routes remain accepted; other merchants keep their own URL handling.
2. Both rendered and native radio collection retain valid, explicit stock
   quantities, including zero. Missing or invalid quantities remain unknown;
   gift allowance and order limits are never substituted for stock.
3. Naver's mirrored controls collapse to one group per stable dimension, and
   their dimension labels survive selection. No additional authentication or
   detail requests are introduced.

The Naver batch restriction deliberately stops subsequent requests after an
observed restriction; `login_preflight` can therefore describe a retained batch
restriction rather than a fresh login failure. This patch does not clear those
restrictions, automate retries, transfer browser sessions, or claim to remove a
server-side restriction. Successful Edge access is not proof of successful
collection in the installed Electron session.

## Validation

`tests/retailer-detail-route-stock.test.mjs` uses sanitized, synthetic documents
modeled on the observed controls and executes the production predicates,
collectors and variant traversal. Four new cases failed before the changes.
The focused detail/stock/access suites passed 72 tests, and the final route and
stock suite together with domestic-search compatibility passed 83 tests.
Full-suite and Windows package results are recorded in the pull request.
