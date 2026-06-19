# Ship Easy — deployment & first round-trip

Everything here is free. Order matters; do the steps top to bottom. You'll wire
up Google sign-in, the Sheets backend, the PWA, then run one real
book → generate → scan → export cycle.

---

## 0. Prerequisites
- A Google account that will **own** everything (use a dedicated company account,
  not a personal one — this is the single biggest longevity risk).
- Node 20+ locally (to build the frontend).
- A GitHub repo for the frontend (the existing one, deploying via
  `.github/workflows/deploy.yml` to GitHub Pages).

---

## 1. Google OAuth client id (sign-in)
1. Go to **console.cloud.google.com** → create/select a project.
2. **APIs & Services → OAuth consent screen**: External, fill app name + your
   email, add yourself as a Test user (or publish). No special scopes needed
   (sign-in only).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID →
   Web application**.
   - **Authorized JavaScript origins** (origin only, no path):
     - `http://localhost:5173` (local dev)
     - `https://YOURNAME.github.io` (GitHub Pages)
   - Create, then copy the **Client ID** (`…apps.googleusercontent.com`).
   - You'll use this in BOTH the backend (`OAUTH_CLIENT_ID`) and the frontend
     (`VITE_GOOGLE_CLIENT_ID`). They must match.

---

## 2. Directory spreadsheet + bootstrap superadmin
1. Create one Google Sheet named e.g. **"ShipEasy Directory"**. Copy its id from
   the URL (`/spreadsheets/d/THIS_PART/edit`).
2. Add two tabs with these **exact** header rows (row 1):

   **`Customers`**
   ```
   customer_id | name | spreadsheet_id | sender_pincode | sender_name | sender_phone | sender_addr1 | sender_addr2 | sender_city | sender_state | sender_email | hub_customer_code | status
   ```
   **`Users`**
   ```
   email | customer_id | role | status
   ```
3. **Bootstrap yourself** (chicken-and-egg: you must be a superadmin before the
   admin UI works). Add one row to `Users`:
   ```
   you@gmail.com | (leave blank) | superadmin | active
   ```
   Use the lowercase email of the Google account you'll sign in with.

> The per-customer spreadsheets are created later by the app (`createCustomer`),
> not by hand. Only this directory is manual.

---

## 3. Apps Script backend

### Option A — paste in the editor (no tools)
1. Go to **script.google.com → New project**. Delete the default file.
2. Create one file per `.gs` in `apps-script/` and paste the contents:
   `Allocation.gs`, `GenerateLabels.gs`, `Schema.gs`, `Auth.gs`, `WebApp.gs`,
   `Actions.gs`, `Admin.gs` (and optionally `Allocation.test.gs`). Then in
   **Project Settings**, tick "Show appsscript.json" and paste `appsscript.json`.

### Option B — push with clasp (recommended for redeploys)
From the `apps-script/` folder:
```bash
npm i -g @google/clasp
clasp login                       # opens a browser (your owner account)
clasp create --type standalone --title "ShipEasy Backend" --rootDir .
clasp push                        # uploads all .gs + appsscript.json
```
After any code change later, just `clasp push` then redeploy (step 6). The
included `appsscript.json` already sets the web app to *Execute as me / Anyone*.

### Then (either option)
3. **Project Settings → Script Properties** → add two:
   - `DIRECTORY_SS_ID` = the directory spreadsheet id from step 2
   - `OAUTH_CLIENT_ID` = the client id from step 1
4. **Prove the core**: select `runAllocationTests` → Run → check the log for
   `ALL PASSED`.
5. **Authorize the Drive scope** (needed so `createCustomer` can make
   spreadsheets): select `action_listCustomers_`… actually just run any function
   once (e.g. open the editor's Run on `doGet`) and accept the Google
   authorization prompt. The first `createCustomer` will also trigger it.
6. **Deploy → New deployment → Web app**:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
   - Deploy, copy the **`/exec` URL**.
7. Open the `/exec` URL in a browser — you should see
   `{"ok":true,"service":"ship-easy","status":"up"}`.

> After ANY code change, **Deploy → Manage deployments → Edit → New version**.
> Edits aren't live until redeployed.

---

## 4. Frontend (PWA)
1. In the project root, copy `.env.example` → `.env` and fill:
   ```
   VITE_WEBAPP_URL=https://script.google.com/macros/s/XXXX/exec
   VITE_GOOGLE_CLIENT_ID=XXXX.apps.googleusercontent.com
   ```
2. Local test: `npm install` then `npm run dev`, open `http://localhost:5173`.
   Sign in with your superadmin Google account.
3. Deploy to GitHub Pages: these two values are public, but `.env` is gitignored,
   so set them for the CI build. Easiest: in the repo, **Settings → Secrets and
   variables → Actions → Variables**, add `VITE_WEBAPP_URL` and
   `VITE_GOOGLE_CLIENT_ID`, then add an `env:` block to the **Build** step in
   `.github/workflows/deploy.yml`:
   ```yaml
   - name: Build
     run: npm run build
     env:
       VITE_WEBAPP_URL: ${{ vars.VITE_WEBAPP_URL }}
       VITE_GOOGLE_CLIENT_ID: ${{ vars.VITE_GOOGLE_CLIENT_ID }}
   ```
4. Push → the workflow builds and publishes to
   `https://YOURNAME.github.io/ship-easy/`.

---

## 5. The round-trip test
Signed in as superadmin:

1. **Master Admin** → **Create Customer** (code `CUST001`, name, sender block,
   hub customer code). This auto-creates that customer's spreadsheet — confirm
   via the spreadsheet link in the Customers list.
2. **Add User**: add an operator email (yours is fine) as `admin` for `CUST001`.
   (You can also just use your superadmin account.)
3. **Tracking ID Ranges**: pick `CUST001`, add a range, e.g.
   `prefix R, start 1001016868, end 1001016886`. Confirm "remaining" shows.
4. **Products**: add a product (name, weight, dims, declared value).
5. **Book Orders**: add 2–3 orders (paste text or type; all receiver fields
   mandatory) → **Generate Labels**. A PDF of labels downloads; the stack clears.
6. **Scan & Book** (admin): the orders appear as "open". Type/scan a tracking ID
   from the PDF → it matches and shows the receiver. (Try an unknown id → "Not
   found"; scan the same one twice → "Already scanned".)
7. **Export DTDC xlsx** → open it: 40 columns, your sender block, product fields,
   receiver block, state derived from pincode.
8. **Mark Shipped** → those orders leave the open list; a manifest row is written.

If all eight work, the system is live.

---

## Troubleshooting
- **`UNAUTHENTICATED` / `BAD_AUDIENCE`** — `OAUTH_CLIENT_ID` (backend) and
  `VITE_GOOGLE_CLIENT_ID` (frontend) don't match, or the token is stale.
- **`NO_ACCOUNT`** — your signed-in email isn't in the directory `Users` sheet
  (check spelling/lowercase).
- **Sign-in button doesn't show / popup blocked** — the page origin isn't in the
  OAuth client's *Authorized JavaScript origins* (must be the exact origin, no
  path).
- **CORS / network error on API calls** — the web app must be deployed *Execute
  as Me, Anyone*; the app already POSTs as `text/plain` to avoid preflight.
  Re-deploy a new version after edits.
- **`createCustomer` fails with authorization** — run any function once in the
  Apps Script editor and accept the Drive permission prompt.
- **Empty product weight/state in the xlsx** — the order references a product
  that no longer exists, or the pincode prefix isn't in `pincode.ts` (add it).
