# Ship Easy — Apps Script backend

The free backend: a Google Apps Script project that reads/writes Google Sheets
and exposes functions to the React PWA. This first slice contains the
**tracking-ID allocator** — the one piece with real correctness risk.

## Files

| File | Purpose |
|---|---|
| `Allocation.gs` | **Pure** range-walk allocator (`planAllocation`). No I/O — unit-testable. |
| `GenerateLabels.gs` | Locked, idempotent orchestration: allocate IDs, record the batch, write orders. |
| `Auth.gs` | Verifies the Google ID token (tokeninfo) → resolves email to a user/role/customer. |
| `WebApp.gs` | HTTP entry (`doPost`/`doGet`): parse → authenticate → authorize → dispatch. |
| `Schema.gs` | Sheet names, directory lookup, generic Sheets helpers. |
| `Allocation.test.gs` | Run `runAllocationTests()` to prove the allocator. No setup needed. |

## Prove the core first (no setup)

1. Create a new Apps Script project (script.google.com) and paste in the four `.gs` files.
2. Select `runAllocationTests` in the toolbar and click **Run**.
3. Open **Execution log** — expect `ALL PASSED — N passed, 0 failed.`

That validates the allocator (spanning gaps, all-or-nothing, exhaustion,
courier prefix/padding, purity) without touching any spreadsheet.

## Wire up the live allocator

### 1. Directory spreadsheet
Create one spreadsheet with two sheets (row 1 = headers, exact names):

**`Customers`**
```
customer_id | name | spreadsheet_id | sender_pincode | sender_name | sender_phone |
sender_addr1 | sender_addr2 | sender_city | sender_state | sender_email |
hub_customer_code | status
```

**`Users`** — who may sign in, and as what:
```
email | customer_id | role | status
```
- `role` = `member` | `admin` | `superadmin`; `status` blank or `disabled`.
- A `superadmin` may act for any customer; everyone else is locked to their own `customer_id`.

Copy the spreadsheet id and set Script Property **`DIRECTORY_SS_ID`**
(Project Settings → Script Properties).

### 2. Per-customer spreadsheet
For each customer, create a spreadsheet (put its id in the directory's
`spreadsheet_id` column) with three sheets:

**`TrackingRanges`** — the courier blocks you've been issued for this customer:
```
seq | prefix | start | end | pad | cursor | status
```
- `cursor` starts equal to `start`; `status` starts `active`.
- e.g. `1 | R | 1001016868 | 1001016876 | 10 | 1001016868 | active`

**`Orders`**:
```
order_id | batch_id | client_order_id | tracking_id | product_id |
receiver_name | receiver_phone | receiver_pincode | receiver_line1 |
receiver_line2 | receiver_state | status | operator_email | created_at
```

**`Batches`**:
```
batch_id | idempotency_key | operator_email | count | orders_json |
result_json | status | created_at
```

### 3. Smoke-test `generateLabels`
With one customer + ranges set up, run from the editor:

```js
function smoke() {
  Logger.log(generateLabels({
    customerId: 'CUST001',
    idempotencyKey: Utilities.getUuid(),  // a NEW uuid each manual run
    operatorEmail: 'op@example.com',
    orders: [
      { clientOrderId: 'a1', productId: 'P1', receiverName: 'Varundev Tp',
        receiverPhone: '9961545170', receiverPincode: '670141',
        receiverLine1: 'Skylone traders near Telephone bhavan',
        receiverLine2: 'Taliparamba, Kannur', receiverState: 'KERALA' }
    ]
  }));
}
```

Re-running `smoke()` with the **same** `idempotencyKey` returns the **same**
result and does **not** consume more IDs (idempotency).

## Why duplicates are impossible

- **`LockService`** serializes the whole allocate→record→write block, so two
  different callers can never read the same cursor.
- **Cursor advance is persisted first** (`SpreadsheetApp.flush()`), so a number
  below the cursor can never be issued again — even if a later write fails.
- **All-or-nothing**: a shortfall allocates nothing and returns `INSUFFICIENT_IDS`.
- **`idempotencyKey`**: the same batch submitted twice returns the stored result
  instead of allocating again.

Worst-case crash outcome is a few **unused** IDs (gaps), never a duplicate
tracking ID and never a duplicate shipment.

## Deploy as a Web App + frontend calls

### Deploy
1. Set Script Property **`OAUTH_CLIENT_ID`** to your Google OAuth **Web client id**
   (Google Cloud Console → Credentials). The frontend uses the same id.
2. **Deploy ▸ New deployment ▸ Web app**, with:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
3. Copy the `/exec` URL — that's the API endpoint. Visiting it in a browser
   should return `{"ok":true,"service":"ship-easy","status":"up"}`.
4. Re-deploy a **new version** whenever you change the code (edits don't go live
   until redeployed).

### Frontend call (React PWA)
Get a Google **ID token** via Google Identity Services, then POST the envelope.
Use `Content-Type: text/plain` so the browser skips the CORS preflight Apps
Script can't answer (the body is still JSON):

```js
const res = await fetch(WEB_APP_EXEC_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({
    action: 'generateLabels',
    token: googleIdToken,                 // JWT from Google Identity Services
    payload: {
      customerId: 'CUST001',
      idempotencyKey: crypto.randomUUID(), // generate ONCE per batch, reuse on retry
      orders: [ /* { clientOrderId, productId, receiverName, ... } */ ],
    },
  }),
});
const data = await res.json();            // { ok, batchId, assignments, ... }
```

> `operatorEmail` is **not** sent by the client — the server derives it from the
> verified token. Generate `idempotencyKey` once when the user clicks "Generate
> Labels" and reuse it if you retry, so a dropped response never double-allocates.

## Request envelope (all actions)

```
{ action: String, token: <google id token>, payload: { ... } }
```
Auth/authorization errors:
`UNAUTHENTICATED` (bad/missing token), `NO_ACCOUNT` (email not in `Users`),
`DISABLED`, `FORBIDDEN` (wrong customer), `UNKNOWN_ACTION`.

## `generateLabels` contract

**Request**
```
{ customerId, idempotencyKey, operatorEmail,
  orders: [ { clientOrderId, productId, receiverName, receiverPhone,
              receiverPincode, receiverLine1, receiverLine2, receiverState } ] }
```
**Success** → `{ ok:true, batchId, count, createdAt, assignments:[{clientOrderId, trackingId}] }`
**Failure** → `{ ok:false, error:'INSUFFICIENT_IDS'|'INVALID_COUNT'|'BAD_REQUEST'|'BUSY'|'INTERNAL', ... }`

> Note: `operatorEmail` is accepted in the request for now. Once the HTTP entry
> point (`doPost` + Google token verification) is added, it will be derived from
> the verified identity and the client-supplied value ignored.
