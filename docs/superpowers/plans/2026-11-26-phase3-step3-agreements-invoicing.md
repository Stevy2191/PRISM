# Phase 3, Step 3 — Agreements, invoicing, payments and timesheets: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The money PRISM takes in: recurring agreements priced the owner's way, a monthly billing run that drafts each customer's invoice (next month's fees plus last month's extras after the billing rules), invoices emailed with a no-sign-in pay link, payment through Stripe Checkout or by hand, credits and refunds, reminders and an optional late fee — all posting to the ledger. Plus weekly timesheets with approval for the internal team.

**Architecture:** New tables for agreements, invoices, payments and timesheets. Services in `backend/src/services/money/` (`agreements.js`, `invoices.js`, `billingRun.js`, `payments.js`, `stripe.js`, `reminders.js`) post through step 1's ledger. Staff routes under `/api/v1/money/…` behind `requireCustomerBilling`; public routes `/api/v1/pay/…` and the Stripe webhook; the client portal gains Invoices. Timesheets live under `/api/v1/timesheets` and work with Customer billing off. Schedulers follow the existing `setInterval` pattern (`csatScheduler.js`).

**Tech Stack:** as steps 1–2 (Express/Sequelize/MariaDB, React/Vite, decimal.js via `money.js`, pdfkit); adds the official `stripe` npm package (pinned exact version).

**Spec:** `docs/superpowers/specs/2026-11-25-phase3-money-design.md` (Step 3, *Agreements*, *Invoices and payment*, *Public endpoints*).

## Global Constraints

- Everything from steps 1–2's Global Constraints (exact money through `money.js`; DECIMAL(12,4) unit amounts, DECIMAL(12,2) totals and anything posted; org time zone via `utils/orgTime.js`; company scope on every fetch-by-id, out of reach = 404; idempotent reversible migrations in the companies chain / `laterMigrations` / `moneyMigrations` as their FKs require; new tables in `resetData`).
- Migration numbers continue from 115.
- **Customer billing switch:** agreements, invoices, the billing run, payments, reminders, the pay link, the Stripe webhook and portal invoices sit behind `requireCustomerBilling` (404 while off). **Timesheets do not.**
- Permissions: read agreements/invoices/payments `money.billing.view`; create, send, void, record payments, refunds, run billing `money.billing.manage`; Stripe keys and invoice settings `money.settings`, and the Stripe secret keys additionally `requireOwner`; approve timesheets `money.timesheets.approve`.
- An invoice's lines always sum to its subtotal; tax per line through `taxForLines`, summed; total = subtotal + tax. Amounts the customer pays are recomputed on the server, never taken from a request.
- Anything billed (time, materials, expenses) is claimed by exactly one invoice line (`billingStatus: 'billed'`, `invoiceLineId`) and locked; deleting a draft or voiding an invoice releases its items back to `unbilled`.
- Public tokens: 32 random bytes base64url, stored as sha256 (as `services/portal/tokens.js`), one invoice per token, rate limited, expire when the invoice is paid or void or 180 days after it was sent.
- Card or bank details never touch PRISM: Stripe Checkout only. Stripe secret key and webhook secret stored with `tokenCrypto`, never returned by any API (a `configured: true` flag only).
- Billed in advance on the 1st (org time zone); Net 30 default (`customerBilling().termsDays`); covered time listed at $0.00.

## Ledger postings (fixed)

| Event | Debit | Credit |
|---|---|---|
| Invoice sent | 1100 A/R (total) | income per line + 2100 sales tax |
| Income account per line kind | | `agreement`, `license`, `prepaid_hours` → 4000; `labor`, `after_hours`, `trip`, `overage` → 4100; `material` → 4200; `expense`, `fee`, `late_fee` → 4300 |
| Invoice voided | reversal of the sent entry | |
| Credit note issued | the credit's income lines + 2100 | 2200 Customer credits |
| Payment recorded by hand (check, cash, transfer) | 1000 Cash | 1100 (up to the balance); any excess 2200 |
| Stripe payment succeeded | 1010 Stripe clearing | 1100 (up to the balance); excess 2200 |
| Stripe fee | 6000 Processing fees | 1010 |
| Credit applied to an invoice | 2200 | 1100 |
| Refund | 1100 (or 2200 when refunding credit) | 1010 (Stripe) or 1000 (by hand) |

`sourceType` values: `invoice`, `credit_note`, `payment`, `stripe_fee`, `credit_apply`, `refund`. Each entry carries the invoice's `companyId`.

## Review Focus

1. **A billing run started twice** (the scheduler and a person, or two people) for the same month → one draft per company per period; no time entry, material or expense on two invoices (unique period key + row locks).
2. **The pay link abused:** an unknown, expired, paid or voided token → the same "link not valid" answer; an amount sent by the browser is ignored; a forged or replayed Stripe webhook (bad signature, same event twice) records nothing or one payment; no other invoice's or company's data is reachable from a token.
3. **Payments at the edges:** partial payment → `partly_paid` with the right balance; overpayment → the excess becomes a customer credit; refunding more than was paid → 400; voiding an invoice that has payments → 409 until they are refunded or moved to credit.
4. **Proration and rounding:** an agreement starting Dec 15 bills 17/31 of each line, rounded per line, and the lines still sum exactly to the invoice subtotal; tax per line summed equals the invoice tax.
5. **Who sees what:** with Customer billing off every route here except timesheets answers 404; a technician gets 403 on invoices and agreements and sees no rates; a portal contact sees only their own company's invoices.

---

### Task 1: Agreements

**Files:**
- Create: `backend/migrations/20260101000115-agreements.js`, models `Agreement.js`, `AgreementLine.js`, `backend/src/services/money/agreements.js`, `backend/src/controllers/money/agreementsController.js`
- Modify: `backend/src/services/microsoft365/graph.js` (`subscribedSkus(tenantId) → [{ skuId, skuPartNumber, consumedUnits }]` from `GET /subscribedSkus`), `routes/money.js`, `companyMerge.js` (agreements follow the company), helpers, companies chain
- Test: `backend/test/integration/money.agreements.test.js`

Tables: `Agreements` (id, `companyId` FK, `name`, `slaPolicyId` FK null, `startsOn` DATEONLY, `endsOn` DATEONLY null, `status` ENUM('active','cancelled'), `cancelledOn` null, `termsDays` INT null (null = the company's), `notes`, createdBy, timestamps). `AgreementLines` (id, agreementId FK cascade, `kind` ENUM('flat','per_user','per_device','license','prepaid_hours'), `description`, `unitPrice` DECIMAL(12,4), `tier` ENUM('full','light') null (per_user), `assetCategoryId` FK null (per_device), `catalogProductId` FK null, `skuId` STRING(64) null + `countSource` ENUM('m365','manual') (license), `manualCount` DECIMAL(12,4) null, `hours` DECIMAL(8,2) null + `rollover` bool + `overageRate` DECIMAL(12,2) null (prepaid_hours), `hoursBalanceMinutes` INT default 0, `lastBilledQuantity` DECIMAL(12,4) null, `taxCategoryId` FK null, `sortOrder`).

**Interfaces:**
- Consumes: `tierCounts(companyId)` (step 1), `customerBilling(companyId)`.
- Produces: `quantityFor(line, agreement) → Promise<{ quantity: string, source: 'tiers'|'assets'|'m365'|'manual'|'fixed' }>` — per_user: `tierCounts()[tier]`; per_device: active assets of the company in that category; license m365: `consumedUnits` of `skuId` from the company's tenant, falling back to `manualCount` with source 'manual' when Microsoft 365 isn't connected or the call fails; flat and prepaid_hours: 1. `activeAgreement(companyId, onDate) → Agreement|null`. Routes: `GET/POST /money/agreements` (`?companyId=`), `GET/PATCH /money/agreements/:id`, `POST /money/agreements/:id/cancel` (`{ cancelledOn }`), `GET /money/agreements/:id/preview` (lines with today's quantities and amounts).
- One active agreement per company at a time (409 otherwise).

- [ ] **Step 1: Failing tests** — Alpha Dental from 2026-12-15: Full user $95 (12 full contacts), Light user $35 (4 light), per device "Servers" $150 (2 assets), license "Microsoft 365 Business Standard" $12.50 from Microsoft 365 (fake graph: 14 consumed) → preview quantities 12/4/2/14, amounts 1140.00/140.00/300.00/175.00; the Graph call failing → license falls back to manualCount with source 'manual'; a second active agreement → 409; a per_user line without a tier, a negative price, a prepaid line without hours → 400; technician 403; another company's agreement → 404; with Customer billing off → 404; merging the company moves the agreement; round trip.
- [ ] **Steps 2–4:** run → FAIL; implement; run → PASS.
- [ ] **Step 5: Commit** `feat(money): recurring agreements priced per user, device, license, flat or prepaid hours`

### Task 2: Invoices

**Files:**
- Create: `backend/migrations/20260101000116-invoices.js`, models `Invoice.js`, `InvoiceLine.js`, `backend/src/services/money/invoices.js`, `backend/src/services/money/invoicePdf.js`, `backend/src/controllers/money/invoicesController.js`
- Modify: `TimeEntry`/`ProjectMaterial`/`Expense` `invoiceLineId` FKs to InvoiceLines (SET NULL), `money/config.js` (`invoicePrefix` default 'INV-', `invoiceNextNumber` default 1001, `autoSend` false), `routes/money.js`, `companyMerge.js`, helpers, chains
- Test: `backend/test/integration/money.invoices.test.js`

Tables: `Invoices` (id, `number` STRING(30) unique null — assigned at send, so drafts leave no gaps; `kind` ENUM('invoice','credit_note'); `companyId` FK; `agreementId` null; `periodKey` STRING(20) null — e.g. '2027-01' for a run invoice, unique with companyId; `ticketId` null — an on-close invoice; `status` ENUM('draft','sent','partly_paid','paid','void'); `issuedOn`, `dueOn` DATEONLY null; `subtotal`, `taxTotal`, `total`, `amountPaid`, `creditApplied` DECIMAL(12,2); `chargeTax` bool; `billToContactId` null; `notes`; `ledgerEntryId` null; `payTokenHash` CHAR(64) null unique, `payTokenExpiresAt` null; `remindersSent` JSON default '[]'; `lateFeeInvoiceId` null; `creditForInvoiceId` null; `voidReason`; createdBy, timestamps). `InvoiceLines` (id, invoiceId FK cascade, `kind` ENUM('agreement','license','prepaid_hours','labor','after_hours','trip','overage','material','expense','fee','late_fee','covered'), `description`, `quantity` DECIMAL(12,4), `unitPrice` DECIMAL(12,4), `amount` DECIMAL(12,2), `taxCategoryId` null, `tax` DECIMAL(12,2), `ticketId`/`projectId` null, `agreementLineId` null, `serviceFrom`/`serviceTo` DATEONLY null, `sortOrder`).

**Interfaces:**
- Consumes: `taxForLines`, `customerBilling`, `postEntry`, `reverseEntry`.
- Produces: `createDraft(companyId, { lines, agreementId?, periodKey?, ticketId?, notes? }, { userId, transaction })`; `claimItems(line, { timeEntryIds, materialIds, expenseIds }, { transaction })` (row-locks, refuses anything not `unbilled` → 409 `ALREADY_BILLED`); `recompute(invoice, { transaction })` (amount = cents(quantity × unitPrice) per line; tax per line; totals); `sendInvoice(invoice, { userId, sendEmail })` (number from the counter under `FOR UPDATE`, `issuedOn` today, `dueOn` = issuedOn + terms, posts the entry, issues the pay token, emails — Task 4 wires the email); `deleteDraft`, `voidInvoice(invoice, { reason })` (409 `HAS_PAYMENTS` while `amountPaid` > 0; releases items); `issueCreditNote(invoice, { lines, reason })`; `invoiceJson`; routes `GET/POST /money/invoices` (filters company, status, from, to, search), `GET/PATCH/DELETE /money/invoices/:id` (PATCH/DELETE drafts only: lines, notes, chargeTax), `POST …/:id/send|void|credit-note`, `GET …/:id/pdf`, `GET /companies/:id/invoices`.

- [ ] **Step 1: Failing tests** — a draft for Alpha with two labor lines (1.5 h × $100, a $45 trip) and a taxable material line: lines and tax add up exactly; claiming a time entry already on another draft → 409 and nothing claimed; a claimed entry can't be edited (existing lock); deleting the draft releases it to `unbilled`; send → number INV-1001 then INV-1002, due 30 days later, ledger Dr 1100 / Cr 4100, 4200, 2100 balanced; a sent invoice can't be edited (409); void → reversal, items released; a credit note for $45 posts Dr 4100 / Cr 2200 and lists against the invoice; PDF is `application/pdf` and contains the number; a customer with `chargeTax: false` gets 0 tax; technician 403; another company's invoice → 404; switch off → 404; round trip.
- [ ] **Steps 2–4**, **Step 5: Commit** `feat(money): invoices, credit notes and invoice PDFs`

### Task 3: The billing run

**Files:**
- Create: `backend/src/services/money/billingRun.js`, `backend/src/services/money/billingScheduler.js`, `backend/src/controllers/money/billingRunController.js`
- Modify: `backend/src/index.js` (start the scheduler), ticket close (an `on_close` customer's ticket drafts its invoice), `money/config.js` (`catchUpAdditions` true, `refundLeavers` false — kept false: leavers drop off with no refund)
- Test: `backend/test/integration/money.billingRun.test.js`

**Interfaces:**
- Consumes: `quantityFor`, `activeAgreement` (Task 1); `createDraft`, `claimItems`, `sendInvoice` (Task 2); `chargesFor` (step 1) with `customerBilling()` rates and `moneyConfig()` minimum/step; `WorkType.onSite`; `TimeEntry.afterHours`.
- Produces: `draftForCompany(companyId, { runDate, userId }) → Invoice|null` (null when nothing to bill); `billingRun({ runDate, userId }) → { drafted: [{ companyId, invoiceId, total }], skipped: [{ companyId, reason }] }`; `draftForTicket(ticket, { userId })` (on-close customers); routes `POST /money/billing-run` (`{ runDate }`, default today), `GET /money/billing-run/preview?runDate=` (what each company would get, nothing written). Scheduler: hourly check; on the 1st (org time zone) runs once for the month (`money.lastBillingRun` setting), sends drafts when `autoSend`.

Rules in `draftForCompany` (runDate's month = the coming month; the month before = last month):
- **Agreement lines** for the coming month at `quantityFor` × unitPrice, `serviceFrom/To` the month. **First month prorated by days:** an agreement starting mid-month gets an invoice drafted on demand at its start for the remaining days (`days left ÷ days in month`, per line, `cents`). **Catch-up:** when a line's quantity now exceeds `lastBilledQuantity`, one extra line for the difference at a full month (`catchUpAdditions`); `lastBilledQuantity` updated. A cancelled agreement bills no fees after `cancelledOn` — its last invoice carries only extras.
- **Last month's extras** on the company's tickets, entries dated before the coming month and `unbilled`: time through `chargesFor` (recurring = an active agreement); `covered` groups become $0.00 `covered` lines and their entries `covered`; **prepaid hours** draw billed labor minutes from the block (this month's hours + rollover balance) and bill the rest at `overageRate` as `overage`; billable `unbilled` materials at `unitPrice` with their tax category; rebillable `unbilled` expenses at cost.
- Customers with `invoiceTiming: 'on_close'` keep their ticket work out of the monthly run (it's billed by `draftForTicket` when the ticket closes); agreement fees still go on the run.
- One run invoice per company per `periodKey` (unique) — a second run for the month returns the existing draft untouched; everything claimed in the same transaction.

- [ ] **Step 1: Failing tests** — Alpha's agreement from 2026-12-15, drafted at start: each line × 17/31 (625.16, 76.77, 164.52, 95.97; subtotal 962.42); run 2027-01-01: January fees 1755.00 plus December extras — Alpha (agreement) on-site 40 min → trip $45 + covered $0.00 line, entries `covered`; Beta Law (no agreement, rates $100/$150/$45) on-site 40 min → $45 + 60 min $100.00, remote 20 min → $50.00, after-hours remote 50 min → 60 min at $150.00; 300 ft of cable at $0.18 → $54.00; a 13th full user added in December → catch-up line 1 × $95.00; prepaid 10 h block with 11.5 h worked → 1.5 h overage at the overage rate; running again → the same drafts, nothing claimed twice; two runs in parallel → one draft per company; an `on_close` customer's closed ticket gets its own invoice and its work isn't on the run; a cancelled agreement's last invoice has extras only; preview writes nothing; scheduler on 2027-01-01 08:00 org time runs once (twice called → once); technician 403; switch off → 404.
- [ ] **Steps 2–4**, **Step 5: Commit** `feat(money): monthly billing run — fees in advance, last month's extras after the billing rules`

### Task 4: Payments, Stripe and the pay link

**Files:**
- Create: `backend/migrations/20260101000117-payments.js`, models `Payment.js`, `Refund.js`, `backend/src/services/money/payments.js`, `backend/src/services/money/stripe.js` (the only file that talks to Stripe; tests swap it for a fake via `stripe.setClientForTests(fake)`), `backend/src/controllers/money/paymentsController.js`, `backend/src/controllers/money/payLinkController.js`, `backend/src/routes/pay.js`
- Modify: `app.js` (keep the raw body for `/api/v1/money/stripe/webhook`, as for agents), `routes/index.js` (public `/pay` and the webhook before auth), `middleware/rateLimit.js` (`payLimiter`: 30/10 min per IP), email templates (`invoice_sent` with `{{invoiceNumber}}`, `{{total}}`, `{{dueOn}}`, `{{payLink}}`; PDF attached), `money/config.js` + settings (`stripePublishableKey`; `stripeSecretKey` and `stripeWebhookSecret` encrypted, Owners only, never returned; `cardFeePercent` default '0'), `package.json` (`stripe`, exact version)
- Test: `backend/test/integration/money.payments.test.js`, `backend/test/integration/money.payLink.test.js`

Tables: `Payments` (id, `companyId` FK, `invoiceId` FK null, `method` ENUM('card','us_bank_account','check','cash','transfer','credit'), `amount`, `fee` DECIMAL(12,2) default 0, `receivedOn`, `reference`, `stripeSessionId` UNIQUE null, `stripePaymentIntentId` UNIQUE null, `status` ENUM('pending','succeeded','failed'), `ledgerEntryId`, `feeEntryId`, createdBy, timestamps). `Refunds` (id, paymentId FK, `amount`, `reason`, `stripeRefundId` UNIQUE null, `ledgerEntryId`, createdBy, createdAt).

**Interfaces:**
- Consumes: `sendInvoice` (Task 2) now issues the token and emails through `invoice_sent`.
- Produces: `recordPayment(invoice, { method, amount, receivedOn, reference }, { userId })` (applies up to the balance, excess → 2200; status `partly_paid`/`paid`); `applyCredit(invoice, amount)` (from the company's 2200 balance); `refund(payment, { amount, reason })` (≤ paid − refunded, else 400; through Stripe for card/bank); `creditBalance(companyId)`; `handleStripeEvent(event)` — `checkout.session.completed` (card: succeeded; bank: pending), `checkout.session.async_payment_succeeded` / `…_failed`, `charge.refunded`; idempotent on session/payment-intent id; the fee read from the balance transaction. Routes: staff `GET /money/payments`, `POST /money/invoices/:id/payments`, `POST /money/invoices/:id/apply-credit`, `POST /money/payments/:id/refund`, `GET /companies/:id/credit`; public `GET /pay/:token` (number, dates, lines, totals, balance, the business name — nothing else), `GET /pay/:token/pdf`, `POST /pay/:token/checkout` → `{ url }` (Stripe Checkout for the balance due, plus `cardFeePercent` as a separate line when set; `metadata.invoiceId`; methods card and us_bank_account); `POST /money/stripe/webhook` (signature checked with the webhook secret; 400 on a bad signature).

- [ ] **Step 1: Failing tests (payments)** — INV-1001 $145.00: a check for $100 → `partly_paid`, balance 45.00, Dr 1000 / Cr 1100; a check for $60 → `paid`, $15.00 credit (Cr 2200), `creditBalance` 15.00; applying $10 of the credit to the next invoice → Dr 2200 / Cr 1100, credit 5.00 left; refunding the remaining $5.00 credit by check → Dr 2200 / Cr 1000, credit 0.00; refunding $200 of a $160 payment → 400; voiding a paid invoice → 409 `HAS_PAYMENTS`; technician 403; switch off → 404.
- [ ] **Step 2: Failing tests (pay link and Stripe)** — `GET /pay/:token` shows INV-1001 only (no other invoice, contact email or company data beyond the name); unknown, voided, paid, expired (181 days) tokens → the same 404 `PAY_LINK_INVALID`; checkout amount is the server's balance (a body `amount: 1` is ignored) and the fake receives 14500 cents; webhook with a bad signature → 400 and nothing recorded; `checkout.session.completed` for $145 (card, fee 4.51) → payment succeeded, Dr 1010 / Cr 1100, Dr 6000 / Cr 1010 4.51, invoice paid; the same event again → one payment; an ACH session → pending until `async_payment_succeeded`; `async_payment_failed` → failed, invoice still due; `charge.refunded` records a refund once; secret keys are never in `GET /money/settings` (only `stripeConfigured: true`) and only an Owner can set them; 31 requests to `/pay/…` in 10 min from one IP → 429; sending an invoice emails `invoice_sent` with the link and the PDF.
- [ ] **Steps 3–5:** run → FAIL; implement; run → PASS.
- [ ] **Step 6: Commit** `feat(money): payments by Stripe Checkout or by hand, credits, refunds and the pay link`

### Task 5: Reminders and late fees

**Files:**
- Create: `backend/src/services/money/reminders.js` (with its scheduler start function)
- Modify: `index.js`, email templates (`invoice_reminder_due`, `invoice_reminder_late`), `money/config.js` + settings (`reminderDaysBefore` 3, `reminderDaysLate` [7, 30], `lateFeeType` 'none'|'flat'|'percent' default 'none', `lateFeeAmount`, `lateFeeAfterDays` 30)
- Test: `backend/test/integration/money.reminders.test.js`

**Interfaces:**
- Produces: `sendDueReminders({ today })` → `{ sent: [{ invoiceId, stage }] }` — stages `before` (dueOn − 3), `late7`, `late30`, each at most once per invoice (`remindersSent`), only for `sent`/`partly_paid` invoices, to the bill-to contact (else the company's primary contact); `applyLateFees({ today })` — when `lateFeeType` isn't 'none', one late-fee invoice (a `late_fee` line, sent) per overdue invoice after `lateFeeAfterDays`, linked by `lateFeeInvoiceId`. Hourly scheduler, dates in the org time zone.

- [ ] **Step 1: Failing tests** — INV-1001 due 2027-01-31: on 01-28 the `before` reminder; on 02-07 `late7`; on 03-02 `late30`; each only once across repeated runs; a paid or void invoice gets none; late fees off by default (none on 03-02); with `flat` $25 after 30 days → one late-fee invoice of $25.00 posted to 4300, never twice; switch off → the scheduler does nothing.
- [ ] **Steps 2–4**, **Step 5: Commit** `feat(money): invoice reminders and optional late fees`

### Task 6: Invoices in the client portal

**Files:**
- Create: `backend/src/routes/portal/invoices.js`, `frontend/src/portal/pages/Invoices.jsx`
- Modify: `routes/portal/index.js`, `PortalLayout.jsx` (an *Invoices* link, only when Customer billing is on and the contact may see them)
- Test: `backend/test/integration/portal.invoices.test.js`

**Interfaces:**
- Produces: `GET /portal/invoices` (sent and later invoices of the contact's company — company portal admins see all; other contacts see those billed to them), `GET /portal/invoices/:id` (same scope; 404 otherwise), `GET /portal/invoices/:id/pdf`, `POST /portal/invoices/:id/pay` → the same Checkout as the pay link.

- [ ] **Step 1: Failing tests** — a portal admin of Alpha lists Alpha's two sent invoices (no drafts); a plain contact sees only the one billed to them; a Beta contact asking for Alpha's invoice → 404; switch off → 404.
- [ ] **Steps 2–4**, **Step 5: Commit** `feat(portal): customers see and pay their invoices`

### Task 7: Timesheets

**Files:**
- Create: `backend/migrations/20260101000118-timesheets.js`, model `Timesheet.js`, `backend/src/services/time/timesheets.js`, `backend/src/controllers/timesheetsController.js`, `backend/src/routes/timesheets.js`
- Modify: `services/time/index.js` (`assertCanChange`: an entry in a submitted or approved week can't be added, changed or deleted by its owner — 409 `TIMESHEET_LOCKED`; an approver may still correct it, logged), settings (`timesheets.weekStartsOn` 1 = Monday, `timesheets.reminderDay` 5), notifications (`timesheet_due`, `timesheet_submitted`, `timesheet_rejected`), helpers
- Test: `backend/test/integration/timesheets.test.js`

`Timesheets` (id, `userId` FK, `weekStart` DATEONLY, `status` ENUM('open','submitted','approved','rejected'), `totalSeconds`, `submittedAt`, `decidedAt`, `decidedById`, `note`, unique (userId, weekStart)).

**Interfaces:**
- Produces: `weekOf(userId, weekStart) → { weekStart, days: [{ date, entries: [...], seconds }], totalSeconds, status }` (built from the person's logged time); routes `GET /timesheets/mine?week=`, `POST /timesheets/mine/submit` (`{ week }`), `GET /timesheets/pending` (approvers: their department's people; admins everyone), `POST /timesheets/:id/approve`, `POST /timesheets/:id/reject` (`{ note }` required). A weekly reminder notification to anyone with time logged and the week still open.

- [ ] **Step 1: Failing tests** — Tess logs 3 entries in the week of 2026-12-07 and submits → `submitted`, total matches; she can't edit or add an entry dated in that week (409), can in the next week; her department manager sees it pending and approves; a manager of another department → 404; rejecting needs a note and unlocks the week; approved stays locked; works with Customer billing off; the reminder goes once per week to people with an open week; round trip.
- [ ] **Steps 2–4**, **Step 5: Commit** `feat(time): weekly timesheets with submit and approval`

### Task 8: The screens

**Files:**
- Create: `frontend/src/pages/money/Invoices.jsx` + `InvoiceDetail.jsx` (lines, send, void, credit note, record a payment, apply credit, refund, PDF), `BillingRun.jsx` (preview, run, review drafts, send all), `Agreements.jsx` + `AgreementForm.jsx` (lines by kind, live preview of quantities), `Payments.jsx`; `frontend/src/pages/PayPage.jsx` (public `/pay/:token`: the invoice, *Pay now* → Stripe); `frontend/src/pages/Timesheets.jsx` (my week: days, totals, submit; approvals tab for approvers)
- Modify: `MoneyHome.jsx` (Invoices, Billing run, Agreements, Payments tabs — only when Customer billing is on and with `money.billing.view`), company page (a *Billing* tab: agreement, invoices, credit balance), Settings › Money (invoice prefix and next number, auto-send, reminders, late fee, card fee; *Stripe* section for Owners: keys, webhook URL to copy, "configured" state), `navConfig.js` (*Timesheets* for anyone who logs time), `App.jsx` routes
- Test: `backend/test/smoke/money.invoicing.smoke.js`, `backend/test/smoke/timesheets.smoke.js`

- [ ] **Step 1: Failing smoke tests** — create Alpha's agreement and see the preview; run billing for 2027-01-01, open Alpha's draft, send it; open the pay link in a fresh browser (no sign-in): the invoice and *Pay now* (fake Stripe returns a URL); record a check for part of it → *Partly paid*; the portal admin sees it under Invoices; a technician sees no Invoices tab and no rates; Tess submits her week and her manager approves it.
- [ ] **Steps 2–4**, **Step 5: Commit** `feat(money): agreements, billing run, invoices, payments and timesheets screens`

### Task 9: Docs and full verification

- [ ] `UPGRADING.md` (Unreleased): step 3; Stripe setup (keys, the webhook URL `https://<host>/api/v1/money/stripe/webhook`, events to subscribe: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`); nginx needs nothing new (everything is under `/api/v1`); prices are still settings for the owner to fill in.
- [ ] `docs/ROADMAP.md`: step 3 shipped; this plan linked.
- [ ] Full backend suite, then the full smoke suite (never at the same time — they share the test DB), agent tests → pass (the five known stale smoke failures excepted and named).
- [ ] Fresh reviewer over the step, fixes test-first, then push to `dev`.
- [ ] **Commit** `docs(money): step 3, agreements, invoicing and payments`

## Left to the executor (decide, record as a ruling)

Invoice PDF layout; email wording (in the template system); the exact Stripe package version; page layouts. Project stages due (spec's billing run) arrive with step 5, which adds them to `draftForCompany`.
