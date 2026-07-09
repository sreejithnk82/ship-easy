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
  return { ok: true, products: rows.map(productFromRow_) };
}

// A product is a pure shipping profile. The "From" sender is chosen per ORDER
// (at booking), not stored on the product.
function productFromRow_(r) {
  return {
    productId: r.product_id,
    name: r.name,
    content: r.content || 'OTHERS',
    description: r.description || r.name,
    declaredValue: Number(r.declared_value) || 0,
    weightG: Number(r.weight_g) || 0,
    lengthCm: Number(r.length_cm) || 0,
    widthCm: Number(r.width_cm) || 0,
    heightCm: Number(r.height_cm) || 0,
    // Optional sub-type labels (color / material / ml …). Same shipping profile;
    // the chosen label is recorded on the order.
    variants: parseIdList_(r.variants),
    // Approval workflow: new member-added products start 'pending' until an
    // admin/superadmin verifies them.
    status: r.status ? String(r.status) : 'verified',
  };
}

/** camelCase product field -> sheet column. Shared by add/update. */
var PRODUCT_COLMAP = {
  name: 'name', content: 'content',
  description: 'description', declaredValue: 'declared_value', weightG: 'weight_g',
  lengthCm: 'length_cm', widthCm: 'width_cm', heightCm: 'height_cm',
  variants: 'variants',
};

// The client sends `variants` as an array of labels; store it as a JSON string
// in the single `variants` cell (parseIdList_ reads it back on the way out).
function normalizeProductPayload_(p) {
  if (p && Array.isArray(p.variants)) {
    p.variants = JSON.stringify(p.variants.map(function (v) { return String(v).trim(); }).filter(String));
  }
  return p;
}

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

function action_addProduct_(payload, ctx) {
  if (!canManageProducts_(ctx)) return forbidden_();
  var c = resolveCustomerId_(payload, ctx);
  if (c.error) return c.error;
  var p = normalizeProductPayload_(payload.product || {});
  if (!p.name) return badRequest_('product.name is required');

  var ss = getCustomerSpreadsheet_(c.id);
  var sheet = ensureColumns_(getSheetOrThrow_(ss, SHEETS.PRODUCTS), productColumns_());
  var productId = Utilities.getUuid();
  var row = { product_id: productId, created_at: nowIso_(), created_by: ctx.email };
  Object.keys(PRODUCT_COLMAP).forEach(function (k) {
    if (p[k] !== undefined) row[PRODUCT_COLMAP[k]] = p[k];
  });
  if (!row.description) row.description = p.name;
  if (!row.content) row.content = 'OTHERS';
  // Managers auto-verify their own products; members create as pending.
  if (isAdmin_(ctx)) { row.status = 'verified'; row.verified_by = ctx.email; row.verified_at = nowIso_(); }
  else { row.status = 'pending'; }
  appendRowObjects_(sheet, [row]);
  return { ok: true, productId: productId, status: row.status };
}

function action_updateProduct_(payload, ctx) {
  if (!canManageProducts_(ctx)) return forbidden_();
  var c = resolveCustomerId_(payload, ctx);
  if (c.error) return c.error;
  var productId = payload.productId;
  if (!productId) return badRequest_('productId required');
  var p = normalizeProductPayload_(payload.product || {});

  var sheet = ensureColumns_(getSheetOrThrow_(getCustomerSpreadsheet_(c.id), SHEETS.PRODUCTS), productColumns_());
  var data = readObjects_(sheet);
  var row = data.rows.find(function (r) { return String(r.product_id) === String(productId); });
  if (!row) return { ok: false, error: 'NOT_FOUND' };
  var setCell = function (name, val) { var col = data.headers.indexOf(name) + 1; if (col > 0) sheet.getRange(row._row, col).setValue(val); };

  // Compare a new value against the stored one, treating blank as 0 for numbers
  // so unchanged numeric cells (e.g. 0 vs "") don't read as edits.
  var eq_ = function (a, b) {
    var sa = (a == null ? '' : String(a)).trim();
    var sb = (b == null ? '' : String(b)).trim();
    if (sa === sb) return true;
    var na = sa === '' ? 0 : parseFloat(sa), nb = sb === '' ? 0 : parseFloat(sb);
    return !isNaN(na) && !isNaN(nb) && na === nb;
  };

  var changed = 0, shippingChanged = false;
  Object.keys(PRODUCT_COLMAP).forEach(function (k) {
    if (p[k] === undefined) return;
    var colName = PRODUCT_COLMAP[k];
    var col = data.headers.indexOf(colName) + 1;
    if (col < 1) return;
    // Only a change to a real shipping field forces a member's product back to
    // pending. Variant labels don't affect the parcel, so editing just those
    // keeps the product verified.
    if (k !== 'variants' && !eq_(row[colName], p[k])) shippingChanged = true;
    sheet.getRange(row._row, col).setValue(p[k]);
    changed++;
  });
  // Re-verification policy on edit:
  //  • admin/superadmin edits stay verified;
  //  • a member edit that touched a shipping field goes back to pending;
  //  • a member edit that changed ONLY the variant labels keeps its current
  //    status — the parcel is identical, so no admin re-approval is needed.
  if (isAdmin_(ctx)) { setCell('status', 'verified'); setCell('verified_by', ctx.email); setCell('verified_at', nowIso_()); }
  else if (shippingChanged) { setCell('status', 'pending'); setCell('verified_by', ''); setCell('verified_at', ''); }
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
  if (!isAdmin_(ctx)) return forbidden_();
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
  if (!isAdmin_(ctx)) return forbidden_();
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

/** Delete an address, but refuse if any order still references it. */
function action_deleteSenderAddress_(payload, ctx) {
  if (!isAdmin_(ctx)) return forbidden_();
  var c = resolveCustomerId_(payload, ctx);
  if (c.error) return c.error;
  var addressId = payload.addressId;
  if (!addressId) return badRequest_('addressId required');

  var ss = getCustomerSpreadsheet_(c.id);
  // The sender is chosen at booking and stored on the ORDER (not the product), so
  // an address is "in use" while any order still references it.
  var orders = readObjects_(getSheetOrThrow_(ss, SHEETS.ORDERS)).rows;
  var inUse = orders.some(function (r) { return String(r.sender_address_id) === String(addressId); });
  if (inUse) return { ok: false, error: 'IN_USE', detail: 'Address is used by existing orders.' };

  var sheet = getAddressSheet_(ss);
  var row = readObjects_(sheet).rows.find(function (r) { return String(r.address_id) === String(addressId); });
  if (!row) return { ok: false, error: 'NOT_FOUND' };
  sheet.deleteRow(row._row);
  return { ok: true };
}

/* ------------------------ hub: scan & ship ----------------------------- */

/** Resolve an order's chosen sender (sender_address_id) against the group's
 *  address list → the "From" block used on the label + DTDC + report. */
function senderForOrder_(r, addrById) {
  var id = r.sender_address_id ? String(r.sender_address_id) : '';
  var a = (id && addrById) ? addrById[id] : null;
  return {
    senderAddressId: id,
    senderName: a ? a.senderName : '',
    senderPhone: a ? a.senderPhone : '',
    senderAddr1: a ? a.senderAddr1 : '',
    senderAddr2: a ? a.senderAddr2 : '',
    senderCity: a ? a.senderCity : '',
    senderState: a ? a.senderState : '',
    senderPincode: a ? a.senderPincode : '',
    senderEmail: a ? a.senderEmail : '',
  };
}

/** Open ('labeled') orders for ONE group, each stamped with its group id / hub /
 *  name AND its resolved sender (chosen at booking) for export + label. */
function openOrdersForGroup_(ss, customerId, hubCode, groupName) {
  var addrById = senderAddressMap_(ss);
  return readObjects_(getSheetOrThrow_(ss, SHEETS.ORDERS)).rows
    .filter(function (r) { return String(r.status) === 'labeled'; })
    .map(function (r) {
      var snd = senderForOrder_(r, addrById);
      return {
        orderId: r.order_id,
        trackingId: String(r.tracking_id),
        productId: r.product_id,
        extraProductIds: parseIdList_(r.extra_product_ids),
        variant: String(r.variant || ''),
        extraVariants: parseIdList_(r.extra_variants),
        receiverName: r.receiver_name,
        receiverPhone: String(r.receiver_phone),
        receiverPincode: String(r.receiver_pincode),
        receiverLine1: r.receiver_line1,
        receiverLine2: r.receiver_line2,
        receiverState: r.receiver_state,
        exportedAt: r.exported_at ? String(r.exported_at) : '',
        // Group tags → hub (col AE) is a group account; export/ship route to it.
        customerId: String(customerId),
        hubCustomerCode: String(hubCode || ''),
        groupName: String(groupName || ''),
        // Sender chosen at booking → label "From:" + DTDC sender (cols O–V).
        senderAddressId: snd.senderAddressId,
        senderName: snd.senderName, senderPhone: snd.senderPhone,
        senderAddr1: snd.senderAddr1, senderAddr2: snd.senderAddr2,
        senderCity: snd.senderCity, senderState: snd.senderState,
        senderPincode: snd.senderPincode, senderEmail: snd.senderEmail,
      };
    });
}

/** Orders generated but not yet shipped for ONE group — for the scan screen. */
function action_listOpenOrders_(payload, ctx) {
  if (!canScan_(ctx)) return forbidden_();
  var c = resolveCustomerId_(payload, ctx);
  if (c.error) return c.error;
  var rec = getCustomerRecord_(c.id);
  var open = openOrdersForGroup_(getCustomerSpreadsheet_(c.id), c.id, rec.hub_customer_code, rec.name);
  return { ok: true, orders: open };
}

/** ALL groups' open orders for the warehouse operator: every open parcel across
 *  every customer (each stamped with its group id / hub / name), plus ALL groups'
 *  products (product_id is a UUID → globally unique, so one array suffices).
 *  canScan_-gated; the front end uses it for the group-less operator role. */
function action_listAllOpenOrders_(payload, ctx) {
  if (!canScan_(ctx)) return forbidden_();
  var custs = readObjects_(getSheetOrThrow_(getDirectorySpreadsheet_(), SHEETS.CUSTOMERS)).rows;
  var orders = [], products = [];
  custs.forEach(function (r) {
    if (!r.spreadsheet_id) return;
    var ss;
    try { ss = SpreadsheetApp.openById(String(r.spreadsheet_id)); } catch (e) { return; }
    var open = openOrdersForGroup_(ss, r.customer_id, r.hub_customer_code, r.name);
    if (!open.length) return;                          // skip groups with nothing open
    orders = orders.concat(open);
    readObjects_(getSheetOrThrow_(ss, SHEETS.PRODUCTS)).rows.forEach(function (pr) {
      products.push(productFromRow_(pr));
    });
  });
  return { ok: true, orders: orders, products: products };
}

/** Mark a set of scanned tracking IDs shipped + record a manifest. */
function action_commitShipment_(payload, ctx) {
  if (!canScan_(ctx)) return forbidden_();
  var c = resolveScanCustomerId_(payload, ctx);   // a warehouse operator ships any group
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
      productId: 'product_id', variant: 'variant',
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

// For SCAN actions only (commitShipment / recordExport): a warehouse scanner may
// act on ANY group. Safe because those actions are all canScan_-gated — the role
// gate decides WHO may scan; this just resolves WHICH group the parcel belongs to.
function resolveScanCustomerId_(payload, ctx) {
  var id = payload.customerId || ctx.customerId;
  if (!id) return { error: badRequest_('customerId required') };
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
