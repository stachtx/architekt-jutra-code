# Gap Analysis: Plugin Token Exchange Security

**Date**: 2026-06-17
**Risk Level**: Medium
**Effort Estimate**: Medium

---

## Task Characteristics

- Has reproducible defect: no (known vulnerability, not a crash/runtime defect)
- Modifies existing code: yes
- Creates new entities: yes (Liquibase migrations, env var schema)
- Involves data operations: yes (oauth2_registered_client INSERT via Liquibase)
- UI heavy: no

---

## Gaps Identified

### Missing Features

**1. Token exchange in server-sdk.ts**
Lines 56–66 extract Token-A and forward it verbatim. No `exchangeToken()` helper exists; no RFC 8693 call. Entire exchange flow absent.

**2. Plugin OAuth2 client registrations**
Only `010-seed-mcp-server-oauth2-client.yaml` exists. No changesets for `ai-description` or `product-validator`. Without registered clients `/oauth2/token` returns `invalid_client`.

**3. Re-exchange guard (T5)**
`handleTokenExchangeGrant()` (OAuth2TokenFilter lines 197–260) calls `parseToken(subjectToken)` with no check whether subject_token already has `iss` == backend issuer. A Token-B holder can re-exchange Token-B.

**4. `jti` and `act` claims missing from Token-B**
`generateOAuth2Token()` (JwtTokenProvider.java:51–65) has no `id()` call and no `act` claim.

**5. `aud`/`iss` enforcement on Token-B consumption (T4)**
`JwtAuthenticationFilter` calls `parseToken()` which validates signature only. Token-A and Token-B are parsed identically.

**6. Token values logged in plaintext (T2)**
- OAuth2TokenFilter.java:69–71: full request param map including `subject_token`
- OAuth2TokenFilter.java:166–167: `access_token` and `refresh_token` in plaintext
- OAuth2TokenFilter.java:330: full response body JSON with `access_token`

**7. JWT secret hardcoded in repository (T3)**
`application.properties:4` — `app.jwt.secret=${APP_JWT_SECRET:i/WZnrbvFqiPfShuZjGmc5kC7IXxRZfpueJEdgCzGFc=}` — real Base64 key committed to repo.

### Incomplete Features

**`plugin-sdk-auth.test.ts`**
125 lines currently asserting the vulnerable (forward) behavior. Must be fully rewritten to assert: (a) Token-A is exchanged not forwarded, (b) fail-closed on exchange failure, (c) no Token-A in outbound headers.

**OAuth2IntrospectionFilter.java — audience validation**
Line 65 reports `aud` in response but does not validate it against expected audience.

---

## Resolved Questions

**Q1: Exact `iss` value in Token-B**
`iss` = `getBaseUrl(request)` in OAuth2TokenFilter, e.g., `http://localhost:8080`. The re-exchange guard must compare subject_token's `iss` against this same computed value. A new `app.issuer` property is recommended to avoid ambient coupling.

**Q2: JwtAuthenticationFilter differentiation between Token-A and Token-B**
It does NOT differentiate. Lines 97–102: if `permissions` claim null, try `scopes`. Both succeed. Recommended: if token has `iss` claim present → it's a Token-B → enforce aud/iss. Tokens with no `iss` (Token-A) bypass check. This avoids breaking existing login path.

**Q3: Exact issuer string configuration**
Issuer is computed dynamically from `getBaseUrl(request)` at all three call sites (lines 160, 189, 251). No static issuer in `application.properties`. Recommendation: introduce `app.issuer=${APP_ISSUER:http://localhost:8080}` as a stable, configurable, testable value.

**Q4: Per-request exchange vs caching**
`TokenExchangeClient.java` Javadoc: "No caching — exchange per request." Per-request is the intended pattern. No caching required for initial implementation.

**Q5: Scope mapping for plugin clients**
`MCP_SCOPE_MAPPING` maps `mcp:read→READ`, `mcp:edit→EDIT`. Plugin clients should register scopes `['mcp:read', 'mcp:edit']` — same as MCP. Mapping does not need to change. Zero code change.

---

## Data Lifecycle Analysis

### Entity: oauth2_registered_client (plugin client rows)

| Operation | Status |
|-----------|--------|
| CREATE (Liquibase) | Missing for ai-description, product-validator |
| READ (findByClientId) | Present schema; absent plugin rows |
| UPDATE | N/A (immutable seeds) |
| DELETE (rollback) | Not created yet |

Missing migrations:
- `src/main/resources/db/changelog/2026/020-seed-ai-description-oauth2-client.yaml`
- `src/main/resources/db/changelog/2026/021-seed-product-validator-oauth2-client.yaml`

Both follow exact structure of `010-seed-mcp-server-oauth2-client.yaml`.

---

## Architectural Decision Required: Issuer Configuration

Current code computes `iss` dynamically from `getBaseUrl(request)`. `JwtAuthenticationFilter` would also need the issuer value for aud/iss enforcement.

**Option A (recommended)**: Introduce `app.issuer=${APP_ISSUER:http://localhost:8080}` property. Referenced in `handleTokenExchangeGrant()` re-exchange guard and `JwtAuthenticationFilter`.

**Option B**: Retain dynamic `getBaseUrl(request)` — `JwtAuthenticationFilter` has access to `HttpServletRequest`, so technically feasible, but creates ambient coupling to host headers.

---

## Decisions Required

### Critical

**1. Issuer configuration strategy**
- A: `app.issuer` property (recommended) — testable, explicit, decoupled from load balancer headers
- B: Dynamic `getBaseUrl(request)` retained everywhere

**2. Scope naming for plugin clients**
- A: Reuse `mcp:read` / `mcp:edit` for plugin clients (recommended) — zero code change, same permission model
- B: Introduce `plugin:read` / `plugin:edit` with extended mapping in `MCP_SCOPE_MAPPING`

**3. Plugin client credential strategy**
- A: Shared `PLUGIN_OAUTH_CLIENT_ID` / `PLUGIN_OAUTH_CLIENT_SECRET` for all plugins (recommended) — simpler deployment
- B: Per-plugin env vars (`AI_DESCRIPTION_OAUTH_CLIENT_ID`, etc.) — isolated identity and revocation per plugin

### Important

**4. Logistics plugin scope**
- A: Logistics is browser-only, no action needed (default)
- B: Add server-side infrastructure now for future routes

**5. `aud` enforcement scope**
- A: Conditional — enforce only when `iss` claim present in token (default) — minimizes blast radius
- B: Universal — add `aud` to all OAuth2 tokens and enforce globally

---

## Critical Issues

1. Missing Liquibase migrations — token exchange will fail at runtime without them
2. `plugin-sdk-auth.test.ts` currently asserts vulnerable behavior — must be fully rewritten
3. `app.jwt.secret` fallback is a real key committed to repo — T3 requires removal, not documentation

---

## Recommendations

1. T2 (logging) first — zero risk, strictly subtractive change
2. T3 (secret) — remove hardcoded fallback; app fails to start if `APP_JWT_SECRET` absent
3. T5 (re-exchange) — `iss` comparison + `jti`/`act` claim addition
4. T4 (aud/iss) — conditional enforcement based on `iss` claim presence
5. Plugin exchange in server-sdk.ts — `exchangeToken()` helper + Liquibase seeds + env vars
6. Tests — new test cases + full rewrite of `plugin-sdk-auth.test.ts`

---

```yaml
status: success
report_path: analysis/gap-analysis.md
risk_level: medium
effort_estimate: medium
task_characteristics:
  has_reproducible_defect: false
  modifies_existing_code: true
  creates_new_entities: true
  involves_data_operations: true
  ui_heavy: false
scope_expansion_recommended: false
```
