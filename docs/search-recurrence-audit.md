# Domestic search recurrence audit — 2026-09-18

Baseline: `853457034e6e27a7a545e0bef8ee931e525076d0` (v2.10.760 release source).

The reported Windows screen shows LotteON `collection_stalled` at
`result_capture`, an expected result URL, 12 candidate links and no detected
empty-result message. Naver reports `naver_credentials_required` before search.
Neither message establishes product absence. The screen does not identify the
installed version, saved official registry entry, credential-save history or the
exact browser operation that stalled.

## Reproduced defects

| Path | Reproduction | Correction |
| --- | --- | --- |
| Official merchant selection | Saved Kolon `search_unsupported` status or a mobile Kolon hostname leaves both official and retailer sources selected. | Deduplicate the usable official adapter by the actual Kolon host and its subdomains, including the internal-search status. Keep the retailer when official search is disabled or belongs to another merchant. |
| Search watchdog | Three distinct queries each finish in 40 seconds, but the shared 90-second clock kills the third despite completed earlier searches. | A completed authoritative empty search renews inactivity time. A stalled query still stops after 90 seconds; access failures do not trigger a fallback. The outer request deadline remains unchanged. |
| Diagnostic identity | Direct retailer URLs leave `searchQuery` blank; a fallback failure keeps the first query. | Retain the actual attempted query and requested URL independently of the exact-code manual Open link. |
| Credential persistence | A real filesystem write failure changes the in-memory Naver account; a subsequent unrelated save can persist the failed account change. | Commit settings to disk before exposing the new credentials in memory. Apply this to both account-save entry points. |
| Source/release consistency | Canonical source scrolls the Lotte grid into recommendations, while an existing release transformation already prevents scrolling. | Bring canonical behavior into agreement and allow the release transformation to retain it. This source discrepancy alone does **not** explain the reported installed-app stall. |

## Validation contract

- Regressions run the production query builder, browser scripts and search loop.
- Store tests force real write/rename failures and reopen the JSON store.
- The packaging regression applies every patch/verification command in the
  release workflow, then reruns merchant, account, collector and store tests.
- Existing guards continue to reject recommendations, retain partial results,
  distinguish account-required from product absence and avoid repeating access
  failures. The exact-code manual Open route is preserved.

## Limits

These are deterministic offline reproductions. They do not prove which code
path produced the user's screenshot. The user's Windows credential store and
authenticated Naver session were not accessed. Naver still correctly reports
account-required when both a usable session and saved account information are
absent. Actual installed version and a trace from a fresh affected search are
needed to establish whether any recurrence remains after deployment.
