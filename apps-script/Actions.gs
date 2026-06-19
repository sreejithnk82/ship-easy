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
  var profile = { ok: true, email: ctx.email, role: ctx.role, customerId: ctx.customerId || '' };
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
  var products = rows.map(productFromRow_);
  return { ok: true, products: products };
}

function productFromRow_(r) {
  return {
    productId: r.product_id,
    productCode: r.product_code || '',
    name: r.name,
    hubCustomerCode: r.hub_customer_code || '',
    senderName: r.sender_name || '',
    senderPhone: String(r.sender_phone || ''),
    senderAddr1: r.sender_addr1 || '',
    senderAddr2: r.sender_addr2 || '',
    senderCity: r.sender_city || '',
    senderState: r.sender_state || '',
    senderPincode: String(r.sender_pincode || ''),
    senderEmail: r.sender_email || '',
    content: r.content || 'OTHERS',
    description: r.description || r.name,
    declaredValue: Number(r.declared_value) || 0,
    weightG: Number(r.weight_g) || 0,
    lengthCm: Number(r.length_cm) || 0,
    widthCm: Number(r.width_cm) || 0,
    heightCm: Number(r.height_cm) || 0,
  };
}

/** camelCase product field -> sheet column. Shared by add/update. */
var PRODUCT_COLMAP = {
  productCode: 'product_code', name: 'name', hubCustomerCode: 'hub_customer_code',
  senderName: 'sender_name', senderPhone: 'sender_phone', senderAddr1: 'sender_addr1',
  senderAddr2: 'sender_addr2', senderCity: 'sender_city', senderState: 'sender_state',
  senderPincode: 'sender_pincode', senderEmail: 'sender_email', content: 'content',
  description: 'description', declaredValue: 'declared_value', weightG: 'weight_g',
  lengthCm: 'length_cm', widthCm: 'width_cm', heightCm: 'height_cm',
};

function action_addProduct_(payload, ctx) {
  if (!isAdmin_(ctx)) return forbidden_();
  var c = resolveCustomerId_(payload, ctx);
  if (c.error) return c.error;
  var p = payload.product || {};
  if (!p.name) return badRequest_('product.name is required');

  var ss = getCustomerSpreadsheet_(c.id);
  var productId = Utilities.getUuid();
  var row = { product_id: productId, created_at: new Date().toISOString() };
  Object.keys(PRODUCT_COLMAP).forEach(function (k) {
    if (p[k] !== undefined) row[PRODUCT_COLMAP[k]] = p[k];
  });
  if (!row.description) row.description = p.name;
  if (!row.content) row.content = 'OTHERS';
  appendRowObjects_(getSheetOrThrow_(ss, SHEETS.PRODUCTS), [row]);
  return { ok: true, productId: productId };
}

function action_updateProduct_(payload, ctx) {
  if (!isAdmin_(ctx)) return forbidden_();
  var c = resolveCustomerId_(payload, ctx);
  if (c.error) return c.error;
  var productId = payload.productId;
  if (!productId) return badRequest_('productId required');
  var p = payload.product || {};

  var sheet = getSheetOrThrow_(getCustomerSpreadsheet_(c.id), SHEETS.PRODUCTS);
  var data = readObjects_(sheet);
  var row = data.rows.find(function (r) { return String(r.product_id) === String(productId); });
  if (!row) return { ok: false, error: 'NOT_FOUND' };

  var changed = 0;
  Object.keys(PRODUCT_COLMAP).forEach(function (k) {
    if (p[k] === undefined) return;
    var col = data.headers.indexOf(PRODUCT_COLMAP[k]) + 1;
    if (col < 1) return;
    sheet.getRange(row._row, col).setValue(p[k]);
    changed++;
  });
  SpreadsheetApp.flush();
  return { ok: true, changed: changed };
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

/* ------------------------ hub: scan & ship ----------------------------- */

/** Orders generated but not yet shipped (status 'labeled') — for the scan screen. */
function action_listOpenOrders_(payload, ctx) {
  if (!isAdmin_(ctx)) return forbidden_();
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
      };
    });
  return { ok: true, orders: open };
}

/** Mark a set of scanned tracking IDs shipped + record a manifest. */
function action_commitShipment_(payload, ctx) {
  if (!isAdmin_(ctx)) return forbidden_();
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
    var now = new Date().toISOString();
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
  if (ctx.role !== 'superadmin' && String(ctx.customerId) !== String(id)) {
    return { error: forbidden_() };
  }
  return { id: id };
}

function isAdmin_(ctx) {
  return ctx.role === 'admin' || ctx.role === 'superadmin';
}

function forbidden_() { return { ok: false, error: 'FORBIDDEN' }; }
function badRequest_(detail) { return { ok: false, error: 'BAD_REQUEST', detail: detail }; }
