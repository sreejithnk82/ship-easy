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
  if (!isAdmin_(ctx)) return forbidden_(); // admin reads directory; superadmin manages it
  var rows = readObjects_(getSheetOrThrow_(getDirectorySpreadsheet_(), SHEETS.CUSTOMERS)).rows;
  var customers = rows.map(function (r) {
    return {
      customerId: r.customer_id, name: r.name, spreadsheetId: r.spreadsheet_id,
      senderPincode: String(r.sender_pincode || ''), senderName: r.sender_name || '',
      senderPhone: r.sender_phone || '', senderAddr1: r.sender_addr1 || '', senderAddr2: r.sender_addr2 || '',
      senderCity: r.sender_city || '', senderState: r.sender_state || '', senderEmail: r.sender_email || '',
      hubCustomerCode: r.hub_customer_code || '', status: r.status || '',
    };
  });
  return { ok: true, customers: customers };
}

/**
 * Edit a customer's directory row — everything except the immutable customer_id
 * (the key that links users, the spreadsheet, and tracking ranges) and the
 * spreadsheet_id (set at creation). Superadmin only.
 */
function action_updateCustomer_(payload, ctx) {
  if (!requireSuperadmin_(ctx)) return forbidden_();
  var customerId = payload.customerId;
  var f = payload.fields || {};
  if (!customerId) return badRequest_('customerId required');

  // Map editable API fields → directory column names. customer_id / spreadsheet_id excluded.
  var MAP = {
    name: 'name', senderName: 'sender_name', senderPhone: 'sender_phone',
    senderAddr1: 'sender_addr1', senderAddr2: 'sender_addr2', senderCity: 'sender_city',
    senderState: 'sender_state', senderPincode: 'sender_pincode', senderEmail: 'sender_email',
    hubCustomerCode: 'hub_customer_code', status: 'status',
  };

  var sheet = getSheetOrThrow_(getDirectorySpreadsheet_(), SHEETS.CUSTOMERS);
  var data = readObjects_(sheet);
  var row = data.rows.find(function (r) { return String(r.customer_id) === String(customerId); });
  if (!row) return { ok: false, error: 'NOT_FOUND' };
  if (f.name !== undefined && !String(f.name).trim()) return badRequest_('name cannot be blank');

  var col = function (name) { return data.headers.indexOf(name) + 1; };
  Object.keys(MAP).forEach(function (apiKey) {
    if (f[apiKey] === undefined) return;
    var c = col(MAP[apiKey]);
    if (c > 0) sheet.getRange(row._row, c).setValue(f[apiKey]);
  });
  SpreadsheetApp.flush();
  return { ok: true };
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
  fileIntoDataFolder_(ss); // keep all ShipEasy sheets in one Drive folder (if configured)

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
    [SHEETS.PRODUCTS, ['product_id', 'name', 'nickname', 'sender_address_id', 'content', 'description', 'declared_value', 'weight_g', 'length_cm', 'width_cm', 'height_cm', 'variants', 'created_at', 'status', 'created_by', 'verified_by', 'verified_at']],
    [SHEETS.ADDRESSES, ['address_id', 'label', 'sender_name', 'sender_phone', 'sender_addr1', 'sender_addr2', 'sender_city', 'sender_state', 'sender_pincode', 'sender_email', 'created_at']],
    [SHEETS.RANGES, ['seq', 'prefix', 'start', 'end', 'pad', 'cursor', 'status']],
    [SHEETS.ORDERS, ['order_id', 'batch_id', 'client_order_id', 'tracking_id', 'product_id', 'extra_product_ids', 'variant', 'extra_variants', 'receiver_name', 'receiver_phone', 'receiver_pincode', 'receiver_line1', 'receiver_line2', 'receiver_state', 'status', 'operator_email', 'created_at', 'manifest_id', 'shipped_at', 'exported_at', 'export_id', 'voided_at', 'voided_by']],
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

/**
 * ONE-TIME maintenance — run manually from the Apps Script editor (pick
 * `resetProductsSheets` in the function dropdown → Run). Rewrites every
 * customer's Products sheet to the current clean schema: exact new headers,
 * dropped legacy columns removed, and NO data rows. Safe only while there is no
 * real product data (it wipes existing products). Returns a per-customer summary
 * (also written to the execution log).
 */
function resetProductsSheets() {
  var dir = getDirectorySpreadsheet_();
  var custs = readObjects_(getSheetOrThrow_(dir, SHEETS.CUSTOMERS)).rows;
  var headers = productColumns_();
  var out = [];
  custs.forEach(function (c) {
    if (!c.spreadsheet_id) return;
    var ss;
    try { ss = SpreadsheetApp.openById(String(c.spreadsheet_id)); }
    catch (e) { out.push(c.customer_id + ': cannot open spreadsheet'); return; }
    var sh = ss.getSheetByName(SHEETS.PRODUCTS) || ss.insertSheet(SHEETS.PRODUCTS);
    sh.clear();                                                 // wipe old headers + rows
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);  // write the clean schema
    var extra = sh.getMaxColumns() - headers.length;
    if (extra > 0) sh.deleteColumns(headers.length + 1, extra); // drop leftover blank columns
    sh.setFrozenRows(1);
    out.push(c.customer_id + ': reset (' + headers.length + ' cols, 0 rows)');
  });
  Logger.log(out.join('\n'));
  return out;
}

/* ---------------------- lockdown (edit safety) ------------------------- */

// Whole tabs only the app should ever write — warning-protected so nobody
// hand-edits them. Directory vs per-customer spreadsheets carry different tabs.
var LOCK_APP_TABS_CUSTOMER = [SHEETS.ORDERS, SHEETS.BATCHES, SHEETS.MANIFESTS, SHEETS.RANGES];
var LOCK_APP_TABS_DIRECTORY = [SHEETS.USERS];
var LOCK_TAG = 'ShipEasy lock:';           // marks the protections we create (for idempotent re-runs)
var LOCK_HELP_PIN = 'Must be exactly 6 digits (e.g. 110001) — no $, commas or decimals.';

/**
 * ONE-TIME hardening — run manually from the editor (pick `lockdownSheets` → Run).
 * Across the Directory + every customer spreadsheet it: freezes + warning-protects
 * each tab's header row, warning-protects the app-only tabs, and adds data
 * validation + plain-text formatting to the columns that break when hand-edited
 * (pincodes, customer_id, status). Changes NO data and never blocks the app (it
 * runs as owner; warning protections + validation only guard MANUAL edits).
 * Idempotent — safe to re-run. Returns a per-spreadsheet summary (also logged).
 */
function lockdownSheets() {
  var out = [];
  var dir = getDirectorySpreadsheet_();
  out.push('Directory: ' + lockdownSpreadsheet_(dir, LOCK_APP_TABS_DIRECTORY));

  var custs = readObjects_(getSheetOrThrow_(dir, SHEETS.CUSTOMERS)).rows;
  custs.forEach(function (c) {
    if (!c.spreadsheet_id) return;
    var ss;
    try { ss = SpreadsheetApp.openById(String(c.spreadsheet_id)); }
    catch (e) { out.push((c.customer_id || c.name) + ': cannot open spreadsheet'); return; }
    out.push((c.customer_id || c.name) + ': ' + lockdownSpreadsheet_(ss, LOCK_APP_TABS_CUSTOMER));
  });
  Logger.log(out.join('\n'));
  return out;
}

/** Freeze + protect headers, protect app tabs, and validate key columns on one ss. */
function lockdownSpreadsheet_(ss, appTabs) {
  clearLockProtections_(ss);                          // drop our previous protections → no stacking
  var appSet = {};
  appTabs.forEach(function (n) { appSet[n] = true; });
  var lockedTabs = 0, vals = 0;

  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    var lastCol = sh.getLastColumn() || 1;
    sh.setFrozenRows(1);

    if (appSet[name]) {
      sh.protect().setWarningOnly(true).setDescription(LOCK_TAG + ' sheet');   // whole app-only tab
      lockedTabs++;
      return;                                          // no per-column validation on app tabs
    }

    sh.getRange(1, 1, 1, lastCol).protect().setWarningOnly(true).setDescription(LOCK_TAG + ' header');

    // Column validation only on hand-editable tabs, and only if there are data rows.
    var nRows = sh.getMaxRows() - 1;
    if (nRows < 1) return;
    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
    headers.forEach(function (h, i) {
      if (h === 'pincode' || /_pincode$/.test(h)) { validate6Digit_(sh, i + 1, nRows); vals++; }
    });
    if (name === SHEETS.CUSTOMERS) {
      var ci = headers.indexOf('customer_id');
      if (ci >= 0) { validateRequiredUnique_(sh, ci + 1, nRows); vals++; }
      var si = headers.indexOf('status');
      if (si >= 0) { validateList_(sh, si + 1, nRows, ['active', 'inactive']); vals++; }
    }
  });

  return lockedTabs + ' app-tab(s) locked, headers locked, ' + vals + ' validation(s)';
}

/** Remove protections this script previously added, so re-runs don't pile up. */
function clearLockProtections_(ss) {
  [SpreadsheetApp.ProtectionType.SHEET, SpreadsheetApp.ProtectionType.RANGE].forEach(function (type) {
    ss.getProtections(type).forEach(function (p) {
      if (String(p.getDescription() || '').indexOf(LOCK_TAG) === 0) {
        try { p.remove(); } catch (e) { /* best effort */ }
      }
    });
  });
}

// --- column validators: plain-text format (so pastes don't reformat) + reject bad input ---
function validate6Digit_(sh, col, nRows) {
  var rng = sh.getRange(2, col, nRows, 1);
  rng.setNumberFormat('@');
  var a1 = sh.getRange(2, col).getA1Notation();       // relative anchor, adjusts per row
  rng.setDataValidation(SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=REGEXMATCH(TO_TEXT(' + a1 + '),"^\\d{6}$")')
    .setAllowInvalid(false).setHelpText(LOCK_HELP_PIN).build());
}

function validateRequiredUnique_(sh, col, nRows) {
  var rng = sh.getRange(2, col, nRows, 1);
  rng.setNumberFormat('@');
  var a1 = sh.getRange(2, col).getA1Notation();
  var colRef = a1.replace(/\d+/g, '');                // "A2" -> "A"
  colRef = colRef + ':' + colRef;                     // whole-column, row-count independent
  rng.setDataValidation(SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=AND(LEN(' + a1 + ')>0, EXACT(' + a1 + ',TRIM(' + a1 + ')), COUNTIF(' + colRef + ',' + a1 + ')=1)')
    .setAllowInvalid(false).setHelpText('Required, no surrounding spaces, and must be unique.').build());
}

function validateList_(sh, col, nRows, list) {
  sh.getRange(2, col, nRows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build());
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
  appendRowObjects_(sh, [{ hub_customer_code: code, label: payload.label || '', created_at: nowIso_() }]);
  return { ok: true };
}

/* ------------------------- serviceable pincodes ------------------------ */

var SERVICEABLE_HEADERS = ['pincode', 'city', 'note'];

/**
 * The full DTDC-serviceable pincode list (one global sheet in the Directory).
 * Any signed-in user may read it — the app caches it locally and checks new
 * bookings against it. Superadmins maintain the list directly in the sheet.
 */
function action_listServiceablePincodes_(payload, ctx) {
  var sh = ensureSheet_(getDirectorySpreadsheet_(), SHEETS.SERVICEABLE, SERVICEABLE_HEADERS);
  var rows = readObjects_(sh).rows;
  var pincodes = [];
  rows.forEach(function (r) {
    // Tolerate cells Sheets auto-formatted as currency/number ("$110,001.00"):
    // drop any decimal part FIRST, then strip non-digits, so we still recover the
    // real 6-digit pin instead of "11000100".
    var p = String(r.pincode == null ? '' : r.pincode).split('.')[0].replace(/\D/g, '');
    if (p.length === 6) pincodes.push(p);
  });
  return { ok: true, pincodes: pincodes };
}

/* -------------------------------- users -------------------------------- */

function action_addUser_(payload, ctx) {
  if (!requireSuperadmin_(ctx)) return forbidden_();
  var u = payload.user || {};
  if (!u.email) return badRequest_('user.email required');
  if (['member', 'admin', 'operator', 'superadmin'].indexOf(u.role) < 0) return badRequest_('invalid role');

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
  if (!isAdmin_(ctx)) return forbidden_(); // admin reads users; superadmin adds them
  var rows = readObjects_(getSheetOrThrow_(getDirectorySpreadsheet_(), SHEETS.USERS)).rows;
  return {
    ok: true,
    users: rows.map(function (r) {
      return { email: r.email, customerId: r.customer_id, role: r.role, status: r.status };
    }),
  };
}

/** Edit a user's role / group / status (email is the immutable key). Superadmin
 *  only. You can't edit your own account here (prevents self-lockout). */
function action_updateUser_(payload, ctx) {
  if (!requireSuperadmin_(ctx)) return forbidden_();
  var email = String(payload.email || '').toLowerCase();
  var f = payload.fields || {};
  if (!email) return badRequest_('email required');
  if (email === String(ctx.email || '').toLowerCase()) return badRequest_("You can't edit your own account here.");
  if (f.role !== undefined && ['member', 'admin', 'operator', 'superadmin'].indexOf(f.role) < 0) return badRequest_('invalid role');
  if (f.status !== undefined && ['active', 'disabled'].indexOf(f.status) < 0) return badRequest_('invalid status');

  var sheet = getSheetOrThrow_(getDirectorySpreadsheet_(), SHEETS.USERS);
  var data = readObjects_(sheet);
  var row = data.rows.find(function (r) { return String(r.email).toLowerCase() === email; });
  if (!row) return { ok: false, error: 'NOT_FOUND' };

  // Global roles (admin/superadmin) hold no group; member/operator need one.
  var role = f.role !== undefined ? f.role : String(row.role || '');
  var global = (role === 'superadmin' || role === 'admin');
  var newCust;
  if (f.role !== undefined || f.customerId !== undefined) {
    newCust = global ? '' : (f.customerId !== undefined ? f.customerId : String(row.customer_id || ''));
    if (!global && !newCust) return badRequest_('a group is required for member/operator');
  }

  var setCell = function (name, val) { var col = data.headers.indexOf(name) + 1; if (col > 0) sheet.getRange(row._row, col).setValue(val); };
  if (f.role !== undefined) setCell('role', f.role);
  if (newCust !== undefined) setCell('customer_id', newCust);
  if (f.status !== undefined) setCell('status', f.status);
  SpreadsheetApp.flush();
  return { ok: true };
}

/** Delete a user row by email. Superadmin only; can't remove your own account. */
function action_removeUser_(payload, ctx) {
  if (!requireSuperadmin_(ctx)) return forbidden_();
  var email = String(payload.email || '').toLowerCase();
  if (!email) return badRequest_('email required');
  if (email === String(ctx.email || '').toLowerCase()) return badRequest_("You can't remove your own account.");
  var sheet = getSheetOrThrow_(getDirectorySpreadsheet_(), SHEETS.USERS);
  var row = readObjects_(sheet).rows.find(function (r) { return String(r.email).toLowerCase() === email; });
  if (!row) return { ok: false, error: 'NOT_FOUND' };
  sheet.deleteRow(row._row);
  return { ok: true };
}

/* --------------------------- tracking ranges --------------------------- */

function action_addTrackingRange_(payload, ctx) {
  if (!isAdmin_(ctx)) return forbidden_();
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
  if (!isAdmin_(ctx)) return forbidden_();
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
  if (!isAdmin_(ctx)) return forbidden_();
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
  if (!isAdmin_(ctx)) return forbidden_();
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
