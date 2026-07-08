/**
 * WebApp.gs
 * ---------
 * The HTTP entry point. Deploy this script as a Web App
 * (Execute as: Me, Who has access: Anyone) and the React PWA calls it.
 *
 * Every request is one JSON envelope, POSTed as a "simple request"
 * (Content-Type: text/plain) so the browser skips the CORS preflight that
 * Apps Script can't answer:
 *
 *   { "action": "generateLabels",
 *     "token":  "<google id token>",
 *     "payload": { ...action-specific... } }
 *
 * Flow: parse → verify token → resolve user (role + customer) → authorize the
 * action → run it → JSON out. Identity (operatorEmail) ALWAYS comes from the
 * verified token, never from the client payload.
 */

function doPost(e) {
  try {
    var body = parseBody_(e);
    if (!body) return jsonOut_({ ok: false, error: 'BAD_REQUEST', detail: 'Body must be JSON.' });
    if (!body.action) return jsonOut_({ ok: false, error: 'BAD_REQUEST', detail: 'Missing action.' });

    var auth = verifyIdToken_(body.token);
    if (!auth.ok) return jsonOut_({ ok: false, error: 'UNAUTHENTICATED', detail: auth.error });

    var user = getUserByEmail_(auth.email);
    if (!user) return jsonOut_({ ok: false, error: 'NO_ACCOUNT', detail: 'Email not provisioned: ' + auth.email });
    if (String(user.status || '').toLowerCase() === 'disabled') {
      return jsonOut_({ ok: false, error: 'DISABLED' });
    }

    var ctx = {
      email: auth.email,
      role: String(user.role || 'member').trim(),
      customerId: user.customer_id,
    };

    // Maintenance pause: when MAINTENANCE_MODE is set, block write actions for
    // everyone except superadmin. Reads still work (so the app shows a banner).
    var maint = maintenanceMessage_();
    if (maint && ctx.role !== 'superadmin' && !READ_ACTIONS_[body.action]) {
      return jsonOut_({ ok: false, error: 'MAINTENANCE', detail: maint });
    }

    return jsonOut_(dispatch_(body.action, body.payload || {}, ctx));
  } catch (err) {
    return jsonOut_({ ok: false, error: 'INTERNAL', detail: String((err && err.message) || err) });
  }
}

/** Health check (visit the /exec URL in a browser). */
function doGet(e) {
  return jsonOut_({ ok: true, service: 'ship-easy', status: 'up' });
}

/* ---------------------------- maintenance ---------------------------- */
// Read-only actions allowed during a maintenance pause (everything else is a
// write and is blocked for non-superadmins while MAINTENANCE_MODE is set).
var READ_ACTIONS_ = {
  getProfile: 1, listProducts: 1, listSenderAddresses: 1, listOpenOrders: 1,
  listOrders: 1, customerBalance: 1, listCustomers: 1, listHubCodes: 1,
  listUsers: 1, listTrackingRanges: 1, listBalances: 1, customerHealth: 1,
  listServiceablePincodes: 1, shipmentReport: 1,
};

/** The maintenance message if the pause is on, else '' (off). */
function maintenanceMessage_() {
  return PropertiesService.getScriptProperties().getProperty('MAINTENANCE_MODE') || '';
}

/** Toggle from the editor. setMaintenance('msg') turns it on; setMaintenance('') off. */
function setMaintenance(msg) {
  var props = PropertiesService.getScriptProperties();
  if (msg) { props.setProperty('MAINTENANCE_MODE', String(msg)); return 'Maintenance ON: ' + msg; }
  props.deleteProperty('MAINTENANCE_MODE');
  return 'Maintenance OFF';
}

/** One-click ON (default message) — run from the editor. */
function maintenanceOn() {
  return setMaintenance('We are doing a quick maintenance — changes are paused, please try again shortly.');
}

/** One-click OFF — run from the editor. */
function maintenanceOff() {
  return setMaintenance('');
}

/* ------------------------------ dispatch ------------------------------ */

function dispatch_(action, payload, ctx) {
  switch (action) {
    case 'getProfile':     return action_getProfile_(payload, ctx);
    case 'listProducts':   return action_listProducts_(payload, ctx);
    case 'addProduct':     return action_addProduct_(payload, ctx);
    case 'updateProduct':  return action_updateProduct_(payload, ctx);
    case 'deleteProduct':  return action_deleteProduct_(payload, ctx);
    case 'verifyProduct':  return action_verifyProduct_(payload, ctx);
    case 'listSenderAddresses':  return action_listSenderAddresses_(payload, ctx);
    case 'addSenderAddress':     return action_addSenderAddress_(payload, ctx);
    case 'updateSenderAddress':  return action_updateSenderAddress_(payload, ctx);
    case 'deleteSenderAddress':  return action_deleteSenderAddress_(payload, ctx);
    case 'generateLabels': return action_generateLabels_(payload, ctx);
    case 'listOpenOrders': return action_listOpenOrders_(payload, ctx);
    case 'updateOrder':    return action_updateOrder_(payload, ctx);
    case 'commitShipment': return action_commitShipment_(payload, ctx);
    case 'voidOrder':      return action_voidOrder_(payload, ctx);
    case 'recordExport':   return action_recordExport_(payload, ctx);
    case 'listOrders':     return action_listOrders_(payload, ctx);
    case 'shipmentReport': return action_shipmentReport_(payload, ctx);
    case 'customerBalance':return action_customerBalance_(payload, ctx);
    // superadmin onboarding
    case 'listCustomers':      return action_listCustomers_(payload, ctx);
    case 'createCustomer':     return action_createCustomer_(payload, ctx);
    case 'updateCustomer':     return action_updateCustomer_(payload, ctx);
    case 'listHubCodes':       return action_listHubCodes_(payload, ctx);
    case 'listServiceablePincodes': return action_listServiceablePincodes_(payload, ctx);
    case 'addHubCode':         return action_addHubCode_(payload, ctx);
    case 'addUser':            return action_addUser_(payload, ctx);
    case 'listUsers':          return action_listUsers_(payload, ctx);
    case 'updateUser':         return action_updateUser_(payload, ctx);
    case 'removeUser':         return action_removeUser_(payload, ctx);
    case 'addTrackingRange':   return action_addTrackingRange_(payload, ctx);
    case 'listTrackingRanges': return action_listTrackingRanges_(payload, ctx);
    case 'updateTrackingRange':   return action_updateTrackingRange_(payload, ctx);
    case 'deleteTrackingRange':   return action_deleteTrackingRange_(payload, ctx);
    case 'reassignTrackingRange': return action_reassignTrackingRange_(payload, ctx);
    case 'listBalances':       return action_listBalances_(payload, ctx);
    case 'customerHealth':     return action_customerHealth_(payload, ctx);
    case 'archiveOrders':      return action_archiveOrders_(payload, ctx);
    default: return { ok: false, error: 'UNKNOWN_ACTION', detail: action };
  }
}

function action_generateLabels_(payload, ctx) {
  var customerId = payload.customerId;
  if (!customerId) return { ok: false, error: 'BAD_REQUEST', detail: 'customerId is required.' };

  // Authorization: the caller must belong to that customer (or be admin/superadmin,
  // who are global and may book for any group).
  if (!isAdmin_(ctx) && String(ctx.customerId) !== String(customerId)) {
    return { ok: false, error: 'FORBIDDEN', detail: 'Not a member of this customer.' };
  }

  // operatorEmail is taken from the verified token — any client value is ignored.
  return generateLabels({
    customerId: customerId,
    idempotencyKey: payload.idempotencyKey,
    operatorEmail: ctx.email,
    orders: payload.orders,
  });
}

/* ------------------------------ helpers ------------------------------ */

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return null;
  try { return JSON.parse(e.postData.contents); } catch (err) { return null; }
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
