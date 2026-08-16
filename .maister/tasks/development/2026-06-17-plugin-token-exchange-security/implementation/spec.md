# Specification: Plugin Token Exchange Security

## Goal

Eliminate direct forwarding of the user's Token-A from `server-sdk.ts` to the backend by replacing it with RFC 8693 Token Exchange (On-Behalf-Of), identical to the existing MCP implementation, and close four security gaps in the backend token infrastructure (T2–T5).

## User Stories

- As a plugin server process, I want to call backend APIs on behalf of a user using a short-lived, audience-scoped credential so that the user's original login token is never transmitted beyond the plugin frontend.
- As a security operator, I want backend-issued tokens to carry `jti`, `act`, `iss`, and `aud` claims so that tokens cannot be replayed or re-exchanged after issuance.
- As a security operator, I want token values and secrets to be absent from application logs so that log aggregation pipelines cannot expose credentials.
- As a DevOps engineer, I want the JWT secret to be mandatory from an environment variable so that no secret is ever committed to the repository.

## Core Requirements

### Functional Requirements

1. **FR1 — Eliminate Token-A forward in server-sdk.ts**: `createServerSDK()` must exchange Token-A for Token-B' via POST `/oauth2/token` (RFC 8693 grant) before every outbound `hostFetch()` call. No code path in the SDK may send Token-A to `/api/**`. If the exchange fails, the function must throw — the original token must never be used as a fallback. (Closes T1, satisfies R1, R10, R11)

2. **FR2 — plugin-server OAuth2 client registration**: A new Liquibase migration (`020-seed-plugin-server-oauth2-client.yaml`) must insert an `oauth2_registered_client` row for `client_id=plugin-server` with grant type `token-exchange` and scopes `['mcp:read', 'mcp:edit']`. Client authentication methods: `client_secret_post` and `client_secret_basic`. The bcrypt hash in the migration must be the hashed value of `PLUGIN_SERVER_CLIENT_SECRET_BCRYPT` env variable substitution — populated at deploy time, not hardcoded. (Satisfies R7)

3. **FR3 — `jti` and `act` claims in issued tokens**: `JwtTokenProvider.generateOAuth2Token()` must add a `jti` claim (`UUID.randomUUID().toString()`) on every invocation. The four-argument overload must accept an optional `actorClientId` parameter and, when non-null, set an `act` claim of the form `{"sub": "<clientId>"}`. `generateToken()` (login path) must also receive a `jti`. (Satisfies R5)

4. **FR4 — Re-exchange guard**: `OAuth2TokenFilter.handleTokenExchangeGrant()` must reject a `subject_token` whose `iss` claim equals `app.issuer` — a Token-B cannot serve as the subject of a further exchange. The check must occur immediately after `parseToken()` succeeds, before scope mapping. Response: HTTP 400 with `error=invalid_request` and message `"Re-exchange of issued tokens is not permitted"`. (Closes T5)

5. **FR5 — Conditional `aud`/`iss` enforcement**: After `parseToken()` in `JwtAuthenticationFilter`, the discriminator for enforcement is the presence of the `aud` claim (not `iss` alone). Call `jwtTokenProvider.parseRawClaims(token)` to read raw claims (the existing `ParsedToken` record does not expose `iss`/`aud`). If `claims.getAudience()` is non-null and non-empty (Token-B path), additionally validate that `claims.getIssuer() != null && claims.getIssuer().equals(configuredIssuer)`; reject with 401 on failure (do not set SecurityContext). Login tokens (Token-A, no `aud`) and OAuth2 authorization-code tokens (have `iss` but no `aud`) bypass this check, preserving full backward compatibility. `OAuth2IntrospectionFilter` must additionally validate that, when the introspected token has an `aud` claim, the calling `client_id` or the issuer URL is among the audience set. (Closes T4, satisfies R4)

6. **FR6 — Log redaction in OAuth2TokenFilter**: Replace all token values with `[REDACTED]` in the following log statements:
   - Line 69–71: replace the raw parameter map logging with a version that replaces the values of `subject_token`, `client_secret`, `access_token`, `refresh_token`, and `code` with `[REDACTED]`.
   - Line 166–167: replace `access_token` and `refresh_token` literal values with `[REDACTED]`.
   - Line 194: remove or redact `refresh_token` value.
   - Line 330: remove the log statement that prints the full token response body. (Closes T2, satisfies R6)

7. **FR7 — JWT secret from environment only**: Remove the hardcoded fallback from `application.properties` (`app.jwt.secret=${APP_JWT_SECRET:i/WZn...}`). The value must be `app.jwt.secret=${APP_JWT_SECRET}` with no default. Add `app.issuer=${APP_ISSUER:http://localhost:8080}` to `application.properties`. Wire the new `app.issuer` value into `OAuth2TokenFilter` and `JwtAuthenticationFilter` via constructor injection. (Closes T3, satisfies R7, R8)

8. **FR8 — Reduce MCP server debug logging**: In `mcp-server/src/main/resources/application.yml`, change the three `DEBUG` log levels under `logging.level` to `INFO` to prevent token-containing frames from appearing in structured logs.

### Non-Functional Requirements

- **NFR1 — Fail-closed**: Exchange failure in `server-sdk.ts` must throw; no silent fallback to Token-A. Backend: missing or invalid `aud` on a Token-B must yield 401, not pass-through.
- **NFR2 — Per-request exchange, no caching**: Token-B is exchanged fresh for every `hostFetch()` call, matching the MCP `TokenExchangeClient` design ("No caching — exchange per request").
- **NFR3 — No custom cryptography**: Only `jjwt 0.12.6` (HS256) on the backend and native `URLSearchParams`/`fetch` on the TypeScript side. No hand-rolled JWT parsing, HMAC, or base64 manipulation for auth purposes.
- **NFR4 — No regression**: All existing tests (`OAuth2IntegrationTests`, `TokenExchangeIntegrationTests`, `OAuth2IntrospectionTests`, MCP test suites) must continue to pass without modification.

### Security Requirements (R1–R12)

| Req | Description | Implementation |
|-----|-------------|----------------|
| R1 | Token-A never sent to backend | FR1: exchangeToken() in server-sdk.ts replaces raw forward |
| R2 | Backend receives only short-lived, audience-scoped credential | FR1+FR3: Token-B has `aud=issuer`, 15 min expiry |
| R3 | Minimal scope/role | FR1+FR2: plugin-server mapped to `mcp:read`/`mcp:edit` only |
| R4 | Validate sig, iss, aud, scope, iat, exp | FR5: conditional aud/iss check in JwtAuthenticationFilter; jjwt validates sig+exp |
| R5 | jti / replay protection | FR3: UUID jti on every generated token |
| R6 | No tokens/secrets in logs | FR6: [REDACTED] substitution in OAuth2TokenFilter; FR8: INFO level in MCP |
| R7 | No secrets in code/repo | FR7: mandatory env var, no fallback; FR2: Liquibase uses env substitution for secret hash |
| R8 | Key rotation support | FR7: change APP_JWT_SECRET env var + restart = full rotation |
| R9 | Auth errors do not reveal details | Existing sendError() returns generic `invalid_request`/`invalid_grant`/`invalid_client` — preserve this pattern in re-exchange guard |
| R10 | Fail closed when exchange unavailable | FR1: throw on non-OK response, no fallback branch |
| R11 | No runtime flag to revert to Token-A forward | FR1: exchangeToken() is the only code path; no feature flag or bypass |
| R12 | No custom crypto — proven libraries only | NFR3: jjwt + fetch/URLSearchParams only |

## Token Exchange Flow

```
Plugin Server (Next.js API route)
    |
    | 1. receive request from browser (Authorization: Bearer Token-A)
    |
    v
createServerSDK(pluginId, baseUrl, req)
    |
    | 2. exchangeToken(tokenA, baseUrl)
    |    POST /oauth2/token
    |      grant_type=urn:ietf:params:oauth:grant-type:token-exchange
    |      subject_token=<Token-A>
    |      subject_token_type=urn:ietf:params:oauth:token-type:access_token
    |      client_id=<PLUGIN_OAUTH_CLIENT_ID>
    |      client_secret=<PLUGIN_OAUTH_CLIENT_SECRET>
    |
    v
AJ Backend — OAuth2TokenFilter.handleTokenExchangeGrant()
    |
    | 3a. authenticate plugin-server client (client_secret_post or Basic)
    | 3b. parseToken(subject_token) — verify sig + exp
    | 3c. [NEW] if subject_token.iss == app.issuer → reject (re-exchange guard)
    | 3d. map scopes: mcp:read→READ, mcp:edit→EDIT
    | 3e. generateOAuth2Token(sub, scopes, issuer, issuer, clientId)
    |       → jti=UUID, iss=app.issuer, aud=app.issuer, act={"sub":"plugin-server"}
    |
    | 4. return Token-B' (access_token, expires_in=900)
    |
    v
createServerSDK — hostFetch()
    |
    | 5. Authorization: Bearer Token-B'
    v
AJ Backend — JwtAuthenticationFilter
    |
    | 6. parseToken(Token-B') — verify sig
    | 7. [NEW] if iss claim present → assert iss==app.issuer AND aud not empty
    | 8. set SecurityContext (username, permissions: [READ, EDIT])
    |
    v
Controller / Service layer (authorized request)
```

## Reusable Components

### Existing Code to Leverage

| Component | File | What it provides |
|-----------|------|-----------------|
| `TokenExchangeClient.java` | `mcp-server/src/main/java/pl/devstyle/aj/mcp/security/TokenExchangeClient.java` | Complete RFC 8693 exchange pattern — TypeScript `exchangeToken()` mirrors this exactly |
| `McpIntrospectionFilter.java` | `mcp-server/src/main/java/pl/devstyle/aj/mcp/security/McpIntrospectionFilter.java` | Demonstrates fail-closed pattern and per-request exchange |
| `010-seed-mcp-server-oauth2-client.yaml` | `src/main/resources/db/changelog/2026/010-seed-mcp-server-oauth2-client.yaml` | Exact Liquibase structure and SQL template to copy for plugin-server |
| `MCP_SCOPE_MAPPING` | `OAuth2TokenFilter.java:33–36` | Already maps `mcp:read`/`mcp:edit` — plugin client reuses same scopes, zero change needed |
| `OAuth2ClientAuthenticator` | `src/main/java/pl/devstyle/aj/core/oauth2/OAuth2ClientAuthenticator.java` | Client credential extraction and verification — no change needed |
| `generateOAuth2Token(username, scopes, issuer, audience)` | `JwtTokenProvider.java:51–65` | Four-argument overload already exists; needs `jti` and `act` additions only |
| `parseRawClaims()` | `JwtTokenProvider.java:67–78` | Used by re-exchange guard to read `iss` claim from subject token |
| `registerConfidentialClient()` / `generateTokenA()` helpers | `TokenExchangeIntegrationTests.java` | Test infrastructure to reuse in new test methods |

### New Components Required

| Component | Justification |
|-----------|---------------|
| `exchangeToken()` function in `server-sdk.ts` | No existing TypeScript token exchange — MCP equivalent is Java only |
| `020-seed-plugin-server-oauth2-client.yaml` | Separate migration per standards (small and focused); cannot share MCP client |
| `app.issuer` property injection in `OAuth2TokenFilter` and `JwtAuthenticationFilter` | Currently these classes derive issuer from the HTTP request (`getBaseUrl()`); the re-exchange guard and conditional aud check require a stable, configured value |

## Technical Approach

### server-sdk.ts Changes

The `exchangeToken()` helper function is added as a module-level private async function. It receives Token-A and `baseUrl`, posts to `/oauth2/token` with the RFC 8693 grant type, and returns the `access_token` string from the JSON response. It throws (with a descriptive message) on any non-OK HTTP status or missing `access_token` field.

Inside `createServerSDK()`, the `bearerToken` extraction is kept for the exchange input. The `hostFetch()` closure is modified to call `await exchangeToken(bearerToken, baseUrl)` and use the result as the outbound `Authorization` header value. When `bearerToken` is absent (unauthenticated context), `hostFetch` remains unchanged — no exchange is attempted and no Authorization header is sent, matching current behavior for no-auth paths.

Client credentials are read from `process.env.PLUGIN_OAUTH_CLIENT_ID` and `process.env.PLUGIN_OAUTH_CLIENT_SECRET`. No new npm dependencies are introduced (native `fetch` + `URLSearchParams`).

### JwtTokenProvider Changes

`generateOAuth2Token()` gains a fifth parameter: `String actorClientId` (nullable). The four-argument overload delegates to the five-argument form with `null` as actor. The builder in the five-argument form adds:
- `.id(UUID.randomUUID().toString())` for `jti`
- `.claim("act", Map.of("sub", actorClientId))` when `actorClientId` is non-null

`generateToken()` (login) gains `.id(UUID.randomUUID().toString())`.

The `issuer` field is injected into `JwtTokenProvider` via `@Value("${app.issuer}")` to enable the re-exchange guard and aud check to use the same canonical value.

### OAuth2TokenFilter Changes

**Re-exchange guard** (in `handleTokenExchangeGrant()`, immediately after `parseToken()` succeeds):
Call `parseRawClaims(subjectToken)` to read the `iss` claim. If `iss` equals the configured `app.issuer`, call `sendError(response, OAuth2Error.INVALID_REQUEST, "Re-exchange of issued tokens is not permitted")` and return.

**`act` claim** (in `handleTokenExchangeGrant()`): Pass `credentials.get().clientId()` as the fifth argument to `generateOAuth2Token()`.

**Log redaction**: The parameter map log at line 69–71 must filter sensitive keys. Replace with a stream that maps values of `subject_token`, `client_secret`, `access_token`, `refresh_token`, and `code` to `[REDACTED]`. Lines 166–167 and line 194 logs must replace token values with `[REDACTED]`. Line 330 (`log.info("OAuth2 token response body: {}", tokenResponseBody)`) must be removed entirely.

**`app.issuer` injection**: Add `private final String issuer` field injected via constructor from the configuration value.

### JwtAuthenticationFilter Changes

Inject `app.issuer` (String) via `@Value("${app.issuer}")` into the constructor alongside the existing `JwtTokenProvider`. After `parseToken()` returns a non-empty result, call `jwtTokenProvider.parseRawClaims(token)` to get the `Claims` object. Note: `ParsedToken` (returned by `parseToken()`) is a minimal record containing only `username` and `permissions` — it does NOT expose `iss` or `aud`. A second call to `parseRawClaims()` is required and is safe: `parseToken()` already verified the signature, so the second parse is equivalent to re-reading an already-trusted structure with no additional trust boundary.

With the `Claims` object available:
- If `claims.getAudience()` is non-null and non-empty (Token-B discriminator): additionally assert `claims.getIssuer() != null && claims.getIssuer().equals(configuredIssuer)`. On any failure: do NOT set SecurityContext; the request proceeds unauthenticated, yielding 401 from the downstream authorization rules.
- If `claims.getAudience()` is null or empty (Token-A / authorization-code tokens): skip enforcement entirely — no issuer check, no audience check.

This discriminator (`aud` presence, not `iss` presence) correctly handles three cases:
- Login Token-A: no `iss`, no `aud` → bypass
- OAuth2 auth-code/refresh tokens: have `iss`, no `aud` → bypass (backward compatible)
- Token-B (exchange): have both `iss` AND `aud` → full enforcement

### OAuth2IntrospectionFilter Changes

After parsing `claims` (line 71 of current file), add an `aud` validation: if `claims.getAudience()` is non-null and non-empty, verify that the authenticated client's `client_id` or the configured issuer URL appears in the audience set. If not, call `sendInactiveResponse()` (returns `{"active": false}`) rather than the active response. This prevents cross-service token use in introspection without exposing details.

### application.properties Changes

- Change `app.jwt.secret=${APP_JWT_SECRET:i/WZnrbvFqiPfShuZjGmc5kC7IXxRZfpueJEdgCzGFc=}` to `app.jwt.secret=${APP_JWT_SECRET}` (mandatory, no fallback).
- Add `app.issuer=${APP_ISSUER:http://localhost:8080}`.

**Test environment requirement**: All `@SpringBootTest` integration tests load `application.properties` at context startup. Removing the `APP_JWT_SECRET` fallback will cause context startup failure in any test environment that does not supply this variable. The implementation must add `app.jwt.secret=<base64-test-key>` to the test-specific properties. The standard Spring Boot test approach is to annotate the test base class or each test class with `@TestPropertySource(properties = {"app.jwt.secret=<base64-encoded-256bit-test-secret>"})` or to add the property to `src/test/resources/application-test.properties` with `@ActiveProfiles("test")`. The specific key value for tests can be the original committed fallback value (now only in test context), which is safe since it is not a production secret.

### mcp-server/application.yml Changes

Change `pl.devstyle: DEBUG`, `org.springframework.security: DEBUG`, and `io.modelcontextprotocol: DEBUG` to `INFO`.

### Liquibase Migration

New file `src/main/resources/db/changelog/2026/020-seed-plugin-server-oauth2-client.yaml`. Single changeSet scoped to `context: dev`. SQL inserts one row into `oauth2_registered_client` for `client_id=plugin-server` with grant `token-exchange`, scopes `mcp:read mcp:edit`, auth methods `client_secret_post` and `client_secret_basic`, and `ON CONFLICT (client_id) DO NOTHING`. Rollback: `DELETE FROM oauth2_registered_client WHERE client_id = 'plugin-server'`.

Following the exact pattern of `010-seed-mcp-server-oauth2-client.yaml`, the `client_secret` column must contain a hardcoded BCrypt hash of the dev secret (e.g., BCrypt of `"plugin-server-secret"`). This is a dev-only seed (`context: dev`) — its plain-text preimage is a well-known dev credential, not a production secret, identical in risk profile to `mcp-server-secret` already committed in `010-seed-mcp-server-oauth2-client.yaml`. Production deployment must replace this row with a properly generated BCrypt hash of a securely generated secret via a separate migration or deployment step. The implementation must compute a BCrypt hash of a chosen dev secret (e.g., using `htpasswd -bnBC 10 "" plugin-server-secret | tr -d ':\n'`) and embed it in the YAML. The corresponding plain-text dev secret is set in `PLUGIN_OAUTH_CLIENT_SECRET` environment variable for local development.

## Visual Design

Not applicable — this task has no UI surface.

## Environment Variables Required

| Variable | Where Used | Required In |
|----------|-----------|-------------|
| `APP_JWT_SECRET` | `application.properties` → `JwtTokenProvider` | All environments (no default) |
| `APP_ISSUER` | `application.properties` → `OAuth2TokenFilter`, `JwtAuthenticationFilter` | All environments (default: `http://localhost:8080` for dev) |
| `PLUGIN_OAUTH_CLIENT_ID` | `plugins/server-sdk.ts` | Plugin server process runtime |
| `PLUGIN_OAUTH_CLIENT_SECRET` | `plugins/server-sdk.ts` | Plugin server process runtime |
| `PLUGIN_SERVER_CLIENT_SECRET_BCRYPT` | Liquibase migration execution | Database migration runtime |

A new `plugins/.env.example` file must document `PLUGIN_OAUTH_CLIENT_ID` and `PLUGIN_OAUTH_CLIENT_SECRET` with placeholder values. No actual secrets in the file.

## Implementation Guidance

### Migration Strategy: Permissive to Strict aud Enforcement

Token-B aud enforcement is conditional — activated only when the token carries an `iss` claim. This design allows a zero-downtime rollout:

1. Deploy backend changes (re-exchange guard, jti/act, log redaction, secret externalization) — existing Token-A users (no `iss`) are unaffected.
2. Deploy Liquibase migration to register `plugin-server` client.
3. Deploy `server-sdk.ts` changes with new env vars set — plugin servers now exchange tokens; Token-B carries `iss` and `aud`; enforcement activates automatically.
4. No runtime feature flag is needed or permitted (R11).

### Testing Approach

Write 2–8 focused tests per implementation step group. Run only the group-relevant test class during implementation; run the full suite before each commit.

New test groups required:

**Group A — `TokenExchangeIntegrationTests.java` (add 4 new tests)**

| Test method | Scenario | Expected |
|-------------|----------|----------|
| `tokenExchange_reExchange_returnsInvalidRequest` | Submit a Token-B (has `iss=app.issuer`) as `subject_token` | HTTP 400, `error=invalid_request` |
| `tokenExchange_success_tokenBHasJtiClaim` | Successful exchange | Parsed Token-B contains non-null `jti` claim (UUID format) |
| `tokenExchange_success_tokenBHasActClaim` | Successful exchange with plugin-server client | Parsed Token-B contains `act.sub = "plugin-server"` (or registered client id) |
| `tokenExchange_wrongAudience_returns401OnApiAccess` | Use Token-B issued for one audience to call `/api/**` protected by a different audience | 401 response |

**Group B — `OAuth2IntrospectionTests.java` (add 1 new test)**

| Test method | Scenario | Expected |
|-------------|----------|----------|
| `introspect_tokenWithAudience_wrongCallerClient_returnsInactive` | Introspect Token-B where `aud` does not include calling client | `{"active": false}` |

**Group C — `JwtTokenProviderTests.java` (add 3 new tests)**

| Test method | Scenario | Expected |
|-------------|----------|----------|
| `generateOAuth2Token_withActorClientId_includesActClaim` | Generate with `actorClientId="mcp-server"` | `act.sub == "mcp-server"` in raw claims |
| `generateOAuth2Token_alwaysIncludesJti` | Generate any token | `jti` claim present, parseable as UUID |
| `generateOAuth2Token_withNullActor_noActClaim` | Generate with `actorClientId=null` | `act` claim absent from raw claims |

**Group D — `plugin-sdk-auth.test.ts` (full rewrite)**

The existing test at line 68–88 (`"includes Authorization header when token is provided"`) currently asserts that Token-A is forwarded directly to the host API — this is the vulnerable behavior being eliminated. The entire `describe("server-sdk JWT propagation")` block must be rewritten.

New test cases for `plugin-sdk-auth.test.ts`:

| Test | Scenario | Expected |
|------|----------|----------|
| `exchanges Token-A for Token-B before calling host API` | Mock fetch to intercept `/oauth2/token` (returns fake Token-B) then `/api/products` | First fetch call is to `/oauth2/token`; second call uses `Authorization: Bearer <token-B>`, not Token-A |
| `throws when token exchange fails` | Mock fetch to return 500 from `/oauth2/token` | `sdk.hostApp.getProducts()` rejects; no second fetch to `/api/**` |
| `does not send Token-A to host API under any circumstance` | Mock fetch to capture all calls; Token-A = "original-token"; exchange returns "exchanged-token" | Verify no fetch call has `Authorization: Bearer original-token` |
| `proceeds without Authorization header when no token provided` | Create SDK without request object | `hostFetch` called without `Authorization` header (unauthenticated path unchanged) |

The `describe("server-sdk data endpoint URLs")` block: these tests create the SDK without a bearer token (`createServerSDK("plugin-id", baseUrl)` with no `request` argument). Since `bearerToken` is undefined, no exchange is attempted and no call to `/oauth2/token` is made. These tests only need to mock the target API endpoint — no exchange mock required. The URL assertions on the API calls remain unchanged.

### Standards Compliance

- **`standards/global/minimal-implementation.md`**: No new classes created — `exchangeToken()` is a module-level function, not a class. The five-argument `generateOAuth2Token` overload replaces the four-argument form progressively with a default delegate. No speculative methods.
- **`standards/backend/security.md`**: JWT error responses remain centralized in `sendError()` with generic messages (R9). No `@PreAuthorize` added.
- **`standards/backend/migrations.md`**: Single-purpose changeSet; rollback implemented; descriptive name; `context: dev` scope; never modifies the existing `010-` changeSet.
- **`standards/testing/backend-testing.md`**: Integration tests with TestContainers; `@Import(TestcontainersConfiguration.class)`; `action_condition_expectedResult` naming; 2–8 tests per group; `var` for locals; `mockMvc` + `jsonPath()` for HTTP assertions; new tests added to existing classes (not new classes per se, except where the class is new).
- **`standards/global/error-handling.md`**: Re-exchange guard uses existing `sendError()` pattern; error message is generic enough to satisfy R9.
- **`standards/global/conventions.md`**: New env vars documented in `.env.example`; no fallback secret in repo.

## Out of Scope

- HS256 → RS256/ES256 algorithm migration (T6) — separate future task
- Logistics plugin (`plugins/logistics/`) — browser-only, no server-side SDK usage
- External IdP / Keycloak integration
- Token revocation store for `jti` replay prevention (R5 is satisfied by short expiry + `jti` presence; revocation store is a future hardening step)
- Rate limiting on `/oauth2/token` endpoint
- Authorization Code flow changes — not affected by this task
- `product-validator` plugin — no server-SDK usage identified

## Success Criteria

1. `grep -r "Authorization.*Bearer" plugins/server-sdk.ts` finds no direct token forward — only the `exchangeToken()` result is used.
2. All 12 required test scenarios pass (Groups A–D above: A×4, B×1, C×3, D×4).
3. Existing test suites (`OAuth2IntegrationTests`, `TokenExchangeIntegrationTests`, `OAuth2IntrospectionTests`, MCP tests) pass without modification.
4. `grep -r "access_token\|subject_token\|client_secret" <log output>` finds only `[REDACTED]` markers, never raw values.
5. Application fails to start when `APP_JWT_SECRET` is unset (Spring bind failure).
6. `application.properties` contains no secret value — `git grep "APP_JWT_SECRET:" application.properties` returns no match.
7. Token-B parsed claims include non-null `jti` (UUID), `iss` matching `app.issuer`, `aud` equal to `app.issuer`, and `act.sub` equal to the exchanging client's `client_id`.
8. Attempting to use a Token-B as `subject_token` in `/oauth2/token` returns HTTP 400 with `error=invalid_request`.
