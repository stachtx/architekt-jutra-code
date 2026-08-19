# Event Review Report — whole project

**Skill**: event-driven-reviewer (`week10/event-driven-reviewer/SKILL.md`)
**Scope**: entire repository (`src/main/java`, `src/main/frontend`, `plugins/`). `week10/` excluded — throwaway exercise fixtures for practicing this skill, not part of the real `aj` app (several already carry their own `skill-run-result.md` from prior runs).
**Date**: 2026-08-19

## Executive Summary

- **Locations with events**: 2
- **Events found**: 2 total
- **Confirmed violations**: 0
- **Exceptions confirmed**: 1 (`filterChange`, kept deliberately)
- **Clean designs (no anti-pattern)**: 1 (`FootprintCalculatedEvent`)
- **Locations with zero events** (pure request/response, checked and ruled out): 3

| Location | Events | Result |
|---|---|---|
| `pl.devstyle.aj.footprint` (backend, Spring `ApplicationEventPublisher`) | 1 — `FootprintCalculatedEvent` | Clean — no anti-pattern |
| `src/main/frontend/src/plugins/` + `plugin-sdk/` (host↔plugin postMessage layer) | 1 — `filterChange` | Deliberate exception (dead today, kept for future plugins) |
| `plugins/` top-level (warehouse, box-size, logistics, product-validator, ai-description) | 0 | Pure request/response RPC via `PluginSDK`/`ServerSDK` — no events |
| `pl.devstyle.aj.core.plugin` (backend plugin-registry package) | 0 | Plain CRUD REST + JPA — no events |
| Rest of `src/main/java` | 0 | No other `@EventListener`/`ApplicationEventPublisher`/`*Event` classes found |

## Findings with Fixes

None.

## Clean Designs (worth citing as the convention to follow)

### `FootprintCalculatedEvent` (`footprint.internal.DefaultFootprintFacade` → `footprint.audit.FootprintAuditListener`)

```
DefaultFootprintFacade ──FootprintCalculatedEvent{correlationId, comparisonGroupId, productId,
  (footprint.internal)    callerId, requestedAt, totalKgCo2, strictness, normalisation,
                           breakdown, warnings, factorVersions, dryRun}──> FootprintAuditListener  ✅
                                                                            (footprint.audit)
                           no callback to publisher · no should/must flags ·
                           rich, self-sufficient payload · single consumer
```

- Names a business occurrence ("a footprint was calculated"), not an entity-field dump — passes the CRUD test despite the `-ed` suffix.
- No `should*`/`needs*` flags, no imperative naming, publisher doesn't orchestrate the listener.
- Payload is rich enough that the listener (`@TransactionalEventListener(AFTER_COMMIT)`, `@Async`, retry + idempotent persistence) never calls back to the publisher.
- **Minor structural nit (not a named anti-pattern, low severity)**: the event class lives in `footprint.audit`, so the publisher in `footprint.internal` imports from its only consumer's package. Fine with one consumer; if a second one appears later, the event's "home" being named after today's single audit use case would read oddly. No action needed now.

## Deliberate Architectural Decisions

### `filterChange` (`plugin-sdk/this-plugin.ts` → `plugins/PluginMessageHandler.ts`)

- Fire-and-forget message; zero producers today (no plugin calls it), zero consumers wired in production (`PluginProvider` installs the handler without the `onFilterChange` option).
- Originally designed for iframe-based filter plugins (Req 11b/16/28); superseded by host-rendered native filters driven by manifest `filterKey`/`filterType`. Never removed after the redesign.
- **Team's rationale (confirmed)**: keep it — future plugins may want a richer custom filter UI that reports changes via `filterChange` rather than the manifest-driven controls. Not a violation.

## Open Questions / Follow-up

- `filterChange` is currently unreachable in production regardless of the keep/delete decision: `PluginProvider` (`PluginContext.tsx:74`) never passes an `onFilterChange` callback, so a plugin calling `thisPlugin.filterChange()` today would have the message silently dropped. Worth a follow-up ticket so a future plugin author doesn't ship against a contract that quietly does nothing.

## Bulk Observations

- All plugin↔host communication other than `filterChange` (`getProducts`, `getData`/`setData`, `objects.*`, `pluginFetch`, `getToken`) is intentionally request/response RPC, not events — correctly modeled, no anti-pattern concern.
- No Kafka/RabbitMQ/MediatR/message-broker usage anywhere in the repo — the only pub/sub-style mechanisms are the in-process Spring `ApplicationEventPublisher` (footprint module) and the browser `postMessage` RPC/event layer (plugin system).
