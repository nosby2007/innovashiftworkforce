# Data Retention & Deletion Policy

This defines how long InnovaShift Workforce keeps each category of data and
what happens when the retention window closes. It exists to satisfy two
things at once: legal minimums (payroll/employment records have real
retention floors) and HIPAA's data-minimization instinct (don't keep
sensitive data — especially bank account numbers — longer than there's a
reason to).

**⚠️ This is an engineering-drafted starting point, not a legal
determination.** The periods below are set to the most common/conservative
US federal and state figures because most of this codebase's tax-profile
work has been US-first so far. This app supports orgs in Canada, Cameroon,
Nigeria, Ghana, Kenya, South Africa, and the UAE (see `taxProfile` in
`updatePlatformOrg.ts`) — **each of those jurisdictions has its own
employment-record retention law, and none of them have been researched
here.** Before this policy is relied on for a non-US org, or presented to
a customer/auditor as final, have it reviewed by counsel licensed in the
relevant jurisdiction(s).

---

## 1. Retention schedule

| Data category | Where it lives | Retention period | Basis | Automated? |
|---|---|---|---|---|
| Time entries (clock in/out, GPS, breaks) | `orgs/{orgId}/timeEntries` | Suggested default 7 years from `checkInAt` (covers FLSA 29 CFR 516.5–516.6: 2–3 yrs, and IRS employment tax records: 4 yrs, with margin for stricter states like NY: 6 yrs) | Org-confirmed figure required — see §3 | **Org opt-in** — `enforceDataRetention`, only once `dataRetention.timeEntriesYears` is set |
| Payroll runs (period locks) | `orgs/{orgId}/payrollRuns` | Suggested default 7 years from period end | Same basis as time entries | **Org opt-in** — `dataRetention.payrollRunsYears` |
| PTO/accrual ledger | `orgs/{orgId}/accrualLedger` | Suggested default 7 years from `createdAt` | Same basis — part of the payroll record trail | **Org opt-in** — `dataRetention.accrualLedgerYears` |
| Time-off requests | `orgs/{orgId}/requests` | Suggested default 7 years from `createdAt` | Same basis — decision trail behind paid leave | **Org opt-in** — `dataRetention.timeOffRequestsYears` |
| Employee identity/tax documents (W-4, W-2, ID, certifications) | `orgs/{orgId}/employeeDocuments` + Storage `.../documents/**` | Suggested default 7 years after employment ends (`revokedAt`) | Aligned with payroll record retention | **Org opt-in** — `dataRetention.employeeDocumentsYearsAfterTermination` |
| **Direct deposit bank account info** | `orgs/{orgId}/users/{uid}/private/bankInfo` | **90 days after termination** (`revokedAt`) | No legal retention requirement for raw account/routing numbers once employment and final pay are settled — the single highest-sensitivity field in the app, so it gets the shortest window by design (data minimization) | **Yes** — `enforceDataRetention` |
| Audit logs | `orgs/{orgId}/auditLogs` | 6 years from `createdAt` | HIPAA Security Rule documentation retention ceiling, 45 CFR §164.316(b)(2)(i) | **Yes** — `enforceDataRetention` |
| Client-side error logs | `clientErrorLogs` (root) | 1 year from `createdAt` | Pure diagnostics, no legal floor — capped for hygiene | **Yes** — `enforceDataRetention` |
| Contact-form rate locks | `contactRateLocks` (root) | Already expires in 60s by design; doc itself now swept once past `expiresAt` | Pure abuse-prevention state, no retention value after expiry | **Yes** — `enforceDataRetention` |
| Demo/contact requests | `contactRequests` (root) | Not covered by this policy | Prospect CRM data, not employee/PHI-adjacent — out of scope here |
| Archived notifications | `orgs/{orgId}/userNotifications/{uid}/items` | 10 days after archive | Pre-existing (`cleanupArchivedNotifications`), unrelated to this policy | Yes — already shipped |

## 2. Why direct deposit gets its own (much shorter) rule

Every other category above has a real legal reason to exist for years — it
substantiates a tax filing or a wage dispute. A bank routing/account number
has no such life span: once someone's last paycheck has cleared, InnovaShift
has no further legitimate use for it, and it is the single most damaging
field in the app if it were ever exposed (routing + account number is
enough to attempt ACH fraud). Keeping it around after termination is pure
risk with no offsetting benefit, so it is purged automatically well before
any of the payroll-adjacent categories.

**Note on suspend vs. revoke**: the app's data model doesn't currently
distinguish a temporary suspension from a permanent revocation — both set
`active: false` and `revokedAt` identically (see `adminManageUserMembership.ts`).
The 90-day bank-info purge therefore applies to both. If an account is
reactivated after its bank info was purged, the employee simply resubmits
it via the self-service Direct Deposit form — this was judged an acceptable
tradeoff given 90 days is a generous grace period for an unresolved
suspension, but flag it if that assumption doesn't hold for a real case.

## 3. What's automated today vs. what's still manual

`enforceDataRetention` (scheduled Cloud Function, runs daily) always purges
the four categories with no legal retention floor to get wrong: direct
deposit, expired audit logs (only past HIPAA's 6-year ceiling), expired
client error logs, and expired rate locks.

Time entries, payroll runs, the PTO ledger, time-off requests, and employee
documents are different — those carry a real, jurisdiction-varying legal
minimum, so nothing about them is ever auto-deleted **by default**. Instead,
`orgs/{orgId}.dataRetention` holds five optional `*Years` fields (one per
category — see `admin-org-settings.page.ts`'s "Data Retention" section),
each defaulting to `null` (= keep forever). `enforceDataRetention` only
purges a category for an org once that org has explicitly set a number —
which should only happen after:

1. Confirming the exact retention figure with legal/compliance counsel for
   that org's jurisdiction (a US org and a Cameroon org may have very
   different legal floors — this app deliberately does not guess a number
   per `countryCode`/`taxProfile`, since none of those jurisdictions'
   specific retention laws have been researched here).
2. An admin/hr user entering that confirmed figure in Org Settings and
   clicking "Mark these figures as legally confirmed" (stamps
   `dataRetention.confirmedBy`/`confirmedAt` for an audit trail of who
   signed off and when — this stamp is informational only and does not
   gate enforcement; enforcement is gated purely by a `*Years` field being
   set).

Two extra safety details in the implementation:
- **Time entries**: never purges an entry with no `checkOutAt` (an open,
  unfinished punch), regardless of how old `checkInAt` is.
- **Time-off requests**: never purges a `status: 'pending'` request,
  regardless of age — a stale-but-unresolved request should surface as a
  data hygiene problem for the org, not silently disappear.
- **Employee documents**: only ever purges documents belonging to an
  already-terminated (`active: false`) user, past their
  `employeeDocumentsYearsAfterTermination` window from `revokedAt` — an
  active employee's documents are never touched regardless of age. This
  also deletes the underlying Cloud Storage file at the document's
  `storagePath`, not just the Firestore record.

## 4. Deletion mechanics

`enforceDataRetention` follows the same pattern as the existing
`cleanupArchivedNotifications` sweep: an `onSchedule` Cloud Function running
once daily, walking `orgs/{orgId}` and its subcollections rather than a
Firestore collection-group query, so it doesn't require any new composite
or collection-group index. Deletions are hard deletes (not soft/archive) —
for the unconditional categories because there's nothing left worth
keeping (past a compliance ceiling, or no retention value at all), and for
the confirmed-only categories because an org that set a `*Years` figure
has, by construction, already confirmed that figure is the legally correct
point to delete. Every purge in the confirmed-only tier writes a
`writeAudit()` entry (`RETENTION_PURGE_*`) so there's a permanent record of
what was deleted, when, and under which policy.
