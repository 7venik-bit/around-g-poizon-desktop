# Official-mall result retention after v2.10.707

## Reproduced defects

1. `officialMallSearchWasExecuted` generates browser JavaScript inside a
   template string. Its product-path regex did not double-escape slashes, so
   the generated script failed to compile. The catch returned `null`, making
   a completed official search appear unsubmitted. Static `node --check` and
   earlier source-text assertions did not execute this script.
2. The rendered official-card parser deliberately retains the mall's own
   results even when the card omits the manufacturer code. The later detail
   pass clears unverified article numbers, after which `addMatchConfidence`
   discarded every official card without an exact code score. The complete
   IPC test reproduced a captured title/price/link disappearing from the final
   response.
3. URL-based deduplication removed every query parameter. Official product
   routes such as `/product/detail?goodsNo=4021` and `?goodsNo=4022` therefore
   collapsed into one row when no manufacturer code was printed.

## Changes and retained behavior

- Fix the generated regex escaping.
- Record official query-result evidence only on the brand's own domain,
  following a submitted interactive search, the requested exact-query route,
  or the existing verified direct-detail route. Restrict official result links
  to that domain and its subdomains.
- Retain these captured result cards through final matching for the user's
  manual product comparison. This flag is not exact article verification:
  missing codes remain missing and are not assigned a fabricated 95 score.
- Keep query parameters as part of official product URL identity so different
  product IDs remain separate.
- Preserve conflict rejection, overseas exclusion, image-only rejection,
  existing authentication, full observation waits, sequential search, final
  response cleanup, and the per-product lower result list.

The existing source assertion requiring unconditional rejection of every
code-less official card was updated to require explicit official-query
evidence. A runtime negative case still rejects a similar image alone.

## Verification

Three new regression cases failed before their respective fixes: generated
search-confirmation code, full IPC retention of a code-less official card,
and two products with query-parameter IDs. Negative cases cover conflicting
model numbers, external-domain links, unsubmitted homepage cards, and
image-only similarity.

Local focused tests: 52 passed. Full suite: 739 passed, zero failed, one
platform-specific skip. The runtime tests execute the real browser scripts,
source collector, parsers, matching, and IPC handler against controlled DOM
documents and a deterministic clock. They do not reproduce the user's live
official-mall session or prove that every brand website is reachable.

The same runtime and completion tests are mandatory after release patches
in source CI, Windows packaging, and the publication workflow.
