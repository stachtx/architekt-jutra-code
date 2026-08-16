# Specification Audit: Plugin Token Exchange Security

**Date**: 2026-06-17
**Spec file**: `.maister/tasks/development/2026-06-17-plugin-token-exchange-security/implementation/spec.md`
**Auditor**: spec-auditor agent (independent)
**Compliance status**: MOSTLY COMPLIANT (no critical gaps; 6 findings require attention before implementation)

---

## Summary

The specification is structurally sound, architecturally coherent, and maps well to the actual codebase. All 12 security requirements are addressed at a high level and the token exchange flow diagram is accurate. Six findings are recorded below: two High, three Medium, and one Low. None are showstoppers, but two High findings can cause a broken CI pipeline or incorrect runtime behavior if left unaddressed by the implementor.

---

## Findings

### Finding 1 — HIGH: APP_JWT_SECRET removal breaks all CI/CD environments that do not set this env var

**Spec Reference**: FR7 — "Remove the hardcoded fallback from `application.properties`. The value must be `app.jwt.secret=${APP_JWT_SECRET}` with no default."

**Implementation Evidence**:
- `src/main/resources/application.properties:4`: `app.jwt.secret=${APP_JWT_SECRET:i/WZnrbvFqiPfShuZjGmc5kC7IXxRZfpueJEdgCzGFc=}`
- `src/test/java/pl/devstyle/aj/core/security/JwtTokenProviderTests.java:17`: unit test constructs `JwtTokenProvider` directly with a hardcoded `TEST_SECRET` — does not depend on `application.properties`
- `src/test/java/pl/devstyle/aj/core/oauth2/TokenExchangeIntegrationTests.java`: uses `@SpringBootTest` with `TestcontainersConfiguration` — it will load `application.properties`. If `APP_JWT_SECRET` is unset in CI, the Spring context fails to start.

**Gap Description**: The spec mandates removing the fallback — a correct security decision (T3). However, it does not specify what value integration tests should use for `APP_JWT_SECRET`. All `@SpringBootTest` test classes (`TokenExchangeIntegrationTests`, `OAuth2IntrospectionTests`, `OAuth2IntegrationTests`, `AuthIntegrationTests`) load the real `application.properties`. Without the fallback, they will fail at context startup unless `APP_JWT_SECRET` is configured in the test environment.

The spec notes "CI failing without APP_JWT_SECRET" as a known warning but gives no resolution. The statement "Application fails to start when `APP_JWT_SECRET` is unset (Spring bind failure)" is listed as a success criterion — but this is also true in the test runner.

**Missing from spec**: One of the following must be explicitly specified:
- A test-specific `application-test.properties` override that supplies a test value for `APP_JWT_SECRET`
- An annotation like `@TestPropertySource(properties = "APP_JWT_SECRET=<test-key>")` on the integration test base class
- A CI pipeline env var instruction

**Category**: Incomplete

**Severity**: High — without this, all existing integration tests break after FR7 is applied, violating NFR4 ("no regression"). The implementor is left to improvise.

**Recommendation**: Add a `src/test/resources/application.properties` (or `application-test.properties`) with a test-safe value: `APP_JWT_SECRET=dGhpcy1pcy1hLXRlc3Qtc2VjcmV0LWtleS0zMmJ5dGVzIQ==` (same key already used in `JwtTokenProviderTests`). Document this in the spec under "Implementation Guidance".

---

### Finding 2 — HIGH: `parseRawClaims()` double-parse in JwtAuthenticationFilter spec is ambiguous — implementation note contradicts instruction

**Spec Reference**: FR5 / "JwtAuthenticationFilter Changes" section:

> "After `parseToken()` returns a non-empty result, check whether the raw token contains an `iss` claim by calling `jwtTokenProvider.parseRawClaims(token)`."

Immediately after:

> "Note: `parseRawClaims()` is already called once; to avoid two parse calls, the implementation may check `claims.getIssuer()` directly from the already-parsed Claims object rather than re-parsing."

**Implementation Evidence**:
- `JwtAuthenticationFilter.java:28`: calls `jwtTokenProvider.parseToken(token)` which internally calls `Jwts.parser()...parseSignedClaims(token)` — this verifies the signature and returns a `ParsedToken(username, permissions)` record.
- `JwtTokenProvider.java:80`: `ParsedToken` record only contains `username` and `permissions` — it does NOT expose `iss` or `aud` claims. The issuer is not accessible from the `ParsedToken` return value.
- `JwtTokenProvider.java:67–78`: `parseRawClaims()` exists and returns the raw `Claims` object, which includes `getIssuer()` and `getAudience()`.

**Gap Description**: The spec text instructs calling `parseRawClaims(token)`, then immediately says not to, but the alternative it suggests — "check `claims.getIssuer()` directly from the already-parsed Claims object" — is not possible with the current `ParsedToken` record. The `parseToken()` method does not expose raw `Claims`; it only returns `ParsedToken`. So either:

(a) `parseRawClaims()` must be called (a second parse, but safe — same key, no new trust boundary introduced), or
(b) `parseToken()` must be refactored to return a richer object that includes `iss` and `aud`, or
(c) `ParsedToken` record must be extended with `issuer` and `audience` fields.

The spec does not explicitly choose between these options. An implementor following the note literally will be confused — the "already-parsed Claims object" does not exist in the `JwtAuthenticationFilter` context.

Option (a) — calling `parseRawClaims()` — verifies the same signature twice, which is a minor overhead but has no trust boundary issue (both calls use the same `secretKey`). The spec states this explicitly but then undermines it with the note.

**Category**: Ambiguous

**Severity**: High — the implementor has two contradictory instructions and the stated alternative is technically incorrect given the current API. This is likely to cause either an incorrect implementation or implementation delay.

**Recommendation**: Remove the contradictory note. Choose one approach explicitly:

Preferred: call `parseRawClaims(token)` after `parseToken()` succeeds to read `iss` and `aud`. This is the correct pattern given the existing API — two parses with the same key, safe, minimal overhead (JWT is small). The spec should say: "Call `jwtTokenProvider.parseRawClaims(token)` to retrieve `iss` and `aud`; this is a second signature verification against the same key, which is safe and does not introduce a new trust boundary."

Alternative (if performance is a concern): extend `ParsedToken` to include `Optional<String> issuer` and `Set<String> audience` — but this requires changes to `JwtTokenProvider.parseToken()` and all its callers, which the spec does not account for.

---

### Finding 3 — MEDIUM: Liquibase migration spec conflicts with MCP template — `client_secret` column handling is structurally different

**Spec Reference**: FR2 / "Liquibase Migration" section:

> "The `client_secret` column value is `'${PLUGIN_SERVER_CLIENT_SECRET_BCRYPT}'` — a Liquibase property substitution filled at migration execution time, not a literal hash."

**Implementation Evidence**:
- `src/main/resources/db/changelog/2026/010-seed-mcp-server-oauth2-client.yaml:16`: the MCP migration hardcodes a bcrypt hash literal: `'$2a$10$kdsYFdOZvZGhotv/59JvIekfLfCooZOUhyS1Uwv39Wh2MDKbEQT22'`
- Liquibase property substitution (`${VAR}`) requires either a `liquibase.properties` file or command-line `-DpropertyName=value` arguments at migration time. It is not an environment variable mechanism — it is distinct from Spring's `${ENV_VAR}` property resolution.

**Gap Description**: The spec says to use `'${PLUGIN_SERVER_CLIENT_SECRET_BCRYPT}'` as Liquibase property substitution. This is a valid mechanism but:

1. The MCP template (the reference the spec explicitly cites) does NOT use Liquibase property substitution — it embeds a literal bcrypt hash. The spec introduces a new, more complex deployment dependency that the template does not demonstrate.
2. Liquibase property substitution requires `enableSubstitution=true` (or `liquibase.changelogParseMode=STRICT` disabled) in Liquibase configuration, or the `--changelogParameters` CLI flag. The spec does not specify how this is wired in the Spring Boot / Maven configuration.
3. If `PLUGIN_SERVER_CLIENT_SECRET_BCRYPT` is not set at migration time, Liquibase will substitute an empty string or throw depending on configuration, inserting an invalid (empty) bcrypt hash.
4. The `spring.liquibase.contexts=dev` in `application.properties` does not mention any `changelogParameters` configuration.

**Category**: Incomplete

**Severity**: Medium — the migration pattern works in theory but introduces a new deployment step not present for the MCP client. The implementor needs explicit guidance on how to pass `PLUGIN_SERVER_CLIENT_SECRET_BCRYPT` to Liquibase at migration time. Without this, the migration will fail or insert an invalid secret.

**Recommendation**: Either (a) follow the MCP template pattern exactly and embed a pre-computed dev bcrypt hash as a literal in the migration (dev context only), document that production deployments must run a separate migration with the production hash; or (b) if Liquibase substitution is required, specify the exact Liquibase configuration in `application.properties` (`spring.liquibase.parameters.PLUGIN_SERVER_CLIENT_SECRET_BCRYPT=${PLUGIN_SERVER_CLIENT_SECRET_BCRYPT}`) which Spring Boot 3.x+ supports via `spring.liquibase.parameters.*`.

---

### Finding 4 — MEDIUM: `plugin-sdk-auth.test.ts` rewrite specification lacks detail on mock setup for the `server-sdk data endpoint URLs` describe block

**Spec Reference**: Group D test specification, last paragraph:

> "The `describe("server-sdk data endpoint URLs")` block must be updated: mock `fetch` must handle the `/oauth2/token` exchange call first, then the API call. The URL assertions on the API calls remain unchanged."

**Implementation Evidence**:
- `src/main/frontend/src/test/plugin-sdk-auth.test.ts:90–124`: The `server-sdk data endpoint URLs` describe block currently creates an SDK without a request object (`createServerSDK("my-plugin", "http://localhost:8080")`), meaning `bearerToken` will be undefined. After the spec changes, `hostFetch` will call `exchangeToken()` only if `bearerToken` is present. With no bearer token, `exchangeToken()` is skipped.

**Gap Description**: The spec says "mock `fetch` must handle the `/oauth2/token` exchange call first, then the API call" for the URL tests. But the existing URL tests create the SDK without a token. After the server-sdk.ts change, if `bearerToken` is absent, no exchange is made and the mock does not need to handle `/oauth2/token`. The spec instruction implies every test case in that describe block will now make two fetch calls (exchange + API), but this is only true when a bearer token is provided.

The spec does not clarify: Should the URL tests be updated to include a bearer token (making them require mock setup for `/oauth2/token`)? Or should they remain without a token (no exchange needed, single fetch call)?

This affects the mock implementation in these tests. The spec statement is ambiguous and will lead different implementors to different conclusions.

**Category**: Ambiguous

**Severity**: Medium — if the implementor adds unnecessary `/oauth2/token` mock handling to the URL tests (because the spec says to), the tests will pass only if the mock is correctly ordered. If the implementor omits it (because no bearer token is present), the tests pass trivially. Neither outcome is catastrophically wrong, but the ambiguity creates implementation friction.

**Recommendation**: Clarify explicitly: "The URL tests create SDK without a bearer token (`createServerSDK("my-plugin", "http://localhost:8080")` — no request object), so `exchangeToken()` is NOT called. The single `fetch` mock returning `{}` for any URL remains sufficient. No `/oauth2/token` handling is needed in these tests."

---

### Finding 5 — MEDIUM: `aud` claim in Token-B equals `app.issuer`, but `JwtAuthenticationFilter` aud validation logic is not fully specified

**Spec Reference**: FR5:

> "Assert `aud` is non-null and non-empty — missing audience → same rejection [401]"

Token Exchange Flow diagram, step 3e:

> `generateOAuth2Token(sub, scopes, issuer, issuer, clientId)` → `iss=app.issuer, aud=app.issuer`

Success Criterion 7:

> "Token-B parsed claims include... `aud` equal to `app.issuer`"

**Implementation Evidence**:
- `JwtTokenProvider.java:51–65`: `generateOAuth2Token(username, scopes, issuer, audience)` — audience is the `issuer` value passed as 4th arg. So Token-B will have `aud=["http://localhost:8080"]`.
- `JwtAuthenticationFilter.java`: currently checks only that `aud` is non-null and non-empty. Does NOT verify that `aud` contains `app.issuer`.
- `OAuth2IntrospectionFilter.java:92–95`: reads `aud` but does not validate it against any expected value in the current code. The spec adds validation "that the authenticated client's `client_id` or the issuer URL is among the audience set."

**Gap Description**: The spec specifies that JwtAuthenticationFilter must assert `aud` is non-null and non-empty, but does NOT specify whether the filter should also validate that `aud` contains the expected issuer value. Simply checking "non-empty" means any audience value (including a wrong one) would pass the check. Combined with the Token-B design where `aud=app.issuer`, this leaves open the question: does JwtAuthenticationFilter validate `aud == app.issuer`, or just `aud != empty`?

For the `OAuth2IntrospectionFilter`, FR5 is more specific: "verify that the authenticated client's `client_id` or the configured issuer URL appears in the audience set." But for `JwtAuthenticationFilter`, the spec only says "non-null and non-empty."

This asymmetry may be intentional (since JwtAuthenticationFilter already validates `iss==app.issuer`, a valid Token-B with wrong `aud` is unlikely but theoretically possible). However, the spec should state this explicitly.

**Category**: Ambiguous

**Severity**: Medium — the check as specified (non-empty aud) is functional and closes T4. The deeper aud value check is a defense-in-depth addition that may or may not be intended. The ambiguity could cause a code review dispute.

**Recommendation**: Explicitly state in FR5: "JwtAuthenticationFilter checks that `aud` is non-null and non-empty — the content of `aud` is not validated against `app.issuer` at this layer because `iss` validation already pins the token to this server. OAuth2IntrospectionFilter additionally validates that the calling `client_id` or issuer URL appears in `aud`." This resolves the asymmetry by design intent.

---

### Finding 6 — LOW: Success Criterion count is incorrect (states "11 required test scenarios" but spec defines 12)

**Spec Reference**: Success Criteria, criterion 2:

> "All 11 required test scenarios pass (Groups A–D above)."

**Implementation Evidence**: Counting the test table rows:
- Group A: 4 tests
- Group B: 1 test
- Group C: 3 tests
- Group D: 4 tests

Total: 12 tests.

**Gap Description**: The success criterion states 11 but the tables define 12. This is a minor editorial error but can cause confusion about whether all tests are passing or whether one is intentionally excluded.

**Category**: Incorrect

**Severity**: Low — editorial only. No implementation impact, but creates a confusing acceptance gate.

**Recommendation**: Update success criterion 2 to read "All 12 required test scenarios pass (Groups A–D above)."

---

## Specific Answers to Key Audit Questions

### Q1: Are all 12 security requirements (R1–R12) fully addressed with no ambiguity?

All 12 requirements are addressed. R1, R10, R11 (token forward elimination) map to FR1. R2, R3 (scoped credential) map to FR1+FR2+FR3. R4 (validate iss/aud/exp) maps to FR5 — with the caveat from Finding 5 that JwtAuthenticationFilter aud content validation is underspecified. R5 (jti replay) maps to FR3 — the spec explicitly defers revocation store to a future task, which is acceptable. R6 (no tokens in logs) maps to FR6+FR8. R7 (no secrets in repo) maps to FR7+FR2. R8 (rotation) maps to FR7. R9 (generic errors) is satisfied by the existing `sendError()` pattern. R12 (no custom crypto) maps to NFR3.

No requirement is left unaddressed at a high level. The ambiguities are in implementation details (Findings 2, 4, 5), not in requirement coverage.

### Q2: Is the `parseRawClaims()` call for the re-exchange guard safe?

Yes, calling `parseRawClaims()` after `parseToken()` is safe. Both methods call `Jwts.parser().verifyWith(secretKey).build().parseSignedClaims(token)` against the same HMAC key (`JwtTokenProvider.java:69–72`). There is no new trust boundary — the signature is re-verified with the same key, which is the only trusted verification mechanism. The overhead is a second HMAC-SHA256 verification of a small JWT, which is negligible. The spec note suggesting this is avoidable is technically incorrect given the current `ParsedToken` record design (see Finding 2).

For the re-exchange guard specifically (`OAuth2TokenFilter.handleTokenExchangeGrant()`): `parseToken()` is already called at line 230. Then `parseRawClaims()` is called to read `iss`. This double-parse pattern is safe, consistent with how `OAuth2IntrospectionFilter` uses `parseRawClaims()` directly.

### Q3: Is the conditional `aud`/`iss` check in JwtAuthenticationFilter truly backward-compatible?

Yes, the conditional approach (check only when `iss` claim is present) is correct for backward compatibility. Verification against actual code:

- **Existing Token-A** (generated by `generateToken()` at `JwtTokenProvider.java:29`): Does not set `.issuer()` — `claims.getIssuer()` returns null. The conditional block is skipped. SecurityContext is set normally. No regression.

- **Existing OAuth2 tokens from auth code flow** (generated by `generateOAuth2Token(username, scopes, issuer)` — 3-arg form at line 47, which calls 4-arg with `null` audience): Sets `iss` but NOT `aud`. After the spec change, when the filter sees `iss != null` → asserts `aud` non-empty → fails (aud is null). **This is a regression for the authorization code flow tokens.**

  The spec's flow diagram shows Token-B as the only token with `iss`, but `handleAuthorizationCodeGrant()` and `handleRefreshTokenGrant()` also call `generateOAuth2Token()` with an issuer (lines 161, 190). These tokens carry `iss` but no `aud`. After FR5, they would be rejected by `JwtAuthenticationFilter` with a 401.

  This is a significant backward compatibility risk not addressed in the spec. The mitigation strategy ("Migration Strategy: Permissive to Strict" section) mentions "existing Token-A users (no `iss`) are unaffected" — but it does not consider tokens issued by the authorization code flow, which DO carry `iss`.

  This deserves a clarification question (see below).

### Q4: Is the Liquibase migration spec correct for the shared `plugin-server` client?

The one-migration-for-one-shared-client design is correct per decision D3 (scope-clarifications.md). Both `ai-description` and `product-validator` plugins will use the same `PLUGIN_OAUTH_CLIENT_ID=plugin-server` credential. The migration structure mirrors `010-seed-mcp-server-oauth2-client.yaml` exactly (same grant type, same scopes, same auth methods). The `ON CONFLICT DO NOTHING` clause is present. Rollback is specified.

The concern is about the Liquibase property substitution mechanism for `client_secret` — see Finding 3. Otherwise the migration design is sound.

### Q5: Is the `plugin-sdk-auth.test.ts` rewrite specification complete enough for the implementor?

Mostly, but with a gap (Finding 4). The four new test cases in Group D are well-specified. The critical security assertions ("no fetch call has `Authorization: Bearer original-token`") are explicit. The mock pattern is clear for the new tests.

The gap is in the existing `server-sdk data endpoint URLs` describe block — the spec says "mock `fetch` must handle the `/oauth2/token` exchange call first" but the tests in that block do not provide a bearer token, so no exchange will occur. The implementor needs explicit guidance on whether to add a bearer token to these tests (making them a two-fetch scenario) or leave them as-is (no bearer token, no exchange, single fetch).

What is missing: explicit mock setup code or pseudocode for the Group D tests. The spec describes behavior but not mock structure. The existing test at line 69–88 uses `vi.spyOn(globalThis, "fetch")` with a single mock response. The new tests need a mock that handles two sequential fetch calls (to `/oauth2/token` and then to `/api/**`). The spec does not show how to set up a conditional mock per URL. For a TypeScript implementor unfamiliar with Vitest mock sequencing, this detail matters.

**Recommendation**: Add a note like: "Use `vi.fn().mockResolvedValueOnce(tokenExchangeResponse).mockResolvedValueOnce(apiResponse)` to mock sequential fetch calls."

### Q6: Are the warnings from spec-creator (CI failing without APP_JWT_SECRET, plugin-sdk-auth.test.ts breakage) adequately addressed?

No — see Finding 1 for APP_JWT_SECRET. The warning is acknowledged in the spec but not resolved. The spec identifies the problem ("Application fails to start when APP_JWT_SECRET is unset") as both a success criterion AND an unresolved risk. This is contradictory.

For `plugin-sdk-auth.test.ts` breakage: the spec is adequate. Group D explicitly mandates a full rewrite of the `describe("server-sdk JWT propagation")` block and provides 4 replacement test cases. The risk is acknowledged and resolved in the spec.

---

## Clarification Required

### C1: Do authorization code flow tokens (Token issued by `handleAuthorizationCodeGrant`) carry `iss`?

Examining `OAuth2TokenFilter.java:161`:
```java
String issuer = getBaseUrl(request);
String accessToken = jwtTokenProvider.generateOAuth2Token(data.username(), grantedScopes, issuer);
```

This uses the 3-arg form of `generateOAuth2Token()` (`JwtTokenProvider.java:47`), which delegates to the 4-arg form with `null` audience. The 4-arg form sets `.issuer(issuer)`. So yes — authorization code tokens carry `iss` but not `aud`.

After FR5 is applied, `JwtAuthenticationFilter` will reject these tokens because: `iss != null` → check `aud` → `aud == null` → reject (401).

**Question**: Is the intent of FR5 to require `aud` on all tokens that carry `iss`, including authorization code flow tokens? If yes, `handleAuthorizationCodeGrant()` and `handleRefreshTokenGrant()` must be updated to pass an audience — which the spec does not mention. If no, the conditional check must use a more specific discriminator than just `iss != null` (e.g., check for both `iss` AND that `iss == app.issuer`, or check for the presence of `act` claim as the Token-B marker).

This is the most significant unresolved ambiguity and may require a spec update before implementation can safely proceed.

---

## Minor Observations

- **FR6 log redaction line numbers**: The spec references "Line 69–71", "Line 166–167", "Line 194", "Line 330" in `OAuth2TokenFilter.java`. These match the actual file exactly (verified). The line 194 statement only logs `scope`, not a token value — the current code at line 194 is `log.info("OAuth2 token refreshed | user={} | scope={}", data.username(), data.scope())`. This is not a token leak. Examine whether the spec's intent for line 194 refers to a different version of the file or is referring to the `refresh_token` parameter read earlier in the method (line 171).

- **FR8 MCP debug logging**: `mcp-server/src/main/resources/application.yml:34–36` confirms the three DEBUG entries exist exactly as specified. The change is straightforward.

- **NFR4 regression**: `generateTokenA()` helper in `TokenExchangeIntegrationTests.java:73` calls `jwtTokenProvider.generateOAuth2Token("admin", Set.of("mcp:read", "mcp:edit"), "http://localhost")` — 3-arg form, which sets `iss`. After FR5, if `JwtAuthenticationFilter` rejects tokens with `iss` but no `aud`, using this `generateTokenA()` as a subject_token in the exchange and then using the resulting Token-B in API calls should still work (Token-B has `aud`). However, any existing test that uses the 3-arg `generateOAuth2Token()` token directly for API access (not via exchange) would break under the new aud/iss check — because those tokens have `iss` but no `aud`. This reinforces Clarification C1 as the most critical open question.

- **`generateToken()` (login flow)**: The spec adds `jti` to `generateToken()`. Existing code at `JwtTokenProvider.java:29–43` uses `generateTokenWithExpiration()` as the delegate. The spec's `generateToken()` change is to add `.id(UUID.randomUUID().toString())` — this is additive and does not break any existing test since `jti` is not currently asserted anywhere in the test suite.

---

## Compliance Status: MOSTLY COMPLIANT

The specification is implementable and closes the stated security gaps. Two actions are required before implementation begins:

1. **Resolve Clarification C1** (auth code flow token backward compatibility with FR5) — this may require a one-line scope adjustment to the aud/iss check in JwtAuthenticationFilter.

2. **Resolve Finding 1** (test environment APP_JWT_SECRET) — specify how integration tests obtain a value for `APP_JWT_SECRET` after the fallback is removed.

All other findings (2–6) can be resolved during implementation with minimal delay.
