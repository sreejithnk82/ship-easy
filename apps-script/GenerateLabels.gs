/**
 * GenerateLabels.gs
 * -----------------
 * The locked, idempotent orchestration around planAllocation().
 *
 * Called when a customer finishes a set of orders and hits "Generate Labels".
 * In ONE atomic, serialized call it: allocates N tracking IDs from that
 * customer's ranges, records the batch, binds the IDs to the orders, and
 * returns the assignments so the client can render the label PDFs.
 *
 * Two layers of duplicate protection:
 *   • LockService (global mutex)  → no two DIFFERENT callers can interleave the
 *     cursor read-modify-write, so they can never grab the same serial.
 *   • idempotencyKey              → the SAME caller retrying / double-clicking
 *     returns the stored result instead of allocating again.
 *
 * Commit ordering is chosen so the worst possible crash outcome is a few
 * "burned" (unused) IDs — never a duplicate tracking ID and never a duplicate
 * shipment:
 *   1. advance + persist cursors   (makes duplicate IDs impossible)
 *   2. write the batch record      (idempotency anchor + source of truth)
 *   3. write the denormalized order rows (rebuildable from the batch record)
 *
 * Request:
 *   { customerId, idempotencyKey, operatorEmail,
 *     orders: [ { clientOrderId, productId,
 *                 receiverName, receiverPhone, receiverPincode,
 *                 receiverLine1, receiverLine2, receiverState } ] }
 * Response (success):
 *   { ok:true, batchId, count, createdAt,
 *     assignments: [ { clientOrderId, trackingId } ] }
 * Response (failure):
 *   { ok:false, error:'INSUFFICIENT_IDS'|'INVALID_COUNT'|'BAD_REQUEST'|'BUSY'|'INTERNAL', ... }
 */

var LOCK_TIMEOUT_MS = 30000;

function generateLabels(req) {
  var v = validateRequest_(req);
  if (!v.ok) return { ok: false, error: 'BAD_REQUEST', detail: v.detail };

  var customerId = req.customerId;
  var key = String(req.idempotencyKey);
  var operatorEmail = req.operatorEmail || '';
  var orders = req.orders;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    return { ok: false, error: 'BUSY', detail: 'Allocation is busy; please retry.' };
  }

  try {
    var ss = getCustomerSpreadsheet_(customerId);
    var batchesSheet = getSheetOrThrow_(ss, SHEETS.BATCHES);

    // --- Idempotency: a known key returns the same result, no re-allocation. ---
    var existing = findBatchByKey_(batchesSheet, key);
    if (existing) {
      ensureOrderRows_(ss, existing);  // recover order rows if an earlier run crashed mid-commit
      return JSON.parse(existing.result_json);
    }

    // --- Plan the allocation from this customer's ranges. ---
    var rangesSheet = getSheetOrThrow_(ss, SHEETS.RANGES);
    var rangeData = readObjects_(rangesSheet);
    var ranges = rangeData.rows.map(toRange_);

    var plan = planAllocation(ranges, orders.length);
    if (!plan.ok) {
      return { ok: false, error: plan.reason, available: plan.available };
    }

    var batchId = Utilities.getUuid();
    var createdAt = new Date().toISOString();

    // Pair each order with its assigned tracking id.
    var enriched = orders.map(function (o, i) {
      var copy = cloneOrder_(o);
      copy.trackingId = plan.ids[i];
      return copy;
    });
    var assignments = enriched.map(function (o) {
      return { clientOrderId: o.clientOrderId || '', trackingId: o.trackingId };
    });
    var result = {
      ok: true, batchId: batchId, count: orders.length,
      createdAt: createdAt, assignments: assignments,
    };

    // 1) Advance + persist cursors FIRST → duplicate tracking IDs become impossible.
    applyRangeUpdates_(rangesSheet, rangeData, plan.updates);

    // 2) Write the batch record (idempotency anchor + full payload for recovery).
    appendRowObjects_(batchesSheet, [{
      batch_id: batchId,
      idempotency_key: key,
      operator_email: operatorEmail,
      count: orders.length,
      orders_json: JSON.stringify(enriched),
      result_json: JSON.stringify(result),
      status: 'committed',
      created_at: createdAt,
    }]);

    // 3) Write the denormalized order rows (a convenience view; rebuildable from #2).
    writeOrderRows_(ss, batchId, operatorEmail, createdAt, enriched);

    return result;
  } catch (err) {
    return { ok: false, error: 'INTERNAL', detail: String((err && err.message) || err) };
  } finally {
    lock.releaseLock();
  }
}

/* ----------------------------- helpers ----------------------------- */

function validateRequest_(req) {
  if (!req || typeof req !== 'object') return { ok: false, detail: 'request must be an object' };
  if (!req.customerId) return { ok: false, detail: 'customerId is required' };
  if (!req.idempotencyKey) return { ok: false, detail: 'idempotencyKey is required' };
  if (!Array.isArray(req.orders) || req.orders.length === 0) {
    return { ok: false, detail: 'orders must be a non-empty array' };
  }
  return { ok: true };
}

/** Sheet row object → numeric range for planAllocation(). */
function toRange_(r) {
  return {
    seq: Number(r.seq),
    prefix: (r.prefix == null) ? '' : String(r.prefix),
    start: Number(r.start),
    end: Number(r.end),
    pad: isFinite(Number(r.pad)) ? Number(r.pad) : 0,
    cursor: Number(r.cursor),
    status: String(r.status || 'active').trim(),
    _row: r._row,
  };
}

function findBatchByKey_(batchesSheet, key) {
  var res = readObjects_(batchesSheet);
  return res.rows.find(function (r) { return String(r.idempotency_key) === String(key); }) || null;
}

/** Persist new cursor/status for each touched range, then flush. */
function applyRangeUpdates_(rangesSheet, rangeData, updates) {
  var headers = rangeData.headers;
  var cursorCol = headers.indexOf('cursor') + 1;
  var statusCol = headers.indexOf('status') + 1;
  if (cursorCol < 1 || statusCol < 1) {
    throw new Error('TrackingRanges is missing a "cursor" and/or "status" column.');
  }
  var rowBySeq = {};
  rangeData.rows.forEach(function (r) { rowBySeq[String(r.seq)] = r._row; });

  updates.forEach(function (u) {
    var row = rowBySeq[String(u.seq)];
    if (!row) throw new Error('No TrackingRanges row for seq ' + u.seq);
    rangesSheet.getRange(row, cursorCol).setValue(u.cursor);
    rangesSheet.getRange(row, statusCol).setValue(u.status);
  });
  SpreadsheetApp.flush();  // force the cursor advance to persist before later writes
}

function orderRowObj_(batchId, operatorEmail, createdAt, o) {
  return {
    order_id: Utilities.getUuid(),
    batch_id: batchId,
    client_order_id: o.clientOrderId || '',
    tracking_id: o.trackingId,
    product_id: o.productId || '',
    receiver_name: o.receiverName || '',
    receiver_phone: o.receiverPhone || '',
    receiver_pincode: o.receiverPincode || '',
    receiver_line1: o.receiverLine1 || '',
    receiver_line2: o.receiverLine2 || '',
    receiver_state: o.receiverState || '',
    status: 'labeled',
    operator_email: operatorEmail,
    created_at: createdAt,
  };
}

function writeOrderRows_(ss, batchId, operatorEmail, createdAt, enrichedOrders) {
  var ordersSheet = getSheetOrThrow_(ss, SHEETS.ORDERS);
  var objs = enrichedOrders.map(function (o) {
    return orderRowObj_(batchId, operatorEmail, createdAt, o);
  });
  appendRowObjects_(ordersSheet, objs);
}

/**
 * If a prior run advanced the cursor + wrote the batch record but crashed
 * before writing order rows, rebuild them from the batch's stored payload.
 * No-op when the rows already exist.
 */
function ensureOrderRows_(ss, batchRecord) {
  var ordersSheet = getSheetOrThrow_(ss, SHEETS.ORDERS);
  var existing = readObjects_(ordersSheet).rows;
  var has = existing.some(function (r) { return String(r.batch_id) === String(batchRecord.batch_id); });
  if (has) return;

  var enriched = JSON.parse(batchRecord.orders_json || '[]');
  var createdAt = batchRecord.created_at || new Date().toISOString();
  writeOrderRows_(ss, batchRecord.batch_id, batchRecord.operator_email || '', createdAt, enriched);
}

function cloneOrder_(o) {
  return {
    clientOrderId: o.clientOrderId,
    productId: o.productId,
    receiverName: o.receiverName,
    receiverPhone: o.receiverPhone,
    receiverPincode: o.receiverPincode,
    receiverLine1: o.receiverLine1,
    receiverLine2: o.receiverLine2,
    receiverState: o.receiverState,
  };
}
