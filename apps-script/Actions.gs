/**
 * Actions.gs
 * ----------
 * Read/write actions behind the web app dispatch (besides generateLabels).
 * Every action receives (payload, ctx) where ctx = {email, role, customerId}
 * already authenticated by WebApp.gs. Customer scoping is enforced here too.
 *
 * Per-customer sheets used:
 *   Products:  product_id | name | weight_g | length_cm | width_cm |
 *              height_cm | declared_value | description | created_at
 *   Manifests: manifest_id | customer_id | admin_email | tracking_ids_json |
 *              count | status | created_at
 *   Orders also use optional columns: manifest_id | shipped_at
 */

/* ------------------------------- profile ------------------------------- */

function action_getProfile_(payload, ctx) {
  var profile = { ok: true, email: ctx.email, role: ctx.role, customerId: ctx.customerId || '', maintenance: maintenanceMessage_() };
  if (ctx.customerId) {
    try {
      var rec = getCustomerRecord_(ctx.customerId);
      profile.customer = customerToSender_(ctx.customerId, rec);
    } catch (e) {
      profile.customerError = String((e && e.message) || e);
    }
  }
  return profile;
}

/* ------------------------------- products ------------------------------ */

function action_listProducts_(payload, ctx) {
  var c = resolveCustomerId_(payload, ctx);
  if (c.error) return c.error;
  var ss = getCustomerSpreadsheet_(c.id);
  var rows = readObjects_(getSheetOrThrow_(ss, SHEETS.PRODUCTS)).rows;
  var addrById = senderAddressMap_(ss);
  var products = rows.map(function (r) { return productFromRow_(r, addrById); });
  return { ok: true, products: products };
}

// The sender block lives on a referenced SenderAddress (resolved live here) so
// editing an address flows through to every product using it. Older products
// store the sender fields inline; we fall back to those when no address is set.
function productFromRow_(r, addrById) {
  var addrId = r.sender_address_id ? String(r.sender_address_id) : '';
  var a = (addrId && addrById) ? addrById[addrId] : null;
  return {
    productId: r.product_id,
    productCode: r.product_code || '',
    name: r.name,
    hubCustomerCode: r.hub_customer_code || '',
    senderAddressId: addrId,
    senderName: a ? a.senderName : (r.sender_name || ''),
    senderPhone: a ? a.senderPhone : String(r.sender_phone || ''),
    senderAddr1: a ? a.senderAddr1 : (r.sender_addr1 || ''),
    senderAddr2: a ? a.senderAddr2 : (r.sender_addr2 || ''),
    senderCity: a ? a.senderCity : (r.sender_city || ''),
    senderState: a ? a.senderState : (r.sender_state || ''),
    senderPincode: a ? a.senderPincode : String(r.sender_pincode || ''),
    senderEmail: a ? a.senderEmail : (r.sender_email || ''),
    content: r.content || 'OTHERS',
    description: r.description || r.name,
    declaredValue: Number(r.declared_value) || 0,
    weightG: Number(r.weight_g) || 0,
    lengthCm: Number(r.length_cm) || 0,
    widthCm: Number(r.width_cm) || 0,
    heightCm: Number(r.height_cm) || 0,
    // Approval workflow: blank/legacy rows count as verified; new member-added
    // products start 'pending' until an admin/superadmin verifies them.
    status: r.status ? String(r.status) : 'verified',
    createdBy: r.created_by || '',
    verifiedBy: r.verified_by || '',
    verifiedAt: r.verified_at ? String(r.verified_at) : '',
  };
}

/** camelCase product field -> sheet column. Shared by add/update. */
var PRODUCT_COLMAP = {
  productCode: 'product_code', name: 'name', hubCustomerCode: 'hub_customer_code',
  senderAddressId: 'sender_address_id',
  senderName: 'sender_name', senderPhone: 'sender_phone', senderAddr1: 'sender_addr1',
  senderAddr2: 'sender_addr2', senderCity: 'sender_city', senderState: 'sender_state',
  senderPincode: 'sender_pincode', senderEmail: 'sender_email', content: 'content',
  description: 'description', declaredValue: 'declared_value', weightG: 'weight_g',
  lengthCm: 'length_cm', widthCm: 'width_cm', heightCm: 'height_cm',
};

// All sheet columns a product may write, so we can migrate older Products sheets
// that predate sender_address_id before any add/update.
function productColumns_() {
  var cols = ['product_id'];
  Object.keys(PRODUCT_COLMAP).forEach(function (k) { cols.push(PRODUCT_COLMAP[k]); });
  cols.push('created_at', 'status', 'created_by', 'verified_by', 'verified_at');
  return cols;
}

/** member / admin / superadmin may manage products (operators cannot). */
function canManageProducts_(ctx) {
  return ctx.role === 'member' || isAdmin_(ctx);
}

/** Auto-generate a short, unique-ish internal product code from the name. */
function generateProductCode_(sheet, name) {
  var slug = String(name || 'PROD').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'PROD';
  var n = readObjects_(sheet).rows.length + 1;
  return slug + '-' + ('000' + n).slice(-3);
}

function action_addProduct_(payload, ctx) {
  if (!canManageProducts_(ctx)) return forbidden_();
  var c = resolveCustomerId_(payload, ctx);
  if (c.error) return c.error;
  var p = payload.product || {};
  if (!p.name) return badRequest_('product.name is required');
  if (!p.senderAddressId && !p.senderName) return badRequest_('a sender address is required');

  var ss = getCustomerSpreadsheet_(c.id);
  var sheet = ensureColumns_(getSheetOrThrow_(ss, SHEETS.PRODUCTS), productColumns_());
  var productId = Utilities.getUuid();
  var row = { product_id: productId, created_at: nowIso_(), created_by: ctx.email };
  Object.keys(PRODUCT_COLMAP).forEach(function (k) {
    if (p[k] !== undefined) row[PRODUCT_COLMAP[k]] = p[k];
  });
  if (!row.product_code) row.product_code = generateProductCode_(sheet, p.name); // auto, hidden from UI
  if (!row.description) row.description = p.name;
  if (!row.content) row.content = 'OTHERS';
  // Managers auto-verify their own products; members create as pending.
  if (isAdmin_(ctx)) { row.status = 'verified'; row.verified_by = ctx.email; row.verified_at = nowIso_(); }
  else { row.status = 'pending'; }
  appendRowObjects_(sheet, [row]);
  return { ok: true, productId: productId, productCode: row.product_code, status: row.status };
}

function action_updateProduct_(payload, ctx) {
  if (!canManageProducts_(ctx)) return forbidden_();
  var c = resolveCustomerId_(payload, ctx);
  if (c.error) return c.error;
  var productId = payload.productId;
  if (!productId) return badRequest_('productId required');
  var p = payload.product || {};

  var sheet = ensureColumns_(getSheetOrThrow_(getCustomerSpreadsheet_(c.id), SHEETS.PRODUCTS), productColumns_());
  var data = readObjects_(sheet);
  var row = data.rows.find(function (r) { return String(r.product_id) === String(productId); });
  if (!row) return { ok: false, error: 'NOT_FOUND' };
  var setCell = function (name, val) { var col = data.headers.indexOf(name) + 1; if (col > 0) sheet.getRange(row._row, col).setValue(val); };

  var changed = 0;
  Object.keys(PRODUCT_COLMAP).forEach(function (k) {
    if (p[k] === undefined) return;
    var col = data.headers.indexOf(PRODUCT_COLMAP[k]) + 1;
    if (col < 1) return;
    sheet.getRange(row._row, col).setValue(p[k]);
    changed++;
  });
  // A member edit needs re-verification; an admin/superadmin edit stays verified.
  if (isAdmin_(ctx)) { setCell('status', 'verified'); setCell('verified_by', ctx.email); setCell('verified_at', nowIso_()); }
  else { setCell('status', 'pending'); setCell('verified_by', ''); setCell('verified_at', ''); }
  SpreadsheetApp.flush();
  return { ok: true, changed: changed };
}

/** Admin/superadmin verifies a product (or sends it back to pending). */
function action_verifyProduct_(payload, ctx) {
  if (!isAdmin_(ctx)) return forbidden_();
  var c = resolveCustomerId_(payload, ctx);
  if (c.error) return c.error;
  var productId = payload.productId;
  if (!productId) return badRequest_('productId required');
  var verified = payload.verified !== false; // default true

  var sheet = ensureColumns_(getSheetOrThrow_(getCustomerSpreadsheet_(c.id), SHEETS.PRODUCTS), productColumns_());
  var data = readObjects_(sheet);
  var row = data.rows.find(function (r) { return String(r.product_id) === String(productId); });
  if (!row) return { ok: false, error: 'NOT_FOUND' };
  var setCell = function (name, val) { var col = data.headers.indexOf(name) + 1; if (col > 0) sheet.getRange(row._row, col).setValue(val); };

  if (verified) { setCell('status', 'verified'); setCell('verified_by', ctx.email); setCell('verified_at', nowIso_()); }
  else { setCell('status', 'pending'); setCell('verified_by', ''); setCell('verified_at', ''); }
  SpreadsheetApp.flush();
  return { ok: true, status: verified ? 'verified' : 'pending' };
}

/** Delete a product, but refuse if any order still references it. */
function action_deleteProduct_(payload, ctx) {
  if (!isAdmin_(ctx)) return forbidden_();
  var c = resolveCustomerId_(payload, ctx);
  if (c.error) return c.error;
  var productId = payload.productId;
  if (!productId) return badRequest_('productId required');

  var ss = getCustomerSpreadsheet_(c.id);
  var orders = readObjects_(getSheetOrThrow_(ss, SHEETS.ORDERS)).rows;
  var inUse = orders.some(function (r) { return String(r.product_id) === String(productId); });
  if (inUse) return { ok: false, error: 'IN_USE', detail: 'Product is used by existing orders.' };

  var sheet = getSheetOrThrow_(ss, SHEETS.PRODUCTS);
  var row = readObjects_(sheet).rows.find(function (r) { return String(r.product_id) === String(productId); });
  if (!row) return { ok: false, error: 'NOT_FOUND' };
  sheet.deleteRow(row._row);
  return { ok: true };
}

/* --------------------------- sender addresses -------------------------- */
// Reusable "From" addresses, one set per customer. Products reference one by id
// (sender_address_id); the sender block is resolved live in productFromRow_.

var SENDER_ADDRESS_HEADERS = ['address_id', 'label', 'sender_name', 'sender_phone',
  'sender_addr1', 'sender_addr2', 'sender_city', 'sender_state', 'sender_pincode',
  'sender_email', 'created_at'];

/** camelCase address field -> sheet column. */
var ADDRESS_COLMAP = {
  label: 'label', senderName: 'sender_name', senderPhone: 'sender_phone',
  senderAddr1: 'sender_addr1', senderAddr2: 'sender_addr2', senderCity: 'sender_city',
  senderState: 'sender_state', senderPincode: 'sender_pincode', senderEmail: 'sender_email',
};

/** Get (auto-creating for older customers) the SenderAddresses sheet. */
function getAddressSheet_(ss) {
  return ensureSheet_(ss, SHEETS.ADDRESSES, SENDER_ADDRESS_HEADERS);
}

function addressFromRow_(r) {
  return {
    addressId: r.address_id,
    label: r.label || '',
    senderName: r.sender_name || '',
    senderPhone: String(r.sender_phone || ''),
    senderAddr1: r.sender_addr1 || '',
    senderAddr2: r.sender_addr2 || '',
    senderCity: r.sender_city || '',
    senderState: r.sender_state || '',
    senderPincode: String(r.sender_pincode || ''),
    senderEmail: r.sender_email || '',
  };
}

/** Map address_id -> resolved address object, for joining onto products. */
function senderAddressMap_(ss) {
  var rows = readObjects_(getAddressSheet_(ss)).rows;
  var map = {};
  rows.forEach(function (r) { map[String(r.address_id)] = addressFromRow_(r); });
  return map;
}

function action_listSenderAddresses_(payload, ctx) {
  var c = resolveCustomerId_(payload, ctx);
  if (c.error) return c.error;
  var rows = readObjects_(getAddressSheet_(getCustomerSpreadsheet_(c.id))).rows;
  return { ok: true, addresses: rows.map(addressFromRow_) };
}

function action_addSenderAddress_(payload, ctx) {
  if (!isSuperadmin_(ctx)) return forbidden_();
  var c = resolveCustomerId_(payload, ctx);
  if (c.error) return c.error;
  var a = payload.address || {};
  if (!a.senderName) return badRequest_('address.senderName is required');

  var sheet = getAddressSheet_(getCustomerSpreadsheet_(c.id));
  var addressId = Utilities.getUuid();
  var row = { address_id: addressId, created_at: nowIso_() };
  Object.keys(ADDRESS_COLMAP).forEach(function (k) {
    if (a[k] !== undefined) row[ADDRESS_COLMAP[k]] = a[k];
  });
  if (!row.label) row.label = a.senderName + (a.senderCity ? ' — ' + a.senderCity : '');
  appendRowObjects_(sheet, [row]);
  return { ok: true, addressId: addressId };
}

function action_updateSenderAddress_(payload, ctx) {
  if (!isSuperadmin_(ctx)) return forbidden_();
  var c = resolveCustomerId_(payload, ctx);
  if (c.error) return c.error;
  var addressId = payload.addressId;
  if (!addressId) return badRequest_('addressId required');
  var a = payload.address || {};

  var sheet = getAddressSheet_(getCustomerSpreadsheet_(c.id));
  var data = readObjects_(sheet);
  var row = data.rows.find(function (r) { return String(r.address_id) === String(addressId); });
  if (!row) return { ok: false, error: 'NOT_FOUND' };

  var changed = 0;
  Object.keys(ADDRESS_COLMAP).forEach(function (k) {
    if (a[k] === undefined) return;
    var col = data.headers.indexOf(ADDRESS_COLMAP[k]) + 1;
    if (col < 1) return;
    sheet.getRange(row._row, col).setValue(a[k]);
    changed++;
  });
  SpreadsheetApp.flush();
  return { ok: true, changed: changed };
}

/** Delete an address, but refuse if any product still references it. */
function action_deleteSenderAddress_(payload, ctx) {
  if (!isSuperadmin_(ctx)) return forbidden_();
  var c = resolveCustomerId_(payload, ctx);
  if (c.error) return c.error;
  var addressId = payload.addressId;
  if (!addressId) return badRequest_('addressId required');

  var ss = getCustomerSpreadsheet_(c.id);
  var products = readObjects_(getSheetOrThrow_(ss, SHEETS.PRODUCTS)).rows;
  var inUse = products.some(function (r) { return String(r.sender_address_id) === String(addressId); });
  if (inUse) return { ok: false, error: 'IN_USE', detail: 'Address is used by existing products.' };

  var sheet = getAddressSheet_(ss);
  var row = readObjects_(sheet).rows.find(function (r) { return String(r.address_id) === String(addressId); });
  if (!row) return { ok: false, error: 'NOT_FOUND' };
  sheet.deleteRow(row._row);
  return { ok: true };
}

/* ------------------------ hub: scan & ship ----------------------------- */

/** Orders generated but not yet shipped (status 'labeled') — for the scan screen. */
function action_listOpenOrders_(payload, ctx) {
  if (!canScan_(ctx)) return forbidden_();
  var c = resolveCustomerId_(payload, ctx);
  if (c.error) return c.error;
  var ss = getCustomerSpreadsheet_(c.id);
  var rows = readObjects_(getSheetOrThrow_(ss, SHEETS.ORDERS)).rows;
  var open = rows
    .filter(function (r) { return String(r.status) === 'labeled'; })
    .map(function (r) {
      return {
        orderId: r.order_id,
        trackingId: String(r.tracking_id),
        productId: r.product_id,
        receiverName: r.receiver_name,
        receiverPhone: String(r.receiver_phone),
        receiverPincode: String(r.receiver_pincode),
        receiverLine1: r.receiver_line1,
        receiverLine2: r.receiver_line2,
        receiverState: r.receiver_state,
        exportedAt: r.exported_at ? String(r.exported_at) : '',
      };
    });
  return { ok: true, orders: open };
}

/** Mark a set of scanned tracking IDs shipped + record a manifest. */
function action_commitShipment_(payload, ctx) {
  if (!canScan_(ctx)) return forbidden_();
  var c = resolveCustomerId_(payload, ctx);
  if (c.error) return c.error;
  var trackingIds = payload.trackingIds;
  if (!Array.isArray(trackingIds) || !trackingIds.length) return badRequest_('trackingIds required');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) return { ok: false, error: 'BUSY' };
  try {
    var ss = getCustomerSpreadsheet_(c.id);
    var ordersSheet = getSheetOrThrow_(ss, SHEETS.ORDERS);
    var data = readObjects_(ordersSheet);
    var statusCol = data.headers.indexOf('status') + 1;
    var manifestCol = data.headers.indexOf('manifest_id') + 1;
    var shippedCol = data.headers.indexOf('shipped_at') + 1;
    if (statusCol < 1) throw new Error('Orders sheet missing "status" column');

    var byTracking = {};
    data.rows.forEach(function (r) { byTracking[String(r.tracking_id)] = r; });

    var manifestId = payload.manifestId || Utilities.getUuid();
    var now = nowIso_();
    var marked = [], already = [], notFound = [];

    trackingIds.forEach(function (t) {
      var r = byTracking[String(t)];
      if (!r) { notFound.push(String(t)); return; }
      if (String(r.status) === 'shipped') { already.push(String(t)); return; }
      ordersSheet.getRange(r._row, statusCol).setValue('shipped');
      if (manifestCol > 0) ordersSheet.getRange(r._row, manifestCol).setValue(manifestId);
      if (shippedCol > 0) ordersSheet.getRange(r._row, shippedCol).setValue(now);
      marked.push(String(t));
    });

    appendRowObjects_(getSheetOrThrow_(ss, SHEETS.MANIFESTS), [{
      manifest_id: manifestId,
      customer_id: c.id,
      admin_email: ctx.email,
      tracking_ids_json: JSON.stringify(marked),
      count: marked.length,
      status: 'booked',
      created_at: now,
    }]);
    SpreadsheetApp.flush();

    return { ok: true, manifestId: manifestId, marked: marked, alreadyShipped: already, notFound: notFound };
  } finally {
    lock.releaseLock();
  }
}

/** Edit a labeled (not-yet-shipped) order. Never changes the tracking ID. */
function action_updateOrder_(payload, ctx) {
  if (!isAdmin_(ctx)) return forbidden_();
  var c = resolveCustomerId_(payload, ctx);
  if (c.error) return c.error;
  var orderId = payload.orderId ? String(payload.orderId) : '';
  var trackingId = payload.trackingId ? String(payload.trackingId) : '';
  if (!orderId && !trackingId) return badRequest_('orderId or trackingId required');
  var fields = payload.fields || {};

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) return { ok: false, error: 'BUSY' };
  try {
    var sheet = getSheetOrThrow_(getCustomerSpreadsheet_(c.id), SHEETS.ORDERS);
    var data = readObjects_(sheet);
    var row = data.rows.find(function (r) {
      return (orderId && String(r.order_id) === orderId) ||
             (trackingId && String(r.tracking_id) === trackingId);
    });
    if (!row) return { ok: false, error: 'NOT_FOUND' };
    if (String(row.status) === 'shipped') return { ok: false, error: 'ALREADY_SHIPPED' };

    // Editable columns only — tracking_id, batch_id, status are never touched here.
    var MAP = {
      receiverName: 'receiver_name', receiverPhone: 'receiver_phone',
      receiverPincode: 'receiver_pincode', receiverLine1: 'receiver_line1',
      receiverLine2: 'receiver_line2', receiverState: 'receiver_state',
      productId: 'product_id',
    };
    var changed = 0;
    Object.keys(MAP).forEach(function (k) {
      if (fields[k] === undefined) return;
      var col = data.headers.indexOf(MAP[k]) + 1;
      if (col < 1) return;
      sheet.getRange(row._row, col).setValue(fields[k]);
      changed++;
    });
    SpreadsheetApp.flush();
    return { ok: true, changed: changed };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------- helpers ------------------------------- */

function customerToSender_(customerId, rec) {
  return {
    customerId: customerId,
    name: rec.name,
    senderPincode: String(rec.sender_pincode || ''),
    senderName: rec.sender_name || '',
    senderPhone: String(rec.sender_phone || ''),
    senderAddr1: rec.sender_addr1 || '',
    senderAddr2: rec.sender_addr2 || '',
    senderCity: rec.sender_city || '',
    senderState: rec.sender_state || '',
    senderEmail: rec.sender_email || '',
    hubCustomerCode: rec.hub_customer_code || '',
  };
}

function resolveCustomerId_(payload, ctx) {
  var id = payload.customerId || ctx.customerId;
  if (!id) return { error: badRequest_('customerId required') };
  // superadmin and admin are global — they act on any group. member/operator are
  // locked to their own customer.
  if (!isAdmin_(ctx) && String(ctx.customerId) !== String(id)) {
    return { error: forbidden_() };
  }
  return { id: id };
}

function isAdmin_(ctx) {
  return ctx.role === 'admin' || ctx.role === 'superadmin';
}

function isSuperadmin_(ctx) {
  return ctx.role === 'superadmin';
}

// The warehouse "operator" role may scan, export the DTDC xlsx, and mark
// shipped — but not void/edit orders or anything else admins can do.
function canScan_(ctx) {
  return ctx.role === 'operator' || isAdmin_(ctx);
}

function forbidden_() { return { ok: false, error: 'FORBIDDEN' }; }
function badRequest_(detail) { return { ok: false, error: 'BAD_REQUEST', detail: detail }; }
