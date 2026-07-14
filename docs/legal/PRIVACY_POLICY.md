# Privacy Policy — DRAFT (not legal advice, not for publication)

> See [README.md](./README.md) in this folder before using this document.
> Placeholders in `[brackets]` must be completed by the business and reviewed
> by a licensed attorney before this is shown to any customer or user.

**Effective date:** [Effective Date]
**Last updated:** [Effective Date]

## 1. Who we are

InnovaShift Workforce ("ISW", "we", "us") is a workforce scheduling and
payroll-support platform provided by [Company Legal Name], a [entity type]
organized in [Jurisdiction]. This policy describes how we collect, use, and
share information when an employer ("Customer") and its staff ("Users") use
ISW.

## 2. Information we collect

**Account & profile data** — name, email, phone, role (staff/manager/
scheduler/HR/admin), hire date, job title, and organization membership.

**Scheduling & attendance data** — shift assignments, shift-swap and
marketplace activity, clock-in/clock-out timestamps, and, where an
organization enables location-based attendance, **GPS coordinates captured at
the moment of clock-in/out** via the device's browser geolocation API. Location
is not tracked continuously or in the background — only at the specific
clock-in/out action, and only when the feature is enabled by the Customer.

**Time-off & accrual data** — PTO/sick-time requests, approval decisions,
accrual balances, and accrual ledger history.

**Payroll-adjacent data** — pay rates, hours worked, computed gross pay
figures, and pay-period assignment, to the extent the Customer uses ISW's
payroll views. **ISW is a payroll-support tool, not a payroll processor or
tax filer** — it does not move money, file taxes, or issue payments;
[clarify actual scope with counsel].

**Billing data** — subscription plan and billing status. Payment card details
are collected and stored directly by our payment processor, Stripe, Inc.; ISW
does not store full card numbers.

**Communications** — in-app messages and shift-related chat between Users
within the same organization.

**Documents** — files Users or admins upload (e.g. onboarding paperwork),
stored via Firebase Cloud Storage.

**Technical data** — device/browser type, IP address, and application error
logs, collected for security and reliability purposes.

## 3. How we use information

- Operate scheduling, shift marketplace, time-off, accrual, and payroll-support
  features
- Authenticate Users and enforce organization- and role-based access control
- Send in-app and (if enabled) push/email notifications about shifts, PTO
  decisions, and messages
- Process subscription billing through Stripe
- Maintain audit logs of sensitive actions (shift changes, PTO decisions,
  settings changes) for the Customer's own compliance and dispute-resolution
  needs
- Monitor and improve service reliability

We do not sell User information. We do not use User data to train third-party
AI models. [Confirm both statements remain accurate before publishing.]

## 4. Legal basis / employer relationship

Each Customer (employer) is the primary controller of its Users' data within
ISW; ISW acts as a data processor/service provider on the Customer's behalf.
Individual Users should direct data-subject requests (access, correction,
deletion) to their employer first; ISW will assist the Customer in fulfilling
such requests.

## 5. Data storage & subprocessors

ISW is built on **Google Firebase** (Firestore database, Cloud Functions,
Firebase Authentication, Cloud Storage, Firebase Hosting) and **Stripe**
(subscription billing). [List actual Firebase project region(s) and any other
subprocessors, e.g. email/SMS providers, once finalized.]

## 6. Data retention

[Define retention periods per data category — e.g. audit logs retained for
N years, accrual ledger retained for the employment relationship plus N years
for wage-and-hour compliance — with counsel input, since retention
requirements vary by jurisdiction and by whether HIPAA applies.]

## 7. Security

We apply role-based access control, per-organization data isolation
(multi-tenant security rules), and restrict sensitive write operations
(shift changes, PTO approvals, payroll data) to server-side functions rather
than direct client writes. [Add encryption-at-rest/in-transit statements,
incident response commitments, and any relevant certifications once verified.]

## 8. Location data specifics

Where a Customer enables GPS-based attendance verification, ISW captures a
User's device location only momentarily, at the point of clock-in/clock-out,
solely to verify attendance at an authorized worksite. Users should be informed
by their employer, prior to enabling this feature, that location will be
captured at those moments. [Confirm state-level consent/notice requirements
for workplace location tracking — these vary significantly by state.]

## 9. Children's privacy

ISW is intended for use by employed adults and is not directed to children.
[Confirm minimum age policy with counsel, especially for any Customers who may
employ minors under applicable labor law.]

## 10. Your rights

Depending on your jurisdiction, you may have rights to access, correct, or
delete your personal information, or to object to certain processing.
[Insert CCPA/CPRA, GDPR, or other applicable regional rights language once
your actual user base/jurisdictions are known.]

## 11. Changes to this policy

We will notify Customers of material changes to this policy. [Define notice
mechanism and timing.]

## 12. Contact

[Contact Email] / [Company mailing address]
