# Preserve thorough searches and completed results

## Reproduced cause

The reported screenshot says the complete search was stopped after two
minutes, while the row incorrectly says the search completed. The previous
runtime tests exercised retailer capture but did not execute the complete
`domestic:search` IPC handler under a slow multi-retailer workload.

Executing that handler with six sequential retailer fixtures reproduces the
failure: the unconditional two-minute wall-clock timer cancels a search that
is still completing retailers. Its response discards completed products.
The renderer also labels an error object as `검색 완료`.

The user explicitly prioritizes thorough collection over speed. The
v2.10.706 early stable-DOM return and shared 30-second query budget therefore
do not provide the requested observation and fallback opportunities.

## Changed behavior

- Keep sequential retailer processing and the complete 25-second DOM
  observation window, including a bounded final settle for late changes.
- Give each ranked query its own 90-second window. Existing code, title, and
  combined-query order and authoritative-absence rules remain in effect.
- Treat the main two-minute and renderer 125-second guards as inactivity
  limits. Only actual stage events extend the wait; elapsed-time animation
  never counts as search progress.
- Preserve completed results after existing matching and image verification.
  If real progress stops, return that verified checkpoint as `일부 결과` in
  the full-width list immediately below the product. Unfinished sources
  remain pending, never authoritative absence.
- Label errors `검색 실패`, and partial data `일부 결과`. Keep the full-screen
  otter overlay until the response is handled, with existing cancellation and
  modal cleanup behavior.
- Bound optional learning persistence to three seconds after final results
  are ready. A stuck preference write returns a warning alongside results.
- Prevent a timer belonging to a canceled search from closing a new search's
  windows.

## Verification and limits

Before the fix, five new tests failed: full-handler long-running search,
checkpoint preservation, renderer activity handling, error status, and
partial-result display. After the fix, focused tests pass (38), and the full
suite has 732 passes, zero failures, and one platform-specific skip.

The tests execute real main-process functions, generated browser JavaScript,
card parsers, matching, the IPC handler, and renderer DOM interactions with
controlled retailer documents and a deterministic clock. Cases include
sequential six-retailer work exceeding two minutes, three ranked queries
taking three minutes, late product cards and price hydration, a frozen
browser call, stuck learning persistence, timeout checkpoints, cancellation,
and the lower result list. They are not live-retailer or user-PC verification.

The same runtime/completion tests run after all release transformations, and
mandatory source/UI/Windows checks must pass before merging and publishing.
