/**
 * OrdersExt.gs
 * ------------
 * Order-lifecycle extensions added on top of the original book/scan/ship flow:
 *
 *   • voidOrder       — cancel a not-yet-shipped order (burns its tracking ID,
 *                       never reused). Removes it from open + export + ship.
 *   • recordExport    — stamp orders as exported to DTDC so the SAME parcels
 *                       can't be silently exported (double-booked) twice.
 *   • listOrders      — a customer's own recent orders WITH live status, so the
 *                       seller's Label History is server-backed (survives a new
 *                       device / cleared browser) and shows where a parcel is.
 *   • customerBalance — remaining tracking IDs for one customer (low warning).
 *   • listBalances    — remaining IDs for ALL customers (superadmin dashboard).
 *   • customerHealth  — Orders row/cell counts vs the Google Sheets 10M ceiling.
 *   • archiveOrders   — move old shipped/void rows to an archive sheet so the
 *                       live Orders sheet stays bounded (the 10-year goal).
 *
 * Status model on the Orders sheet:  labeled → shipped, or → void.
 * `exported_at` is independent metadata (a labeled order may be exported but
 * not yet shipped). New columns are added on demand by ensureColumns_.
 */

var LOW_ID_THRESHOLD = 200;        // warn the seller when fewer than this remain
var SHEET_CELL_LIMIT = 10000000;   // Google Sheets hard ceiling (per spreadsheet)
var SHEET_CELL_WARN = 7000000;     // warn at 70%

// ensureColumns_ lives in Schema.gs (it returns the sheet, which addProduct relies
// on). Do not redefine it here — a duplicate would shadow that and break callers.

function findOrderRow_(rows, orderId, trackingId) {
  return rows.find(function (r) {
    return (orderId && String(r.order_id) === String(orderId)) ||
           (trackingId && String(r.tracking_id) === String(trackingId));
  }) || null;
}

/* ------------------------------ void ------------------------------ */

/** Cancel a labeled (not-yet-shipped) order. The tracking ID is burned. */
function action_voidOrder_(payload, ctx) {
  if (!isAdmin_(ctx)) return forbidden_();
  var c = resolveCustomerId_(payload, ctx);
  if (c.error) return c.error;
  var orderId = payload.orderId ? String(payload.orderId) : '';
  var trackingId = payload.trackingId ? String(payload.trackingId) : '';
  if (!orderId && !trackingId) return badRequest_('orderId or trackingId required');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) return { ok: false, error: 'BUSY' };
  try {
    var sheet = getSheetOrThrow_(getCustomerSpreadsheet_(c.id), SHEETS.ORDERS);
    ensureColumns_(sheet, ['voided_at', 'voided_by']);
    var data = readObjects_(sheet);
    var row = findOrderRow_(data.rows, orderId, trackingId);
    if (!row) return { ok: false, error: 'NOT_FOUND' };
    if (String(row.status) === 'shipped') return { ok: false, error: 'ALREADY_SHIPPED' };
    if (String(row.status) === 'void') return { ok: true, alreadyVoid: true };

    var col = function (n) { return data.headers.indexOf(n) + 1; };
    sheet.getRange(row._row, col('status')).setValue('void');
    if (col('voided_at') > 0) sheet.getRange(row._row, col('voided_at')).setValue(nowIso_());
    if (col('voided_by') > 0) sheet.getRange(row._row, col('voided_by')).setValue(ctx.email);
    SpreadsheetApp.flush();
    return { ok: true, trackingId: String(row.tracking_id) };
  } finally {
    lock.releaseLock();
  }
}

/* --------------------------- record export --------------------------- */

/**
 * Stamp orders as exported to DTDC. Re-exporting the same parcel is the path to
 * a double courier booking, so this reports which IDs were ALREADY exported.
 */
function action_recordExport_(payload, ctx) {
  if (!canScan_(ctx)) return forbidden_();
  var c = resolveCustomerId_(payload, ctx);
  if (c.error) return c.error;
  var trackingIds = payload.trackingIds;
  if (!Array.isArray(trackingIds) || !trackingIds.length) return badRequest_('trackingIds required');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) return { ok: false, error: 'BUSY' };
  try {
    var sheet = getSheetOrThrow_(getCustomerSpreadsheet_(c.id), SHEETS.ORDERS);
    ensureColumns_(sheet, ['exported_at', 'export_id']);
    var data = readObjects_(sheet);
    var col = function (n) { return data.headers.indexOf(n) + 1; };
    var expCol = col('exported_at'), idCol = col('export_id');

    var byTracking = {};
    data.rows.forEach(function (r) { byTracking[String(r.tracking_id)] = r; });

    var exportId = payload.exportId || Utilities.getUuid();
    var now = nowIso_();
    var marked = [], alreadyExported = [], notFound = [], shipped = [];

    trackingIds.forEach(function (t) {
      var r = byTracking[String(t)];
      if (!r) { notFound.push(String(t)); return; }
      if (String(r.status) === 'shipped') { shipped.push(String(t)); return; }
      if (String(r.status) === 'void') { notFound.push(String(t)); return; }
      if (r.exported_at) { alreadyExported.push({ trackingId: String(t), exportedAt: String(r.exported_at) }); return; }
      if (expCol > 0) sheet.getRange(r._row, expCol).setValue(now);
      if (idCol > 0) sheet.getRange(r._row, idCol).setValue(exportId);
      marked.push(String(t));
    });
    SpreadsheetApp.flush();
    return { ok: true, exportId: exportId, marked: marked, alreadyExported: alreadyExported, shipped: shipped, notFound: notFound };
  } finally {
    lock.releaseLock();
  }
}

/* ----------------------- list a customer's orders ----------------------- */

/**
 * Recent orders for the caller's own customer (members allowed), WITH status.
 * Powers the server-backed Label History and parcel-status visibility.
 */
function action_listOrders_(payload, ctx) {
  var c = resolveCustomerId_(payload, ctx); // members may read their own customer only
  if (c.error) return c.error;
  var limit = Math.min(Number(payload.limit) || 300, 2000);

  var sheet = getSheetOrThrow_(getCustomerSpreadsheet_(c.id), SHEETS.ORDERS);
  var rows = readObjects_(sheet).rows;
  rows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  if (rows.length > limit) rows = rows.slice(0, limit);

  var orders = rows.map(function (r) {
    return {
      orderId: String(r.order_id || ''),
      batchId: String(r.batch_id || ''),
      trackingId: String(r.tracking_id || ''),
      productId: String(r.product_id || ''),
      receiverName: r.receiver_name || '',
      receiverPhone: String(r.receiver_phone || ''),
      receiverPincode: String(r.receiver_pincode || ''),
      receiverLine1: r.receiver_line1 || '',
      receiverLine2: r.receiver_line2 || '',
      receiverState: r.receiver_state || '',
      status: String(r.status || 'labeled'),
      exportedAt: r.exported_at ? String(r.exported_at) : '',
      shippedAt: r.shipped_at ? String(r.shipped_at) : '',
      voidedAt: r.voided_at ? String(r.voided_at) : '',
      createdAt: String(r.created_at || ''),
    };
  });
  return { ok: true, orders: orders };
}

/* ------------------------------ balances ------------------------------ */

function rangesRemaining_(customerId) {
  var rows = readObjects_(getSheetOrThrow_(getCustomerSpreadsheet_(customerId), SHEETS.RANGES)).rows;
  var remaining = 0;
  rows.forEach(function (r) {
    if (String(r.status || 'active').trim() !== 'active') return; // paused/exhausted don't count
    remaining += Math.max(0, Number(r.end) - Number(r.cursor) + 1);
  });
  return remaining;
}

/** Remaining tracking IDs for the caller's own customer (members allowed). */
function action_customerBalance_(payload, ctx) {
  var c = resolveCustomerId_(payload, ctx);
  if (c.error) return c.error;
  var remaining = rangesRemaining_(c.id);
  return { ok: true, remaining: remaining, threshold: LOW_ID_THRESHOLD, low: remaining < LOW_ID_THRESHOLD };
}

/** Remaining IDs for every customer — superadmin top-up dashboard. */
function action_listBalances_(payload, ctx) {
  if (!requireSuperadmin_(ctx)) return forbidden_();
  var rows = readObjects_(getSheetOrThrow_(getDirectorySpreadsheet_(), SHEETS.CUSTOMERS)).rows;
  var balances = rows.map(function (r) {
    var remaining = -1;
    try { remaining = rangesRemaining_(String(r.customer_id)); } catch (e) { remaining = -1; }
    return {
      customerId: String(r.customer_id), name: r.name || '',
      remaining: remaining, low: remaining >= 0 && remaining < LOW_ID_THRESHOLD,
    };
  });
  return { ok: true, balances: balances, threshold: LOW_ID_THRESHOLD };
}

/* ------------------------ health & archival (#5) ------------------------ */

var ORDERS_ARCHIVE = 'OrdersArchive';

/** Orders row/cell count for one customer vs the 10M-cell spreadsheet ceiling. */
function action_customerHealth_(payload, ctx) {
  if (!requireSuperadmin_(ctx)) return forbidden_();
  var c = resolveCustomerId_(payload, ctx);
  if (c.error) return c.error;
  var sheet = getSheetOrThrow_(getCustomerSpreadsheet_(c.id), SHEETS.ORDERS);
  var rows = Math.max(0, sheet.getLastRow() - 1);
  var cols = sheet.getLastColumn();
  var cells = rows * cols;
  return {
    ok: true,
    orderRows: rows, columns: cols, orderCells: cells,
    cellLimit: SHEET_CELL_LIMIT, warn: cells >= SHEET_CELL_WARN,
    pctOfLimit: Math.round((cells / SHEET_CELL_LIMIT) * 1000) / 10,
  };
}

/**
 * Move shipped/void orders older than `beforeISO` into an archive sheet, so the
 * live Orders sheet stays small (fast reads, far from the cell ceiling).
 * Open ('labeled') orders are never touched.
 */
function action_archiveOrders_(payload, ctx) {
  if (!requireSuperadmin_(ctx)) return forbidden_();
  var c = resolveCustomerId_(payload, ctx);
  if (c.error) return c.error;
  var beforeISO = String(payload.beforeISO || '');
  if (!beforeISO) return badRequest_('beforeISO required (ISO date cutoff)');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) return { ok: false, error: 'BUSY' };
  try {
    var ss = getCustomerSpreadsheet_(c.id);
    var ordersSheet = getSheetOrThrow_(ss, SHEETS.ORDERS);
    var data = readObjects_(ordersSheet);
    var headers = data.headers;

    var stampOf = function (r) { return String(r.shipped_at || r.voided_at || r.created_at || ''); };
    var movable = data.rows.filter(function (r) {
      var st = String(r.status);
      return (st === 'shipped' || st === 'void') && stampOf(r) && stampOf(r) < beforeISO;
    });
    if (!movable.length) return { ok: true, moved: 0 };

    var archive = ensureSheet_(ss, ORDERS_ARCHIVE, headers);
    var objs = movable.map(function (r) {
      var o = {};
      headers.forEach(function (h) { o[h] = r[h]; });
      return o;
    });
    appendRowObjects_(archive, objs);

    // Delete from the live sheet bottom-up so row indices stay valid.
    movable.sort(function (a, b) { return b._row - a._row; });
    movable.forEach(function (r) { ordersSheet.deleteRow(r._row); });
    SpreadsheetApp.flush();
    return { ok: true, moved: movable.length };
  } finally {
    lock.releaseLock();
  }
}
