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
