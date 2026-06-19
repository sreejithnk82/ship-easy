/**
 * Schema.gs
 * ---------
 * Sheet names, the directory lookup, and small generic Sheets helpers.
 *
 * Data layout:
 *   • One DIRECTORY spreadsheet (its id is stored in a Script Property).
 *       - "Customers" sheet: one row per customer, incl. that customer's own
 *         spreadsheet id and sender/DTDC details.
 *   • One spreadsheet PER customer, each with:
 *       - "TrackingRanges": seq | prefix | start | end | pad | cursor | status
 *       - "Orders":         order_id | batch_id | client_order_id | tracking_id |
 *                           product_id | receiver_name | receiver_phone |
 *                           receiver_pincode | receiver_line1 | receiver_line2 |
 *                           receiver_state | status | operator_email | created_at
 *       - "Batches":        batch_id | idempotency_key | operator_email | count |
 *                           orders_json | result_json | status | created_at
 */

var SCRIPT_PROP_DIRECTORY_SS = 'DIRECTORY_SS_ID';

var SHEETS = {
  CUSTOMERS: 'Customers',
  USERS: 'Users',
  HUBCODES: 'HubCodes',
  PRODUCTS: 'Products',
  RANGES: 'TrackingRanges',
  ORDERS: 'Orders',
  BATCHES: 'Batches',
  MANIFESTS: 'Manifests',
};

function getDirectorySpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty(SCRIPT_PROP_DIRECTORY_SS);
  if (!id) {
    throw new Error('Script property "' + SCRIPT_PROP_DIRECTORY_SS + '" is not set. ' +
      'Set it to the directory spreadsheet id (Project Settings → Script Properties).');
  }
  return SpreadsheetApp.openById(id);
}

function getSheetOrThrow_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Missing sheet "' + name + '" in spreadsheet ' + ss.getId());
  return sh;
}

/** Get a sheet, creating it (with the given header row) if it doesn't exist. */
function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/**
 * Read a whole sheet into an array of plain objects keyed by the header row.
 * Each object also carries `_row` (1-based sheet row index). Fully-blank rows
 * are skipped. Returns {headers:[...], rows:[{...}]}.
 */
function readObjects_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values.length) return { headers: [], rows: [] };

  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var obj = { _row: i + 1 };
    var allBlank = true;
    for (var c = 0; c < headers.length; c++) {
      var val = values[i][c];
      obj[headers[c]] = val;
      if (val !== '' && val !== null) allBlank = false;
    }
    if (!allBlank) rows.push(obj);
  }
  return { headers: headers, rows: rows };
}

/** Append objects as rows, matching the sheet's header columns by name. */
function appendRowObjects_(sheet, objs) {
  if (!objs || !objs.length) return;
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var matrix = objs.map(function (o) {
    return headers.map(function (h) { return (o[h] === undefined) ? '' : o[h]; });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, matrix.length, headers.length).setValues(matrix);
}

/** Look up a customer row in the directory by customer_id. */
function getCustomerRecord_(customerId) {
  var dir = getDirectorySpreadsheet_();
  var res = readObjects_(getSheetOrThrow_(dir, SHEETS.CUSTOMERS));
  var rec = res.rows.find(function (r) { return String(r.customer_id) === String(customerId); });
  if (!rec) throw new Error('Unknown customer_id: ' + customerId);
  if (!rec.spreadsheet_id) throw new Error('Customer "' + customerId + '" has no spreadsheet_id set.');
  return rec;
}

/** Open the per-customer spreadsheet for a given customer_id. */
function getCustomerSpreadsheet_(customerId) {
  return SpreadsheetApp.openById(getCustomerRecord_(customerId).spreadsheet_id);
}
