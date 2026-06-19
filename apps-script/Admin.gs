/**
 * Admin.gs
 * --------
 * Superadmin onboarding: create customers (auto-provisioning their spreadsheet
 * with all tabs), add users to the directory, and seed tracking-ID ranges.
 * All actions here require role 'superadmin' (range listing also allows admins).
 */

function requireSuperadmin_(ctx) { return ctx.role === 'superadmin'; }

/* ------------------------------ customers ------------------------------ */

function action_listCustomers_(payload, ctx) {
  if (!requireSuperadmin_(ctx)) return forbidden_();
  var rows = readObjects_(getSheetOrThrow_(getDirectorySpreadsheet_(), SHEETS.CUSTOMERS)).rows;
  var customers = rows.map(function (r) {
    return {
      customerId: r.customer_id, name: r.name, spreadsheetId: r.spreadsheet_id,
      senderPincode: String(r.sender_pincode || ''), senderName: r.sender_name || '',
      senderCity: r.sender_city || '', senderState: r.sender_state || '',
      hubCustomerCode: r.hub_customer_code || '', status: r.status || '',
    };
  });
  return { ok: true, customers: customers };
}

/** Create a customer: makes a new spreadsheet (with tabs) + a directory row. */
function action_createCustomer_(payload, ctx) {
  if (!requireSuperadmin_(ctx)) return forbidden_();
  var c = payload.customer || {};
  if (!c.customerId) return badRequest_('customer.customerId required (e.g. CUST001)');
  if (!c.name) return badRequest_('customer.name required');

  var dir = getDirectorySpreadsheet_();
  var custSheet = getSheetOrThrow_(dir, SHEETS.CUSTOMERS);
  var dup = readObjects_(custSheet).rows.find(function (r) {
    return String(r.customer_id) === String(c.customerId);
  });
  if (dup) return { ok: false, error: 'DUPLICATE', detail: 'customerId already exists' };

  var ss = SpreadsheetApp.create('ShipEasy — ' + c.name);
  seedCustomerSpreadsheet_(ss);

  appendRowObjects_(custSheet, [{
    customer_id: c.customerId, name: c.name, spreadsheet_id: ss.getId(),
    sender_pincode: c.senderPincode || '', sender_name: c.senderName || c.name,
    sender_phone: c.senderPhone || '', sender_addr1: c.senderAddr1 || '',
    sender_addr2: c.senderAddr2 || '', sender_city: c.senderCity || '',
    sender_state: c.senderState || '', sender_email: c.senderEmail || '',
    hub_customer_code: c.hubCustomerCode || '', status: 'active',
  }]);

  return { ok: true, customerId: c.customerId, spreadsheetId: ss.getId(), spreadsheetUrl: ss.getUrl() };
}

function seedCustomerSpreadsheet_(ss) {
  var specs = [
    [SHEETS.PRODUCTS, ['product_id', 'product_code', 'name', 'hub_customer_code', 'sender_name', 'sender_phone', 'sender_addr1', 'sender_addr2', 'sender_city', 'sender_state', 'sender_pincode', 'sender_email', 'content', 'description', 'declared_value', 'weight_g', 'length_cm', 'width_cm', 'height_cm', 'created_at']],
    [SHEETS.RANGES, ['seq', 'prefix', 'start', 'end', 'pad', 'cursor', 'status']],
    [SHEETS.ORDERS, ['order_id', 'batch_id', 'client_order_id', 'tracking_id', 'product_id', 'receiver_name', 'receiver_phone', 'receiver_pincode', 'receiver_line1', 'receiver_line2', 'receiver_state', 'status', 'operator_email', 'created_at', 'manifest_id', 'shipped_at']],
    [SHEETS.BATCHES, ['batch_id', 'idempotency_key', 'operator_email', 'count', 'orders_json', 'result_json', 'status', 'created_at']],
    [SHEETS.MANIFESTS, ['manifest_id', 'customer_id', 'admin_email', 'tracking_ids_json', 'count', 'status', 'created_at']],
  ];
  specs.forEach(function (spec) {
    var sh = ss.insertSheet(spec[0]);
    sh.getRange(1, 1, 1, spec[1].length).setValues([spec[1]]);
    sh.setFrozenRows(1);
  });
  var def = ss.getSheetByName('Sheet1');
  if (def) ss.deleteSheet(def);
}

/* ----------------------------- hub codes ------------------------------- */

var HUBCODE_HEADERS = ['hub_customer_code', 'label', 'created_at'];

function action_listHubCodes_(payload, ctx) {
  // Any signed-in user may read the hub-code list (needed for the product form).
  var sh = ensureSheet_(getDirectorySpreadsheet_(), SHEETS.HUBCODES, HUBCODE_HEADERS);
  var rows = readObjects_(sh).rows;
  return {
    ok: true,
    hubCodes: rows.map(function (r) { return { code: String(r.hub_customer_code), label: r.label || '' }; }),
  };
}

function action_addHubCode_(payload, ctx) {
  if (!requireSuperadmin_(ctx)) return forbidden_();
  var code = payload.code ? String(payload.code).trim() : '';
  if (!code) return badRequest_('code required');
  var sh = ensureSheet_(getDirectorySpreadsheet_(), SHEETS.HUBCODES, HUBCODE_HEADERS);
  var dup = readObjects_(sh).rows.find(function (r) { return String(r.hub_customer_code) === code; });
  if (dup) return { ok: false, error: 'DUPLICATE', detail: 'hub code already exists' };
  appendRowObjects_(sh, [{ hub_customer_code: code, label: payload.label || '', created_at: new Date().toISOString() }]);
  return { ok: true };
}

/* -------------------------------- users -------------------------------- */

function action_addUser_(payload, ctx) {
  if (!requireSuperadmin_(ctx)) return forbidden_();
  var u = payload.user || {};
  if (!u.email) return badRequest_('user.email required');
  if (['member', 'admin', 'superadmin'].indexOf(u.role) < 0) return badRequest_('invalid role');

  var usersSheet = getSheetOrThrow_(getDirectorySpreadsheet_(), SHEETS.USERS);
  var email = String(u.email).toLowerCase();
  var dup = readObjects_(usersSheet).rows.find(function (r) {
    return String(r.email).toLowerCase() === email;
  });
  if (dup) return { ok: false, error: 'DUPLICATE', detail: 'email already exists' };

  appendRowObjects_(usersSheet, [{ email: email, customer_id: u.customerId || '', role: u.role, status: 'active' }]);
  return { ok: true };
}

function action_listUsers_(payload, ctx) {
  if (!requireSuperadmin_(ctx)) return forbidden_();
  var rows = readObjects_(getSheetOrThrow_(getDirectorySpreadsheet_(), SHEETS.USERS)).rows;
  return {
    ok: true,
    users: rows.map(function (r) {
      return { email: r.email, customerId: r.customer_id, role: r.role, status: r.status };
    }),
  };
}

/* --------------------------- tracking ranges --------------------------- */

function action_addTrackingRange_(payload, ctx) {
  if (!requireSuperadmin_(ctx)) return forbidden_();
  var customerId = payload.customerId;
  var r = payload.range || {};
  if (!customerId) return badRequest_('customerId required');
  var start = Number(r.start), end = Number(r.end);
  if (!(start >= 0) || !(end >= start)) return badRequest_('invalid range: need end >= start >= 0');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) return { ok: false, error: 'BUSY' };
  try {
    var sheet = getSheetOrThrow_(getCustomerSpreadsheet_(customerId), SHEETS.RANGES);
    var rows = readObjects_(sheet).rows;
    var ov = rangeOverlap_(rows, null, r.prefix || '', start, end);
    if (ov !== null) return { ok: false, error: 'OVERLAP', detail: 'overlaps existing range seq ' + ov };

    var nextSeq = rows.reduce(function (m, x) { return Math.max(m, Number(x.seq) || 0); }, 0) + 1;
    var pad = (r.pad != null && r.pad !== '') ? Number(r.pad) : String(end).length;
    appendRowObjects_(sheet, [{
      seq: nextSeq, prefix: r.prefix || '', start: start, end: end,
      pad: pad, cursor: start, status: 'active',
    }]);
    return { ok: true, seq: nextSeq };
  } finally {
    lock.releaseLock();
  }
}

/** Returns the seq of an existing same-prefix range that overlaps [start,end], or null. */
function rangeOverlap_(rows, excludeSeq, prefix, start, end) {
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (excludeSeq !== null && Number(r.seq) === Number(excludeSeq)) continue;
    if (String(r.prefix || '') !== String(prefix || '')) continue; // different prefix = separate number space
    var s = Number(r.start), e = Number(r.end);
    if (start <= e && s <= end) return r.seq;
  }
  return null;
}

/**
 * Edit a range. Untouched (cursor===start) → full edit + reset cursor. Used →
 * only extend `end` upward or change status (active/paused). Lock-guarded.
 */
function action_updateTrackingRange_(payload, ctx) {
  if (!requireSuperadmin_(ctx)) return forbidden_();
  var customerId = payload.customerId, seq = Number(payload.seq);
  var f = payload.range || {};
  if (!customerId || !seq) return badRequest_('customerId and seq required');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) return { ok: false, error: 'BUSY' };
  try {
    var sheet = getSheetOrThrow_(getCustomerSpreadsheet_(customerId), SHEETS.RANGES);
    var data = readObjects_(sheet);
    var row = data.rows.find(function (r) { return Number(r.seq) === seq; });
    if (!row) return { ok: false, error: 'NOT_FOUND' };

    var start = Number(row.start), end = Number(row.end), cursor = Number(row.cursor);
    var untouched = cursor === start;
    var col = function (name) { return data.headers.indexOf(name) + 1; };
    var setCell = function (name, val) { sheet.getRange(row._row, col(name)).setValue(val); };

    if (f.status !== undefined) setCell('status', String(f.status)); // active | paused

    var structural = (f.prefix !== undefined || f.start !== undefined || f.end !== undefined || f.pad !== undefined);
    if (structural) {
      if (untouched) {
        var newPrefix = f.prefix !== undefined ? f.prefix : row.prefix;
        var newStart = f.start !== undefined ? Number(f.start) : start;
        var newEnd = f.end !== undefined ? Number(f.end) : end;
        if (!(newEnd >= newStart)) return { ok: false, error: 'BAD_RANGE', detail: 'end must be >= start' };
        var ov = rangeOverlap_(data.rows, seq, newPrefix, newStart, newEnd);
        if (ov !== null) return { ok: false, error: 'OVERLAP', detail: 'overlaps range seq ' + ov };
        if (f.prefix !== undefined) setCell('prefix', f.prefix);
        if (f.pad !== undefined) setCell('pad', Number(f.pad));
        setCell('start', newStart);
        setCell('end', newEnd);
        setCell('cursor', newStart);                      // reset, nothing issued yet
        if (String(row.status) === 'exhausted') setCell('status', 'active');
      } else {
        // Used range: only extending the end upward is safe.
        if (f.prefix !== undefined || f.start !== undefined || f.pad !== undefined) {
          return { ok: false, error: 'RANGE_IN_USE', detail: 'IDs already issued; only the end can be extended' };
        }
        if (f.end !== undefined) {
          var ne = Number(f.end);
          if (ne < end) return { ok: false, error: 'RANGE_IN_USE', detail: 'cannot shrink a used range' };
          var ov2 = rangeOverlap_(data.rows, seq, row.prefix, start, ne);
          if (ov2 !== null) return { ok: false, error: 'OVERLAP', detail: 'overlaps range seq ' + ov2 };
          setCell('end', ne);
          if (String(row.status) === 'exhausted' && ne >= cursor) setCell('status', 'active');
        }
      }
    }
    SpreadsheetApp.flush();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** Delete a range — only if untouched (no IDs issued). Lock-guarded. */
function action_deleteTrackingRange_(payload, ctx) {
  if (!requireSuperadmin_(ctx)) return forbidden_();
  var customerId = payload.customerId, seq = Number(payload.seq);
  if (!customerId || !seq) return badRequest_('customerId and seq required');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) return { ok: false, error: 'BUSY' };
  try {
    var sheet = getSheetOrThrow_(getCustomerSpreadsheet_(customerId), SHEETS.RANGES);
    var row = readObjects_(sheet).rows.find(function (r) { return Number(r.seq) === seq; });
    if (!row) return { ok: false, error: 'NOT_FOUND' };
    if (Number(row.cursor) !== Number(row.start)) {
      return { ok: false, error: 'RANGE_IN_USE', detail: 'IDs already issued from this range' };
    }
    sheet.deleteRow(row._row);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** Move an untouched range to another customer. Delete-source-first for crash safety. */
function action_reassignTrackingRange_(payload, ctx) {
  if (!requireSuperadmin_(ctx)) return forbidden_();
  var fromId = payload.fromCustomerId, toId = payload.toCustomerId, seq = Number(payload.seq);
  if (!fromId || !toId || !seq) return badRequest_('fromCustomerId, toCustomerId, seq required');
  if (String(fromId) === String(toId)) return badRequest_('same customer');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) return { ok: false, error: 'BUSY' };
  try {
    var fromSheet = getSheetOrThrow_(getCustomerSpreadsheet_(fromId), SHEETS.RANGES);
    var row = readObjects_(fromSheet).rows.find(function (r) { return Number(r.seq) === seq; });
    if (!row) return { ok: false, error: 'NOT_FOUND' };
    if (Number(row.cursor) !== Number(row.start)) {
      return { ok: false, error: 'RANGE_IN_USE', detail: 'IDs already issued; cannot reassign' };
    }

    var toSheet = getSheetOrThrow_(getCustomerSpreadsheet_(toId), SHEETS.RANGES);
    var toData = readObjects_(toSheet);
    var ov = rangeOverlap_(toData.rows, null, row.prefix, Number(row.start), Number(row.end));
    if (ov !== null) return { ok: false, error: 'OVERLAP', detail: 'overlaps a range in the target customer (seq ' + ov + ')' };

    // Safe order: remove from source FIRST so the pool can never exist in two customers at once.
    fromSheet.deleteRow(row._row);
    var nextSeq = toData.rows.reduce(function (m, x) { return Math.max(m, Number(x.seq) || 0); }, 0) + 1;
    appendRowObjects_(toSheet, [{
      seq: nextSeq, prefix: row.prefix || '', start: Number(row.start), end: Number(row.end),
      pad: Number(row.pad) || 0, cursor: Number(row.start), status: 'active',
    }]);
    SpreadsheetApp.flush();
    return { ok: true, newSeq: nextSeq };
  } finally {
    lock.releaseLock();
  }
}

function action_listTrackingRanges_(payload, ctx) {
  if (!requireSuperadmin_(ctx) && !isAdmin_(ctx)) return forbidden_();
  var c = resolveCustomerId_(payload, ctx);
  if (c.error) return c.error;
  var rows = readObjects_(getSheetOrThrow_(getCustomerSpreadsheet_(c.id), SHEETS.RANGES)).rows;
  var ranges = rows.map(function (r) {
    var start = Number(r.start), end = Number(r.end), cursor = Number(r.cursor);
    return {
      seq: Number(r.seq), prefix: r.prefix || '', start: start, end: end,
      pad: Number(r.pad) || 0, cursor: cursor, status: r.status,
      remaining: Math.max(0, end - cursor + 1),
      allocated: Math.max(0, cursor - start),
      used: cursor > start,
    };
  });
  return { ok: true, ranges: ranges };
}
