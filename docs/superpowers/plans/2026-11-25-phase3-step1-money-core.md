# Phase 3, Step 1 — Money core: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The foundation every later Money step posts into: exact money arithmetic, a double-entry ledger, tax rates and categories, the products and services list, rates and the owner's billing rules on time entries, contact support tiers, the new permissions, and the Customer billing switch — with the Settings screens to set them up.

**Architecture:** New backend area `src/services/money/` (money math, ledger, tax, catalog, billing rules) and `src/controllers/money/` + `src/routes/money.js` mounted at `/api/v1/money`. Settings are SystemSettings rows with defaults in `services/money/config.js` (the `oauth/config.js` pattern). Per-customer billing settings live in one new table, `CompanyBilling`. Nothing here sends an invoice: Step 3 consumes the rules engine and ledger.

**Tech Stack:** Node/Express/Sequelize/MariaDB, React/Vite; adds `decimal.js` (exact decimals).

**Spec:** `docs/superpowers/specs/2026-11-25-phase3-money-design.md` (Step 1 and the owner's decisions).

## Global Constraints

- Money is never a JS float. All arithmetic through `services/money/money.js` (decimal.js). DB: unit costs and prices `DECIMAL(12,4)`; amounts, line totals and ledger amounts `DECIMAL(12,2)`; percentages `DECIMAL(7,4)`. Round half up to cents only when an amount is final.
- One currency per install: setting `money.currency`, default `USD`.
- Dates follow the organization's time zone (`utils/orgTime.js`).
- Every new fetch-by-id re-checks company scope (`loadAccessibleCompany` / `canAccessCompany`); out-of-scope answers like missing.
- Ledger entries are never updated or deleted; corrections are reversals.
- Migrations take the next numbers (103 onward), are idempotent, and round-trip. Any new table or column that points at Companies, Contacts or Departments is added to the chain in `test/integration/companies.migration.test.js` (rolled back first, re-applied last); new tables go in `resetData` in `test/integration/helpers.js`. Check table existence with `showAllTables()` mapped through `t.tableName` (lesson from 9b).
- Rates and customers' billing are visible only with the new permissions; technicians keep logging time without seeing a rate.
- Customer billing switch (`money.customerBilling`, default `false`) is changed only by Owners.

## Interpretations of the spec (made while planning; the owner can overrule)

- **After-hours minimum:** the 1-hour minimum belongs to *calls* (on-site
  visits) of event-basis customers, after hours too; after-hours remote work
  and a recurring customer's after-hours work bill in 30-minute steps with no
  minimum.
- **Timesheet approval** goes to System Administrators and Department
  Managers by default; every other new permission to System Administrators
  only.
- **Products' costs** are seen only by people who bill or buy.

## Review Focus

1. **Rounding at the edges** — 0 minutes, exactly 60, 61, 89, 90 and 91 minutes; an on-site visit split across two entries on one day; entries on the same ticket on two days (two calls). Expected: the owner's rules exactly (Task 6 tests).
2. **A billed time entry** edited, deleted, or moved to another ticket → refused (409), unbilled ones unaffected (Task 6).
3. **Tax on mixed lines** — 80 % taxable services and 100 % parts on one customer, an exempt customer with an expired certificate (taxed again), tax turned off for the customer (Task 4).
4. **An unbalanced or zero ledger entry**, a line with both debit and credit, an entry against an unknown account → refused, nothing written (Task 2).
5. **A technician** (no money permissions) reading rates, products' costs, a company's billing settings or the ledger → 403; still able to log time and see work types (Tasks 3, 6, 8).

---

### Task 1: Exact money

**Files:**
- Create: `backend/src/services/money/money.js`
- Modify: `backend/package.json` (dependency `decimal.js`, exact version pinned, `npm audit` clean)
- Test: `backend/test/unit/money.test.js`

**Interfaces:**
- Produces: `D(value) → Decimal` (accepts string, number, Decimal; rejects NaN/Infinity/'' with `TypeError`); `cents(value) → string` ("12.35", half-up to 2 dp); `unit(value) → string` (4 dp); `sum(values[]) → Decimal`; `percent(amount, pct) → Decimal`; `isZero(value) → boolean`.

- [ ] **Step 1: Failing tests** — `cents('0.105') === '0.11'`; `cents(D('0.1').plus('0.2')) === '0.30'`; `cents('-0.005') === '-0.01'`; `unit('0.18') === '0.1800'`; `sum(['0.10','0.20','0.30']).toFixed(2) === '0.60'`; `percent('100', '8.25').toFixed(2) === '8.25'`; `D('')` and `D(NaN)` throw; `cents('1e3') === '1000.00'`.
- [ ] **Step 2: Run** `npx jest test/unit/money.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement** with decimal.js, `Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP })` on a cloned constructor (don't change the global).
- [ ] **Step 4: Run** → PASS. `npm audit` → 0.
- [ ] **Step 5: Commit** `feat(money): exact money arithmetic`

### Task 2: The ledger

**Files:**
- Create: `backend/migrations/20260101000103-ledger.js`, `backend/src/models/LedgerAccount.js`, `LedgerEntry.js`, `LedgerLine.js`, `backend/src/services/money/ledger.js`
- Modify: `backend/src/models/index.js`, `test/integration/helpers.js` (resetData: `LedgerLines`, `LedgerEntries`; accounts are seeded, kept)
- Test: `backend/test/integration/money.ledger.test.js`

Tables: `LedgerAccounts` (id, `code` unique STRING(20), name, `type` ENUM asset/liability/income/expense/equity, `system` bool, active) seeded with this fixed chart (code — name — type): `1000` Cash — asset; `1010` Stripe clearing — asset; `1100` Accounts receivable — asset; `1200` Inventory — asset; `2000` Accounts payable — liability; `2100` Sales tax payable — liability; `2200` Customer credits — liability; `3000` Owner's equity — equity; `4000` Managed services income — income; `4100` Labor income — income; `4200` Product sales — income; `4300` Fees income — income; `5000` Cost of materials — expense; `5100` Contractor costs — expense; `6000` Payment processing fees — expense; `6100` Office and software — expense; `6200` Vehicle and fuel — expense; `6300` Tools and equipment — expense; `6900` Other expenses — expense. `LedgerEntries` (id, `entryDate` DATEONLY, memo, `sourceType` STRING(40), `sourceId` INT null, `companyId` FK Companies SET NULL null, `reversesId` FK self null, `createdBy` FK Users null, createdAt). `LedgerLines` (id, entryId FK cascade, accountId FK, `debit` DECIMAL(12,2) default 0, `credit` DECIMAL(12,2) default 0).

**Interfaces:**
- Produces: `postEntry({ date, memo, sourceType, sourceId, companyId, lines: [{ account: '1100', debit?: '12.00', credit?: '12.00' }] }, { transaction, userId }) → LedgerEntry`; `reverseEntry(entryId, { date, memo, transaction, userId }) → LedgerEntry`; `balances({ from, to, companyId }) → [{ code, name, type, debit, credit, balance }]` (balance as string, debit-positive for asset/expense, credit-positive otherwise); `accountByCode(code)`.

- [ ] **Step 1: Failing tests** — a balanced entry (AR 108.25 / income 100.00 / tax 8.25) posts and `balances()` shows AR 108.25, income 100.00, tax 8.25; unbalanced (100 vs 99.99) → throws, nothing written; a line with both debit and credit → throws; zero total → throws; unknown account code → throws; `reverseEntry` makes the mirror entry with `reversesId` and balances go to 0; reversing twice → throws; the model refuses `update`/`destroy` on entries and lines (hook throws); `balances({ companyId })` filters; migration down/up round trip (FK into Companies, so added to the companies chain).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** migration, models (beforeUpdate/beforeDestroy hooks throw), service (sums with `money.js`; one transaction per entry).
- [ ] **Step 4: Run** the new test and `companies.migration.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(money): the ledger`

### Task 3: Permissions, the Customer billing switch, money settings

**Files:**
- Create: `backend/migrations/20260101000104-money-permissions.js`, `backend/src/services/money/config.js`, `backend/src/middleware/customerBilling.js`, `backend/src/controllers/money/settingsController.js`, `backend/src/routes/money.js`
- Modify: `backend/src/routes/index.js` (mount `/money` behind `guard`)
- Test: `backend/test/integration/money.settings.test.js`

Permissions (category `money`; roles granted): `money.billing.view` (System Administrator), `money.billing.manage` (System Administrator), `money.settings` (System Administrator), `money.rates.manage` (System Administrator), `money.timesheets.approve` (System Administrator, Department Manager), `money.bills.manage` (System Administrator), `money.purchasing.manage` (System Administrator), `money.sales.manage` (System Administrator), `money.books.view` (System Administrator). Labels and descriptions in plain words (e.g. "See invoices and billing", "Approve timesheets").

Settings with defaults in `config.js`: `money.customerBilling` 'false', `money.currency` 'USD', `money.hourlyRate` '0', `money.afterHoursRate` '0', `money.tripCharge` '0', `money.eventMinimumMinutes` '60', `money.stepMinutes` '30', `money.defaultMarkupPercent` '0', `money.defaultTermsDays` '30', `money.frontlineSkuIds` (Task 7).

**Interfaces:**
- Produces: `moneyConfig() → { customerBilling, currency, hourlyRate, afterHoursRate, tripCharge, eventMinimumMinutes, stepMinutes, defaultMarkupPercent, defaultTermsDays, frontlineSkuIds: string[] }` (money values as strings); `requireCustomerBilling` middleware (404 `NOT_FOUND` when off); routes `GET /money/config` (any staff: `{ customerBilling, currency }` only), `GET /money/settings` (`money.settings`), `PUT /money/settings` (`money.settings`; `money.customerBilling` additionally `requireOwner('Customer billing')`), `PUT /money/rates` (`money.rates.manage`: hourly, after-hours, trip, minimum, step).

- [ ] **Step 1: Failing tests** — admin reads defaults; PUT rates validates (non-negative, ≤ 2 dp for money, minimum 0–480 and step 1–240 minutes, both whole); a technician gets 403 on settings and rates and sees `{ customerBilling:false, currency:'USD' }` on config; a non-Owner admin can't turn customer billing on (403), the Owner can; a route behind `requireCustomerBilling` answers 404 while off and 200 when on; every change audited; the permissions exist and the Department Manager role has only `money.timesheets.approve`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(money): permissions, the Customer billing switch and money settings`

### Task 4: Tax and each customer's billing settings

**Files:**
- Create: `backend/migrations/20260101000105-tax-and-company-billing.js`, models `TaxRate.js`, `TaxCategory.js`, `CompanyBilling.js`, `backend/src/services/money/tax.js`, `backend/src/controllers/money/taxController.js`, `backend/src/controllers/money/companyBillingController.js`
- Modify: `routes/money.js`, `routes/companies.js` (`/companies/:id/billing`), `companyMerge.js` (the merged-away company's billing row is dropped; the kept company's wins), helpers resetData, companies migration chain
- Test: `backend/test/integration/money.tax.test.js`

Tables: `TaxRates` (id, name, `ratePercent` DECIMAL(7,4), `isDefault` bool, active); `TaxCategories` (id, name unique, `taxablePercent` DECIMAL(7,4) 0–100, active) seeded: Parts and equipment 100, Managed services 80, Remote support 80, On-site labor 100, Cabling 100, Licenses 100, Fees 0 — with a note in the UI and the migration that the shares must be confirmed with a CPA. `CompanyBilling` (companyId PK FK cascade, `chargeTax` bool default true, `taxExempt` bool default false, `exemptCertificateFile` STRING null, `exemptCertificateName` STRING null, `exemptExpiresOn` DATEONLY null, `taxRateId` FK null (null = default rate), `termsDays` INT null (null = default), `invoiceTiming` ENUM('monthly','on_close') default 'monthly', `hourlyRate`/`afterHoursRate`/`tripCharge` DECIMAL(12,2) null (null = default)).

**Interfaces:**
- Consumes: `money.js`, `moneyConfig()`.
- Produces: `customerBilling(companyId) → { chargeTax, taxExempt, exemptExpiresOn, taxRatePercent, termsDays, invoiceTiming, hourlyRate, afterHoursRate, tripCharge }` (defaults filled in); `taxForLines(lines: [{ amount, taxCategoryId }], billing, { onDate }) → { lines: [{ taxable, tax }], taxTotal }` (per-line tax = cents(amount × taxable% × rate%), summed); `isExemptOn(billing, date) → boolean` (exempt only while the certificate hasn't expired; no expiry date = exempt); routes: `GET/POST/PATCH /money/tax-rates`, `GET/POST/PATCH /money/tax-categories` (`money.settings`), `GET/PUT /companies/:id/billing` (`money.billing.view` / `money.billing.manage`, company scope), `POST /companies/:id/billing/certificate` (upload through the usual checks: signature, size, virus scan; PDF/PNG/JPG only), `GET .../certificate`.

- [ ] **Step 1: Failing tests** — at 8.25 %: $100 on Managed services (80 %) → tax 6.60; $100 on Parts (100 %) → 8.25; both on one bill → 14.85; an exempt customer → 0; the same with `exemptExpiresOn` yesterday → taxed; `chargeTax:false` → 0; a customer's own rate used when set; one default rate at a time (setting another default unsets the first); a technician gets 403 on billing; another company's billing → 404 for a user without reach; certificate upload refuses an .exe and stores a PDF; merge keeps the surviving company's row; round trip.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(money): tax rates, tax categories and each customer's billing settings`

### Task 5: Products and services

**Files:**
- Create: `backend/migrations/20260101000106-catalog-products.js`, model `CatalogProduct.js`, `backend/src/services/money/catalog.js`, `backend/src/controllers/money/catalogController.js`
- Modify: `routes/money.js`, helpers resetData
- Test: `backend/test/integration/money.catalog.test.js`

Table `CatalogProducts`: id, name (unique, any case), sku null unique, `kind` ENUM('labor','service','product','license','fee'), `unit` STRING(20) default 'each', `cost` DECIMAL(12,4) null, `price` DECIMAL(12,4) null, `markupPercent` DECIMAL(7,4) null, `taxCategoryId` FK null, `purchaseUnit` STRING(20) null, `usagePerPurchase` DECIMAL(12,4) default 1, `stocked` bool, `serialized` bool, `active` bool, notes.

**Interfaces:**
- Produces: `unitPrice(product, cfg) → string` (4 dp: `price` if set, else `cost × (1 + (markupPercent ?? defaultMarkupPercent)/100)`, else '0.0000'); `usageCost(product) → string` (4 dp: cost ÷ usagePerPurchase); routes `GET /money/products` (needs `money.billing.view` or `money.purchasing.manage`; others 403), `POST/PATCH /money/products` (`money.rates.manage`), search `?search=&kind=&active=`.

- [ ] **Step 1: Failing tests** — cable box: cost 180.00 per box of 1000 ft, usage unit 'ft' → `usageCost` 0.1800, `unitPrice` with no markup 0.1800 (owner's default), with 15 % default markup 0.2070, with own price 0.25 → 0.2500; duplicate name (any case) → 409; negative cost → 400; a technician → 403; filtering by kind and search.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** For a stocked product sold per usage unit, `cost` is per purchase unit and `unitPrice`'s cost basis is `usageCost`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(money): products and services`

### Task 6: Billing rules on time

**Files:**
- Create: `backend/migrations/20260101000107-time-billing.js`, `backend/src/services/money/billingRules.js`, `backend/src/services/money/afterHours.js`
- Modify: `backend/src/models/WorkType.js` (`onSite` bool), `backend/src/models/TimeEntry.js` (`billingStatus` ENUM('unbilled','covered','billed','non_billable') default 'unbilled', `afterHours` BOOLEAN null — null = decide from the SLA, true/false = a tech's override, `invoiceLineId` INT null — FK added in Step 3), `backend/src/services/time/index.js` (refuse changes to billed entries; `afterHours` accepted on create/update; `billingStatus` follows `billable`: false → 'non_billable', true → 'unbilled', never touching 'billed'), work types controller (`onSite`), migration seeds `onSite = true` for the work type named 'On-site'
- Test: `backend/test/unit/billingRules.test.js`, `backend/test/integration/money.timeBilling.test.js`

**The rules (spec, owner 2026-11-25), as a pure function:**
- A **call** is the on-site entries of one ticket on one day (work type `onSite`).
- **Event-basis customer** (no agreement — step 3 supplies this; here a parameter): call → one trip charge + labor billed at max(60 min, total rounded **up** to 30-min steps); remote work → per ticket per day, total rounded up to 30-min steps, no minimum.
- **Recurring customer**: call → trip charge only, labor `covered` — unless after hours; remote within hours → `covered`.
- **After hours** (decided per entry): billed at the after-hours rate in 30-min steps; for an event customer's after-hours call the 60-min minimum applies too.
- Billing settings: `customerBilling(companyId)` (Task 4) gives the rates.

**Interfaces:**
- Consumes: `money.js`, `customerBilling()`.
- Produces: `chargesFor(entries, { recurring: boolean, rates: { hourlyRate, afterHoursRate, tripCharge }, minimumMinutes, stepMinutes }) → { lines: [{ kind: 'labor'|'after_hours'|'trip', ticketId, date, minutes, billedMinutes, rate, amount, entryIds }], covered: [{ entryIds, minutes }] }` where `entries` are `{ id, ticketId, entryDate, durationSeconds, onSite, afterHours: boolean, billable }` (non-billable entries ignored); `isAfterHours(entry, companyId) → Promise<boolean>` (override if set; else the entry's `startTime` outside the company's SLA support hours/holidays via the existing SLA business-time helpers; an entry with no start time is in hours).

- [ ] **Step 1: Failing unit tests (`billingRules.test.js`)** at $100/h, after-hours $150/h, trip $45, min 60, step 30 — event on-site 20 min → trip 45 + 60 min = 145.00; 61 min → 90 min = 150.00 + 45; 90 min → 90; 91 → 120; two on-site entries same ticket same day 25 + 25 → one call, 60 min + one trip; same ticket two days → two calls, two trips; event remote 10 min → 30 min = 50.00, 0 min → nothing; recurring on-site 3 h in hours → trip 45 only, 180 min covered; recurring remote in hours → all covered, no lines; recurring after-hours remote 40 min → 60 min × 150 = 150.00; event after-hours on-site 20 min → 60 min × 150 + 45; non-billable entries → nothing.
- [ ] **Step 2: Failing integration tests (`money.timeBilling.test.js`)** — `isAfterHours` with an SLA Mon–Fri 08:00–17:00: Tue 16:30 start → false, Tue 17:30 → true, Saturday → true, a holiday → true, override false on a Saturday → false, no start time → false; a time entry marked `billed` can't be edited, deleted or have its ticket changed (409 `TIME_BILLED`), an unbilled one can; setting `billable:false` gives `non_billable`; the 'On-site' work type is `onSite` after migration; a technician can still log time and gets no rate in any response; round trip of 107.
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement** migration (add `invoiceLineId` without FK — Step 3 of Phase 3 adds it), `billingRules.js` (pure), `afterHours.js`, the time-service guards.
- [ ] **Step 5: Run** both → PASS; run `test/integration/time*.test.js` to confirm nothing else moved.
- [ ] **Step 6: Commit** `feat(money): billing rules on time; billed time is locked`

### Task 7: Contact support tiers

**Files:**
- Create: `backend/migrations/20260101000108-support-tiers.js`, `backend/src/services/money/tiers.js`
- Modify: `backend/src/models/Contact.js` (`supportTier` ENUM('full','light','none') null = automatic, `m365Frontline` bool default false), `backend/src/models/Department.js` (`defaultSupportTier` ENUM default 'full'), `backend/src/services/microsoft365/graph.js` (`USER_FIELDS` adds `assignedLicenses`), `backend/src/services/microsoft365/sync.js` (sets `m365Frontline` when any assigned `skuId` is in `money.frontlineSkuIds`), contacts and departments controllers (read/write the fields; writing needs `money.billing.manage`)
- Test: `backend/test/integration/money.tiers.test.js`

`money.frontlineSkuIds` default: `66b55226-6b4f-492c-910c-a3b7a3c9d993` (Microsoft 365 F3), `50f60901-3181-4b75-8a2c-4c8e4c1d5a72` (Microsoft 365 F1), `4b585984-651b-448a-9e53-3b10f069cf7f` (Office 365 F3) — **verify these against Microsoft's "Product names and service plan identifiers for licensing" page before shipping**; editable in Settings.

**Interfaces:**
- Produces: `effectiveTier(contact, department) → 'full'|'light'|'none'` (manual tier, else `light` when `m365Frontline`, else the department's default, else 'full'); `tierCounts(companyId) → { full, light, none }` over active, non-placeholder contacts (used by Step 3's agreements).

- [ ] **Step 1: Failing tests** — a contact with no tier in a department defaulting 'light' → light; manual 'full' wins over department and frontline; frontline with no manual → light; `tierCounts` excludes inactive and placeholder contacts; sync with a fake Graph user holding a frontline skuId sets `m365Frontline`, and removing the license clears it; a technician can't set a tier (403) but can still edit the rest of a contact as today; round trip (Contacts/Departments columns → companies chain).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** plus `test/integration/m365*.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(money): support tiers on contacts, from departments and Microsoft 365 licenses`

### Task 8: The screens

**Files:**
- Create: `frontend/src/pages/settings/money/MoneySettings.jsx` (Customer billing switch for Owners, currency, default markup, terms), `RatesSettings.jsx` (hourly, after-hours, trip charge, minimum, step), `TaxSettings.jsx` (rates, categories with taxable %, the CPA note), `ProductsSettings.jsx` (list, search, add/edit), `frontend/src/components/companies/CompanyBilling.jsx` (Setup › Billing: tax, exemption and certificate, terms, invoice timing, rate overrides, tier counts)
- Modify: settings menu config (a **Money** group, shown to holders of the permissions), `CompanyPage.jsx` (part `billing` under Setup, only with `money.billing.view`), contact form and department form (tier, with "Automatic (…)" showing what it resolves to), work types settings (`On site` checkbox), the time entry form (an **After hours** choice: Automatic / Yes / No; a "Billed" badge and read-only fields on billed entries)
- Test: `backend/test/smoke/money.settings.smoke.js`

- [ ] **Step 1: Failing smoke tests** — admin sets rates and sees them after reload; adds a tax rate and a category; adds the cable product and sees $0.1800/ft; on a company sets tax exempt with a PDF certificate and Net 15; sets a contact to Light; marks a time entry After hours: Yes; a technician sees no Money group, no Billing part, no tier control, and can log time; the switch shows only for the Owner.
- [ ] **Step 2: Run** (`npm run test:smoke -- money.settings`) → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS, and the existing time and company smoke files.
- [ ] **Step 5: Commit** `feat(money): settings screens, customer billing, tiers and after-hours time`

### Task 9: Docs and full verification

- [ ] `UPGRADING.md` (Unreleased): what Step 1 adds, the CPA note on tax shares, the frontline SKU list, that nothing bills yet.
- [ ] `docs/ROADMAP.md`: Phase 3 step 1 status; this plan linked.
- [ ] Full backend suite, smoke suite, `go test ./...` unchanged → all pass.
- [ ] **Commit** `docs(money): step 1, the money core` and push to `dev`.
