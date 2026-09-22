# Local purchase workbook

The purchase workbook is independent of Google. Load, refresh, edit, purchase recording,
account lookup and Excel export never contact Google or the former Apps Script endpoint.

On first load, `ledger-workbook.encrypted` is copied into
`ledger-local-workbook.encrypted` using Electron safeStorage. The source snapshot is
left unchanged. Every sheet, including hidden and account sheets, is retained. A
missing or corrupt local file is reported; a corrupt file is never silently replaced
with the migration source. Subsequent starts always read the local working copy.

Writes are serialized, use revision and typed-cell checks, recalculate formula
dependencies, write an encrypted temporary file and atomically replace the working
copy. The saved workbook is reread before reporting success. Purchase receipt notes
prevent duplicate unit rows, including receipts already present in the migration.
Product IMAGE formulas stay formulas and display the source product image.

Excel export starts from the original XLSX archive and patches edited cells and
formula caches. It preserves the other parts, including styles, hidden tabs, named
ranges, validation, merged cells and embedded images. An unedited copy exports the
original bytes. Local edits and new purchase rows are included in later exports.
External image URLs still need access to their image host; ledger reads/writes and
calculation do not need network access.

Validation includes offline load/edit/record/export, restart persistence, stale
edits, failed writes, original archive preservation, and receipt idempotency. The
one-time migration's 757 formula results were compared privately to the source
results, with no differences. Existing source errors are retained as errors rather
than converted into plausible totals. No real workbook/account data is in fixtures.
