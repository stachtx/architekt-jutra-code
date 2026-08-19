---
name: event-driven-reviewer
description: Reviews event-driven systems for event anti-patterns by analyzing event definitions, payloads, and handlers. Detects CRUD events (state dumps instead of business intent), passive-aggressive events (commands in disguise), and decoy events (empty payloads forcing callbacks to the publisher). Proposes type-specific fixes (business-intent events, explicit commands, payload enrichment) and interactively validates exceptions with the user. Invoke when user asks to review events, "review my event-driven architecture", "should this be an event or a command", "are my events well designed", or reviews a PR touching event classes, publishers, or handlers. Strictly read-only.
argument-hint: "[module or path to analyze, or 'all', or module name --pr for pull request diff check]"
---

# Event-Driven Reviewer

Analyze events in a codebase to ensure they carry **business intent about something that happened** — not database state, not hidden commands, not empty notifications. When violations are found, propose **type-specific fixes** and validate interactively with the user.

**Output goal**: An event review report with detected anti-patterns, proposed fixes (business-intent events for CRUD, explicit commands for hidden commands, payload enrichment for decoys), and a record of exceptions the team confirmed as deliberate. The report is a review artifact — the skill never modifies code.

**Why a skill and not a linter**: these defects are silent. The system runs, the tests pass, and the problem only surfaces when contracts change between teams or when someone adds a new consumer. Static tools miss them entirely, because the defect isn't syntactic — it lives in the business intent of the event, which only shows up in names, payload shapes, and what handlers do with them.

## When to Use

**Two modes of operation:**

1. **Full inventory check** — provide a module, path, or "all". The skill locates events, classifies anti-patterns, and proposes fixes.
2. **Pull request check** — provide a module with `--pr`. The skill diffs the PR, extracts new or changed events, and checks only those. This is the primary mode: the cheapest moment to fix an event is before it becomes a contract.

**Use this skill when:**
- Architectural review of a PR that adds or changes events, publishers, or handlers
- Before extracting a module or splitting a monolith — event contracts become public at that moment
- As a periodic architecture health check (quarterly), tracking whether violation count falls
- When onboarding a team to event-driven design and you need concrete examples from their own code

## When NOT to Use — Fit Test

### The core question

> *"Do my events cross a boundary where somebody else depends on their shape?"*

If **yes** — review is worth it. That boundary is a contract, and contract mistakes are expensive.
If events are **internal to one module with one consumer** — the cost of a bad event is a refactor, not a migration. Run the skill if you like, but expect low value; report these in bulk rather than individually.
If the question is **"which infrastructure should I use"** (Kafka vs RabbitMQ, at-least-once vs exactly-once, outbox pattern) — this is the wrong skill. This one reviews event *semantics*, not delivery guarantees. Say so plainly and stop.
If the question is **"where should my boundaries be"** — boundaries come first. Events are how modules talk; reviewing the conversation before agreeing who the speakers are produces noise.

## Prerequisites

- Access to event class/record definitions and their payloads
- Ideally access to consumers (monorepo). **Without handlers you cannot reliably detect decoys or confirm CRUD** — the strongest signals live in what handlers do. If consumers are out of scope, say so in the report so nobody over-trusts the findings.

## Core Principle

**An event announces what happened; a command requests what should happen.** Every anti-pattern below is a different way of blurring that line — CRUD events announce *field changes* instead of *business facts*, passive-aggressive events *request* while pretending to *announce*, and decoy events announce without saying enough to be useful.

---

## Phase 1: Locate Events

Agree scope first, then build an inventory. For each event collect:

| Field | Why it matters |
|-------|----------------|
| Name and source module | Classification; detecting vocabulary from foreign contexts |
| Payload fields and types | CRUD signals (entity copy) and decoy signals (thin payload) |
| Publication site | Determines whether the publisher knows the next step |
| Handlers, if available | Strongest signals live here |
| First ~5 lines of each handler | Detects the callback shot to the publisher |

**Search patterns** — filter out false positives (`EventLoop`, telemetry `AnalyticsEvent`) immediately; they only dilute the report.

```bash
# Universal starting point
rg -e 'Event\b' -e 'DomainEvent' -e 'IntegrationEvent'

# CRUD suffixes — fastest route to a first signal
rg -o '\b\w+(Created|Updated|Deleted|Edited|Changed|Modified|Removed)\b' -N | sort -u
```

- **Java / Spring**: `@EventListener`, `@TransactionalEventListener`, `@KafkaListener`, `@RabbitListener`, `ApplicationEventPublisher`, `publishEvent`, `@DomainEvents`, `record \w+Event`
- **Kotlin**: as above, plus `data class \w+Event`, `sealed (class|interface) \w*Event`
- **C# / .NET**: `INotification`, `INotificationHandler`, `IIntegrationEventHandler`, `IPublisher.Publish`, `IConsumer<` (MassTransit, NServiceBus, MediatR)
- **TypeScript / Node**: `@OnEvent`, `eventEmitter.on|emit`, `@EventPattern`, `@MessagePattern`, `implements IEvent`
- **Python**: `@event_handler`, `@subscribe`, `@listens_for`, `class \w+Event(`

**Scoping**:
- Path or module -> events defined OR consumed there
- `--pr` -> only events touched by the diff, plus their existing handlers for context
- "all" -> full inventory, but narrow before Phase 2 (see below)

**Narrowing on a large repository.** Hundreds of events cannot be reviewed meaningfully. Order: events **crossing module boundaries** first (mistakes there become public contracts), then events with the **most consumers** (largest blast radius), then **recently added or changed** ones (still cheap to fix). Module-internal single-consumer events go in the bulk section.

**Output**: Summary table — events found, modules involved, handler visibility (full / partial / none).

-> Proceed to Phase 2

---

## Phase 2: Detect Anti-Patterns

For each event, walk the signals below and assign a preliminary classification with a **confidence level**. Read the handler code — what the consumer DOES with the event is more informative than the event's own definition.

Distinguish **strong signals** (payload is a 1:1 entity copy; a `shouldRecalculate` flag in the payload) from **heuristics** (the event has one field). Never classify from a single heuristic. Two or three converging signals are the threshold for raising it.

### Typical Anti-Pattern Types

Not exhaustive — these are the most common patterns, not a closed taxonomy.

| Anti-Pattern | How It Manifests | Fix Strategy |
|--------------|------------------|--------------|
| **Event-Driven CRUD** | `ProductUpdated { id, name, price, category, weight }` — a state dump on the bus, consumers diff fields to guess what happened | **Recover the business fact**: split into intent-carrying events named after the decision that caused the change |
| **Passive-Aggressive Event** | `EmissionFactorUpdated { factorId, shouldRecalculate: true }` — a command wearing an event's name | **Make the command explicit**: publisher either stops knowing the next step (ACL on consumer side) or admits it orchestrates (send a command) |
| **Decoy Event** | `EmissionFactorUpdated { factorId }` — every handler's first line is a call back to the publisher | **Enrich the payload** with what consumers already query for |

### Detection details

**Event-Driven CRUD.** Events carry only `-Created`/`-Updated`/`-Deleted` suffixes; the payload's field set largely overlaps the entity's (above ~70% is strong); technical fields leak in (`updated_at`, `version`, `row_id`); a handler must consume 3-5 such events in sequence to deduce what actually happened. Hurts because it puts zero business semantics on the wire — logic that belongs to the publisher leaks into every consumer — couples everyone to the database schema, multiplies events four-per-entity, and turns versioning into a migration project.

**Passive-Aggressive Event.** Payload contains `should*`, `needs*`, `requires*`, `must*` flags; the name starts with an imperative (`Recalculate...`, `Send...`); the publisher imports classes from consumer modules; the event's vocabulary contains terms from a foreign context. The decisive check is a question, not a grep:

> **Does the publisher know what the next step of the process is?**

Everything else is circumstantial evidence pointing at that question. Ask it directly. If the answer is yes, loose coupling is already fiction — the publisher is orchestrating while pretending to inform, and adding a consumer means adding another flag to the contract.

**Decoy Event.** Many handlers whose **first step is a REST/gRPC call to the publisher's module**; handlers in different consumers making the same query to the same publisher; a name implying a rich business fact over a payload holding only an ID. Hurts because it is request-reply dressed as event-driven: you pay for the broker and lose its benefits, the consumer is coupled to the publisher's availability (temporal coupling when synchronous), and one event times N consumers equals N callbacks in the same second.

### Cross-file checks

These give the strongest signals and are invisible in any single file:

```bash
# 1. Payload vs entity — field overlap above ~70% is a strong CRUD signal
rg -A15 'class Product\b'; rg -A15 'class ProductUpdated\b'

# 2. Publisher importing consumer modules — near-certain hidden command
rg '^import .*\.(consumer|billing|notification)\.' src/main/java/.../publisher/

# 3. Handler's first step — an HTTP/gRPC call back to the publisher means decoy
rg -A8 '@EventListener' | rg -B4 'restTemplate|webClient|httpClient|feign'
```

### NOT a Violation

Filter out before presenting:

- **Single-field events per se** — `OrderCancelled { orderId }` is fine if consumers need nothing more. Only handler behavior turns thinness into a decoy.
- **Events named after real business facts that happen to end in a verb participle** — `InvoiceIssued` is not CRUD just because it ends in `-ed`. The test is whether the name denotes a business decision or a row mutation.
- **Technical/infrastructure events** — health checks, heartbeats, telemetry. Not domain language, not in scope.
- **Internal in-process events used purely to decouple code within one module**, where cross-team contracts were never the goal. Worth naming in the report, but not the same severity.

### -> Pause: Present findings with diagram

**Draw an ASCII diagram showing the current event flow with violations marked.** Show publisher, event, consumers, and where the flow degenerates (callbacks to the publisher, flags driving consumers). Mark violations with ❌. This diagram is the FIRST thing the user sees — before the table.

```
BEFORE — decoy event
  EmissionFactor ──EmissionFactorUpdated{factorId}──┬──> Pricing ──GET /factors/{id}──┐
                                                    ├──> Reporting ──GET──────────────┤ ❌
                                                    └──> Budget ──GET─────────────────┘
                                                                          all callbacks hit publisher
```

Then present findings as a table with: #, anti-pattern, event name, location, signals found, handler behavior.

Ask: "Should I proceed with fix proposals? (Yes / Some are false positives / Add context)"

---

## Phase 3: Rule Out Exceptions

**This phase is what separates this skill from a linter.** Each anti-pattern has legitimate, deliberate uses. Reporting those as violations destroys trust in the tool and teaches the team to ignore its reports — so ask before you diagnose, exactly as a human architect would when they see something odd in a review.

Use `AskUserQuestion`. **Batch the questions by anti-pattern rather than asking one per event** — with twenty events, an interrogation kills the tool's usefulness.

### Exception check for CRUD events

> "I see [N] CRUD-style events whose payloads mirror the entity. Before I assess these — what are they for? (a) Refreshing a cache or CQRS read model. (b) A deliberate Change Data Capture pipeline. (c) They're meant to notify other modules about business events. (d) Mixed — some of each."

- (a) or (b) -> **legitimate**. If the intent is to publish changed state so somebody refreshes a projection, CRUD is exactly right. Not a violation.
- (c) -> confirmed anti-pattern, proceed to fix.
- (d) -> **the exception does not cancel the problem**. The same stream serving projections and business logic is itself the finding: recommend splitting the two streams.

### Exception check for passive-aggressive events

> "For [EventName] — do you, as the publisher, know what should happen next in the process? (a) Yes, I know the exact next step. (b) No, I'm announcing a fact and don't care who reacts. (c) This module is a deliberate orchestrator (saga / process manager)."

- (a) -> confirmed. The fix is to stop pretending: send a command.
- (b) -> the flags may be vestigial. Check whether they're still read; if not, the fix is deletion.
- (c) -> **legitimate role, wrong vocabulary.** Driving the next step is an orchestrator's job. The finding is naming only: this should be a command, not an event. Report as low severity.

### Exception check for decoy events

> "[EventName] carries only an ID while [N] handlers immediately call back to you. Is that deliberate? (a) Yes — privacy/GDPR: sensitive data must not sit on the bus. (b) Yes — payload would be very large; the reference is cheaper (claim-check). (c) No, the payload just ended up thin."

- (a) -> **legitimate and worth documenting.** Keeping personal data off the bus means the data can later be erased while the event log stays intact. Note it in the report as a deliberate strategy.
- (b) -> legitimate claim-check pattern. Note the trade-off (temporal coupling remains) and move on.
- (c) -> confirmed, proceed to fix.

### Non-interactive mode

In CI/CD you cannot ask. Then **report every finding as "needs verification"**, never as a confirmed violation, and print the question you would have asked. Do not fail the build — without the exception check, the false-positive risk is too high to justify blocking a merge.

### -> Pause: Record answers

Every confirmed exception goes into the report as a **deliberate architectural decision**, with the user's rationale. This is valuable documentation, not noise — the next run won't have to ask again.

---

## Phase 4: Propose Fixes

For each confirmed violation, propose a fix matched to the anti-pattern type. Use this block format:

### Fix for CRUD events: Recover the business fact

Do not rename mechanically. Find **which business decision** caused that set of fields to change — the answer is usually in the caller of the code that publishes the event.

```
VIOLATION: ProductUpdated in catalog/ProductService.java:112
  Payload: { id, name, price, category, weight, updatedAt }  (6/7 entity fields)
  Behavior: 3 consumers each diff old vs new to detect what changed
  Fix: split by business intent
    ProductPriceChanged { productId, oldPrice, newPrice, reason }
    ProductRecategorized { productId, previousCategory, newCategory }
  Consumers affected: 3 (Pricing reacts to price only, Reporting to both)
  Note: if one entity change genuinely means several business things,
        that is the proof the single event was too coarse
```

### Fix for passive-aggressive events: Make the command explicit

Two possible fixes, chosen by the same heuristic used in Phase 3.

**Fix A: publisher doesn't actually need to know** -> keep the event, strip the flags, and put an Anti-Corruption Layer on the consumer side that decides what to do.

**Fix B: publisher genuinely orchestrates** -> replace the event with a command. This is not an architectural downgrade; it is an honest naming of what already happens.

```
VIOLATION: EmissionFactorUpdated in factors/FactorService.java:88
  Payload: { factorId, shouldRecalculateProducts: true, needsBudgetRefresh: true }
  Heuristic: publisher knows both next steps -> orchestrating, not announcing
  Fix (B): split announcement from instruction
    Event:   EmissionFactorRevised { factorId, previousValue, newValue, effectiveFrom }
    Command: RecalculateProductFootprint(factorId) issued by orchestrator
  Consumers affected: 2 — both stop reading flags, one becomes a command target
```

### Fix for decoy events: Enrich the payload

Practical method: **look at what the handlers query after receiving the event, and put that in the event.** The consumers have already told you what the payload is missing.

```
VIOLATION: EmissionFactorUpdated in factors/FactorService.java:88
  Payload: { factorId }
  Behavior: 4 handlers, each opens with GET /emission-factors/{id}
  Common fields fetched: category, value, unit, effectiveFrom
  Fix: EmissionFactorRevised { factorId, category, previousValue,
                               newValue, unit, effectiveFrom }
  Consumers affected: 4 — all drop the callback
  Note: if consumers need wildly different data, one event is serving
        several unrelated use cases — split it instead
```

### Quality checks for all fixes

- Does the new name denote a **business decision** rather than a row mutation?
- Would the payload let a consumer act **without calling back**?
- Could a new consumer be added **without changing the event**?
- Does the publisher stay ignorant of who listens?
- Is the cost of change stated — how many consumers migrate, does the contract need versioning?

### Diagrams: BEFORE and AFTER per violation

For each violation (or group), generate two concise ASCII diagrams (8-12 lines). BEFORE shows the degenerate flow with ❌ at the break; AFTER shows the fixed flow with ✅ and where intent now lives.

```
AFTER — enriched event
  EmissionFactor ──EmissionFactorRevised{id,category,prev,new,unit,from}──┬──> Pricing   ✅
                                                                          ├──> Reporting ✅
                                                                          └──> Budget    ✅
                                                                     no callbacks, no temporal coupling
```

### -> Pause: Present fixes with diagrams

**ALWAYS draw diagrams when presenting violations and fixes.** Visual representation is the primary way the user grasps the problem; text accompanies the diagram, not the other way around.

Ask per violation:
"Does this make sense?
- **Yes**
- **No, the publisher genuinely needs to drive this** (explain why — may indicate the boundary is misplaced)
- **Different fix** (describe)"

If the user says the publisher must drive it, flag as a **boundary question** rather than forcing the fix. Note it in the report.

---

## Phase 5: Generate Report

**Output**: `event-review-report.md`

1. **Executive Summary** — events analyzed, findings by anti-pattern, exceptions confirmed, handler visibility limitations
2. **BEFORE/AFTER diagrams** — per violation or group
3. **Deliberate Architectural Decisions** — events confirmed as exceptions, with the team's rationale. Placed **before** the findings list, so the reader immediately sees the tool distinguishes the two.
4. **Findings with Fixes** — per finding: signals, handler behavior, confidence, user's answer, proposed fix, cost of change
5. **Bulk Observations** — low-severity items, module-internal events, naming nits
6. **Open Questions** — where context was missing; for the architect to settle

**Prioritize.** Three well-described findings with concrete fixes beat forty list items — a report with 40 "violations" is useless and gets ignored. Everything else goes in bulk observations.

In periodic mode, open with a comparison against the previous run: findings per module and the trend. Only the trend carries information, not the absolute number.

---

## Pull Request Mode (--pr)

When the PR touches events, review only what changed — but with more scrutiny, because this is the moment fixes are cheap.

1. **Diff the PR** — extract new/changed event classes, payload fields, publishers, handlers
2. **Classify each change**:
   - **New event with business-intent name and self-sufficient payload** — OK, note it
   - **New CRUD-suffixed event** — check payload against the entity, then ask the cache/read-model question
   - **New flag added to an existing event's payload** (`shouldX`, `needsY`) — high alert. This is how passive-aggressive events grow: one consumer at a time
   - **Field removed from a payload** — contract break. Who consumes it? Is it versioned?
   - **New handler opening with a call to the publisher** — decoy signal, even if the event itself is old
3. **Weight by boundary**: an event crossing module boundaries is a public contract, judge strictly. An event internal to the module is cheap to change later, judge leniently.

### -> Pause: Present classification

"Two new events look fine. `EmissionFactorUpdated` gained a `shouldRecalculate` flag — that's a consumer's instruction moving into the publisher's contract. Deliberate?"

---

## Gotchas

- **The failure mode is silence** — nothing breaks at commit time. The cost lands months later on whoever has to add a consumer or version a contract.
- **A thin payload is not automatically a decoy** — the diagnosis lives in the handlers, not the event definition. Check both before flagging.
- **A CRUD-shaped event is not automatically wrong** — cache and read-model refresh is exactly this shape. Ask before diagnosing, every time.
- **"We publish an event, they subscribe" is not automatically loose coupling** — if the payload carries `shouldDoX`, you have a command with extra infrastructure.
- **The publisher knowing the next step is the single most informative signal** — when in doubt about any event, ask that question first.
- **Reviewing without access to consumers halves the skill's power** — say so explicitly rather than presenting partial findings as complete.
- **20+ findings in one module** may mean the team never agreed what an event is for, not that they made 20 independent mistakes. Recommend a conversation, not 20 tickets.
- **This skill supports the architect, it does not replace them.** They see business context, decision history, and deadline pressure that no amount of code reading surfaces. The report's job is to produce the first set of questions that starts the conversation.
