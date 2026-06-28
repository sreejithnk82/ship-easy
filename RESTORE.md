# Ship Easy — Restore procedure

The data is Google Sheets: one **Directory** spreadsheet (id in Script Property
`DIRECTORY_SS_ID`) + one spreadsheet **per customer** (id in the Directory's
`Customers.spreadsheet_id`). The daily backup (`Backup.gs` → `backupAll`) writes a
`shipeasy-backup-YYYYMMDD-HHmmss.zip` to the Backups folder, keeping the last 7. Each
zip holds `Directory.xlsx` + one `.xlsx` per customer (a full export of every tab).

Use the **lightest** option that fixes the problem.

---

## Option 0 — Version History (try first, for recent in-place mistakes)
If the spreadsheet still exists and you just need to undo a recent bad edit:
- Open it → **File → Version history → See version history** → pick a point before the
  mistake → **Restore**.
- Keeps the same file id, so all references still work. No zip needed.

## Option 1 — Restore from the zip (in-place, keeps the id)
For a corrupted sheet where version history isn't enough, but the **file still exists**:
1. Get the right `shipeasy-backup-*.zip` (Backups folder, or Drive Trash) and **unzip**.
2. Open the **live** spreadsheet you're restoring (e.g. the customer's sheet).
3. **File → Import → Upload** → choose the matching `.xlsx`
   (`Directory.xlsx` or `<CUSTOMERID>.xlsx`) → **Import location: "Replace spreadsheet"**
   → Import.
4. This replaces all tabs (incl. headers) with the backup, **keeping the same file id**,
   so `DIRECTORY_SS_ID` and `Customers.spreadsheet_id` still point correctly.

Repeat per spreadsheet you need to restore.

## Option 2 — The spreadsheet file was deleted
1. First try **Drive Trash → Restore** (within ~30 days), then do Option 1.
2. If it's truly gone, open the backup `.xlsx` as a new Google Sheet (it gets a **new
   id**), then **re-point the reference**:
   - **Directory** → set Script Property **`DIRECTORY_SS_ID`** = new id.
   - **A customer** → set that customer's **`spreadsheet_id`** in the Directory
     `Customers` sheet = new id.

---

## ⚠️ ALWAYS do this after a restore: fix tracking-ID cursors
A restore rolls data back to the backup moment. Labels generated **after** that backup
are gone from the data, but their tracking IDs were already issued (maybe booked with
DTDC). The restored `TrackingRanges.cursor` points earlier, so the next "Generate
Labels" could **re-issue those IDs → duplicates / double-booking**.

1. In the Apps Script editor, run **`auditCursors`** → the log lists every range's
   `cursor` vs the highest issued ID in its Orders sheet, flagging any that are behind.
2. Find the **true** last-issued tracking number from your **DTDC export files / label
   PDFs** for the period after the backup (the restored sheet can't show those).
3. Move each affected cursor safely forward (forward-only, can't go backward):
   - `bumpCursor('CUST001', <seq>, <oneAfterHighestIssued>)` — e.g.
     `bumpCursor('CUST001', 1, 1001016950)`.
   - (Or edit the `cursor` cell in that customer's `TrackingRanges` sheet directly.)
4. Re-run `auditCursors` → no ⚠ flags.

Only generate new labels **after** the cursors are confirmed ahead of everything issued.

---

## Verify
- App opens; the restored group's orders/products look correct.
- `/exec` URL returns `{"ok":true,…,"status":"up"}`.
- `auditCursors` shows no flags.
- Generate **one** test label and confirm the tracking ID is new (not a reused one).

## Notes
- This restores **data** (sheets). The **code** (`.gs` / frontend) is restored from the
  repo / `_upload`, not the zip.
- Trashed items are recoverable ~30 days, then permanent.
