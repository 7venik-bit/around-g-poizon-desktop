# Preserve platform stock wording

## Reproduced problem

The reported Kolon Mall detail page (`/Product/JWJJM26321DGY`) displays both
`현재 구매할 수 없는 상품입니다.` and `품절`. The inline result list had no stock
field. Kolon API results also bypassed the rendered detail verification pass.
The old normalizer let a generic cart/purchase control override negative stock
text and retained only one status line. Naver's early seller-verification path
did not collect the detail stock state.

Twelve initial regression assertions failed before the fix: four inline label
cases, five unavailable-wording cases, multiline preservation, rendered official
detail stock, and Kolon detail refresh. Separately, a code-only Kolon query was
dropped when its human-readable name did not repeat the code.

## Behavior

- Capture visible stock notices from the product purchase area or search card.
  Keep the original wording, case, and all distinct notice lines. Normalize only
  whitespace. Do not treat navigation carts, recommendations or delivery-policy
  text as the current product's stock evidence.
- Explicit product-level unavailable wording overrides purchase controls.
  Keep option stock text separately so one unavailable size does not make all
  sizes unavailable.
- Read Kolon product details sequentially, with the existing full observation
  interval. A stalled detail read is bounded and keeps available prior evidence;
  a missing live status does not invent availability.
- Preserve stock evidence through official, manual official, and Naver paths.
  Keep Kolon code matches even when the product name omits that code.
- Show stock wording under each retailer product title in the existing lower
  list. Sold-out products, their displayed price, and their links remain visible.
  Exclude confirmed unavailable products from purchase-price candidates in both
  the backend and renderer. Do not manufacture a positive stock label.

## Verification

- Focused domestic search, retailer runtime, completion UI, Naver finalizer and
  login-session tests: **149 passed**.
- Full `npm test`: **757 passed, 1 existing skip, 0 failed**.
- Runtime fixtures execute the production browser capture scripts, parsers,
  completion handler and matching logic against controlled retailer documents.
  Cases include the two Kolon notices, a purchase area inside an `aside`, manual
  official cards, Naver detail verification, mixed-size stock, and profit-price
  exclusion. UI fixtures execute the production renderer and inline result code.
- The final release-patched runtime and UI tests must also pass before merging;
  Windows package and layout checks must pass before publishing.

These are deterministic runtime and UI checks, not a claim that the user's
authenticated Windows session was remotely exercised. The supplied screenshot
provides the reported platform wording; live retailer pages can change.
