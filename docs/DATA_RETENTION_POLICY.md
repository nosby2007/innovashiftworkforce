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
| Time entries (clock in/out, GPS, breaks) | `orgs/{orgId}/timeEntries` | 7 years from `checkInAt` | Covers FLSA (29 CFR 516.5–516.6: 2–3 yrs) and IRS employment tax records (4 yrs) with margin for stricter states (e.g. NY: 6 yrs) | Not yet — see §3 |
| Payroll runs (period locks) | `orgs/{orgId}/payrollRuns` | 7 years from period end | Same basis as time entries — these are the payroll register for that period | Not yet — see §3 |
| PTO/accrual ledger | `orgs/{orgId}/accrualLedger` | 7 years from `createdAt` | Same basis — part of the payroll record trail | Not yet — see §3 |
| Time-off requests | `orgs/{orgId}/requests` | 7 years from `createdAt` | Same basis — decision trail behind paid leave | Not yet — see §3 |
| Employee identity/tax documents (W-4, W-2, ID, certifications) | `orgs/{orgId}/employeeDocuments` + Storage `.../documents/**` | 7 years after employment ends (`revokedAt`) | Aligned with payroll record retention; these documents substantiate payroll/tax filings for the employment period | Not yet — see §3 |
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

`enforceDataRetention` (new scheduled Cloud Function, runs daily) currently
purges only the four categories marked "Yes" above: direct deposit,
expired audit logs, expired client error logs, and expired rate locks.
These were chosen first because none of them carry a real legal retention
floor that a wrong number could violate — audit-log purging only removes
records *past* HIPAA's own 6-year ceiling, and the other three have no
floor at all.

Time entries, payroll runs, the PTO ledger, time-off requests, and employee
documents are **not yet auto-deleted**, on purpose: those are the
categories with an actual legal minimum, and getting the number wrong in
either direction is a real problem — too short is a compliance violation,
too long defeats the point of having a policy. Enabling automated deletion
for those requires:

1. Confirming the exact retention figure per org (or per org's
   `countryCode`/`taxProfile`, since a US org and a Cameroon org may have
   different legal floors) — likely needs a per-org override field on
   `orgs/{orgId}` similar to how tax defaults already work, rather than one
   global constant.
2. Legal sign-off on the confirmed figures.
3. Only then extending `enforceDataRetention` (or a follow-up function) to
   cover them, almost certainly behind an explicit "retention enforcement
   enabled" toggle per org so a customer's legal/finance team opts in
   deliberately rather than records disappearing by default.

## 4. Deletion mechanics

`enforceDataRetention` follows the same pattern as the existing
`cleanupArchivedNotifications` sweep: an `onSchedule` Cloud Function running
once daily, walking `orgs/{orgId}` and its subcollections rather than a
Firestore collection-group query, so it doesn't require any new composite
or collection-group index. Deletions are hard deletes (not soft/archive),
since everything it currently touches is either past a compliance ceiling
(audit logs) or has no retention value at all (bank info post-termination,
diagnostics, rate locks).
