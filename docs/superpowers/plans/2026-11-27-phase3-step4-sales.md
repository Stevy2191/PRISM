# Phase 3, Step 4 — Sales: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From a website request to a signed customer: the website's *Get a quote* form opens a ticket under a **prospect**; staff quote it; the customer accepts the quote and signs a contract online (typed name, drawn signature optional, a signed PDF with a signature page and fingerprint); signing turns the prospect into a client, recurring lines into an agreement and one-time lines into a project or ticket work. A monthly Prospects report.

**Architecture:** Companies gain *prospect* beside client/vendor/internal. New tables for quotes, contract templates and signed documents. Services in `backend/src/services/sales/`. Staff routes under `/api/v1/sales/…`; public routes `/api/v1/quote/:token`, `/api/v1/sign/:token` and the website form at `/forms/quote` (a small server-rendered page, the only page that may be framed). Everything sits behind the Customer billing switch.

**Tech Stack:** as steps 1–3 (Express/Sequelize/MariaDB, React/Vite, decimal.js via `money.js`, pdfkit, `utils/richHtml.js`). No new packages: Cloudflare Turnstile is checked with one `fetch` to its siteverify endpoint.

**Spec:** `docs/superpowers/specs/2026-11-25-phase3-money-design.md` (Step 4, *Kinds of company and the switch*, *Sales* decisions, *Public endpoints*).

## Global Constraints

- Everything from steps 1–3's Global Constraints (exact money through `money.js`; org time zone; company scope on every fetch-by-id, out of reach = 404; reversible migrations registered in `moneyMigrations`/`laterMigrations`; new tables in `resetData`; never share a Sequelize attribute object between columns).
- Migration numbers continue from 120.
- **Customer billing switch:** every route, page and form here answers 404 while it's off.
- Permission: everything staff-side needs `money.sales.manage` (exists since step 1); reading quotes also `money.billing.view`. Countersigning needs `money.sales.manage`.
- **Naming:** PRISM's *Contracts* module is for vendor contracts and step 3 took *Agreements*; the customer documents signed here are **Signed documents**, made from **Contract templates** (spec: "the builder's call").
- Public tokens as in step 3: 32 random bytes base64url, stored as sha256, one document per token, same 404 for unknown / expired / superseded / used-up, rate limited per IP. Every amount shown or accepted is recomputed on the server.
- Prospects are left out of the client portal, agents (install links), the billing run and customer lists; their tickets are ordinary tickets.
- Contract wording is the owner's (written later); PRISM ships one plain starter template with fill-in fields and says so on screen.

## Review Focus

1. **The website form abused:** a filled honeypot, a failed or missing Turnstile answer (when configured), more than 5 posts an hour from one IP, oversized or HTML-laden fields → nothing created (the honeypot answers "thanks" so bots learn nothing); a post never creates a second prospect for an email already known.
2. **Signing tampered with:** a signed or superseded document's link, a quote changed after it was sent, a drawn signature that isn't a small PNG → refused; the fingerprint on the signature page matches the document text the customer saw; signing twice converts once.
3. **Converting at the edges:** a prospect with an active agreement already, a quote with no recurring lines (no agreement), no one-time lines (no project or ticket), a customer that is already a client (no change of kind) → each handled, all in one transaction.
4. **Embedding:** the form page allows framing only by the origins in the setting (`frame-ancestors`), and every other PRISM page still refuses framing.
5. **Who sees what:** prospects never appear in the portal, in agent install links or in the billing run; a technician gets 403 on quotes and templates; another company's quote is 404.

---

### Task 1: Prospects

**Files:**
- Create: `backend/migrations/20260101000120-prospects.js`, `backend/src/services/sales/prospects.js`, `backend/src/controllers/sales/prospectsController.js`, `backend/src/routes/sales.js`
- Modify: `Company` (`isProspect` BOOLEAN default false, `prospectSource` ENUM('website','referral','phone','email','other') null, `convertedAt` DATE null), `Ticket.source` adds `'website'`, `services/companyService.js` (a prospect may own contacts and tickets), companies controller (`kind=prospect` filter; customer lists exclude prospects), portal sign-in and `portalCompany` (refuse prospects), agent install-link creation (refuse prospects), `billingRun.candidates()` (skip prospects), `routes/index.js` (`/sales`), chains
- Test: `backend/test/integration/sales.prospects.test.js`

**Interfaces:**
- Produces: `createProspect({ name, contact: { firstName, lastName, email, phone }, source }, { userId, transaction }) → { company, contact }`; `findOrCreateProspect(input, opts)` — matches an existing contact by email (any kind of company: a client's contact stays the client's); `convertToClient(company, { transaction })` (isProspect false, isClient true, convertedAt now; no-op on a client); routes `GET /sales/prospects` (list with source, created, quotes count), `POST /sales/prospects`, `POST /sales/prospects/:id/convert` (by hand).

- [ ] **Step 1: Failing tests** — create a prospect "Gamma Vet" with contact Gia: company `isProspect`, not client; Gia can be given a ticket; the prospect isn't in `GET /companies?kind=client`, is in `kind=prospect`; its portal refuses sign-in (404) and an install link for it → 400; `findOrCreateProspect` with Gia's email again returns the same company and contact (no duplicate); with a client contact's email returns that client; convert → client, `convertedAt` set, out of the prospect list; billing-run candidates skip a prospect with unbilled time; technician 403; switch off → 404; round trip.
- [ ] **Steps 2–4:** run → FAIL; implement; run → PASS.
- [ ] **Step 5: Commit** `feat(sales): prospects beside clients and vendors`

### Task 2: The website form

**Files:**
- Create: `backend/src/services/sales/websiteForm.js`, `backend/src/services/sales/turnstile.js`, `backend/src/routes/forms.js` (server-rendered HTML, no React), `backend/src/views/quoteForm.js` (the page as a template function; escaped output only)
- Modify: `app.js` (mount `/forms` before the SPA; this router sets its own CSP), `frontend/nginx/site.conf` (+ a `headers-embeddable.conf` without `X-Frame-Options`/CSP, used only by `location /forms/`), `middleware/rateLimit.js` (`websiteFormLimiter`: 5 posts / hour / IP), `money/config.js` + settings (`sales.formEmbedOrigins` — list of `https://` origins; `sales.turnstileSiteKey`; `sales.turnstileSecret` encrypted, Owners only, never returned), email (`website_request_received` to the requester, on by default)
- Test: `backend/test/integration/sales.websiteForm.test.js`

**Interfaces:**
- Consumes: `findOrCreateProspect` (Task 1).
- Produces: `GET /forms/quote` (the page: name, company, email, phone, "what do you need", a choice of *Get info* / *Get a quote*, a hidden honeypot field `website`, Turnstile widget when configured); `POST /forms/quote` (form-encoded) → creates or matches the prospect and contact and opens a ticket (source `website`, title "Website: get a quote — <company>", the message as its description, plain text) → a thank-you page. Response headers: `Content-Security-Policy: … frame-ancestors <origins or 'none'>; script-src 'self' https://challenges.cloudflare.com` (Turnstile only when configured).
- Limits: name/company 200, email 254 (valid), phone 40, message 5,000 chars; HTML is stored as text, never rendered.

- [ ] **Step 1: Failing tests** — a post from Gia at Gamma Vet → prospect, contact, ticket with source `website` and the message as text; a second post with the same email → same contact, a second ticket; honeypot filled → thank-you page, nothing created; Turnstile configured (fake verifier) and a failing token → 400, nothing created; 6th post in an hour from one IP → 429; a 10,000-char message → 400; `<script>` in the message is stored as text and escaped on the page; the page's `frame-ancestors` is the setting's origins (and `'none'` when empty), and `/api/v1/…` responses are unchanged; an origin setting that isn't `https://host` → 400; switch off → 404 on both.
- [ ] **Steps 2–4**, **Step 5: Commit** `feat(sales): the website quote form, embeddable on the owner's site`

### Task 3: Quotes

**Files:**
- Create: `backend/migrations/20260101000121-quotes.js`, models `Quote.js`, `QuoteLine.js`, `backend/src/services/sales/quotes.js`, `backend/src/services/sales/quotePdf.js`, `backend/src/controllers/sales/quotesController.js`, `backend/src/controllers/sales/publicQuoteController.js`, `backend/src/routes/quote.js`
- Modify: `routes/sales.js`, `routes/index.js` (public `/quote`), `rateLimit.js` (`publicDocLimiter`: 30 / 10 min / IP, shared by Task 4), money config (`sales.quotePrefix` 'Q-', `sales.quoteNextNumber` 1001, `sales.quoteValidDays` 30), email (`quote_sent`), notifications (`quote_accepted`, `quote_declined`), companyMerge, chains
- Test: `backend/test/integration/sales.quotes.test.js`

Tables: `Quotes` (id, `number` unique, `companyId` FK, `ticketId` null, `contactId` null — who it's for, `version` INT default 1, `previousId` null — the version it replaced, `status` ENUM('draft','sent','accepted','declined','expired','superseded'), `validUntil` DATEONLY, `terms` TEXT, `oneTimeAs` ENUM('project','ticket') default 'ticket', `oneTimeTotal`, `recurringTotal` (a month), `taxTotal`, `tokenHash` CHAR(64) unique null, `tokenExpiresAt`, `sentAt`, `acceptedAt`, `acceptedName`, `acceptedIp`, `declinedAt`, `declineReason`, `convertedAt`, createdBy, timestamps). `QuoteLines` (id, quoteId FK cascade, `recurring` bool, `kind` — for recurring lines the agreement line kinds (flat, per_user, per_device, license, prepaid_hours) with their fields (tier, assetCategoryId, skuId, countSource, manualCount, hours, rollover, overageRate); for one-time lines 'product','labor','fee'; `catalogProductId` null, `description`, `quantity` DECIMAL(12,4), `unitPrice` DECIMAL(12,4), `amount` DECIMAL(12,2), `taxCategoryId`, `tax`, `sortOrder`).

**Interfaces:**
- Consumes: `taxForLines`, `customerBilling` (step 1), agreement line validation (`agreements.readLines` — exported for this), `moneyConfig`.
- Produces: `createQuote(company, body, { userId })` (draft, numbered at creation: Q-1001), `updateQuote` (drafts only), `sendQuote(quote, { userId })` (issues the token, valid until `validUntil`, emails `quote_sent` to the contact with the PDF), `reviseQuote(quote, { userId })` (a new draft version Q-1001 v2 with the same lines; the old one `superseded`, its link dead), `acceptQuote(token, { name, ip })`, `declineQuote(token, { reason })`, `expireQuotes({ today })` (daily, from the reminder scheduler), `quoteJson`, `publicQuoteJson` (number, version, dates, lines, totals, terms, business name; nothing else); routes `GET/POST /sales/quotes`, `GET/PATCH /sales/quotes/:id`, `POST …/:id/send|revise`, `GET …/:id/pdf`; public `GET /quote/:token`, `GET /quote/:token/pdf`, `POST /quote/:token/accept` (`{ name }`, 1–200 chars), `POST /quote/:token/decline`.
- Totals: one-time lines are `cents(quantity × unitPrice)` with tax per line; recurring lines are a month at today's counts for per-user/per-device/license (the same `quantityFor` as agreements, shown as "about"), tax per line; both summed separately and shown separately.

- [ ] **Step 1: Failing tests** — Gamma Vet quote: recurring Full user $95 × (3 contacts), firewall flat $40, one-time "Network install" labor 6 h × $100 and "Firewall" product 1 × $650 → recurringTotal 325.00, oneTimeTotal 1250.00 plus tax; send → token, status `sent`, emailed with the PDF; public view shows those, no other quote or company data; accept with typed name "Gia Grant" from IP x → `accepted`, name, IP, time stored, a `quote_accepted` notification for the sender; accepting again or after expiry or after decline → the same 404; revise → v2 draft with the same lines, v1 `superseded` and its link 404; a sent quote can't be edited (409); `expireQuotes` on validUntil + 1 → `expired`; technician 403; another company's quote via a limited clerk → 404; switch off → 404; round trip.
- [ ] **Steps 2–4**, **Step 5: Commit** `feat(sales): quotes, sent as a link and accepted online`

### Task 4: Contract templates and signed documents

**Files:**
- Create: `backend/migrations/20260101000122-signed-documents.js`, models `ContractTemplate.js`, `SignedDocument.js`, `backend/src/services/sales/contracts.js` (fill-in fields, signing), `backend/src/services/sales/signedPdf.js`, `backend/src/controllers/sales/contractsController.js`, `backend/src/controllers/sales/publicSignController.js`, `backend/src/routes/sign.js`
- Modify: `routes/sales.js`, `routes/index.js` (public `/sign`), email (`contract_sent`, `contract_signed` with the signed PDF to the customer), notifications (`contract_signed`), migration seeds one starter template ("Managed services agreement — starter, replace with your own wording"), companyMerge, chains
- Test: `backend/test/integration/sales.contracts.test.js`

Tables: `ContractTemplates` (id, `name`, `bodyHtml` TEXT (sanitized with `sanitizeRichHtml`), `active`, timestamps). `SignedDocuments` (id, `companyId` FK, `quoteId` FK, `templateId` null, `title`, `bodyHtml` — the filled-in text, frozen when sent, `fingerprint` CHAR(64) — sha256 of the frozen plain text, `status` ENUM('sent','signed','countersigned','void'), `tokenHash` unique null, `tokenExpiresAt`, `signerName`, `signerEmail`, `signerIp`, `signerUserAgent` STRING(300), `signedAt`, `signatureImage` MEDIUMTEXT null (PNG data URL), `countersignedById`, `countersignedAt`, `pdfPath`, `pdfSha256`, createdBy, timestamps).

**Interfaces:**
- Consumes: an accepted quote (Task 3).
- Produces: fill-in fields `{{company.name}}`, `{{company.address}}`, `{{contact.name}}`, `{{contact.email}}`, `{{quote.number}}`, `{{quote.recurringTotal}}`, `{{quote.oneTimeTotal}}`, `{{quote.lines}}` (a table, server-built), `{{business.name}}`, `{{today}}` — values HTML-escaped; unknown fields → 400 on saving the template; `sendContract(quote, { templateId, userId })` (only for an accepted quote; freezes the text and fingerprint; token valid 30 days; emails `contract_sent`); `signDocument(token, { name, signatureImage?, ip, userAgent }) → { document, converted }` (in one transaction: marks signed, builds the PDF, calls `convertQuote` from Task 5; a second signature → the same 404); `countersign(document, user)`; the PDF: the document's text, then a signature page (signer name and email, date and time in the org time zone, IP, the fingerprint, the drawn signature if any, the countersigner when there is one); routes `GET/POST/PATCH /sales/contract-templates`, `POST /sales/quotes/:id/contract` (`{ templateId }`), `GET /sales/documents?companyId=`, `GET /sales/documents/:id/pdf`, `POST /sales/documents/:id/countersign`, `POST /sales/documents/:id/void` (unsigned only); public `GET /sign/:token` (title, the frozen text as sanitized HTML, the fingerprint), `POST /sign/:token` (`{ name, signatureImage? }`).
- A drawn signature must be `data:image/png;base64,…`, PNG bytes, ≤ 200 KB, ≤ 2000 × 1000 px.

- [ ] **Step 1: Failing tests** — a template with `{{company.name}}` and `{{quote.lines}}`, an unknown `{{bank.account}}` → 400; `sendContract` for a sent-but-not-accepted quote → 409; for the accepted Gamma quote → document `sent` whose text has "Gamma Vet" and the lines, a fingerprint equal to sha256 of its plain text, emailed; public view shows the text and fingerprint; signing with typed name and a small PNG → `signed`, signer details stored, a PDF on disk whose signature page has the name, the IP and the fingerprint, emailed to the signer; signing again → 404; a JPEG or a 300 KB PNG as the signature → 400; a template `<script>` is stripped; countersign → `countersigned`, the PDF regenerated with both; technician 403; switch off → 404; round trip.
- [ ] **Steps 2–4**, **Step 5: Commit** `feat(sales): contract templates and documents signed online`

### Task 5: Converting the customer

**Files:**
- Create: `backend/src/services/sales/convert.js`
- Modify: `contracts.js` (`signDocument` calls it), `quotesController.js` (`POST /sales/quotes/:id/convert` for an accepted quote without a contract)
- Test: `backend/test/integration/sales.convert.test.js`

**Interfaces:**
- Consumes: `convertToClient` (Task 1), `agreements.createAgreement` (step 3, given a transaction), `addMaterial` (step 2, for one-time lines), project creation (`services/projects` create), ticket creation (`services/tickets/ticketWrite` or the model, the same way the website form opens one).
- Produces: `convertQuote(quote, { transaction, userId }) → { company, agreement|null, project|null, ticket|null }` — idempotent (`quote.convertedAt`): the company becomes a client; recurring lines become an agreement starting on the signing day (or the 1st of next month — a setting `sales.agreementStarts` 'signing_day' | 'next_month', default 'signing_day', so step 3's billing bills the first part month); a company that already has an active agreement gets the recurring lines added to it instead of a second agreement; one-time lines become, by `oneTimeAs`, a project ("<company> — <quote number>", owned by the default department) or a ticket ("Quoted work — <quote number>"), each line a billable material at the quoted price and tax category; nothing is created when there are no lines of that kind.

- [ ] **Step 1: Failing tests** — signing the Gamma contract → Gamma is a client with `convertedAt`, an active agreement with the two recurring lines from the signing day, a ticket with two billable materials (6 × $100, 1 × $650); `oneTimeAs: 'project'` → a project with the materials instead; a quote with only one-time lines → no agreement; only recurring → no ticket or project; an existing client with an active agreement → its agreement gains the lines; converting twice (sign, then the manual convert) → once; a failure part-way (a forced error) leaves nothing half done; the January billing run for Gamma bills the agreement's December days.
- [ ] **Steps 2–4**, **Step 5: Commit** `feat(sales): signing turns the prospect into a customer with their agreement and work`

### Task 6: The Prospects report

**Files:**
- Create: `backend/src/controllers/sales/salesReportsController.js`
- Modify: `routes/sales.js`
- Test: `backend/test/integration/sales.report.test.js`

**Interfaces:**
- Produces: `GET /sales/reports/prospects?from=2026-12&to=2027-02` → `{ months: [{ month, bySource: { website, referral, … }, newProspects, quoted, quotedValue, won, wonValue }] }` (org time zone; quoted = quotes first sent that month, value = one-time + 12 × recurring; won = companies converted that month, value = their accepted quote's); `?format=csv` via `reports/shared.sendCsv`.

- [ ] **Step 1: Failing tests** — two website prospects and one referral in December, one quoted in December ($1,250 + $325/mo → 5,150.00), won in January → December: new 3 (website 2, referral 1), quoted 1, quotedValue 5150.00, won 0; January: won 1, wonValue 5150.00; CSV escapes a company named `=cmd()`; technician 403.
- [ ] **Steps 2–4**, **Step 5: Commit** `feat(sales): the monthly Prospects report`

### Task 7: The screens

**Files:**
- Create: `frontend/src/pages/sales/` — `SalesHome.jsx` (Prospects, Quotes, Contract templates, Report tabs; Money › Sales in the sidebar when Customer billing is on and with `money.sales.manage`), `Prospects.jsx`, `QuoteForm.jsx` (recurring and one-time lines, catalog picker, live totals from the server), `Quotes.jsx` + `QuoteDetail.jsx` (send, revise, PDF, send contract, convert), `ContractTemplates.jsx` (the rich-text editor with a fill-in field picker), `ProspectsReport.jsx`; `frontend/src/pages/QuotePage.jsx` (public `/q/:token`: the quote, Accept by typed name, Decline) and `frontend/src/pages/SignPage.jsx` (public `/s/:token`: the document, the fingerprint, typed name, an optional drawing pad, Sign)
- Modify: `App.jsx`, `navConfig.js`, the company page (prospects: a *Convert* button and their quotes; every customer: *Signed documents* on Setup › Billing), Settings › Money (*Website form*: embed origins, the snippet to paste, Turnstile keys for Owners; quote prefix and validity; when agreements start), notification labels
- Test: `backend/test/smoke/sales.smoke.js`

- [ ] **Step 1: Failing smoke tests** — post the website form (served by PRISM, as a visitor would): a ticket and a prospect appear; staff quote Gamma from the prospect, send it; the quote link in a fresh browser: accept by typing a name; staff send the starter contract; the sign link: type a name, draw a line, sign → "Signed"; Gamma now shows as a client with an agreement and the quoted ticket; the Prospects report shows the month; a technician sees no Sales.
- [ ] **Steps 2–4**, **Step 5: Commit** `feat(sales): prospects, quotes, contracts and the report screens`

### Task 8: Docs and full verification

- [ ] `UPGRADING.md` (Unreleased): step 4; the website form (the snippet, the embed-origins setting, Turnstile keys, nginx's new `/forms/` location from `site.conf`); the starter contract is a placeholder — **have your contract reviewed before using it**; migrations 120–122.
- [ ] `docs/ROADMAP.md`: step 4 shipped; row 14 done; this plan linked.
- [ ] Full backend suite, then the full smoke suite (never at the same time; no code changes while they run), agent tests → pass (the known stale smoke failures named).
- [ ] Fresh reviewer over the step, fixes test-first, then push to `dev`.
- [ ] **Commit** `docs(sales): step 4, sales`

## Left to the executor (decide, record as a ruling)

Page and PDF layouts; email wording; the drawing pad (a plain `<canvas>`, no library); the starter template's text (plain, marked as a placeholder).
