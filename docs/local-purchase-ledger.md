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
results, with no differences. Unknown source errors remain errors rather than
being converted into plausible totals. No real workbook/account data is in fixtures.

Cell tools support single cells and Shift+click/Shift+arrow ranges (up to 5,000
cells). Delete clears values, formulas and cell pictures, preserving coordinates,
formatting, dropdown rules and receipt notes. All cells in a block are validated
before the single durable write. Invalid, stale or out-of-bounds operations never
partially apply.

Ctrl+C/Ctrl+V and the toolbar use the native clipboard. Copies from this ledger
carry typed values, formulas and embedded pictures; relative formula references
move with the destination and absolute references stay fixed. Existing destination
styles remain. External TSV/text is pasted literally, including leading zeros and
strings starting with `=`. Use the explicit formula editor to enter a new formula.
Clipboard actions only run from the grid or their buttons; text-editor shortcuts
keep their normal meaning.

Column-letter right edges and row-number bottom edges resize by dragging. Numeric
controls apply widths/heights to the selected columns/rows. Sizes are stored in the
encrypted workbook, survive restart and are patched into Excel column widths and
row heights while preserving unrelated dimension attributes. Default columns keep
the existing responsive layout until resized. Resizing preserves an unsaved cell
editor draft.

Musinsa recording starts at the clicked row in `1-구매완료`. The form shows that
row before submission and requires a single data-row selection. The destination
sheet ID, row and workbook revision are passed independently of normalized order
evidence. Selecting a cell does not write; the record button still commits the
recognized order. Multiple units occupy consecutive rows starting there.

All destination rows are checked before a write. Existing product data, pictures,
notes, merged rows, invalid ranges and stale revisions block the whole operation.
Gender/status/shipping defaults and existing calculation formulas do not make an
otherwise empty purchase row occupied. Destination formatting, fees and formulas
remain; missing calculation formulas use the closest preceding product template.
Recording locks workbook selection and editing until it finishes. Unsaved cell
edits must be resolved first. Success reloads and highlights the committed rows.
Existing receipts stay idempotent at their original rows; choosing another row
does not move or duplicate an already recorded order. No Google calls are added.

## Transaction formula repair and automatic fill

The recognized original transaction tables now receive a one-time template repair.
Before changing anything, the service saves and rereads an encrypted recovery copy
alongside the working file. A backup failure prevents repair. The working workbook
stores the repair version, old/new formulas and affected addresses, and the normal
atomic save/reread path commits calculated caches to the original XLSX archive.

Recognized imported formulas that used the sale-date column, a preceding row or
rows 573/574 now refer to the same row's selling price and purchase inputs. The
original VAT template uses purchase price / 1.1 * 0.1. Whitespace-only missing
amounts stay missing, valid numeric money text is converted to numbers for native
Excel totals, and zero denominators return a blank rate. Invalid money is still an
error. Existing manual fees, shipping values and unrelated custom formulas remain.
Missing input totals and simple transaction total ranges include later purchases.

New product rows receive missing fee/margin/refund/rate formulas on manual entry,
paste or Musinsa recording. Unused rows receive no new calculations. A direct edit
or Delete in a calculation cell becomes a persistent override; later input edits
do not silently restore that cell. Original images, size lookups and account data
are not changed by this repair.

Category lookup reads completed local POIZON exports and requires an exact article
match with agreeing categories. It never opens Seller Center or starts a download.
The category is placed in an unused trailing column; a conflict or absent match
shows a review hint, and a user's category edit is preserved. Category-specific
fee policy is pending a verified user-provided reference: this change preserves
existing numeric fee overrides and the imported 10% / 15,000 template rule rather
than claiming that unverified category rates came from Google Drive.
