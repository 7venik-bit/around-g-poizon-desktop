# Shared Agent Instructions

These instructions apply to ChatGPT Work, Codex, and Cursor when working in this repository.

## Product priorities

- Prefer correctness and stability over speed.
- Preserve the user's original OneDrive Excel workbook structure and unrelated cells.
- Treat the visible POIZON screen as authoritative for verified recent-30-day values.
- Process one POIZON page completely: compare, save changes when needed, reread and verify, then move to the next page.
- Do not mark a brand verified unless every page reaches 100% and the saved workbook reread succeeds.
- Keep brand verification valid for seven days, including after a newer workbook download.
- Category selection and category search read saved local Excel data. They must not open Seller Center, capture POIZON pages, or start Excel correction.
- Keep POIZON screen-to-Excel verification behind its separate, explicit verification menu. Its screen-authoritative comparison and save/reread rules still apply there.
- Show domestic retailer sizes and inventory in the lower product list, between the product title and article number. Preserve platform stock wording.
- Purchase limits are not inventory counts, and "품절 임박" is not sold out. Never invent a count when the retailer does not expose one.
- Select stock strategies by the actual merchant domain for every brand. Preserve colour/size combinations, raw stock wording, and explicit quantities; missing quantity is unknown.
- Do not silently truncate matched domestic products to eight. Checkpoint completed products and use inactivity deadlines while real option/detail progress continues.
- A profile or passing fixture is not proof that every brand was tested live. Record actual retailer/product checks and keep login-required or partial coverage explicit.
- Resolve an unlinked brand's official search on demand using its catalog identity and verified page evidence. Keep transient discovery failures pending; preserve other retailers and never invoke POIZON verification from this path.
- Match official aliases exactly and prefer the actual merchant domain over a brand label. Keep hidden restock widgets and related colour SKUs out of the current product's inventory.

- Persist unfinished domestic work per product and retailer, including completed option branches. Resume failed work; recheck inventory older than 30 minutes and start completed new searches fresh.
- Commit recovery completion only after its file save succeeds. A storage or retailer failure must remain pending and must not discard successful observations.
- Do not retry authentication or access restrictions automatically. A complete result requires verified stock coverage or authoritative absence, not merely a successful product search.

## Safe development workflow

- Start each change from the latest `main` on a short-lived branch.
- Never push an unreviewed change directly to `main`.
- Keep unrelated user changes intact.
- Add or update a regression test for every bug fix.
- Run the focused test first, then run `npm test`.
- Do not merge when any required source, UI, or Windows package check fails.
- Merge through a pull request only after all GitHub checks pass.
- Let the release workflow assign the next `v2.10.x` version and publish the Windows installer, blockmap, and `latest.yml`.

## Handoff between tools

- Before starting, pull the latest `main` and inspect open branches or pull requests to avoid duplicate work.
- Use descriptive branch names prefixed with `codex/` or `cursor/`.
- Record the cause, changed behavior, and test results in the pull request.
- If ChatGPT Work created the branch, Cursor should review or continue that branch instead of recreating the same fix.
- If Cursor created the branch, ChatGPT Work should inspect and validate that branch before merging.
