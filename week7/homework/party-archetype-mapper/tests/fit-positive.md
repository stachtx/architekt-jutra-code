---
fixture: positive
expected: fit test passes
---

# Contract Service: Business Requirements

**Document owner:** Domain architecture team
**Status:** Draft for technical review
**Related systems:** Policy Administration (monolith), Agency Service, Customer Portal, Agent Portal, Audit Log

---

## 1. Background

Contract data currently lives inside the policy administration monolith. Six consuming applications
read it, and each one reimplements its own rules for deciding who is allowed to see which contract.
Those rules have drifted apart over eight years.

The drift is now visible to customers. Last quarter a regional manager raised a ticket because the
agent portal showed her contracts sold by a branch that had been moved out of her region eighteen
months earlier, while the reporting warehouse (reading the same database) correctly excluded them.
Neither behaviour was documented as intentional. Separately, an internal audit flagged that we cannot
answer, for any given contract lookup, whether the person who performed it was acting on their own
behalf or on behalf of a customer.

We are extracting contract management into a separate service with a single, centrally owned
visibility check that all six consumers call.

## 2. Glossary

| Term | Meaning |
|------|---------|
| **Contract** | A sold insurance policy. Has a validity period and a status. |
| **Customer** | The party that holds the contract. An individual or a company. |
| **Agent** | A person authorised to sell and service contracts on behalf of an agency. |
| **Agency** | A sales organisation. May be our own branch or an independent broker. |
| **Service session** | A time-boxed interaction in which an agent assists a named customer. |
| **Visibility check** | The decision on whether a given requester may see a given contract. |

## 3. Actors

| Actor | What they optimise for | Primary interaction |
|-------|----------------------|--------------------|
| Customer | Seeing their own policies, quickly, without calling anyone | Customer Portal, self-service |
| Agent | Servicing a customer on the phone without asking them to read out policy numbers | Agent Portal, during a service session |
| Agency manager | Understanding what their agency and everything under it has sold | Agent Portal, reporting views |
| Compliance officer | Reconstructing who saw what and when | Audit Log, ad-hoc queries |
| Consuming service | A correct yes/no answer to one visibility question, fast | Service API |

## 4. Functional requirements

### 4.1 Contract ownership and origin

1. Every contract is assigned to exactly one customer and to exactly one insurance agency: the
   agency that sold it.

2. A customer may be an individual or a company. Both hold contracts on identical terms and both
   must be able to use the customer portal. Roughly 8% of our book is corporate.

3. A contract has a validity period and a status. Expired and terminated contracts must remain
   retrievable in history, subject to exactly the same visibility rules as active contracts. There
   is no archive with looser access.

4. The agency that sold a contract does not change, even if the agency itself is later reorganised
   or closed. The sale is a historical fact.

### 4.2 Visibility

5. The service must perform a data visibility check before returning any contract or any list of
   contracts. No consumer is permitted to filter results itself.

6. A customer may see their own contracts and nothing else.

7. An agent may see contracts sold by their own agency.

8. Agencies form a hierarchy. An agency may have child agencies. A parent agency may view contracts
   sold by its children. It has not been decided whether this reaches only direct children or the
   entire subtree beneath the agency. Today's monolith does one of these, and nobody is certain
   which.

9. In addition, an agent may see a specific customer's contracts during a service session with that
   customer, regardless of which agency sold them. This is how the call centre works: the customer
   calls, is identified, and the agent needs their whole portfolio, not just the part their own
   agency sold.

10. A service session is bounded in time. It is opened when the agent identifies the customer and
    closed when the interaction ends or after a timeout. Outside an open session, the agent falls
    back to their normal agency-based visibility.

### 4.3 Agents and agencies

11. Agents are assigned to agencies. An agent serves customers within their own agency.

12. Agents move between agencies. When an agent transfers, they lose access to the previous agency's
    contracts, but contracts they personally sold remain attributed to the agency that sold them,
    not to the agent's current one.

13. Agency data and the agency hierarchy come from the Agency Service. That service is the
    company-wide source of truth for the structure and we must not maintain our own copy. Agency
    Service exposes a read API and publishes change events.

14. Agencies are occasionally reorganised. An agency is moved under a different parent, two agencies
    are merged, or a large agency is split into two. These events happen a handful of times per year
    and are planned in advance, but they are not rare enough to handle manually.

15. When a reorganisation happens, contracts sold before the change must remain accessible. Whether
    they become visible to the new parent or remain visible to the old one is an open question that
    the business has not answered. See section 7.

### 4.4 Identity

16. An agent has an agent number issued by the Agency Service. Agent numbers have been observed to
    be reused after a number of years when an agent leaves and the number is recycled.

17. A customer has a customer ID assigned by us. Individual customers additionally have a national
    ID number where they are domestic residents; foreign customers may have a passport number
    instead. Corporate customers have a company registration number.

18. It happens that an agent is also a customer of ours and holds their own contracts. The current
    monolith handles this with a special-case branch in the visibility code that has been the source
    of two production incidents. We do not want to carry that approach over.

19. A customer may exist in our system before they have any portal account. Most corporate customers
    never register for the portal at all; they are serviced entirely through their agent.

### 4.5 Audit

20. Every access to contract data must be logged. Where an agent acts during a service session, the
    log must make clear both who performed the lookup and whose data was shown. Compliance has
    stated that a log which records only "user X read contract Y" is insufficient.

21. Compliance must be able to answer, for a date in the past: which agents were able to see a given
    contract on that date, and on what basis: their own agency, a parent relationship, or a service
    session.

## 5. Non-functional requirements

- The visibility check is on the hot path of every contract read. Target p99 under 50 ms.
- Agency Service is available at 99.5%. This service targets 99.9%, so it cannot fail whenever
  Agency Service is unavailable, but it also cannot serve contracts to the wrong people.
- Audit records are immutable and retained for ten years.

## 6. Sample scenarios

**S1: Customer self-service.** Anna logs into the customer portal and sees three policies: two motor
policies bought through the Kraków branch and one travel policy bought online. She sees no other
contracts.

**S2: Call centre.** Anna calls. Agent Marek, who works at the Gdańsk branch, identifies her and
opens a service session. He sees all three of her policies, including the two sold by Kraków. When he
closes the session, those two disappear from his view.

**S3: Agent who is a customer.** Marek himself holds a household policy sold by the Gdańsk branch. In
the agent portal he sees it because his agency sold it. In the customer portal, logged in as himself,
he also sees it because he holds it. Both are correct and it is the same contract.

**S4: Regional oversight.** The Pomerania regional agency has four branches beneath it, one of which
has two sub-branches of its own. The regional manager expects to see everything sold in the region.
Whether the two sub-branches are included is exactly the ambiguity in requirement 8.

**S5: Reorganisation.** In March, the Sopot branch is moved from the Pomerania region to the newly
created North region. In April, someone asks for last year's sales figures for Pomerania. It is not
currently defined whether Sopot's historical contracts appear in that number.

## 7. Open questions from the business

These are known to be unresolved and are deliberately recorded rather than guessed:

- Does a parent agency's visibility reach only direct children or the whole subtree? (Req. 8)
- After a reorganisation, do historical contracts follow the new structure or stay with the old?
  (Req. 15, scenario S5)
- Does an agent in a service session see exactly what the customer sees, or a superset that includes
  internal annotations not shown in the customer portal? (Req. 9)
- May a service session be opened without the customer being present, for example to prepare for a
  scheduled callback? Compliance has concerns.
- When an agent leaves the company entirely, do their historical audit entries remain attributable?

## 8. Out of scope

- Contract creation and underwriting, which remains in policy administration
- Premium calculation and billing
- Claims handling
- Customer portal authentication
