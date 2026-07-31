# Security & HIPAA Compliance Plan

This document tracks InnovaShift Workforce's security posture against the
HIPAA Security Rule (45 CFR Part 164, Subpart C) and general application
security best practice. It is a living checklist, not a one-time audit —
update it whenever a new PHI/PII-adjacent feature ships or a gap gets
closed.

**Scope note on PHI**: this app does not store clinical/diagnostic data.
The PHI/PII-adjacent data it does hold is: employee identity documents
(name, address, SSN via W-4/W-2 fields), direct-deposit bank account
numbers, GPS location at clock-in/out, and time-off *type* (PTO vs. sick —
which implies but does not detail a health condition). Treat that last
category as PHI-adjacent for a **covered entity or business associate**
customer (e.g. a home health agency), since "employee took sick leave" tied
to an identifiable person is the kind of data HIPAA's minimum-necessary and
access-control principles are meant to protect, even though it is
workforce/HR data rather than a patient record.

---

## 1. Where things stand today (already implemented)

### Technical safeguards
- **Role-based access control** enforced server-side in `firestore.rules`
  and `storage.rules`, not just hidden in the UI. Two tiers: `isOrgAdminLike()`
  (admin/manager/scheduler/hr — operational access) and the narrower
  `isAdminOrHR()`/`isOrgAdminOrHR()` (payroll, PTO decisions, employee
  identity documents, direct deposit — discretionary/sensitive data).
- **Cloud-Functions-only writes** for every workflow where client-side
  tampering could bypass a business rule: shift lifecycle, time entry
  corrections/deletion, time-off approval, employee document review,
  role/claims assignment. The client can create initial records but
  never mutate their approval state directly.
- **Audit logging** (`writeAudit()` → `orgs/{orgId}/auditLogs`) on every
  role/permission change, payroll-adjacent decision, and document review;
  visible to org admins via the Audit Log page and to platform super-admins
  across all orgs via `getGlobalAuditLogs`. Audit log documents are
  Cloud-Functions-write-only (`allow write: if false` in rules) so they
  can't be edited or deleted by anyone, including admins.
- **Masked PII display**: direct-deposit account numbers show only the
  last 4 digits everywhere except the employee's own profile view
  (`maskLast4()`), with an explicit admin-only "Reveal" toggle rather than
  showing the full number by default.
- **Secrets management**: all third-party API keys/webhook secrets
  (Stripe, SendGrid, OpenAI, the push-notification action-token signing
  key) are bound via `defineSecret()` / Google Secret Manager, never
  committed to the repo or stored in a `.env` file that ships to CI.
- **Signed, single-use, short-lived tokens** for the one auth-free HTTP
  surface (push-notification "Accept shift" deep link) — HMAC-SHA256
  signed, 15-minute TTL, timing-safe comparison, and a Firestore
  atomic-create used as a single-use lock.
- **2FA (TOTP)** available and user-enrollable from Staff Profile → Security.
- **Biometric/device app-lock** (native biometric via Capacitor, WebAuthn
  on web) re-locks the app on resume.
- **Encryption in transit**: all traffic is HTTPS (Firebase Hosting +
  Cloud Functions enforce TLS; no HTTP fallback).
- **Encryption at rest**: Firestore, Cloud Storage, and Secret Manager
  encrypt at rest by default under Google Cloud's platform-level encryption
  (AES-256) — this is a Google Cloud platform guarantee, not something this
  app's code configures, and should be *cited*, not re-implemented.
- **Dependency hygiene**: `npm audit` run against both the frontend and
  backend; all reachable *critical* vulnerabilities were resolved (see
  §4 Appendix). Remaining moderate/high findings are all several major
  versions deep in transitive chains (`firebase-admin`, `firebase`, `uuid`)
  and are tracked as scheduled major-version upgrades rather than forced
  through blind, breaking `npm audit fix --force` runs.

### Administrative safeguards
- Role model maps cleanly to HIPAA's "minimum necessary" principle:
  staff see only their own records; manager/scheduler see operational
  data org-wide but not payroll/PTO decisions or identity documents;
  admin/hr see everything relevant to their org; platform super-admin is
  a separate, narrower shell (`/platform`) distinct from any single org.
- Every sensitive state transition (role grant, PTO decision, time-entry
  deletion, document verification) requires an authenticated actor and is
  attributed to that actor's `uid` in the audit trail — supports HIPAA's
  accountability requirement.

### Physical safeguards
- Fully delegated to Google Cloud Platform (Firebase's underlying
  infrastructure) — GCP data centers carry SOC 2, ISO 27001, and (with a
  signed BAA) HIPAA-eligible physical security controls. This app has no
  on-premises servers to secure.

---

## 2. Gaps closed in this pass (2026-07-19 DevSecOps audit)

| Finding | Severity | Fix |
|---|---|---|
| `adminSetUserClaims` let **any** org-admin-like caller (manager/scheduler/hr, not just admin) grant themselves or anyone else the `admin` accessRole, directly via the callable — a straight privilege-escalation path bypassing the UI, which only ever exposes this to platform super-admins. | **Critical** | Restricted the non-super-admin path to `accessRole === 'admin'` only. |
| `adminManageUserMembership` let any manager/scheduler revoke or suspend an `admin`/`hr` account in their own org (no check that the caller outranks the target). | **High** | Added a check requiring admin/hr to act on an admin/hr target. |
| `requests` (time-off) collection's Firestore `create` rule never enforced `status == 'pending'`, `paid`, or `payRate` — a client could write a pre-approved, pre-priced leave request directly, bypassing `decideTimeOffRequest`'s approval workflow and injecting fabricated paid leave into payroll. | **High** | Rule now requires `status == 'pending'` and rejects `paid`/`payRate`/`decidedAt`/`decidedBy` on create. |
| `timeEntries` Firestore rules allowed `isOrgAdminLike()` to `update` and `isAdmin()` to `delete` directly via client SDK, even though every legitimate mutation path already goes through Cloud Functions (`checkIn`/`checkOut`/`approveTimeCorrection`/`deleteTimeEntry`), which enforce audit logging and finalized-pay-period locks that a direct client write would skip. | **Medium** | Tightened both to `if false` (Cloud-Functions-only), matching the pattern already used for `shifts`/`accrualBalances`/`accrualLedger`. |
| `orgs/{orgId}` Firestore `update` rule let any manager/scheduler modify org-wide payroll settings (tax defaults, 401(k) match %/provider, benefit plans, overtime multiplier, holiday policy) — conceptually admin/hr-tier data. | **Medium** | Added a `diff().affectedKeys()` check: admin/hr may update anything, manager/scheduler may update anything **except** the payroll-sensitive field list. |
| Employee identity/W-4/W-2/certification documents in Cloud Storage were governed by the same broad `isOrgAdminLike()` rule as ordinary per-user files (avatars, etc.), inconsistent with the matching Firestore `employeeDocuments` collection, which was already correctly scoped to admin/hr only. | **Medium** | Added a more specific Storage rule for the `.../documents/**` subpath restricting read/write to admin/hr + the owning employee. |
| Backend (`firebase-admin` chain) had a **critical** `websocket-driver` advisory reachable via `@firebase/database-compat`. | **Critical** | Pinned `websocket-driver` to `0.7.5` via `package.json` `overrides`; verified compatible with `faye-websocket`'s declared range. |
| Frontend had **3 critical** advisories (`protobufjs` RCE/DoS via `@grpc/proto-loader`←`firebase`; `shell-quote` via dev-only webpack-dev-server; a second `websocket-driver` path). | **Critical** | Resolved via non-forced `npm audit fix` (lockfile update only, no major version bumps). |

All fixes were validated with `npx tsc --noEmit`, `npx vitest run` (backend,
61/61), `npx ng build`, and `npx ng test --watch=false` (frontend, 81/81) —
all green after the changes.

---

## 3. Prioritized action items still open

### High priority — schedule soon
1. **Upgrade `firebase` (frontend) past `^10.0.0`.** Currently resolves to
   `10.14.1`; latest is `12.x`. The remaining moderate/high `undici`
   HTTP-client CVEs (header injection, request-queue poisoning, DoS) live
   in this dependency's bundled fetch implementation and can only be
   cleared by a major-version bump. Needs a manual regression pass (this
   sandbox has no way to smoke-test the built app against live Firebase
   after a major SDK bump) before shipping.
2. **Upgrade `firebase-admin` (backend) past `^13.6.0` when a non-breaking
   path exists**, to clear the remaining moderate `uuid` buffer-bounds
   advisories. `npm audit fix --force` currently wants to downgrade to
   `10.3.0` (3 majors back) — not worth doing; wait for/track an upstream
   fix release instead of forcing a downgrade.
3. **Extend `writeAudit()` coverage** to `updatePlatformOrg` (super-admin
   changing an org's plan/billing/tax profile) — every other admin-level
   mutation is audited; this one currently isn't.
4. **Formal password/session policy documentation.** Firebase Auth's
   defaults (session length, password complexity) are in effect but have
   never been explicitly reviewed/tightened for a HIPAA-adjacent posture —
   confirm minimum password length/complexity and consider enforcing a
   session-idle timeout in addition to the existing app-lock.

### Organizational — not code, needs a human decision/signature
5. **[IN PROGRESS] Sign a Business Associate Agreement (BAA) with Google
   Cloud/Firebase.** This has to be done by a human with the right GCP
   access — an AI agent has no console session and, more importantly, no
   authority to bind the company to a legal agreement. Steps, as of this
   writing:
   - **Google Cloud Console** (covers Firestore, Cloud Storage, Cloud
     Functions): sign in as an Organization Administrator or Project Owner
     on the `atlanta-e04aa` project → **IAM & Admin** → select the project
     → find **"Google Cloud Platform HIPAA Business Associate Addendum"**
     → **Review and Accept**. You only need to accept it once per Google
     Cloud account, not per project.
   - **Google Workspace/Cloud Identity Admin console**, if the org's Google
     account is on Workspace (needed if Workspace apps ever touch PHI):
     **Admin console** → **Account settings** → **Legal and compliance** →
     **Security and Privacy Additional Terms** → **Google
     Workspace/Cloud Identity HIPAA Business Associate Amendment** →
     **Review and Accept**.
   - Screenshot the acceptance confirmation and keep it — that screenshot
     *is* your proof of a signed BAA; Google doesn't issue a separate
     countersigned PDF for the self-service flow.
   - **⚠️ Related, separate action — also required**: HIPAA coverage under
     Google's BAA only extends to Google's published list of *Covered
     Products*. **Firestore, Cloud Storage, and Cloud Functions are
     covered — but plain Firebase Authentication is not.** The
     HIPAA-eligible equivalent is **Identity Platform**.
     **Good news, confirmed on a second pass**: this is *not* a code
     migration — it's another one-click console action, like the BAA
     itself. **Firebase Console → Authentication → Settings tab →
     "Upgrade to Identity Platform."** The existing client SDK
     (`firebase/auth`, used throughout `frontend-angular/src/app/core/firebase/firebase.app.ts`)
     and Admin SDK (`admin.auth()` server-side) keep working completely
     unchanged after the upgrade — confirmed by grepping the codebase for
     any tenant-ID/GCIP-specific assumptions that could break, and there
     are none. The only real consideration is billing: post-upgrade,
     Blaze-plan projects get 50,000 monthly active users free before
     metered billing starts, which this app is nowhere near yet. Do this
     right after (or same session as) accepting the BAA — same
     access level required, same "click a button" effort.
     Firebase Hosting was also not on the covered products list found
     during this research — lower risk than Auth since Hosting only
     serves the static JS bundle rather than storing PHI at rest, but
     confirm before relying on it for anything that renders PHI
     server-side.
6. **Sign or confirm a BAA with OpenAI** (used by `aiAssistantChat` — org
   user/shift names and timesheet summaries are sent to the OpenAI API as
   tool-call results). If a customer's data is PHI-adjacent, this needs
   OpenAI's enterprise/BAA-eligible tier, not the standard consumer API
   terms.
7. **Sign or confirm a BAA with SendGrid** (transactional email — invite
   links, demo-request notifications; no PHI in current email bodies, but
   confirm before that changes).
8. **Sign or confirm a BAA with Stripe** (billing only — Stripe never
   receives employee PII/PHI, only org-level billing contact info, so this
   is lower priority than the others but should still be tracked).
9. **Written breach-notification procedure.** HIPAA requires notifying
   affected individuals within 60 days of discovering a breach of
   unsecured PHI, plus HHS and (for 500+ affected) media notification.
   This needs an actual written runbook (who decides it's a breach, who
   drafts notifications, who contacts HHS) — not something code can
   provide.
10. **[DONE, pending real-world use] Data retention & deletion policy.**
    Full policy and rationale live in `docs/DATA_RETENTION_POLICY.md`.
    `enforceDataRetention` (daily scheduled function) always purges the
    categories with no legal retention floor to get wrong — direct-deposit
    bank info (90 days post-termination), audit logs (only past HIPAA's own
    6-year ceiling), client error logs, expired contact rate locks. For the
    categories with a real, jurisdiction-varying legal floor (time entries,
    payroll runs, PTO ledger, time-off requests, employee documents), Org
    Settings now has a **Data Retention** section where an admin/hr user
    enters a confirmed figure per category (all default to "keep forever"
    — nothing auto-deletes until explicitly set) and stamps who confirmed
    it and when. **What's still genuinely open is organizational, not
    code**: someone needs to actually get the per-jurisdiction figures
    confirmed by counsel and enter them — the engineering exists, the
    legal sign-off doesn't yet.
11. **Workforce security training.** HIPAA's Security Rule requires
    documented security awareness training for anyone with access to PHI
    — this applies to the customer organizations' own admin/hr users, not
    just InnovaShift's engineering team. Consider a short onboarding
    doc/checklist for org admins covering "don't share your login,"
    "reveal-account-number is logged," etc.
12. **Incident response plan.** A one-page runbook: who gets paged, how to
    rotate a leaked secret (`firebase functions:secrets:set` +
    redeploy), how to force-revoke a compromised user's session
    (`admin.auth().revokeRefreshTokens(uid)` — not currently wired to any
    UI action, worth adding as a super-admin/org-admin "force sign-out"
    button).

### Lower priority — good hygiene, not urgent
13. Consider Firestore TTL policies for `contactRateLocks` (already
    short-lived by design) and `clientErrorLogs` (currently unbounded).
14. Consider rate-limiting `aiAssistantChat` per-org (currently bounded
    only by `MAX_TOOL_ITERATIONS`/message-length, not call frequency) to
    control OpenAI cost/abuse exposure.

---

## 4. Appendix — dependency vulnerability detail (2026-07-19)

**Backend** (`backend-firebase-functions`): before → `{moderate: 9, critical: 1}`.
After pinning `websocket-driver` to `0.7.5` via `overrides`: `{moderate: 8,
critical: 0}`. Remaining 8 moderate findings are `uuid` v3/v5/v6 buffer-bounds
issues several layers deep in `gaxios → google-gax → @google-cloud/firestore
→ firebase-admin → firebase-functions`; not directly reachable by
attacker-controlled input in this app's own code, and the only fix path is
a 3-major-version `firebase-admin` downgrade, which was judged not worth
the regression risk. Tracked as action item #2 above.

**Frontend** (`frontend-angular`): before → `{low: 1, moderate: 33, high: 35,
critical: 3}`. After a non-forced `npm audit fix`: `{low: 1, moderate: 20,
high: 22, critical: 0}` — all 3 critical findings resolved without any
breaking change. The remaining moderate/high findings require either
bumping `firebase` two majors forward (action item #1) or downgrading
`exceljs` to `3.4.0` (which would undo an earlier, deliberate
security-motivated swap away from the `xlsx` package's own known
vulnerabilities — not worth reversing).

---

## 5. How to keep this current

- Re-run `npm audit` (both packages) monthly or whenever `package.json`
  changes; update §4 with the new counts.
- Any new Firestore/Storage collection or path must get an explicit rule —
  never rely on a catch-all. The `match /{allPaths=**} { allow read, write:
  if false; }` fallback in `storage.rules` and the absence of a
  wildcard-allow in `firestore.rules` are both intentional; keep them that
  way.
- Any new Cloud Function that mutates payroll, PTO, identity documents, or
  role/claims must call `writeAudit()` and must use `requireOrgAdminOrHr`/
  the narrowest role check that still lets the feature work — default to
  the narrower tier and widen only if a real workflow needs it, not the
  other way around.
