# Phase 3, Step 2 — Bills, purchasing, stock, materials and expenses: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The money PRISM pays out, tied to the work: contractor and supplier bills linked to tickets and projects (with the yearly "paid per contractor" and 1099 reports), purchase orders and receiving, a small shelf stock sold by the unit used, materials on tickets as on projects, equipment received becoming customer assets, and business expenses with receipts — all posting to the ledger. Works with Customer billing off.

**Architecture:** New tables for bills, purchase orders, stock movements and expenses; the existing `ProjectMaterials` table becomes the one materials table for tickets and projects. Services in `backend/src/services/money/` post to the step 1 ledger (`postEntry`, `reverseEntry`). Routes under `/api/v1/money/…`; ticket and project pages gain Materials and Bills panels; a **Money** item in the sidebar opens Bills, Purchase orders, Stock and Expenses.

**Tech Stack:** as step 1 (Express/Sequelize/MariaDB, React/Vite, decimal.js via `services/money/money.js`).

**Spec:** `docs/superpowers/specs/2026-11-25-phase3-money-design.md` (Step 2, and the owner's decisions on purchasing and stock).

## Global Constraints

- Everything from step 1's Global Constraints (exact money through `money.js`; DECIMAL(12,4) unit amounts, DECIMAL(12,2) totals; org time zone; company scope on every fetch-by-id, out of reach answers like missing; idempotent, reversible migrations added to the companies chain when they point at Companies/Contacts/Departments, new tables in `resetData`; table checks via `showAllTables` mapped through `tableName`).
- Numbers continue from 109.
- Step 2 works **with Customer billing off** (spec: bills, purchasing, stock, materials, expenses are for internal IT too). Nothing here sits behind `requireCustomerBilling`.
- Permissions: bills and expenses `money.bills.manage`; purchase orders, receiving and stock `money.purchasing.manage`; books reports in this step (paid per vendor, 1099) `money.bills.manage` or `money.books.view`. Adding materials to a ticket or project needs the right to edit that record; **prices and costs on materials are shown only to holders of `money.billing.view`, `money.purchasing.manage` or `money.bills.manage`.**
- Every posting is one balanced ledger entry written in the same transaction as the record it belongs to; a correction is a reversal, never an edit of the entry.
- No markup by default (owner); stock is sold by the usage unit (300 ft of a 1,000 ft box); no contractor tax IDs (SSN/EIN) stored anywhere (anti-goal).
- Files (vendor bill PDFs, receipts) go through the existing upload checks (signature, size, virus scan) and download as attachments only.

## Ledger postings (fixed; every task that posts uses these)

| Event | Debit | Credit |
|---|---|---|
| Bill entered, line kind `contractor` | 5100 Contractor costs | 2000 Accounts payable |
| Bill entered, line kind `materials` (job) | 5000 Cost of materials | 2000 |
| Bill entered, line kind `stock` | 1200 Inventory | 2000 |
| Bill entered, line kind `expense` (category account 6100/6200/6300/6900) | that account | 2000 |
| Bill paid | 2000 | 1000 Cash |
| Bill voided | reversal of the entered entry (and of the paid entry if paid) | |
| Stock used on a job | 5000 | 1200 |
| Stock adjusted down / up | 6900 / 1200 | 1200 / 6900 |
| Expense recorded (paid) | its category account | 1000 |

`sourceType` values: `bill`, `bill_payment`, `stock_use`, `stock_adjust`, `expense`. Each entry carries the job's `companyId` when there is one.

## Review Focus

1. **A bill whose lines don't add up to its total**, a negative line, a bill number reused for the same vendor, a bill paid twice, a void after payment → refused or correctly reversed; the ledger always balances and AP returns to 0 for a voided bill.
2. **Receiving more than ordered, receiving twice, receiving a cancelled PO**, a serialized item received without enough serial numbers → refused; partial receipts leave the PO *partly received*.
3. **Using more stock than is on hand** → refused (no negative stock unless adjusted); using exactly what's left → 0 and a low-stock alert; concurrent uses don't oversell (row lock).
4. **A technician** adding 300 ft of cable to a ticket sees the quantity, never the cost or price; a billing person sees both; another company's ticket can't be reached through any material, bill or PO line.
5. **Billed materials** (status `billed`) can't be edited or deleted on any path, exactly like billed time.

---

### Task 1: Vendors, bills and bill payments

**Files:**
- Create: `backend/migrations/20260101000109-bills.js`, models `Bill.js`, `BillLine.js`, `backend/src/services/money/bills.js`, `backend/src/controllers/money/billsController.js`
- Modify: `backend/src/models/Company.js` (`is1099` BOOLEAN default false — vendors only), companies controller (read/write `is1099`, vendors only), `routes/money.js`, `companyMerge.js` (bills follow the vendor), helpers resetData, companies migration chain
- Test: `backend/test/integration/money.bills.test.js`

Tables: `Bills` (id, `vendorCompanyId` FK Companies RESTRICT, `billNumber` STRING(100), `billDate` DATEONLY, `dueDate` DATEONLY null, `status` ENUM('received','entered','paid','void') default 'received', `externalRef` STRING(100) null — e.g. the Tyler Incode number, `total` DECIMAL(12,2), `paidOn` DATEONLY null, `paidMethod` STRING(40) null, `paidRef` STRING(100) null, `notes` TEXT, `fileName`/`filePath` null, `ledgerEntryId` INT null, `paymentEntryId` INT null, createdBy, timestamps; unique (vendorCompanyId, billNumber)). `BillLines` (id, billId FK cascade, `kind` ENUM('contractor','materials','stock','expense'), `description` STRING(500), `amount` DECIMAL(12,2) > 0, `expenseAccount` STRING(20) null (6100/6200/6300/6900, only for kind expense), `ticketId` FK null, `projectId` FK null, `purchaseOrderLineId` INT null (FK in Task 2)).

Statuses: `received` → `entered` (the money is owed; posts the bill entry; optional `externalRef`) → `paid` (`paidOn`, `paidMethod`, `paidRef`; posts the payment entry) ; `void` from received/entered/paid (reverses what was posted).

**Interfaces:**
- Produces (service): `createBill(input, { userId })`, `updateBill(bill, input)` (only while `received`), `enterBill(bill, { externalRef, userId })`, `payBill(bill, { paidOn, paidMethod, paidRef, userId })`, `voidBill(bill, { reason, userId })`, `billJson(bill, { canSeeAmounts })`; routes: `GET/POST /money/bills` (filters: `vendorCompanyId`, `status`, `ticketId`, `projectId`, `from`, `to`, `search`), `GET/PATCH /money/bills/:id`, `POST /money/bills/:id/enter|pay|void`, `POST/GET /money/bills/:id/file`; `GET /tickets/:id/bills` and `GET /projects/:id/bills` (the job's bills; amounts only with money permissions).
- A line's ticket or project must be one the caller can reach; a bill can span several jobs (the network drop and its follow-up), even of different companies.

- [ ] **Step 1: Failing tests** — Hale Communication (vendor, 1099) bill H-1042 for $1,250: one `contractor` line linked to the HR ticket → `received`; lines must sum to `total` (400 otherwise), amounts > 0, a duplicate H-1042 for the same vendor → 409 (another vendor may reuse it); `enter` with externalRef 'INC-5521' posts Dr 5100 / Cr 2000 1,250.00; `pay` on 2026-12-15 by check #3301 posts Dr 2000 / Cr 1000; paying twice → 409; `void` of a paid bill posts both reversals and AP/5100/Cash balances return to 0.00; a bill can't be edited after `entered` (409); the ticket's `GET /tickets/:id/bills` lists it; a technician gets 403 on bills and sees no amounts in the ticket's list; a line on a ticket out of the caller's reach → 400; PDF upload stored, `.exe` refused; `is1099` only settable on a vendor; merging Hale into another vendor moves its bills; migration round trip.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(money): contractor and supplier bills, linked to tickets and projects`

### Task 2: Shelf stock

**Files:**
- Create: `backend/migrations/20260101000110-stock.js`, model `StockMovement.js`, `backend/src/services/money/stock.js`, `backend/src/controllers/money/stockController.js`
- Modify: `CatalogProduct` (`onHand` DECIMAL(12,4) default 0, `lowStockAt` DECIMAL(12,4) null), `routes/money.js`, notifications (a `stock_low` notice to holders of `money.purchasing.manage`)
- Test: `backend/test/integration/money.stock.test.js`

`StockMovements` (id, productId FK, `quantity` DECIMAL(12,4) signed, `reason` ENUM('receive','use','adjust'), `unitCost` DECIMAL(12,4), `materialId` null, `poLineId` null, `note`, `ledgerEntryId` null, createdBy, createdAt).

**Interfaces:**
- Produces: `stockIn(product, usageQuantity, { unitCost, poLineId, transaction, userId })`; `stockOut(product, usageQuantity, { materialId, companyId, transaction, userId })` — locks the product row, refuses more than `onHand` (409 `NOT_ENOUGH_STOCK`), posts Dr 5000 / Cr 1200 at `usageCost × quantity`, raises `stock_low` when `onHand` falls to or below `lowStockAt`; `adjustStock(product, newOnHand, { note, userId })` (posts the difference to 6900/1200); routes `GET /money/stock` (stocked products with on hand, value, low flag), `GET /money/stock/:productId/movements`, `POST /money/stock/:productId/adjust`, `PATCH /money/stock/:productId` (`lowStockAt`).

- [ ] **Step 1: Failing tests** — `stockIn` 1,000 ft: on hand 1000, value $180.00; use 300 ft on a ticket → 700 left, ledger Dr 5000 / Cr 1200 54.00; use 800 → 409, nothing changes; use exactly 700 → 0 and a `stock_low` notice (lowStockAt 200); two concurrent uses of 400 each from 700 → one succeeds, one 409; adjust to 650 (a count) → movement −50 and Dr 6900 / Cr 1200 9.00; technician 403; round trip.
- [ ] **Steps 2–4**, **Step 5: Commit** `feat(money): shelf stock sold by the unit used`

### Task 3: Materials on tickets (one materials list for tickets and projects)

**Files:**
- Create: `backend/migrations/20260101000111-materials-everywhere.js`, `backend/src/services/money/materials.js`, ticket materials routes in `backend/src/routes/tickets.js` (`GET/POST/PATCH/DELETE /tickets/:id/materials`)
- Modify: `backend/src/models/ProjectMaterial.js` (now any job's material: `projectId` nullable, `ticketId` FK null, exactly one set — a check constraint as TimeEntries has; `catalogProductId` FK null; `quantity` DECIMAL(12,4); `unitPrice` DECIMAL(12,4) null; `taxCategoryId` FK null; `billable` bool default true; `fromStock` bool; `billingStatus` ENUM('unbilled','billed','non_billable'); `invoiceLineId` INT null; `poLineId` INT null; the same billed-lock hooks as TimeEntry), `backend/src/controllers/projects/materials.js` (uses the shared service; existing behavior kept), ticket merge (materials move with time) and ticket delete (materials go with the ticket)
- Test: `backend/test/integration/money.materials.test.js` (plus the existing project materials tests still pass)

**Interfaces:**
- Produces: `addMaterial(job, { catalogProductId?, itemName, quantity, unitCost?, unitPrice?, fromStock?, serialNumber?, billable?, taskId? }, { userId, transaction })` — from a catalog product, fills name, unit cost (usage cost) and price (`unitPrice` with markup) and tax category; `fromStock` calls `stockOut`; `materialJson(m, { canSeePrices })` drops `unitCost`, `totalCost`, `unitPrice` without money permissions.
- Who may add: anyone who may edit the ticket (tickets) or with `projects.manage_expenses` (projects, unchanged).

- [ ] **Step 1: Failing tests** — a technician adds 300 ft of Cat6 from stock to a ticket: material quantity 300, stock −300, response has no cost/price; a billing user reading the same ticket's materials sees unitPrice 0.1800 and total 54.00; a free-typed item ("Patch panel", 1 × $89.00) by a billing user; a billed material can't be edited, deleted, moved by merge or deleted with its ticket (409 `MATERIAL_BILLED`); merging moves unbilled materials; deleting a ticket deletes unbilled ones; another company's ticket via a material id → 404; existing project materials tests pass unchanged; round trip (and 112 in laterMigrations if a round trip recreates ProjectMaterials).
- [ ] **Steps 2–4**, **Step 5: Commit** `feat(money): materials on tickets, from stock or the catalog`

### Task 4: Purchase orders and receiving

**Files:**
- Create: `backend/migrations/20260101000112-purchase-orders.js`, models `PurchaseOrder.js`, `PurchaseOrderLine.js`, `backend/src/services/money/purchasing.js`, `backend/src/controllers/money/purchaseOrdersController.js`
- Modify: `CatalogProduct` (`assetCategoryId` FK AssetCategories null — what a serialized product becomes), `routes/money.js`, BillLines and materials `poLineId` FKs to PurchaseOrderLines, helpers, companies chain

**Interfaces consumed:** `stockIn` (Task 2), `addMaterial` (Task 3).
- Test: `backend/test/integration/money.purchasing.test.js`

Tables: `PurchaseOrders` (id, `number` STRING(20) unique, e.g. PO-00001 from a counter; `vendorCompanyId` FK; `ticketId`/`projectId` null — the job it's for, or none for stock; `status` ENUM('draft','ordered','partly_received','received','cancelled'); `orderedOn`, `notes`, createdBy, timestamps). `PurchaseOrderLines` (id, poId FK cascade, `catalogProductId` FK null, `description`, `quantity` DECIMAL(12,4) > 0 in purchase units, `unitCost` DECIMAL(12,4), `forStock` bool, `receivedQuantity` DECIMAL(12,4) default 0).

**Interfaces:**
- Produces: `createPurchaseOrder`, `orderPurchaseOrder`, `cancelPurchaseOrder`, `receive(po, [{ lineId, quantity, serials?: string[] }], { userId, receivedOn })` → `{ materials: [], assets: [], stock: [] }`; routes `GET/POST /money/purchase-orders`, `GET/PATCH /money/purchase-orders/:id`, `POST …/:id/order|cancel|receive`; `GET /tickets/:id/purchase-orders`, `GET /projects/:id/purchase-orders`.
- Receiving a line: **job line** → a material on the PO's ticket/project (Task 3's `addMaterial`) of `quantity × usagePerPurchase` usage units at the catalog's `unitPrice`, `billable: true`; **stock line** (`forStock`) → stock in (Task 2's `stockIn`); **serialized product** on a job line → one Asset per unit in the job's company (`assetTag` from `suggestNextAssetTag`, its `assetCategoryId` or 'Computers', `serialNumber` from `serials[i]`, `purchaseDate` = receivedOn, `purchaseCost` = unitCost) and the material lists the serials. A PO for stock has no job; a PO for a job can still carry stock lines.

- [ ] **Step 1: Failing tests** — PO for project "Northgate network": 2 boxes of Cat6 (stock) and 1 Dell Latitude (serialized, job) from a supplier; `order` → ordered; receive 1 box → partly received, stock +1,000 ft; receive the laptop with serial '7XK4Q93' → an Asset in the project's company with that serial and cost, and a material of 1 on the project; receive the 2nd box → received; receiving more than ordered, a cancelled PO, a serialized line without its serials, a line of another PO → 400/409; a PO's job out of reach → 404; technician 403; round trip.
- [ ] **Steps 2–4**: Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Commit** `feat(money): purchase orders and receiving; equipment received becomes the customer's asset`

### Task 5: Expenses

**Files:**
- Create: `backend/migrations/20260101000113-expenses.js`, model `Expense.js`, `backend/src/services/money/expenses.js`, `backend/src/controllers/money/expensesController.js`
- Modify: `routes/money.js`, helpers, companies chain
- Test: `backend/test/integration/money.expenses.test.js`

`Expenses` (id, `spentOn` DATEONLY, `account` STRING(20) one of 6100/6200/6300/6900, `description`, `amount` DECIMAL(12,2) > 0, `paymentMethod` STRING(40), `vendorCompanyId` null, `ticketId`/`projectId` null, `rebillable` bool, `billingStatus` ENUM('unbilled','billed','non_billable'), `invoiceLineId` null, `receiptName`/`receiptFile` null, `ledgerEntryId`, `voided` bool, createdBy, timestamps). The existing project budget expenses (`ProjectExpenses`) stay as they are; step 5 (project billing) reconciles them.

**Interfaces:**
- Produces: `recordExpense(input, { userId })` (posts Dr account / Cr 1000), `voidExpense(expense)` (reversal; refused when billed), routes `GET/POST /money/expenses`, `GET/PATCH /money/expenses/:id` (description, receipt only — amount changes are a void and a new one), `POST /money/expenses/:id/void`, `POST/GET /money/expenses/:id/receipt` (PDF/PNG/JPG, phone photos).

- [ ] **Step 1: Failing tests** — fuel $62.40 on 2026-12-03 (6200), card, receipt photo → posted; rebillable expense on a customer ticket shows as `unbilled`; void → reversal, balances 0; amount change via PATCH → 400 (void and re-enter); a receipt `.exe` → 400; technician 403; round trip.
- [ ] **Steps 2–4**, **Step 5: Commit** `feat(money): expenses with receipts`

### Task 6: Contractor and supplier reports

**Files:**
- Create: `backend/src/controllers/money/payablesReportsController.js`
- Modify: `routes/money.js`, money settings (`money.form1099Threshold`, default '2000' — the 1099-NEC threshold for payments from 2026; verify with the CPA, editable)
- Test: `backend/test/integration/money.payablesReports.test.js`

**Interfaces:**
- Produces: `GET /money/reports/paid-by-vendor?year=2026` → `[{ vendorCompanyId, vendor, is1099, billed, paid, bills }]` (paid = bills paid in that year by `paidOn`, org time zone; billed = entered in that year by `billDate`); `GET /money/reports/1099?year=2026` → vendors with `is1099` and paid ≥ threshold, with totals; `GET /money/reports/open-bills` → entered-not-paid bills with days to due (aging buckets: current, 1–30, 31–60, 61–90, 90+); each also as CSV (`?format=csv`, formula-injection safe through `utils/csv.js`).

- [ ] **Step 1: Failing tests** — Hale paid $1,250 (Dec 15 2026) and $900 (Jan 4 2027): 2026 paid 1,250, 2027 paid 900; entered-unpaid bills don't count as paid; a voided bill counts nowhere; 1099 for 2026 with threshold 2000 excludes Hale, with threshold 600 includes it; a non-1099 vendor never appears in the 1099 report; open bills aged by due date; CSV of a vendor named `=HYPERLINK(...)` is escaped; technician 403.
- [ ] **Steps 2–4**, **Step 5: Commit** `feat(money): paid per vendor, 1099 totals and open bills`

### Task 7: The screens

**Files:**
- Create: `frontend/src/pages/money/` — `MoneyHome.jsx` (Bills, Purchase orders, Stock, Expenses, Reports tabs), `Bills.jsx` + `BillForm.jsx` (vendor picker, lines with job pickers, PDF, enter/pay/void with the Incode reference), `PurchaseOrders.jsx` + `PurchaseOrderForm.jsx` (lines from the catalog, order, receive with serials), `Stock.jsx` (on hand, value, low, adjust, movements), `Expenses.jsx` (with receipt photo from a phone), `PayablesReports.jsx` (paid per vendor by year, 1099, open bills, CSV); `frontend/src/components/work/MaterialsPanel.jsx` (tickets and projects: add from catalog or stock, quantity, prices only with permission), `frontend/src/components/work/BillsPanel.jsx` (a job's bills and POs)
- Modify: sidebar (`navConfig.js`: **Money**, shown with any of `money.bills.manage`, `money.purchasing.manage`, `money.books.view`), `App.jsx` routes, ticket detail (Materials and Bills panels), project detail (materials panel replaced by the shared one; Bills panel), company Details (vendor: *Gets a 1099*), Settings › Money (1099 threshold), Products (asset category for serialized products, low-stock level)
- Test: `backend/test/smoke/money.payables.smoke.js`

- [ ] **Step 1: Failing smoke tests** — enter Hale's bill on the HR network-drop ticket with its PDF, mark entered with Incode number and paid; the ticket shows the bill; Reports › Paid per vendor 2026 shows Hale $1,250; a PO for a laptop and cable, received with a serial: the laptop appears in the customer's Assets, the cable in Stock; a technician adds 300 ft of cable to a ticket and sees no price; an expense with a receipt; a technician sees no Money in the sidebar.
- [ ] **Steps 2–4**, **Step 5: Commit** `feat(money): bills, purchasing, stock, materials and expenses screens`

### Task 8: Docs and full verification

- [ ] `UPGRADING.md` (Unreleased): step 2, the 1099 threshold note, the materials table now serving tickets.
- [ ] `docs/ROADMAP.md`: step 2 shipped; this plan linked.
- [ ] Full backend suite, full smoke suite, agent tests → pass (the five known stale smoke failures excepted and named).
- [ ] Fresh reviewer over the step (owner-approved), fixes test-first, then push to `dev`.
- [ ] **Commit** `docs(money): step 2, bills and purchasing`
