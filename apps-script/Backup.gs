/**
 * Backup.gs
 * ---------
 * Two operational helpers:
 *
 *  1. Folder isolation — keep every ShipEasy spreadsheet inside one Drive folder
 *     so they don't scatter through "My Drive" and get opened/edited by accident.
 *     Set Script Property DATA_FOLDER_ID to that folder's id; new per-customer
 *     spreadsheets are then auto-filed into it on creation.
 *
 *  2. Full backup — backupAll() exports the Directory + every customer spreadsheet
 *     to .xlsx and writes them as ONE .zip file in a Backups folder. Run it from
 *     the editor on demand, or attach a daily time-driven trigger.
 *
 * Both auto-request the Drive scope on first run (accept the Google prompt).
 */

var SCRIPT_PROP_DATA_FOLDER = 'DATA_FOLDER_ID';
var SCRIPT_PROP_BACKUP_FOLDER = 'BACKUP_FOLDER_ID';
var BACKUP_PREFIX = 'shipeasy-backup-';
var BACKUP_KEEP = 7; // keep the last N daily backups; older ones are trashed

/** The configured data folder, or null if DATA_FOLDER_ID isn't set. */
function getDataFolder_() {
  var id = PropertiesService.getScriptProperties().getProperty(SCRIPT_PROP_DATA_FOLDER);
  if (!id) return null;
  try { return DriveApp.getFolderById(id); } catch (e) { return null; }
}

/** Move a freshly-created spreadsheet into the data folder (best-effort). */
function fileIntoDataFolder_(ss) {
  var folder = getDataFolder_();
  if (!folder) return; // not configured → leave it in My Drive
  try { DriveApp.getFileById(ss.getId()).moveTo(folder); } catch (e) { /* best-effort */ }
}

/** Backups folder: BACKUP_FOLDER_ID if set, else a "ShipEasy — Backups" folder. */
function getBackupFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(SCRIPT_PROP_BACKUP_FOLDER);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* recreate below */ } }

  var parent = getDataFolder_() || DriveApp.getRootFolder();
  var name = 'ShipEasy — Backups';
  var it = parent.getFoldersByName(name);
  var folder = it.hasNext() ? it.next() : parent.createFolder(name);
  props.setProperty(SCRIPT_PROP_BACKUP_FOLDER, folder.getId());
  return folder;
}

/**
 * Export the Directory + every customer spreadsheet to .xlsx and save them as a
 * single timestamped .zip in the Backups folder. Returns the file URL.
 * Run from the editor, or add a Time-driven trigger for daily backups.
 */
function backupAll() {
  var dir = getDirectorySpreadsheet_();
  var targets = [{ id: dir.getId(), name: 'Directory' }];

  var custs = readObjects_(getSheetOrThrow_(dir, SHEETS.CUSTOMERS)).rows;
  custs.forEach(function (r) {
    if (!r.spreadsheet_id) return;
    var label = String(r.customer_id || r.name || r.spreadsheet_id).replace(/[^A-Za-z0-9_-]/g, '_');
    targets.push({ id: String(r.spreadsheet_id), name: label });
  });

  var token = ScriptApp.getOAuthToken();
  var blobs = [];
  var skipped = [];
  targets.forEach(function (t) {
    var url = 'https://docs.google.com/spreadsheets/d/' + t.id + '/export?format=xlsx';
    var resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (resp.getResponseCode() === 200) {
      blobs.push(resp.getBlob().setName(t.name + '.xlsx'));
    } else {
      skipped.push(t.name + ' (HTTP ' + resp.getResponseCode() + ')');
    }
  });

  if (!blobs.length) throw new Error('Backup produced no files. Skipped: ' + skipped.join(', '));

  var stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd-HHmmss');
  var zip = Utilities.zip(blobs, BACKUP_PREFIX + stamp + '.zip');
  var folder = getBackupFolder_();
  var file = folder.createFile(zip);
  pruneBackups_(folder, BACKUP_KEEP);

  Logger.log('Backup saved: ' + file.getUrl() + (skipped.length ? ' | skipped: ' + skipped.join(', ') : ''));
  return file.getUrl();
}

/** Keep only the newest `keep` backup zips in the folder; trash the rest. */
function pruneBackups_(folder, keep) {
  var list = [];
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().indexOf(BACKUP_PREFIX) === 0) list.push(f);
  }
  // Filenames embed yyyyMMdd-HHmmss, so name order == chronological. Newest first.
  list.sort(function (a, b) { return a.getName() < b.getName() ? 1 : (a.getName() > b.getName() ? -1 : 0); });
  for (var i = keep; i < list.length; i++) {
    try { list[i].setTrashed(true); } catch (e) { /* best-effort */ }
  }
}

/**
 * Run ONCE from the editor to schedule a daily backup (~2 AM IST). Re-running is
 * safe — it removes any existing backupAll trigger first, so no duplicates.
 */
function setupDailyBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupAll') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backupAll').timeBased().everyDays(1).atHour(2).create();
  var msg = 'Daily backup scheduled (~2 AM IST), keeping the last ' + BACKUP_KEEP + ' files.';
  Logger.log(msg);
  return msg;
}

/* ----------------------------- restore aids ----------------------------- */
// After restoring data from a backup, a range's `cursor` may sit behind tracking
// IDs that were already issued — which would re-issue them (duplicates). These
// helpers make the cursor reconciliation safe. See RESTORE.md.

/**
 * Read-only. For every customer + tracking range, report the cursor vs the highest
 * tracking ID actually present in that customer's Orders sheet, flagging any range
 * whose cursor would re-issue an existing ID. Run from the editor after a restore.
 */
function auditCursors() {
  var dir = getDirectorySpreadsheet_();
  var custs = readObjects_(getSheetOrThrow_(dir, SHEETS.CUSTOMERS)).rows;
  var out = [];
  custs.forEach(function (c) {
    if (!c.spreadsheet_id) return;
    var ss;
    try { ss = SpreadsheetApp.openById(String(c.spreadsheet_id)); } catch (e) { out.push(c.customer_id + ': cannot open spreadsheet'); return; }
    var ranges = readObjects_(getSheetOrThrow_(ss, SHEETS.RANGES)).rows;
    var orders = readObjects_(getSheetOrThrow_(ss, SHEETS.ORDERS)).rows;
    ranges.forEach(function (r) {
      var prefix = String(r.prefix == null ? '' : r.prefix);
      var start = Number(r.start), end = Number(r.end), cur = Number(r.cursor), maxNum = 0;
      orders.forEach(function (o) {
        var t = String(o.tracking_id || '');
        if (t.indexOf(prefix) !== 0) return;
        var n = Number(t.slice(prefix.length));
        if (isFinite(n) && n >= start && n <= end && n > maxNum) maxNum = n;
      });
      var flag = (maxNum > 0 && cur <= maxNum) ? '  ⚠ CURSOR BEHIND ISSUED — fix before generating' : '';
      out.push(c.customer_id + ' seq' + r.seq + ' ' + prefix + start + '-' + prefix + end +
        ' | cursor=' + cur + ' maxIssued=' + (maxNum || '-') + flag);
    });
  });
  var report = out.length ? out.join('\n') : 'No ranges found.';
  Logger.log(report);
  return report;
}

/**
 * Forward-only cursor fix. Sets a range's cursor to `newCursor` ONLY if it moves
 * forward (never backward), so you can't accidentally make IDs re-issuable.
 * e.g. bumpCursor('CUST001', 1, 1001016950)
 */
function bumpCursor(customerId, seq, newCursor) {
  var sheet = getSheetOrThrow_(getCustomerSpreadsheet_(customerId), SHEETS.RANGES);
  var data = readObjects_(sheet);
  var row = data.rows.find(function (r) { return String(r.seq) === String(seq); });
  if (!row) throw new Error('No tracking range seq ' + seq + ' for ' + customerId);
  var cur = Number(row.cursor);
  if (!(Number(newCursor) > cur)) throw new Error('Refusing: ' + newCursor + ' is not ahead of current cursor ' + cur);
  var col = data.headers.indexOf('cursor') + 1;
  sheet.getRange(row._row, col).setValue(Number(newCursor));
  SpreadsheetApp.flush();
  var msg = customerId + ' seq' + seq + ' cursor ' + cur + ' → ' + newCursor;
  Logger.log(msg);
  return msg;
}
