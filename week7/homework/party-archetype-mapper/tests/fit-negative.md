---
fixture: negative
expected: fit test rejects
---

# Contract Renewal Service: Business Requirements

**Document owner:** Renewals operations
**Status:** Draft for technical review
**Related systems:** Policy Administration (monolith), Identity Service, Finance, Agency Directory

---

## 1. Background

Renewals are handled today by a batch job and a set of back-office screens bolted onto the policy
administration monolith. The job decides which contracts are due, generates renewal offers, and
updates statuses in place.

Two incidents forced this project. In February a batch run generated renewal offers for 4 100
contracts that had already been terminated, because the job read the status column without checking
how the contract had reached that status. In August a reconciliation found that the total unpaid
renewal premium reported to finance differed from the sum of the individual contract balances, and
nobody could reconstruct where the difference came from.

We are building a dedicated renewal service that owns the renewal lifecycle and the renewal premium
balance, with both recorded as append-only histories.

## 2. Glossary

| Term | Meaning |
|------|---------|
| **Contract** | A sold insurance policy that may become due for renewal. |
| **Renewal window** | The period before expiry during which a contract may be renewed. |
| **Renewal offer** | A proposal issued to the customer to continue cover for a further term. |
| **Outstanding balance** | Renewal premium invoiced but not yet paid on a contract. |
| **Lapse** | The state a contract reaches when the renewal window closes unaccepted. |

## 3. Actors

| Actor | What they optimise for | Primary interaction |
|-------|----------------------|--------------------|
| Back-office operator | Contracts not getting stuck in states nobody can move them out of | Renewal console |
| Supervisor | Reinstatements and write-offs not happening without a second pair of eyes | Approval queue |
| Auditor | Reconstructing how a contract reached its current renewal state | Read-only views |
| Finance | A balance figure that reconciles to the sum of its movements | Nightly extract |

## 4. Functional requirements

### 4.1 Renewal lifecycle

1. A contract in this service progresses through a defined renewal lifecycle: NOT_DUE, DUE,
   OFFER_ISSUED, OFFER_ACCEPTED, RENEWED, LAPSED, TERMINATED.

2. Which operations are permitted depends entirely on the current state:
   - A contract may move to DUE only from NOT_DUE, and only when the renewal window opens
   - An offer may be issued only from DUE
   - An offer may be accepted only from OFFER_ISSUED, and only before the window closes
   - A contract may move to RENEWED only from OFFER_ACCEPTED and only once the renewal premium is
     paid in full
   - A contract may LAPSE only from DUE or OFFER_ISSUED, when the window closes
   - A LAPSED contract may be reinstated back to OFFER_ISSUED within sixty days, with supervisor
     approval
   - A TERMINATED contract may not re-enter the lifecycle under any circumstances

3. The set of permitted transitions is the core business logic of this service. The February
   incident is the direct reason it exists: the batch job had no notion of legal transitions.

4. Every transition is recorded with a timestamp, the previous state, the new state, the trigger,
   and the user or system process that caused it. Transition records are append-only and are never
   edited or deleted.

5. Some transitions are automatic. A contract whose renewal window closes without an accepted offer
   moves to LAPSED overnight, with the batch process recorded as the trigger rather than a user.

6. The renewal window opens sixty days before expiry and closes on the expiry date. Window length is
   configured per product line, not per contract, per customer and not per agency.

### 4.2 Renewal premium balance

7. When an offer is issued, the renewal premium is invoiced and booked as an outstanding balance on
   the contract.

8. Payments received draw down the outstanding balance, oldest invoice first where several exist.

9. The premium may be revised while an offer is open, for example after a mid-term adjustment. Each
   revision is booked as a separate movement, never as an edit to the original booking.

10. The service must report the outstanding balance on any contract at any point, together with the
    complete history of every booking, revision and drawdown that produced that figure. This is the
    requirement the current batch job fails, and the reason for the August reconciliation gap.

11. The outstanding balance may never fall below zero. A payment exceeding the balance is rejected
    and routed to finance as an overpayment.

12. Balances on LAPSED contracts that remain unrecovered are written off at the end of the financial
    year and do not carry into the next one. The write-off is itself a booking, so the history
    remains complete.

### 4.3 Access

13. A user account has exactly one role, assigned at account creation: OPERATOR, SUPERVISOR or
    AUDITOR. The role is the same across the whole platform and does not vary by contract, by
    product line or by agency.

14. OPERATOR may trigger ordinary transitions and issue offers. SUPERVISOR may additionally approve
    reinstatements and balance write-offs. AUDITOR has read-only access and may trigger nothing.

15. All back-office users see all contracts in the renewal queue. There is no per-user or per-agency
    filtering; the renewal team operates centrally and works the whole book.

16. Contracts flagged UNDER_LEGAL_REVIEW are hidden from the queue and are visible only to users
    holding the SUPERVISOR or AUDITOR role. The flag is set manually by a supervisor.

17. User accounts, their roles and their activation status come from the corporate Identity Service.
    We read them; we do not manage accounts and we do not assign roles.

### 4.4 Reference data

18. Each contract carries the identifier of the customer who holds it and the identifier of the
    agency that sold it. Both are copied in at registration.

19. Agency names and the agency tree are fetched from the agency directory once a night and cached.
    They are used to populate a filter dropdown on the renewal console and to print agency names on
    operational reports. No renewal rule depends on the agency, its parent, or the agent who sold
    the contract.

20. Where a renewal completed, the identifier of the successor contract is stored alongside the
    predecessor.

## 5. Non-functional requirements

- The nightly window and lapse batch processes the full book, currently 2.4 million contracts,
  inside a four-hour window.
- Balance figures must reconcile exactly against finance. Discrepancies are a regulatory finding.
- Transition history and booking history are both append-only and retained for ten years.

## 6. Sample scenarios

**S1: Ordinary renewal.** A contract expiring on 30 June moves to DUE on 1 May. An offer is issued on
3 May and the renewal premium of 1 240 is booked. The customer pays on 20 May, the balance reaches
zero, and the contract moves to OFFER_ACCEPTED and then RENEWED.

**S2: Lapse and reinstatement.** A contract moves to DUE, an offer is issued, and the customer does
not respond. On the expiry date the batch moves it to LAPSED with 980 outstanding. Six weeks later
the customer calls and pays; a supervisor approves reinstatement and the contract returns to
OFFER_ISSUED.

**S3: Terminal state.** A contract is TERMINATED mid-term after the customer cancels. Two months
later the renewal batch runs. The contract is not picked up, because TERMINATED is terminal and no
approval level can move it back into the lifecycle.

**S4: Partial payment.** A contract carries 1 800 outstanding across two revised invoices. A payment
of 1 100 is applied to the older invoice in full and the newer in part, leaving 700. The contract
stays in OFFER_ISSUED and does not progress to RENEWED, because full payment is required.

## 7. Open questions from the business

- Should the sixty-day reinstatement window be configurable per product line, as the renewal window
  is, or is one value acceptable across the book?
- When a contract is reinstated after part of its balance was written off, is the written-off amount
  restored?
- Should the nightly batch run per product line to shorten the window, or remain a single pass?

## 8. Out of scope

- Contract content, cover terms and underwriting, which remain in policy administration
- Premium calculation itself; this service records the figure it is given
- Payment execution and refunds
- Customer and agent communications
