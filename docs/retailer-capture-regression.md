# Retailer capture regression after v2.10.705

This records the v2.10.706 investigation. Its early-return and shared-budget
policy is superseded by [the thorough-search correction](search-progress-checkpoints.md).

The screenshot shows the restored per-product list, with Naver/LotteON
`page_load_timeout`, SSG `page_load_failed`, and a partial-result warning.
The retailer adapters and release transformations were still present. The
shared execution path prevented those adapters from returning their results.

## Reproduced failures

1. PR #591 reduced each retailer's deadline to 15 seconds while the shared
   capture path still slept for 25 seconds before reading any cards. Running
   the actual main-process functions with immediately available Naver, SSG,
   and LotteON product documents reproduced `source_timeout` for all three.
2. After allowing capture to execute, its generated JavaScript failed to
   compile: `Unexpected token '?'`. Unescaped slashes in the Naver department
   and outlet regexes became JavaScript comments inside the template string.
   This shared capture script also runs for SSG and LotteON. The outer catch
   classified the syntax exception as `page_load_failed`, making it look like
   a network failure. `node --check main.mjs` cannot validate generated code.
3. `addMatchConfidence` referenced `discoveredProducts`, a local belonging to
   `addRenderedSearchCounts`. Its ReferenceError produced the partial-result
   warning and discarded the returned confidence/price data.

These are deterministic application defects. The screenshot alone cannot
prove which underlying exception occurred in every retailer on the user's PC.

## Changes

- Wait for actual card/price stability instead of always sleeping 25 seconds.
  A larger displayed result count or a visible busy indicator keeps collection
  waiting for late cards or price hydration. Observation remains bounded.
- Give each retailer one 30-second budget shared across its accuracy queries.
  Keep the existing two-minute overall guard, cancellation, and failed-source
  isolation. No timeout is converted into authoritative product absence.
- Correct escaping in the generated capture script, including Naver domain
  and official-brand label expressions.
- Build price candidates from the products that passed the matching gates.
  Do not bypass existing domestic-seller, overseas, identity, or image rules.

## Validation

`tests/domestic-retailer-runtime.test.mjs` executes the actual source collector,
deadline, generated browser scripts, retailer card parsers, Naver finalizer,
matching function, and aggregation against controlled DOM fixtures and a
deterministic clock. Only external detail adapters are controlled; these are
not live-retailer or user-PC tests.

Cases cover all three retailers, one combined search, a declared second card
arriving at 18 seconds, price hydration, authoritative empty pages, a stalled
navigation, and verified price propagation. The existing 14 DOM completion
tests retain per-product lower lists, keys, cancellation, and modal release.

Source CI, Windows packaging, and the publication workflow run the runtime and
completion tests after the release patches as mandatory steps. A failure must
stop packaging/publication, even though the older broad suite's CI step still
has `continue-on-error`.

Local focused tests: 30 passed. Full current suite: 724 passed, 0 failed,
1 Windows-only test skipped. GitHub Windows and final release checks are
required before publication.
