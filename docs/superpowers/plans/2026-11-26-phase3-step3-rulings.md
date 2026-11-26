# Phase 3, step 3 — decisions made while building

Calls made during the build of [the step 3 plan](2026-11-26-phase3-step3-agreements-invoicing.md), each with what it costs if it's wrong, and the minor review findings left for later. The owner can overrule any of them.

## Rulings

Pre-flight: T1→T3 quantityFor/activeAgreement — consistent. T2→T3 createDraft/claimItems/sendInvoice — consistent. T2→T4 sendInvoice issues token+email in T4 — T2 ships sendInvoice without email; T4 adds the pay token + invoice_sent email. Ruling: T2 creates payTokenHash columns but issues the token in T4 — keeps T2 free of public routes — cost if wrong: none.
- **Pre-flight:** Refunds of credit (no Stripe) by check post Dr 2200 / Cr 1000 via a Refund row with paymentId null and companyId — the plan's Refunds table requires paymentId; made nullable with companyId — cost if wrong: one column.
- **Task 1:** license counts need the Graph application permission Organization.Read.All, which the portal app (User.Read.All, GroupMember.Read.All) lacks — any Graph failure falls back to the typed count (source 'manual'); UPGRADING (Task 9) tells the owner to add it and re-consent — cost if wrong: counts are typed until then.
- **Task 1:** devices "in service" = asset status active, in_repair or on_hold; retired, lost, in storage and ready-to-issue aren't billed — cost if wrong: one list.
- **Task 1:** merging two companies that both have an active agreement → 409 AGREEMENT_EXISTS (cancel one first); a company with an agreement can't be deleted (409 COMPANY_IN_USE); the merged-away SLA's agreements point at the kept company's SLA — the plan said only "agreements follow the company" — cost if wrong: one extra click for the admin.
- **Task 1:** an agreement is for a client (or the internal company); editing replaces the lines, a line sent back with its id and same kind keeps its billing history (lastBilledQuantity, hours balance) — cost if wrong: catch-up/prepaid balances reset on edit.
- **Task 2:** invoiceLineId on TimeEntries/ProjectMaterials/Expenses now has a real FK (SET NULL); three step-1/2 tests that faked billing with invoiceLineId: 1 now set only billingStatus 'billed' (the lock is the status) — cost if wrong: none.
- **Task 2:** a line given no tax category takes the seeded category for its kind (agreement → Managed services, license → Licenses, labor/after-hours/overage → Remote support, trip → On-site labor, material/expense → Parts and equipment, fees → Fees); a missing seeded category → 400 — never untaxed — cost if wrong: a CPA picks other defaults.
- **Task 2:** credit notes have their own sequence (CN-1001…, `money.creditNotePrefix/NextNumber`) so invoice numbers have no gaps; a credit note can't be voided, and an invoice with credit notes can't be voided (409 HAS_CREDIT_NOTES) — cost if wrong: one extra invoice to undo a credit.
- **Task 2:** an invoice whose total is 0 (all covered) is marked paid as it's sent and posts nothing (the ledger refuses empty entries) — cost if wrong: none.
- **Task 2:** the next invoice/credit-note number can only be raised in settings (a number once given is never given again); prefixes 0–10 of A–Z, 0–9, dash — cost if wrong: none.
- **Task 2:** invoices follow a company merge (counted in the merge preview); a clashing run period on the merged-away company's invoice is cleared so the kept company's stays the month's; a company with invoices can't be deleted — cost if wrong: none.
- **Task 3:** first-month proration and catch-up carry the fraction in the line's quantity (count × days ÷ days-in-month, 4 dp), price unchanged, so amount = cents(quantity × price) as on every line — matches per-line cents(count × price × days ÷ month) to the cent for the plan's figures; a rare 1-cent difference is possible with odd prices — cost if wrong: a cent.
- **Task 3:** whether time is covered is decided by the agreement in force on the entry's date; an agreement with only a prepaid-hours line isn't "coverage" — its customer's labor follows the event rules and is drawn from the block (a call that crosses the block's end is billed as one overage line for the part past it, claiming that call's entries); after-hours and trip charges are billed normally — cost if wrong: prepaid customers' trip charges.
- **Task 3:** catch-up uses AgreementLines.lastBilledQuantity, set when a draft is built; deleting a run draft does not restore it (the next draft may miss one month's catch-up) — cost if wrong: one month's catch-up for an added person, fixable by hand.
- **Task 3:** project time, materials and expenses stay off the run until step 5 (project billing picks fixed/T&M/stages); the run bills ticket work only — cost if wrong: T&M projects billed by hand until step 5.
- **Task 3:** `money.refundLeavers` not added — the owner's decision is "leavers drop off with no refund", which needs no setting; catch-up is a setting (`money.catchUpAdditions`, on) — cost if wrong: one setting later.
- **Task 3:** per-job (on_close) customers are drafted from the main ticket-update path when a ticket moves into a closed status (not on quiet merge-closes); other close paths (bulk, portal) leave the work for a manual draft — cost if wrong: a ticket closed in bulk isn't drafted automatically.
- **Task 3:** the run skips the internal company; a company whose draft fails is listed as skipped with the reason and the run carries on — cost if wrong: none.
- **Task 4:** stripe@23.1.0 pinned (released 2026-10-29, the newest stable release over two weeks old).
- **Task 4:** the pay link opens only sent/partly-paid invoices (paid, void, expired and unknown tokens all get the same 404 PAY_LINK_INVALID); 180 days; re-emailing issues a new token and the old one stops working; Stripe's success/cancel pages are /pay/thanks and /pay/cancelled so the token never goes to Stripe — cost if wrong: a customer who returns to a paid invoice's link sees "not valid".
- **Task 4:** the online-payment fee (`money.cardFeePercent`, default 0, max 10 %) applies to any Stripe Checkout payment, card or bank (Checkout can't price the method before the customer picks it); it's its own line and posts to 4300 — cost if wrong: owner may want it card-only (needs a two-step flow).
- **Task 4:** a refund of a payment takes back, in order, what went to credit (Dr 2200), then what paid the invoice (Dr 1100, the invoice is owed again), then the online fee (Dr 4300); refusing when the credit part has since been used — cost if wrong: a refund needs splitting by hand.
- **Task 4:** credit refunds have no payment: Refunds.paymentId is nullable with companyId and fromCredit (pre-flight ruling applied); credit applied to an invoice is a Payment of method 'credit' and can't itself be refunded (issue a credit note) — cost if wrong: none.
- **Task 4:** invoices are emailed to the bill-to contact, else the company's portal admins; with neither, sending succeeds and the response says it wasn't emailed (delivery.reason) — cost if wrong: staff must pick a bill-to contact.
- **Task 4:** Stripe's fee is read from the payment intent's balance transaction when the payment succeeds; if Stripe can't be reached the fee is recorded as 0 and logged — cost if wrong: one fee entry by hand.
- **Task 4:** ledger.balances() now accepts a transaction, so credit checks inside a payment's transaction read consistently — cost if wrong: none.
- **Task 4:** invoice emails' subjects name the invoice, not a ticket: emailTemplates unit test's "subjects name the ticket" rule now excepts invoice_ templates as it does portal ones.
- **Task 5:** each reminder email issues a fresh pay link (only hashes are stored, so the old token can't be resent); the newest email's link works, older ones stop — cost if wrong: a customer clicking an old email's link sees "not valid".
- **Task 5:** reminders are claimed (remindersSent) under a row lock before the email goes, so two runs never both send one; a reminder that fails to send isn't retried — cost if wrong: one missed reminder on a mail outage.
- **Task 5:** reminder and late-fee settings: reminderDaysBefore 0–60 (0 = none), reminderDaysLate up to 5 values 1–365, lateFeeType none/flat/percent (percent ≤ 25), lateFeeAfterDays 1–365; a percent fee is of what's still owed — cost if wrong: none.
- **Task 6:** the portal shows sent, partly paid and paid invoices (not drafts or voided ones); paying from the portal returns to the portal's Invoices page — cost if wrong: none.
- **Task 7:** who decides a week: holders of money.timesheets.approve in the person's department; those who also see everyone's reports (reports.view_all — admins) decide for everyone. time.manage_others can't be the signal: department managers hold it too. Nobody decides their own week (403) — cost if wrong: a role tweak.
- **Task 7:** the lock binds the entry's owner only; a manager (or anyone allowed to change someone's time) may still correct a locked week's entry, audited as every time change is; the timer's stop is refused like any entry in a locked week — cost if wrong: none.
- **Task 7:** no "reminder day" setting: the hourly check reminds once (remindedAt) for last week as soon as a new week starts, to everyone who logged time in it and hasn't submitted; `timesheets.weekStartsOn` (default Monday) is read from SystemSettings — cost if wrong: one setting later.
- **Task 8:** the company's Billing tab (Setup › Billing) gains the agreement, invoices, payments and unused credit while Customer billing is on, rather than a new top-level tab — cost if wrong: one tab.
- **Task 8:** a credit note from the screen is one line of the amount entered (kind fee, so 0 % taxable, posted to 4300); the API takes any lines — cost if wrong: credits for taxed work need the API or a later form.
- **Task 8:** Money is in the sidebar for billing.view/billing.manage holders too; with Customer billing off and no other money permission it says how to turn it on — cost if wrong: none.
- **Task 8:** staff can also make an invoice by hand (Invoices › New invoice); the portal shows Invoices only when /me says Customer billing is on — cost if wrong: none.
- **Final:** a refund Stripe has already made is always recorded even when the customer's credit from it was used; their credit (2200) goes below zero (they owe it) and a warning is logged — the books then match Stripe — cost if wrong: staff must chase the negative credit.
- **Final:** an invoice is emailed, and its new pay link put in force, only when the email goes; an invoice sent with no recipient has no working link until it's emailed again — cost if wrong: staff press "Email again" after setting a bill-to contact.
- **Final:** billing in advance means an agreement known on the 1st has its partial first month billed on that run; one signed later has it on the next run with that month's fees. A cancelled agreement's never-billed last days are billed on the next run. Four existing tests' expectations changed to match (cancelled stub, prepaid December fee, preview total, credit note applied).
- **Final:** the SLA migration test now rolls back migrations 115+ around itself (agreements point at SlaPolicies); its earlier failure cascaded into 130 suites.

## Fixed after the review

- C1 covered/on-invoice time freed by an edit — money.step3Fixes 'C1: covered time on an invoice is locked' RED→GREEN (pre-fix code: 11 of 12 fix tests failed; the 12th is a guard that already held).
- I1 Stripe refund made before PRISM's checks — 'I1: a refund PRISM can't record never reaches Stripe…' RED→GREEN.
- I2 prepaid balances (months with no work, per-job tickets, deleted drafts) — both 'I2' tests RED→GREEN. Draws are stored on invoice lines (migration 119) and the balance is worked out from non-void invoices; AgreementLines.hoursBalanceMinutes is no longer used.
- I3 first-month days lost — 'I3: an agreement signed after the 1st…' RED→GREEN. Each run bills every agreement from the day after it was last billed through (from non-void invoices) to the month's end, month by month.
- I4 credit note not lowering its invoice — 'I4' RED→GREEN.
- I5 pay link changed when no email went — 'I5' RED→GREEN.
- I6 late fee on a late fee — 'I6' RED→GREEN.
- I7 merging a customer with payments failed — 'I7' RED→GREEN.
- I8 billing run ignoring company reach — 'I8' RED→GREEN (the run needs reach over all companies).
- I9 webhook taking any session — 'I9' RED→GREEN (metadata.source 'prism' and the business's currency required).

## Deferred minor findings

- M1 proration in the quantity can be off by a few cents on large flat fees (e.g. $2,500 × 17/31 → 1371.00 vs 1370.97) — fix: prorate the price instead.
- M2 HAS_PAYMENTS message names "move to credit", which has no operation; an invoice paid by credit can only be credited, not voided.
- M3 the pay link offers online payment when the webhook secret isn't set (payments then go unrecorded).
- M4 invoice and credit-note prefixes can be set equal, so a number clash 500s.
- M5 a hand-made invoice line's agreementLineId isn't checked against the invoice's company.
- M6 Microsoft Graph is called while the run holds the company row lock.
- M7 a pending bank payment doesn't pause reminders or late fees.
- M8 approvers see weekly totals only, not the days.
- M9 a 1st missed entirely (PRISM down all day) skips that month's automatic run without notice (it can be run by hand).
- M10 Stripe refunds still pending are recorded; a later refund.failed isn't handled.
- M11 voiding an invoice leaves its late-fee invoice open and doesn't restore catch-up counts.
- M12 a credit note from the screen is a 0 %-tax fee line, so crediting taxed labor doesn't reduce sales tax.
- M13 sending accepts any invoice date (backdating unlimited).
