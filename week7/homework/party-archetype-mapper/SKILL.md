---
name: party-archetype-mapper
description: Transform domain requirements into a Party Archetype model. Identifies complexity level (1-9), designs Party and PartyType layer, Role and Relationship structure, Hierarchy traversal, temporal Validity, Visibility derivation, and external identity boundaries. Produces implementable model with explicit concept mapping and unmapped concepts sections.
argument-hint: "[domain requirements or feature description]"
---

# Party Archetype Mapper

Transform any domain where **who is related to whom** answers a business question into a structured party model. The parties do not need to be people. They can be organizations, branches, systems, or any entity that participates in relationships from which something is derived.

**Output goal**: A complete, implementable model that gives the system uniform treatment of people and organizations, roles that survive their first exception, hierarchy traversal with an explicit time dimension, and a visibility rule expressed as a graph traversal rather than a pile of conditions.

## When to Use

**Use this skill when:**
- A domain requires deriving something from relationships (not just storing a user record)
- The same entity can appear in different roles depending on context or counterparty
- Organizations form hierarchies and something flows along them: visibility, reporting, responsibility
- One party acts on behalf of another (assisted sessions, powers of attorney, guardianship, impersonation)
- Identity is fragmented across systems and must be reconciled

**Output is useful for:**
- Designing a service where users, organizations, and permissions meet
- Reviewing a schema where `role` appears as a column
- Domain modeling sessions before an identity, CRM, or brokerage module is implemented

## When NOT to Use: Fit Test

Before starting the mapping, apply this test. If the domain fails it, **stop and tell the user** that the party archetype does not fit, and briefly explain why.

### The core question

> *"Can the same party appear in different roles depending on who or what it is related to, and does 'what someone may see or do' follow from those relationships rather than from a single field on a record?"*

If **yes** → party archetype likely fits.
If the natural question is **"how much of X does Y have?"** → it's an accounting ledger. Use `accounting-archetype-mapper` instead.
If the natural question is **"how much does X cost for Y at time T?"** → use `pricing-archetype-mapper` instead.
If the natural question is **"what state is X in?"** → it's a state machine. Do not map.

### Signal table

Signals are stated as **shapes**, not as domain vocabulary. The same shape appears as brokers and
branches, as clinicians and departments, as suppliers and subsidiaries. Match on the shape.

| Signal shape in requirements | Likely archetype fit? |
|------------------------------|-----------------------|
| One entity provably occupies two roles at once | ✅ Yes |
| A role is qualified by a counterparty or a context ("X *of* Y", "X *within* Y") | ✅ Yes |
| Something flows along an organizational structure: reach, oversight, responsibility | ✅ Yes |
| One entity performs an action whose subject is a different entity | ✅ Yes |
| Individuals and organizations are described as interchangeable counterparties | ✅ Yes |
| Membership or assignment is described as changing over time | ✅ Yes |
| One entity carries identifiers issued by several different authorities | ✅ Yes |
| Roles are a closed global list fixed at account creation, invariant across context | ❌ No. RBAC over a CRUD user table |
| The tree is over artefacts or classifications rather than over actors | ❌ No. Taxonomy |
| A quantity accumulates, is drawn down, and must be audited | ❌ No. Accounting archetype |
| The hard part is which transitions between named states are legal | ❌ No. State machine |
| A single entity table with no entity-to-entity relationships | ⚠️ Level 1-2 only. May not need full archetype |

**Decisive question for every ✅ row**: is anything *derived* from the structure? A hierarchy that
only renders a tree in the UI, or a relationship nothing is computed from, scores zero regardless of
how organizational the vocabulary sounds.

### Grey zones: ask, do not auto-reject

- A hierarchy exists but nothing is derived from it → possibly a UI tree only.
- Roles exist but there are exactly two and they never overlap → watch for the first exception; ask whether one is coming.
- Party is present but peripheral to the real problem → party is a submodule here, not the core. Say so.

### If the domain does not fit

Output:

```
## Archetype Fit Assessment: ❌ Does Not Fit

The party archetype models entities whose roles and permissions derive from relationships.
This domain is a [RBAC user model / taxonomy / state machine / accounting ledger / ...] because:

- [specific reason from the requirements]
- The natural question is "[...]" not "who is related to whom, and what follows from that?"
```

Do NOT force a partial mapping. Stop here. A clean rejection is a useful result. It tells the user a from-scratch modeling session is justified rather than wasteful.

---

## Mapping Workflow

### Step 0: Get Requirements

- If provided as argument, use it directly
- If not provided, scan the recent conversation for domain context. If found, use that.
- Only if no argument AND no context in session, ask:
  > "Describe the domain: who the participants are, how they relate to each other, and what the system must derive from those relationships."

---

### Step 1: Assess Complexity Level

Locate the **highest applicable level** in the requirements. Higher levels include all lower levels.

| Level | Name | Signal in requirements |
|-------|------|------------------------|
| 1 | **Single user entity** | One user table, no relationships between users |
| 2 | **Global roles** | Fixed role labels assigned at account creation, no context |
| 3 | **Unified party** | People and organizations must be treated uniformly as counterparties |
| 4 | **Relational roles** | A role is scoped to a relationship, e.g. "manager *of this team*" |
| 5 | **Organizational hierarchy** | Parent-child structures with something flowing along them |
| 6 | **Temporal relationships** | Relationships and role assignments have `validFrom` / `validTo` |
| 7 | **Historical reconstruction** | Structure must be reproducible as-of a past date |
| 8 | **Acting on behalf** | Delegation, sessions on behalf of another party, actor ≠ subject in audit |
| 9 | **Federated identity** | Party owned by an external system; merge, dedup, reconciliation required |

**Guidance:**
- Levels 1-2: Party archetype is overkill. Document the level and say plainly that a user table with RBAC is the right answer.
- Levels 3-5: Core archetype. Party + PartyRole + PartyRelationship + Hierarchy sufficient.
- Levels 6-7: Add `RelationshipVersion` with half-open validity intervals and an explicit as-of traversal.
- Level 8: Add an Authority layer and split `actorPartyId` from `subjectPartyId` in every audit record. Retrofitting this is impossible.
- Level 9: Add `PartyIdentifier` with issuing authority, plus a reconciliation policy. The external system, not this service, owns the truth.

---

### Step 2: Ask Clarifying Questions

Before continuing, identify gaps. Ask about **two categories** in a single `AskUserQuestion` call (up to 4 questions per call; split into multiple calls if more needed). Always include **"To zależy / It depends"** as an explicit last option in every question.

#### Category A: Standard party decisions

Ask only about those **not clearly addressed** in requirements:

- **Role multiplicity**: Can one party hold several roles at once? Are any mutually exclusive, and is that a business rule or an accident of the current data?
- **Party scope**: Are parties only people, only organizations, or both: and must they be treated uniformly as counterparties?
- **Relationship temporality**: Do relationships and role assignments carry validity periods, or are they permanent once created?
- **Hierarchy transitivity**: Is the hierarchy transitive (grandparent reaches grandchild), or one level only? Is depth bounded?
- **Identity ownership**: Is party identity owned by this service or by an external one: and what is the staleness tolerance?

#### Category B: Gap-triggered questions

Scan the requirements for anything the archetype supports but requirements do not mention:

- **As-of reconstruction**: Must the organizational structure be reconstructable at a past date, or is the current state enough? (Determines whether hierarchy traversal takes a timestamp.)
- **Reorganization semantics**: When a unit moves under a new parent, do historical records follow the new structure or stay with the old? (Live traversal vs. snapshot at event time.)
- **Party merge**: Can two party records turn out to be the same entity, and must they be mergeable? What happens to relationships on the losing record?
- **Cycles**: Can a relationship be self-referential or cyclic, and must that be prevented at write time or detected at read time?
- **Permission expiry**: Does an authority derived from a relationship end automatically when the relationship ends, or persist?
- **Temporary delegation**: Are there stand-ins during leave, and are they distinguishable from permanent assignment?
- **Party without account**: Can a party exist with no login: a customer who never registered, an organization that is only ever a counterparty?
- **Audit granularity**: Where one party acts for another, must the audit distinguish who acted from whose data was shown?
- **Any other gap** you identify between what the archetype can model and what the requirements specify.

Collect answers before proceeding. If the user cannot answer, document the assumption in **Implementation Notes**.

#### Handling "it depends / both / varies by situation" answers

Always include **"To zależy / It depends"** as an explicit option in every `AskUserQuestion` call. Do not rely on the automatic "Other" fallback. Place it as the last option. If the user selects it, treat it as a **variable policy**:

- Document the *parameter* passed into the party service (e.g., `asOf`, `traversalDepth`, `visibilityMode`)
- Note in **Implementation Notes** that its value is determined externally by a policy/business-rules layer
- Do **not** model the decision logic inside the party model

---

### Step 3: Map Domain Concepts to Party Archetypes

For each significant noun and verb in the requirements, produce an explicit mapping table:

```
| Domain Concept       | Party Archetype | Notes |
|----------------------|-----------------|-------|
| [domain noun/verb]   | Party / PartyType / PartyRole / PartyRelationship / Hierarchy / PartyIdentifier / ContactPoint / Authority / VisibilityRule | [why] |
```

After the table, list any domain concepts that **could not be mapped**:

```
## Unmapped Concepts

The following domain concepts have no clear party archetype equivalent:
- [concept]: [reason / decision needed]
```

This section must be present even if empty (`None identified`). In practice it is rarely empty, and it is usually where the next module is hiding.

---

### Step 4: Design Party & PartyType Layer

**Party** = anything that can be a side of a relationship. Has identity. Has **no role of its own**.

**Available PartyTypes:**

| Type | Use when |
|------|---------|
| `Person` | A natural person; may or may not have an account |
| `Organization` | A legal entity: company, agency, institution |
| `OrganizationUnit` | A part of an organization with no separate legal identity: branch, team, department |
| `System` | A non-human counterparty: integration, service account, automated process |

**For each Party, define:**
- `PartyId` (stable, internal, never reused, never a login or an external ID)
- PartyType and whether the type can change over its lifetime (usually no)
- Which identifiers attach to it (Step 9)
- Whether it can exist without an account

**The identity test**: if removing every relationship from a candidate leaves nothing meaningful behind, it is not a Party. It is a role. A candidate named after a function ("approver", "handler", "representative") usually fails it; a candidate named after a thing that exists in its own right usually passes.

---

### Step 5: Design Roles & Relationships

**PartyRole** = a role played by a party. It is a property of participation, **not** an attribute of the party.

**PartyRelationship** = a link between two parties, with a role on each end.

**For each relationship, specify:**
- Both ends (`fromPartyId`, `toPartyId`) and the role at each end
- Cardinality and whether it is exclusive (may a party hold this relationship with two counterparties at once?)
- Whether it is temporal (Step 7)
- What is **derived** from it: visibility, authority, routing, reporting. A relationship from which nothing is derived may be documentation, not model.

**Role placement rules:**

| Situation | Where the role lives |
|-----------|---------------------|
| Role means the same everywhere, for everyone | Global role. This is RBAC, not this archetype |
| Role only makes sense with respect to a counterparty | On the relationship |
| Role only makes sense within an organization | On the relationship to that organization |
| Role only holds for a period | On a versioned relationship |

```
Party:         who this is                        (identity, no role)
PartyRole:     what they are in this relationship (context)
Relationship:  the link the role lives on         (two ends, cardinality)
Authority:     what that role may do              (derived, in a layer above)
```

---

### Step 6: Design Hierarchy & Traversal

If complexity level ≥ 5, model the hierarchy explicitly rather than as a `parent_id` afterthought.

**Hierarchy** is a relationship subtype: `parent-of` / `child-of` between two parties, usually between `Organization` or `OrganizationUnit`.

**For each hierarchy, specify:**
- Which PartyTypes participate; may types be mixed at different depths?
- Transitivity: does reach extend to all descendants, or one level?
- Depth bound, if any, and what happens on breach
- Cycle policy: prevented at write time, or detected at read time
- Multiple parents allowed? (Matrix organizations make this a real question, not a theoretical one)
- **What traverses it**: visibility, reporting rollup, responsibility, none

**Traversal signature.** State it explicitly, because it is the decision that leaks everywhere:

```
descendantsOf(partyId, asOf: Instant, maxDepth: Int?) → Set<PartyId>
```

If `asOf` is absent from this signature, the model cannot answer historical questions and level 7 is not met. Say so rather than discovering it later.

---

### Step 7: Define Temporal Validity

If complexity level ≥ 6, relationships and role assignments need versioning.

**Validity** = half-open interval `[validFrom, validTo)`:
- `validFrom`: first moment the relationship is effective (inclusive)
- `validTo`: first moment it is no longer effective (exclusive); use an "end of time" sentinel for open-ended
- Constructors: `ALWAYS`, `from(t)`, `until(t)`, `between(t1, t2)`

**RelationshipVersion** = immutable snapshot: `{fromPartyId, toPartyId, fromRole, toRole, validity, recordedAt}`
- `recordedAt` = system timestamp when the fact was recorded (never editable)
- The gap between `validFrom` and `recordedAt` is backdating: decide whether it is allowed

**Two distinct time axes.** Confusing them is the most common source of irreproducible reports:
- **Valid time**: when the relationship held in the real world
- **Transaction time**: when the system learned about it

**For each temporal relationship, specify:**
- Whether overlapping versions are rejected or resolved by recency
- Whether backdating is permitted, and who may do it
- How termination is modeled: closing `validTo` on the current version, never deleting rows

---

### Step 8: Define Visibility Derivation

If the domain asks "who may see what", express it as a **traversal over the relationship graph**, not as a list of conditions.

**For each visibility rule, specify:**
- Subject: whose data
- Viewer: which party is asking, and in which role
- Path: the sequence of relationships connecting them
- Time semantics: evaluated live against the current graph, or against the graph as it stood at the record's creation

```
VisibilityRule: record R is visible to party V when
  R.ownerPartyId == V                                          (own data)
  OR R.originPartyId ∈ descendantsOf(V.unitId, asOf, depth)    (structural reach)
  OR ∃ active delegation D: D.actor == V AND D.subject == R.ownerPartyId   (on behalf)
```

**Boundary rule. This is where party models go wrong.** The party model answers *what relationships exist*. It must not answer *whether this is allowed*. Authorization additionally depends on channel, consent, record status, regulation, and business rules that have nothing to do with the graph. Keep the decision in a layer above, consuming the graph as input.

```
Party model:   descendantsOf(unitId, asOf) → Set<PartyId>    (facts)
Policy layer:  mayView(requester, record) → boolean          (decision)
```

---

### Step 9: Define Identity & External Boundaries

**PartyIdentifier** = an external identifier attached to a party. A party normally has several.

**For each identifier, specify:**
- Issuing authority (this service, an external service, a state registry)
- Uniqueness scope: globally unique, unique per authority, or not unique at all
- Whether it is stable or reassignable (employee numbers get reused; national IDs do not)
- Whether it may be used as a join key by other services (usually: no)

**If the structure is owned by an external service** (level 9):
- Hold the identifier and a cache, never your own copy of the truth
- State the **staleness tolerance** explicitly: seconds, minutes, or a nightly sync
- Define behavior when the external service is unavailable: fail closed (deny visibility) or fail open (serve stale)? For visibility checks, fail closed is usually the only defensible choice
- Define the reconciliation process for divergence. If there is none, you have two truths

---

### Step 9.5: Decision Sanity Check

**Before producing the final output**, enumerate every concrete decision in the draft model and verify each has a source:
- **(R)**: explicitly stated in requirements
- **(A)**: asked and answered in Step 2
- **(X)**: neither: assumed silently

**Decision checklist:**

| Decision area | Example decisions to check |
|---------------|---------------------------|
| Complexity level | Which of the 9 levels applies? Is full versioning needed? |
| Party vs. role | Is each candidate a Party or a role on a relationship? |
| PartyType scope | People only, or organizations too? Are units separate from organizations? |
| Role placement | Global, on a relationship, or on a versioned relationship? |
| Role exclusivity | May roles overlap? Is exclusivity a rule or an accident? |
| Hierarchy transitivity | All descendants or one level? Depth bound? |
| Multiple parents | Allowed? What does traversal return then? |
| Cycle policy | Prevented at write or detected at read? |
| Temporal semantics | Live traversal or snapshot at event time? |
| Backdating | Permitted? By whom? |
| Visibility path | Which relationship sequences grant reach? |
| Authority boundary | What stays out of the party model? |
| Identity ownership | Who owns the truth? Staleness tolerance? |
| Failure behavior | External service down: fail closed or open? |
| Audit granularity | Is actor separated from subject? |
| Party merge | Supported? What happens to relationships? |

**For every (X) decision found:**
1. If low impact (purely technical, easily changed): mark as explicit assumption in Implementation Notes.
2. If it affects business behavior: **stop and ask** using `AskUserQuestion` before delivering the model.

Silent assumptions are the failure mode of this whole workflow. A model where everything traces to (R) or (A) can be reviewed; one full of (X) merely looks finished.

---

## Output Format

```markdown
# Party Archetype Model: [Domain Name]

## Party Domain
[Who the participants are, detected complexity level (1-9), justification]

## Concept Mapping

| Domain Concept | Party Archetype | Notes |
|----------------|-----------------|-------|
| ...            | ...             | ...   |

## Unmapped Concepts
[List or "None identified"]

## Parties & Types

| Party ID | PartyType | Can exist without account | Notes |
|----------|-----------|--------------------------|-------|

## Roles & Relationships

[ASCII relationship graph]

| Relationship | From (role) | To (role) | Cardinality | Temporal | Derives |
|--------------|-------------|-----------|-------------|----------|---------|

## Hierarchy & Traversal

| Hierarchy | Participating types | Transitive | Depth bound | Multiple parents | Cycle policy |
|-----------|--------------------|-----------|-------------|------------------|--------------|

**Traversal signature**: `descendantsOf(partyId, asOf, maxDepth) → Set<PartyId>`

## Temporal Validity

| Relationship | Overlap policy | Backdating | Termination | Notes |
|--------------|---------------|-----------|-------------|-------|

## Visibility Rules

| Subject | Viewer | Path | Time semantics |
|---------|--------|------|----------------|

**Out of scope for this model**: [what stays in the policy layer]

## Identifiers & External Boundaries

| Identifier | Issuing authority | Uniqueness | Stable | Usable as join key |
|-----------|-------------------|-----------|--------|-------------------|

## Implementation Notes
[Key decisions, assumptions, edge cases, boundaries]
```

---

## Common Patterns & Pitfalls

### Pattern: A Role Is a Property of a Relationship, Not of a Party

Anti-pattern: `user.role = PROVIDER`. It works until the day a provider becomes a consumer of the same service, and then someone adds `isAlsoConsumer`, and the model has started lying.

Correct: the party is a person; "provider" is the role they hold on their relationship to an organization; "consumer" is the role they hold on their relationship to a record. Both can be true simultaneously without a special case.

**Symptom to look for in your own draft**: any role that has no relationship attached to it.

### Pattern: Authorization Lives Outside the Party Model

The party model answers *what relationships exist*. Whether an action is allowed additionally depends on channel, consent, record status, regulatory rules, and business policy, none of which are graph facts. Pull them in and every new rule touches the core model.

```
Party model:   what relationships exist        (facts, stable)
Policy layer:  whether this action is allowed  (decisions, volatile)
```

The same split appears in the accounting archetype ("record what happened, do not decide whether it should happen"). It is the same mistake wearing different clothes.

### Pattern: A Hierarchy Without Time Is a Reporting Bug Waiting to Happen

A reorganization moves a unit under a new parent, and last quarter's numbers silently change. Both answers are defensible (visibility computed live from the current structure, or snapshotted at the moment of the event) but drifting into one by accident is not.

Decide explicitly, and put `asOf` in the traversal signature the moment level 7 appears. Adding it later means touching every call site.

### Pattern: Party Is Not an Account

A customer exists before they log in and after the account is deleted. An organization may never have an account at all. An account is at most one identifier among several, with its own lifecycle.

Merging the two makes GDPR erasure and "customer known to us but not registered" both structurally impossible.

### Pattern: Reference External Structure, Do Not Copy It

When another service owns the hierarchy, hold an identifier and a cache. Copying creates two truths with no reconciliation process, and the divergence surfaces as a visibility bug: someone sees a record they should not, months later, with no obvious cause.

State staleness tolerance and unavailability behavior as explicit decisions. For visibility checks, fail closed.

### Pitfall: The Reverse Error Is Equally Expensive

Splitting what should be one party (separate customer and employee records for the same human) costs as much as merging what should be separate, and it hides longer, because nothing looks wrong until someone tries to reconcile.

The test is the same in both directions: **do we do the same thing with them in this context?** If yes, one party with two roles. If genuinely not, two parties.

---

## Quality Checks

Before returning the model, verify:

- [ ] Complexity level is explicitly stated and justified with evidence from requirements
- [ ] Every candidate passed the identity test: nothing that is a role is modeled as a Party
- [ ] Every role is attached to a relationship or explicitly declared global (and if global, level 2 was considered)
- [ ] Every relationship states both ends, cardinality, and what is derived from it
- [ ] Hierarchy transitivity, depth bound, cycle policy, and multiple-parent policy are all decided
- [ ] The traversal signature includes `asOf` if complexity level ≥ 7
- [ ] Validity intervals use `[validFrom, validTo)` half-open notation consistently
- [ ] Valid time and transaction time are distinguished where both matter
- [ ] Visibility rules are expressed as graph traversals, not condition lists
- [ ] Authorization is explicitly scoped *out* of the party model
- [ ] Identifier ownership, uniqueness, and staleness tolerance are stated
- [ ] Actor is separated from subject wherever one party acts for another
- [ ] Concept mapping table is present and complete
- [ ] Unmapped concepts section is present (even if empty)
- [ ] All clarifying question answers (or assumptions) are reflected in the model
- [ ] Implementation Notes document all (X) assumptions and boundary decisions

---

## Example

**Input:** "Mikroserwis do zarządzania kontraktami klienta. Każdy kontrakt przypisany do jednego klienta i jednej agencji ubezpieczeniowej. Klientem może być osoba fizyczna lub firma. Data visibility check przed zwróceniem kontraktu, czyli klient przegląda swoje kontrakty sam albo agent przegląda je w sesji z klientem. Agencje tworzą hierarchię, agencja nadrzędna widzi kontrakty sprzedane przez podrzędne. Agenci przypisani do agencji. Dane o agencjach z zewnętrznego Agency Service. Zdarza się, że agent jest też naszym klientem."

**Detected complexity level**: 9. Relational roles, organizational hierarchy with derived visibility, acting on behalf via agent sessions, and party structure owned by an external service.

**Output:**

```markdown
# Party Archetype Model: Insurance Contract Service

## Party Domain
**Who participates**: individuals and companies as customers, agents as people, agencies as organizations in a hierarchy.
**Complexity level**: 9. Visibility derived from hierarchy traversal, agent sessions on behalf of customers, agency structure owned by Agency Service.

## Concept Mapping

| Domain Concept | Party Archetype | Notes |
|----------------|-----------------|-------|
| Customer (individual) | Party (Person) | May exist without an account |
| Customer (company) | Party (Organization) | Same counterparty treatment as Person |
| Agent | Party (Person) + PartyRole on employs relationship | NOT a PartyType, see level-4 note |
| Agency | Party (Organization) | Referenced from Agency Service, not owned here |
| Parent/child agency | Hierarchy relationship, parent-of | Transitivity is an open question |
| Agent assigned to agency | PartyRelationship employs (Agency → Person as AGENT) | Temporal |
| Contract held by customer | PartyRole HOLDER on contract relationship | Contract itself is not a Party |
| Contract sold by agency | PartyRole SELLER on contract relationship | Drives structural visibility |
| Agent in session with customer | Authority, temporary, actor ≠ subject | Level 8, audit split required |
| Agent number | PartyIdentifier, authority = Agency Service | Reassignable, not a join key |
| National ID | PartyIdentifier, authority = state registry | Stable, unique, restricted use |
| Customer ID | PartyIdentifier, authority = this service | Internal, stable |
| Agent who is also a customer | Two roles on one Party | The reason `user.type` fails here |

## Unmapped Concepts
- Contract status and validity period: contract lifecycle, likely a state machine
- Insurance product: product catalog, outside this model
- Whether a session may view a given contract: policy layer, deliberately excluded

## Parties & Types

| Party | PartyType | Without account | Notes |
|-------|-----------|-----------------|-------|
| Customer (individual) | Person | Yes | Sold to before registering |
| Customer (company) | Organization | Yes | Represented by people |
| Agent | Person | No | Always has a system account |
| Agency | Organization | Yes | Never logs in; pure counterparty |

## Roles & Relationships

```
  Parent Agency ──parent-of──> Child Agency ──employs(AGENT)──> Person
        │                            │                            │
        │  visibility flows down     │  sold-by(SELLER)           │ acts-on-behalf-of
        └────────────────────────────┴──> Contract <──────────────┘   (session, temporary)
                                            │
                                       held-by(HOLDER)
                                            v
                                     Person | Organization
```

| Relationship | From (role) | To (role) | Cardinality | Temporal | Derives |
|--------------|-------------|-----------|-------------|----------|---------|
| employs | Agency (EMPLOYER) | Person (AGENT) | 1:N | Yes | Structural reach |
| parent-of | Agency (PARENT) | Agency (CHILD) | 1:N | Yes | Visibility rollup |
| sold-by | Contract | Agency (SELLER) | N:1 | No (fixed at sale) | Visibility subject |
| held-by | Contract | Party (HOLDER) | N:1 | No | Own-data visibility |
| acts-on-behalf-of | Person (ACTOR) | Party (SUBJECT) | N:M | Yes, session-scoped | Delegated visibility |

## Hierarchy & Traversal

| Hierarchy | Types | Transitive | Depth bound | Multiple parents | Cycle policy |
|-----------|-------|-----------|-------------|------------------|--------------|
| Agency tree | Organization | (A) full, confirmed with user | None stated (X) | No (A) | Rejected at write, in Agency Service |

**Traversal signature**: `descendantsOf(agencyId, asOf, maxDepth=null) → Set<AgencyId>`

## Temporal Validity

| Relationship | Overlap | Backdating | Termination | Notes |
|--------------|---------|-----------|-------------|-------|
| employs | Rejected | Permitted, admin only (X) | Close validTo, never delete | Agent leaving must not erase history |
| parent-of | Rejected | Not permitted | Close validTo | Owned by Agency Service |
| acts-on-behalf-of | Allowed | Never | Session end | Short-lived by design |

## Visibility Rules

| Subject | Viewer | Path | Time semantics |
|---------|--------|------|----------------|
| Contract | Its holder | held-by, direct | Current |
| Contract | Selling agency | sold-by, direct | Current |
| Contract | Ancestor agency | sold-by then parent-of, upward | (A) live traversal |
| Contract | Agent in session | employs + active acts-on-behalf-of | Session validity |

**Out of scope for this model**: whether a given session may view a given contract. Consent, contract status, channel restrictions, and regulatory rules live in the policy layer, which consumes these traversals as input.

## Identifiers & External Boundaries

| Identifier | Authority | Uniqueness | Stable | Join key |
|-----------|-----------|-----------|--------|----------|
| Customer ID | This service | Global | Yes | Yes, internally |
| Agent number | Agency Service | Per authority | No, reassignable | No |
| National ID | State registry | Global | Yes | No, restricted |

**Agency Service boundary**: hierarchy is referenced, never copied. Cache with (X) 5-minute staleness tolerance, needs confirmation. On unavailability, **fail closed**: structural visibility is denied rather than served stale, because a stale parent link leaks another agency's contracts.

## Implementation Notes
- Level 9 justified by external ownership plus session delegation; either alone would be level 8
- "Agent" deliberately modeled as a role, not a PartyType: requirement 9 (agent who is also a customer) makes `user.type` unworkable from day one
- Contract is NOT a Party. It is related to parties; it does not participate in relationships as a counterparty
- Visibility computed live from the current hierarchy (A). Consequence: a reorganization retroactively changes who can see historical contracts. Accepted; alternative was snapshotting `visibleToAgencyPath` at sale time
- Audit records must carry both `actorPartyId` and `subjectPartyId` from day one: level 8 cannot be retrofitted from existing logs
- (X) Assumption: agency hierarchy depth unbounded; if Agency Service permits deep nesting, traversal needs a guard
- (X) Assumption: backdating of employs permitted for administrators; confirm with compliance
- (X) Assumption: no party merge required in v1; if two customer records for one person are possible, this changes the identifier model
```

---

## Test Fixtures

`tests/` holds two fixtures for calibrating the boundary:

- `fit-positive.md`: requirements the fit test **should pass**, producing a sensible model
- `fit-negative.md`: requirements that **look** like Party but should be rejected

If the negative fixture passes, the fit test is too permissive. Tighten the ❌ rows in the signal table and sharpen the relational-role test. Iterating on these two boundaries is the most effective way to sharpen the skill.
