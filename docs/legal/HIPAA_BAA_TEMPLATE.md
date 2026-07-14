# HIPAA Business Associate Agreement — DRAFT TEMPLATE (not legal advice, not for execution)

> See [README.md](./README.md) in this folder before using this document.
>
> **Read this first: do you actually need a BAA?** A BAA is only required if
> ISW meets HIPAA's definition of a "Business Associate" for a given
> Customer — i.e. the Customer is a "Covered Entity" (a healthcare provider,
> health plan, or clearinghouse) and ISW creates, receives, maintains, or
> transmits **Protected Health Information (PHI)** on that Customer's behalf.
> A home-health or clinical-staffing agency's *workforce* scheduling/PTO/
> payroll data (employee names, shifts, hours, pay rates) is generally
> **employment data, not PHI** — PHI is patient health information, not
> employee HR data. Whether ISW ever touches PHI depends entirely on how a
> given Customer uses the product (e.g. if shift notes, messages, or uploaded
> documents ever reference patient information). **This threshold
> determination must be made by a healthcare-compliance attorney, per
> Customer, before this template is used** — do not assume a BAA is needed or
> not needed without that review.

**This Business Associate Agreement ("Agreement")** is entered into between
[Company Legal Name] ("Business Associate") and [Covered Entity Legal Name]
("Covered Entity"), effective as of [Effective Date].

## 1. Definitions

Terms used in this Agreement — "Protected Health Information" (PHI),
"Electronic PHI" (ePHI), "Covered Entity," "Business Associate," "Required by
Law," "Secretary," "Subcontractor," "Breach" — have the meanings given under
the HIPAA Privacy, Security, and Breach Notification Rules (45 C.F.R. Parts
160 and 164), as amended. [Confirm against current regulatory text at time of
execution.]

## 2. Permitted uses and disclosures of PHI

Business Associate may use or disclose PHI only:

- To perform the functions, activities, or services specified in the
  underlying services agreement with Covered Entity, provided such use or
  disclosure would not violate the Privacy Rule if done by Covered Entity
  itself
- As Required by Law
- For Business Associate's proper management and administration, or to carry
  out its legal responsibilities, subject to the conditions in 45 C.F.R.
  § 164.504(e)(4)

[Insert the specific scope of services under which PHI would be
handled — this must match what the product actually does for this Customer.]

## 3. Safeguards

Business Associate will implement administrative, physical, and technical
safeguards that reasonably and appropriately protect the confidentiality,
integrity, and availability of ePHI it creates, receives, maintains, or
transmits on behalf of Covered Entity, consistent with the HIPAA Security
Rule (45 C.F.R. Part 164, Subpart C). [Insert reference to actual technical
controls once verified — e.g. encryption in transit/at rest, access controls,
audit logging — do not assert controls that have not been confirmed to be in
place.]

## 4. Reporting

Business Associate will report to Covered Entity, without unreasonable delay
and in no case later than [X business days] after discovery, any:

- Use or disclosure of PHI not provided for under this Agreement
- Security Incident of which it becomes aware
- Breach of Unsecured PHI, per the requirements of 45 C.F.R. § 164.410

[Insert specific notice mechanism/contact.]

## 5. Subcontractors

Business Associate will ensure that any subcontractor that creates, receives,
maintains, or transmits PHI on Business Associate's behalf (e.g. underlying
cloud infrastructure providers) agrees to the same restrictions and
conditions that apply to Business Associate. **Google Cloud/Firebase offers a
BAA to customers who enable it on their Google Cloud account** — [confirm
whether a Google Cloud BAA has actually been executed for the Firebase
project(s) backing this product before representing HIPAA-eligibility to any
Customer; if not executed, ISW is not yet in a position to store PHI in
Firebase in a HIPAA-compliant manner]. Stripe's role is limited to billing
and does not typically involve PHI.

## 6. Individual rights

Business Associate will make PHI available to support Covered Entity's
obligations to provide individuals access to, amendment of, and an accounting
of disclosures of their PHI, per 45 C.F.R. §§ 164.524, 164.526, and 164.528.
[Insert operational process/timeline once defined — verify what export/
correction tooling actually exists in the product.]

## 7. Return or destruction of PHI

Upon termination of the underlying services agreement, Business Associate
will, at Covered Entity's election, return or destroy all PHI received from,
or created/received on behalf of, Covered Entity, if feasible. If not
feasible, protections of this Agreement will extend to the retained PHI.
[Confirm actual data-deletion capability before committing to a timeline.]

## 8. Term and termination

This Agreement is effective as of the Effective Date and terminates when all
PHI is destroyed or returned, or upon termination of the underlying services
agreement, whichever is later. Covered Entity may terminate for material
breach if Business Associate does not cure within [X days] of notice.

## 9. Miscellaneous

[Insert interpretation clause (this Agreement controls over conflicting terms
in the underlying services agreement regarding PHI), amendment process, and
survival of obligations post-termination — counsel input required.]

---

**Signature blocks, effective dates, and all bracketed terms must be
completed and reviewed by counsel for both parties before execution. This
template does not constitute an executed or valid BAA in its current form.**
