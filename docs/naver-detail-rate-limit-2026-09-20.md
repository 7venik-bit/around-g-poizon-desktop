# Naver detail collection diagnosis, 2026-09-20

## Observed in the user's installed Windows app

The existing JH9977 result reported `collection_stalled` / `product_detail_not_ready`,
with the last detail URL ending in `/window-products/brandfashion/12813318713`.
One manual Open of the Naver search result displayed 14 products. Clicking the
matching adidas official JH9977 card (119,000 KRW on the search card) navigated to:

`https://shopv.pstatic.net/web/maintenance/rate-limit.html`

The visible page said "현재 서비스 접속량이 많습니다." and explained that a temporary
traffic increase was delaying service. No further requests or authentication
were attempted after observing this restriction. This is not evidence of an
account suspension, or proof that every historical failure had the same cause.
Search-card price is not a verified current detail price or stock observation.

## Reproduced code defect

`domesticPageAccessState` did not recognize this rate-limit URL or wording.
`waitForDomesticDetailReady` consequently waited for a product that could not
appear, then raised `product_detail_not_ready`. The Naver verifier treated that
as an ordinary failed candidate and continued to the next detail. Recovery could
retry because the restriction was not represented in the result.

Plain login redirects without a specific Korean "login required" sentence were
also missed. That separate defect is reproduced offline, not asserted as the
cause of the live rate-limit page.

## Changes

- Classify the observed rate-limit URL/text immediately, separately from login
  and security verification. Stop candidate traversal and automatic recovery.
- Retain the restriction for the current renderer login/batch scope, so later
  products do not initiate more Naver requests or authentication in that batch.
  An explicit new batch is a new scope; this is not an inferred server cooldown.
- Recognize Naver login redirects and visible password-login forms, ignoring
  hidden forms. Existing shared persistent authentication remains intact.
- Show the rate-limit state without a login prompt or inline price retry button.
- Record sanitized detail destination, readiness stage and boolean document
  evidence; do not log credentials, query tokens or full page bodies.

This change does not bypass Naver restrictions or guarantee successful detail
collection while Naver continues returning the restriction page. The installed
app has not been replaced. Installed resource files remained inaccessible even
after a read-permission grant, so binary/source identity was not established.

## Validation

Offline fixtures use the observed restriction text/URL plus synthetic login and
product documents. They execute the production detail collector and batch
preflight, and check that no next candidate or login request is made. Existing
session-reuse, stock-integrity, recovery and renderer tests remain required.
Release-transformation tests also run the new detail and batch regressions.

Final focused detail/batch/release tests: 32 passed. Full `npm test`: 1,102
passed, 1 failed. The Windows Electron review smoke process exits with
3221225477 (0xC0000005); the same test fails identically on unchanged main
9d81d492285bf28f328adb4ba80eb85bf215d0d5 in this environment. No assertion was
disabled. Release source transformations pass, but Windows runtime/package
validation and a successful live Naver detail collection remain unverified.
Keep the change as a draft until required checks and runtime validation pass.

## Authenticated follow-up

The user completed Naver login and device confirmation in the isolated Windows
test profile. The Naver page displayed a logout control, and the sourcing UI
reported successful saved-account/login verification. A JH9977 search still
reported login required. A sanitized production `domestic:search` diagnostic at
2026-09-20T05:02:19Z captured 83 rendered cards, 33 candidates, one failed detail,
and a final destination of `https://nid.naver.com/nidlogin.login` with
`expectedPage: true`, `loginRequired: true`, and `rateLimited: false`.

That identity match suggests an account link was selected as a candidate; the
original candidate URL was omitted by the diagnostic allowlist, so this is an
inference rather than an independently captured original URL. Both candidate
filters demonstrably accepted Naver account links carrying product/seller text.
Exclude the `nid.naver.com` account host at both gates, while preserving genuine
Naver product links and external official-mall links. Actual redirects from valid
product pages to login remain access failures; they are not bypassed.

Three new regression cases failed before this correction. Afterwards all 196
focused tests passed. Full `npm test`: 1,106 passed, 1 failed (1,107 total).
The Windows Electron smoke test still fails launching its GPU process in the
shell environment, this time exit 2147483651 with GPU-unusable diagnostics.
This is not a successful Windows package validation. No tests were skipped.

The corrected production search was then exercised once in the actual Windows
test app, reusing the saved login session. At 2026-09-20T05:10:10Z it read 83 cards
and 31 candidates. Its first detail attempt was the genuine product URL
`https://shopping.naver.com/window-products/department/13723139483`, which resolved
to `https://shopv.pstatic.net/web/maintenance/rate-limit.html`. The result retained
`rateLimited: true`, `loginRequired: false`, and one failed detail; traversal
stopped. This confirms the logged-in full search still encounters a Naver access
restriction after excluding account links. It does not prove account suspension
or successful stock collection. The test-only automatic diagnostic was removed
after this single run; no extra authentication was submitted.
