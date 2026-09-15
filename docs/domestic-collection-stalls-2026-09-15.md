# Domestic collection interruption, 2026-09-15

The user's JH9976 result remained partial: Naver and Musinsa showed
`page_load_timeout`; later retailers still showed pending after the absolute
four-minute product timer canceled the shared search. The existing lower
retailer list was already rendered. No additional inventory button is needed.

## Reproduced defects and changes

- The full IPC handler canceled ongoing option collection at 90 seconds per
  retailer and four minutes per product. A deterministic regression failed
  before this change despite new options arriving every 30 seconds. The same
  handler now finishes every retailer. Deadlines measure inactivity; repeated
  options and unchanged progress revisions cannot renew them. Query fallbacks
  retain the same retailer budget unless new detail/option work occurs.
- Empty product snapshots downloaded the source image. Every native option
  checkpoint repeated matching/image verification. Empty snapshots now skip
  image requests, and option-only checkpoints preserve the previous verified
  products while saving raw options. Completed product candidates still pass
  matching and image verification.
- Naver's exact URL alone passed the readiness gate, and failed navigation
  could become a completed link-only result. Blank, security, login and service
  error pages remain explicit failures. Missing channel counts are unknown.
- Musinsa could declare absence merely from reaching its search URL. Only an
  explicit empty-result message authorizes that conclusion; promotional cards
  below an empty result are excluded.
- Naver detail windows now participate in cancellation cleanup. A stalled
  collector keeps completed rows and options and proceeds to the next source.

All three menus retain the common `domestic:search` collection path and the
existing result list below the product. The 25-second observation window,
merchant wording, disclosed quantities and sold-out options remain intact.

## Evidence and limits

The user supplied
`https://shopping.naver.com/window/search/fashion-group?q=JH9976&queryType=ac`
and confirmed products exist there. The shared URL builder already generates
that exact URL. No URL-parameter change is necessary.

In the separate cloud browser, the Naver JH9976 URL without `queryType=ac`
displayed a receipt CAPTCHA. No CAPTCHA was attempted. Musinsa's exact JH9976
search initially displayed a service error; one normal reload then displayed
an explicit empty result followed by signup promotion cards. These observations
do not establish the behavior of the user's Windows session, nor do they
establish that Naver has no products.

Regression documents use synthetic prices, sizes and quantities. The actual
shared collector tests the supplied Naver URL through detail-stock aggregation.
The real Electron test keeps page resources pending and exercises the ordinary
search-to-detail-to-options-to-lower-list flow. Source, renderer and Windows
package checks are required before release. None of these fixture checks is
a claim that JH9976 inventory was successfully retrieved live on the user's PC.
