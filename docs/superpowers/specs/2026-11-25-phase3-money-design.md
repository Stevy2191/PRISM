# Phase 3 — Money: design

Status: **approved by the owner** (2026-11-25). Covers roadmap
sub-projects 10–15 as one design, built in six steps plus a closing security check (see *Build order*).
Read the [roadmap design](2026-10-03-prism-psa-roadmap-design.md) first;
this document keeps its principles (one time ledger, exact money, one
currency, card data never on PRISM's servers, MSP screens switchable).

## Why

PRISM is used today by the owner's internal IT team, and will run the
owner's own MSP once it starts. Phase 3 has to serve both:

- **The internal team now:** contractors (Eric, trading as Hale
  Communication) invoice the team for work on a ticket. The invoice is
  attached to the ticket, entered by hand into Tyler Incode (the team's
  finance system) to get him paid, and the team wants to look up how much it
  paid each contractor in a year. Customer billing happens elsewhere.
- **The MSP later:** a prospect finds the MSP's website, asks for a quote,
  signs a quote and a contract, and becomes a customer: one-time work or a
  recurring managed-services agreement. Customers get invoices by email and
  pay online. The MSP keeps its business books in PRISM.

The owner asked for a full feature set, built into PRISM (not paired with a
separate invoicing app such as Invoice Ninja, considered and declined
2026-11-25), because PRISM is meant to run the whole MSP.

## Goals

1. Contractor and supplier bills recorded against tickets and projects, with
   a yearly "paid per contractor" report and 1099 totals.
2. Purchasing for jobs (purchase orders, receiving), a small shelf stock sold
   by the unit used (300 ft of a 1,000 ft box), materials on tickets and
   projects, equipment received becoming customer assets.
3. Rates and billing rules matching the owner's business (below), applied
   automatically when an invoice is drafted.
4. Recurring agreements priced per user (in tiers), per device, flat, by
   license count or by prepaid hours, billed monthly in advance.
5. Invoices emailed with a pay link; payment by card or bank transfer through
   Stripe; reminders; partial payments, credits, refunds; Net terms.
6. Sales: a website quote request becomes a ticket under a **prospect**; quotes
   are accepted and contracts signed online; signing turns the prospect into a
   customer and starts what they bought. A monthly Prospects report.
7. Project billing: fixed price, time and materials, or deposit and stages —
   all three, chosen per project.
8. Business books (level A): profit and loss, receivables and payables aging,
   sales tax collected, profit per customer, an accountant export, all from
   proper double-entry records underneath.
9. Texas sales tax handled by tax categories with a taxable share, exempt
   customers, tax included or left off per customer and per invoice.
10. Weekly timesheets with approval for the internal team.

## Non-goals (this phase)

- Managing customers' Microsoft 365 or Google Workspace tenants (creating
  accounts, assigning licenses, Google directory sync and sign-in): its own
  project right after Phase 3 (owner agreed 2026-11-25). Phase 3 only *reads*
  license counts from Microsoft 365 for billing; Google counts are manual
  until that project.
- Full accounting (editable chart of accounts, manual journals, balance
  sheet, bank reconciliation) — level B, later, on top of this phase's
  records. QuickBooks/Xero connectors — later.
- Automatic tax services (Avalara and the like), more than one currency,
  reselling licenses (PRISM is not a Microsoft/Google store).
- Payroll. PRISM tracks cost rates, not paychecks.

## Anti-goals (would make this a failure even if it works)

- **Money that doesn't add up:** a float rounding error, an invoice whose
  lines don't sum to its total, books that disagree with invoices, or a
  billed time entry that can still be edited.
- **Card data or bank numbers on PRISM's servers**, or a Stripe key readable
  by anyone but Owners.
- **Technicians seeing rates, other people's costs, or customers' invoices**
  without the permission for it.
- **An internal-IT install cluttered with MSP screens** it never uses.
- **A public page (pay link, quote, contract, website form) that leaks
  another customer's data** or can be abused to spam or flood PRISM.
- **Storing contractors' tax IDs (SSN/EIN).** 1099 reporting needs totals
  per vendor; the W-9 lives as an attachment if the owner wants it there.

## Constraints

- Existing stack: Node/Express/Sequelize/MariaDB, React/Vite, nginx, the
  client portal, email templates, `pdfkit` (already used for reports and
  forms), `tokenCrypto` for secrets, the survey-link pattern for public
  tokens, the per-company SLA with support hours and holidays (CS).
- **Money is exact.** Stored as DECIMAL; unit prices and costs to 4 decimals
  (cable per foot), line totals and everything posted to 2. Arithmetic in
  integer cents (or a decimal library) — never JS floats. The builder picks
  the library.
- **One currency per install**, a setting (USD default).
- **Dates follow the organization's time zone** (`utils/orgTime.js`).
- Every new fetch-by-id re-checks company scope (the IDOR rule).
- MSP-only screens sit behind a switch (*Customer billing*, off by default).
- Behind the Cloudflare Tunnel the real client IP is trusted only via
  `TRUSTED_PROXIES` (security pass, 2026-11-23); public endpoints rely on it
  for rate limits.

## Approaches considered (build order)

| | Approach | Trade-off |
|---|---|---|
| **A** ✔ | **Foundation first, then the money the team uses today:** money core → bills and purchasing → agreements, invoicing, payments → sales → project billing → books reports | Everything posts into one correct core; the internal team gets value from step 2 while MSP steps are built. **Chosen by the owner, 2026-11-25.** |
| B | Follow the customer's journey end to end thinly, then deepen | Whole MSP flow visible early; nothing finished for a long time; the team gets nothing until late |
| C | Billing engine first, typed lines, automate later | Fastest to a sendable invoice; useless until the MSP starts; automation reshapes it |

Also considered and declined: pairing PRISM with Invoice Ninja for customer
invoicing (a second internet-facing app, two portals, sync edge cases; the
owner wants it built in). Built-in books chosen at level A over full
accounting (B) or a QuickBooks/Xero connector (C).

## Decisions by the owner (2026-11-24/25)

**Rates and billing rules**
- One flat hourly rate, a flat **after-hours** rate, and a **trip charge**
  (drive time) per on-site visit. Prices are settings, decided later.
- A **"call" is an on-site visit.** Event-basis customer on site: trip charge
  + **1-hour minimum**, then **30-minute steps**. Recurring customer on site:
  **trip charge only** (labor covered within support hours).
- Remote work for an event-basis customer: 30-minute steps, no minimum
  (proposed, accepted).
- After-hours work: the after-hours rate, same minimum and steps.
- Billed time is rounded when the invoice is drafted; time entries keep the
  real minutes.

**Agreements (recurring customers)**
- Per-user pricing **in tiers**: Full user, Light user (e.g. mechanics,
  drivers: email/phone/passwords), Not covered; shared and unowned equipment
  (shop PC, servers, firewalls) **per device**. Flat fees, license lines and
  prepaid hour blocks also available — PRISM supports every model.
- A contact's tier defaults from their department and, with Microsoft 365
  sync, from their license (frontline F1/F3 → Light).
- **Coverage comes from the SLA:** Basic support 8–5 is included; after
  hours is billed at the flat rate on top; projects and new installs are
  quoted and billed separately. Covered time shows on the invoice at $0.
- License lines ("Microsoft 365 Business Standard × 14") can take their count
  from the customer's Microsoft 365 tenant each month.
- **Billed monthly in advance** on the 1st: the coming month's fees plus last
  month's extras on one invoice; the first month prorated by days; mid-month
  additions caught up on the next invoice; leavers drop off with no refund
  (both settings); a cancelled agreement's last invoice carries only extras.
- **Net 30** for contract customers (a per-customer setting).
- **Event-basis customers (no agreement):** billed **monthly with everyone
  else by default** (visits and parts on the invoice of the 1st), with a
  **per-customer switch to bill each job when its ticket closes** (owner,
  2026-11-25). Terms per customer as for everyone.

**Invoices and payment**
- Email with a **pay link that needs no sign-in**, showing only that invoice,
  paid on **Stripe Checkout** (card and bank transfer); the client portal
  lists all of a signed-in contact's invoices. (Option A, 2026-11-24.)
- Processing fees absorbed by default; an optional card fee setting.
  Partial payments; overpayment becomes a credit; refunds through Stripe.
- Reminders before the due date and at 7 and 30 days late; late fees
  optional, off by default.

**Sales**
- The website's *Get info* / *Get a quote* opens a **ticket** and creates the
  person as a contact under a **prospect** company — a kind of company beside
  client and vendor. Prospects are left out of agents, the portal, billing
  and normal reports until they convert.
- Flow: review → contact them → **quote**, which they accept online →
  **contract**, which they sign → they become a customer (prospect → client),
  one-time or recurring.
- **Both the quote and the contract are signed.** Contract text is the
  owner's, written later; PRISM provides templates with fill-in fields.
- Signing is built into PRISM (no DocuSign): typed name (drawn signature
  optional), a signed PDF with a signature page (who, when, IP, document
  fingerprint), optional countersignature.
- A **monthly Prospects report**: new prospects by source, quoted, won,
  quoted and won value.

**Purchasing and stock**
- Items are ordered per job (projects mostly); a few boxes kept on the shelf
  and charged by the amount used (300 ft, not the box).
- **No markup by default**; a markup setting (percent, overall or per
  product) exists for others.

**Tax (Texas)**
- One combined rate per location you set; **tax categories** on everything
  sold, each with a taxable share (100 % / 80 % / 0 %), to be filled in with
  the owner's CPA; exempt customers with a certificate and expiry tracked;
  **tax included or left off per customer and per invoice**; a tax-collected
  report for filing. (Texas facts here are from memory and must be
  confirmed with a CPA or the Comptroller before charging tax.)

**Books** — level A: profit and loss (monthly/yearly), receivables and
payables aging, sales tax collected, 1099 totals, profit per customer,
expenses with receipts, an export for the accountant; double-entry records
underneath from day one.

**Project billing** — all three per project: fixed price, time and
materials, deposit and stages (e.g. 50 / 25 / 25 %). Projects also gain a
money budget beside the hour budget (roadmap 15).

**Permissions** — new: see billing, manage invoices and payments, billing
settings (Owners: Stripe keys, tax), manage rates, approve timesheets,
manage bills, manage purchasing, manage sales, see the books. Technicians
log time and materials without seeing rates or invoices unless granted.

## The design

### Kinds of company and the switch

- `Company` gains **prospect** beside client / vendor / internal. A prospect
  may own contacts and tickets (today only clients and the internal company
  may — the builder relaxes that rule for prospects). Converting sets client
  and clears prospect; nothing is copied.
- **Customer billing** switch (Settings, Owners; off by default). Off:
  bills, purchasing, stock, materials, expenses, timesheets, contractor
  reports and the books are available; invoices, agreements, payments,
  quotes, contracts, prospects and the website form are hidden and refuse
  requests. On: everything.

### Step 1 — Money core

- **Ledger:** accounts (a fixed, system-defined chart in level A: cash,
  Stripe clearing, receivables, customer credits, inventory, payables, sales
  tax payable, income by category, cost of materials, expense categories,
  processing fees) and journal entries with lines that must balance.
  Entries are written only by the system, never edited: a correction is a
  reversal plus a new entry. Every invoice, payment, bill, bill payment,
  expense, stock use and credit posts through one service.
- **Tax:** tax rates (one to start: your location), tax categories with a
  taxable share, a per-customer setting (taxable / exempt with certificate
  attachment and expiry; tax included or not).
- **Catalog:** products and services (name, SKU, kind: labor, service,
  product, license, fee; unit; cost; price or markup; tax category;
  purchase unit and how many usage units it holds; stocked or not;
  serialized or not). Separate from 9b's per-company software list.
- **Rates and rules:** the hourly rate, after-hours rate, trip charge, event
  minimum (1 h), step (30 min) — settings, overridable per customer.
  Work types gain *on site* (the trip charge applies) and *after hours*
  is decided from the entry's start time against the customer's SLA support
  hours (a tech can override). Time entries gain a billing status
  (unbilled, covered, billed, non-billable) and the invoice line that billed
  them; billed entries are locked.
- **Contact tiers:** Full / Light / Not covered on contacts, defaults by
  department and Microsoft 365 license.
- **Permissions** and the **Customer billing** switch.

### Step 2 — Bills, purchasing, stock, materials, expenses

- **Bills** from vendor companies (contractors and suppliers): bill number,
  dates, due date, lines (expense category, or materials, or PO lines), the
  vendor's PDF, linked tickets and projects (several), status *received →
  entered elsewhere (reference, e.g. the Incode number) → paid (date,
  method, reference)*. The 1099 flag lives on the vendor company. Posts to
  the ledger.
- **Purchase orders** from a ticket or project to a vendor: lines from the
  catalog, *draft → ordered → partly received → received*; receiving adds
  the items to the job's materials (billable at price), adds stocked items to
  the shelf, and creates an **Asset** in the customer's company for
  serialized equipment (serial, date, cost) that the agent later matches.
- **Stock:** on hand per stocked item in usage units; using 300 ft takes
  300 ft off and posts its cost; low-stock threshold and alert.
- **Materials on tickets** (projects already have them; unified so both
  bill the same way).
- **Expenses:** date, category, amount, payment method, receipt photo,
  optionally rebilled to a customer job.
- **Reports:** paid per vendor per year (the "how much did we pay Eric"
  report), 1099 totals, open bills.

### Step 3 — Agreements, invoicing, payments, timesheets

- **Agreements** on a customer: SLA, start/end, billing day (1st), terms
  (Net 30), lines of kind flat / per user (tier) / per device (type) /
  license (SKU, count from Microsoft 365 or typed) / prepaid hours (hours,
  rollover or not, overage rate).
- **Billing run** on the 1st (and on demand): for each customer, a **draft
  invoice** with the coming month's agreement lines (counts taken now and
  shown for review; prorated first month; catch-up lines for additions) and
  last month's unbilled items — billable time after the rules (minimum,
  steps, trip charges, after hours), materials, rebilled expenses, project
  stages due. Covered time is listed at $0. Drafts are reviewed and sent; an
  auto-send setting exists.
- **Invoices:** one numbering sequence for the business (prefix a setting),
  lines with tax category and tax, totals, status *draft → sent → partly
  paid → paid / void*, credit notes, PDF, email with the pay link, shown in
  the client portal.
- **Payments:** Stripe Checkout (card and US bank account) opened from the
  pay link; a verified webhook records the payment; manual payments (check,
  cash, transfer); credits and refunds; fees posted. Stripe keys encrypted,
  set by Owners.
- **Reminders** on the schedule above; optional late fee.
- **Timesheets:** each person's week built from their logged time; submit,
  approve, lock; reminders to submit.

### Step 4 — Sales

- **Website form:** a hosted PRISM page (*Get a quote*), embeddable on the
  owner's site in an iframe or linked. Name, company, email, phone, what they
  need. Creates (or matches by email) the prospect company and contact and a
  ticket with source *website*. Spam and abuse: a honeypot field, Cloudflare
  Turnstile when configured, per-IP rate limits, size limits. Because PRISM's
  pages refuse framing (CSP `frame-ancestors 'none'`), this one page allows
  the website domains listed in a setting.
- **Quotes** from a ticket or prospect: catalog lines, labor, recurring lines
  (become agreement lines) and one-time lines (become a project or billed
  ticket work), terms, valid-until, versions, a PDF; sent as a link (no
  sign-in, that quote only); the customer accepts by typing their name.
- **Contracts:** templates (rich text, with fill-in fields from the company,
  the contact and the accepted quote); sent with the accepted quote; signed
  by typed name (drawn optional); the signed PDF with a signature page and a
  SHA-256 fingerprint is stored on the company; optional countersignature.
- **Converting:** on signing, the prospect becomes a client, recurring lines
  become an agreement, one-time lines become a project (with the billing
  method chosen on the quote) or billable ticket work.
- **Prospects report** by month and source.

### Step 5 — Project billing

Per project: fixed price (billed in full or by stages), time and materials
(through the monthly run or on demand), or deposit and stages (percentages
or amounts, each due on a date or a milestone). A money budget beside the
hour budget, with the same alerts.

### Step 6 — Books reports

Profit and loss (accrual by invoice and bill date, with a cash view), aging
of receivables and payables, sales tax collected by period and category,
profit per customer (revenue minus labor cost, materials, bills), expenses
by category, and an export (CSV, and a journal export an accountant can
import).

### Step 7 — Security check (owner, 2026-11-25)

The last step, before Phase 3 is released, repeats the 2026-11-23 security
pass over everything Phase 3 added and the system as a whole:
- known vulnerabilities in every dependency and image (`npm audit`,
  govulncheck, base image versions), fixed where a fix exists;
- static analysis (semgrep) of the new code;
- a hand review of the new attack surface: the public pages (pay link,
  quote, contract signing, website form), the Stripe webhook, money
  calculations done server-side, company scope on every new record
  (bills, invoices, agreements, quotes, payments), the new permissions,
  stored secrets (Stripe keys), file uploads (bill PDFs, receipts,
  certificates) and generated PDFs, CSV exports (spreadsheet formula
  injection), and the CSP exception for the embedded website form;
- findings fixed with tests, the rest written up with their severity, and
  the full backend, smoke and agent suites run before release.

### Public endpoints (security)

Pay link, quote, contract signing, the website form and the Stripe webhook
are the only new pages reachable without signing in. Each token is 32 random
bytes, stored hashed, shows one document only, expires (paid, void,
superseded, or after a period), and every amount is recomputed on the
server. The webhook checks Stripe's signature. All are rate limited. nginx
routes the webhook and the public pages as it does `/mcp` today.

## Left to the builder

Schema and table names; the money library; PDF layouts; exact email
template wording (in the existing email-template system); how the stepper
of a long quote looks; which ledger account each category posts to (a
sensible fixed chart); where each screen sits in the navigation (Money in
the sidebar, Billing on a company's page). Naming: PRISM already has a
**Contracts** module for vendor contracts — the customer documents signed in
step 4 need a name that doesn't collide (the builder's call; e.g. "Signed
agreements").

## Calls made while writing this up (the owner can overrule)

- **Income is counted when invoiced** (accrual), so a fee billed in advance
  counts in the month invoiced; the cash view shows when it was paid.
- **No double-counted contractor cost:** a contractor who logs time *and*
  bills (Eric) — profit per customer uses the bill, not his time entries'
  cost, on tickets the bill is linked to.

## Open with the owner (doesn't block building)

- Prices, the after-hours rate, the trip charge.
- The contract wording (owner writes it later).
- Which tax category gets which taxable share (with a CPA).
- A Stripe account; whether a card fee is allowed and wanted.
