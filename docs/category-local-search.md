# Category search and explicit POIZON review

The user clarified that POIZON-to-Excel verification already has its own menu.
Category selection opens filter controls; pressing Search must only classify
saved local Excel data. It must not start a Seller Center session or verification.

## Reproduced causes

- The category Search handler called `captureSellerBrandSales` for each brand.
  That unnecessarily made a local search depend on Seller Center navigation.
  The screenshot showed a blank product-search area and navigation failures.
- Workbook paths came from the cached download list. A moved Adidas workbook
  produced ENOENT even though the current folder list could resolve another path.
- The all-failed branch left the last title at `검색 · 진행 중`, although the
  request had ended. The empty result also incorrectly suggested no matches.

Three new runtime assertions failed on the previous implementation: no implicit
seller capture, refreshing a stale path, and clearing the all-failed progress title.

## Changes

- Scan the current local file list, read each selected brand workbook sequentially,
  and filter its saved values by category and AND sales conditions.
- Keep the existing POIZON export-schema interpretation. Generic lifetime totals
  cannot become recent-30 values. Missing saved metrics receive an explanation;
  clearing the conditions permits reading products without those values.
- Category completion is a local search result, not a verification certification.
  Histories use a new local-Excel namespace and are not reused as search inputs.
- Preserve the separate review menu and its screen comparison, correction,
  page-completion, and disk-reread rules. No seller navigation code was changed.
- Keep progress at zero initially; stop locally and ignore late responses from a
  stopped run. Show completed, partial, failed, and stopped result titles accurately.
  Unrelated seller progress events no longer update the category progress.
- Add required local-category/review-separation checks to source and Windows CI,
  in addition to the release workflow's existing final-patched category tests.
  Record the menu separation in AGENTS.md for future changes.

## Validation

- Focused runtime, UI lifecycle, category, and explicit-review tests: 112 passed,
  1 existing Windows-only skip, 0 failed.
- Full `npm test`: 767 passed, 1 existing skip, 0 failed.
- Regression coverage includes opening category controls without file reads or
  capture, saved metrics, category OR/threshold AND, real POIZON raw exports,
  missing metrics, moved files, all-failed/partial results, duplicate clicks,
  stopping, late replies, and restart isolation.
- Three older source assertions required implicit live category search and were
  updated to the user's clarified separation requirement. Explicit review tests
  remain and pass.

Before merging, apply the release patches in an isolated checkout, rerun the
category and existing domestic/review regressions, and require source, rendered
layout, and Windows package checks. These deterministic tests do not claim to
exercise the user's authenticated Windows session or restore a genuinely deleted
workbook.
