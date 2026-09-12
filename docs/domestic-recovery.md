# Domestic search recovery

The earlier save queue retained a rejected promise, causing later writes to fail. Excel search results also lived only in renderer memory, and retrying a selection restarted every retailer. Recovery now records product inputs, retailer tasks, option checkpoints, attempts and observation times in the local JsonStore. Completion uses an atomic committed upsert: failed writes leave the previous in-memory record intact and do not poison subsequent writes.

Selected Excel searches resume the same unfinished job, including subset selections. Successful retailer tasks and finished colour branches are reused within 30 minutes. A retry rechecks unfinished retailer work once after 10 seconds; authentication and access restrictions remain pending for operator action. Closing/reopening a workbook offers the unfinished-search button. Finished jobs are not reused by a new search. Old stock is rechecked, and partial results carry their observation timestamp rather than a new timestamp for each failed attempt.

The existing lower product list, full-screen progress overlay, platform stock wording, official discovery and merchant-specific strategies remain in use. Category selection does not invoke POIZON Excel verification. The legacy explorer batch also keeps its cursor on a failed/canceled item instead of skipping it.

## Validation

Tests inject actual file write failures; restart JsonStore between attempts; verify successful tasks are skipped, stale observations are rechecked, late canceled callbacks cannot overwrite resumed results, and incomplete stock never claims completion. Renderer tests exercise the actual enhanced product-row renderer across a restart. Option tests resume a failed colour without reselecting completed colours and preserve explicit zero quantities.

These are regression and package tests, not proof of live inventory support for every brand. Merchant login, access controls and changes to product pages can still require site-specific maintenance. This release does not claim new live retailer validation or an always-running external monitoring service.
