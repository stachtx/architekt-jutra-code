# Codebase Analysis Report

**Date**: 2026-06-17
**Task**: Plugin Token Exchange Security — eliminate direct user token forwarding from plugins to backend; replace with RFC 8693 Token Exchange (On-Behalf-Of), matching the existing MCP implementation; close gaps T2–T5.
**Analyzer**: codebase-analyzer skill (3 Explore agents: Code Analysis, Context Discovery, Pattern Mining)

---

## Summary

The codebase has a fully working RFC 8693 Token Exchange implementation for the MCP server that can serve as a direct template for the plugin path. The plugin SDK currently forwards Token-A (user JWT) verbatim to the backend — a critical vulnerability. Four additional security gaps exist: plaintext token logging in OAuth2TokenFilter (T2), a hardcoded JWT secret in application.properties (T3), missing aud/iss enforcement in JwtAuthenticationFilter and OAuth2IntrospectionFilter (T4), and no re-exchange prevention in the token exchange grant handler (T5).

---

## Files Identified

### Primary Files

**`plugins/server-sdk.ts`** (~70 lines)
- Entry point for all plugin-to-backend communication
- Lines 50–66: raw Token-A is extracted from the incoming request and forwarded directly as `Authorization: Bearer` — the root vulnerability
- Must be replaced with the RFC 8693 exchange flow

**`src/main/java/pl/devstyle/aj/core/oauth2/OAuth2TokenFilter.java`** (379 lines)
- Handles all OAuth2 grant types including the existing `token-exchange` grant
- Lines 69–71, 166–167, 194: plaintext token logging (T2)
- Lines 197–260: token exchange handler — no re-exchange guard (T5), no `act`/`jti` generation

**`src/main/java/pl/devstyle/aj/core/security/JwtTokenProvider.java`** (140 lines)
- Central JWT generation and parsing
- `parseToken()` (lines 88–107): no `aud`/`iss` validation (T4)
- `generateOAuth2Token()` (lines 51–65): no `jti` or `act` claim
- `generateToken()` (lines 36–43): no `jti` claim

**`src/main/java/pl/devstyle/aj/core/security/JwtAuthenticationFilter.java`** (54 lines)
- Accepts any valid JWT signature without checking `aud` or `iss` (T4)
- Tokens from any issuer accepted if signature validates

**`src/main/java/pl/devstyle/aj/core/oauth2/OAuth2IntrospectionFilter.java`** (140 lines)
- Uses `parseRawClaims()` without `aud` validation (T4)
- Will introspect tokens intended for a different audience

**`src/main/resources/application.properties`**
- `app.jwt.secret` hardcoded — no env-variable override (T3)

### Reference / Template Files

**`mcp-server/src/main/java/pl/devstyle/aj/mcp/security/McpIntrospectionFilter.java`**
- Reference implementation: introspect → exchange → inject Token-B, fail-closed (401/502)

**`mcp-server/src/main/java/pl/devstyle/aj/mcp/security/TokenExchangeClient.java`**
- Reference implementation: RFC 8693 POST to `/oauth2/token`

**`mcp-server/src/main/java/pl/devstyle/aj/mcp/config/RestClientConfig.java`** (lines 81–96)
- `TokenBForwardingInterceptor`: ThreadLocal → Authorization header pattern

**`src/main/java/pl/devstyle/aj/core/security/SecurityConfiguration.java`** (175 lines)
- Filter chain wiring order — determines where aud/iss validation fires

**`src/main/resources/db/changelog/2026/010-seed-mcp-server-oauth2-client.yaml`**
- Template for new plugin client seed migrations

### Consumer Files

**`plugins/ai-description/src/pages/api/generate.ts`** (line 41)
- `createServerSDK("ai-description", undefined, req)`

**`plugins/product-validator/src/pages/api/validate.ts`** (line 48)
- `createServerSDK("product-validator", undefined, req)`

**`src/main/java/pl/devstyle/aj/api/AuthController.java`** (line 48)
- `generateToken()` — login flow; will receive `jti` transparently (additive)

---

## Current Data Flow (Vulnerable)

```
Browser → Plugin API route (Next.js)
  → createServerSDK() extracts Token-A from request.headers.authorization
  → hostFetch() forwards Token-A as Authorization: Bearer [VULNERABILITY]
  → JwtAuthenticationFilter parses Token-A (no aud/iss check)
  → SecurityContext set with Token-A's full user permissions
  → /api/** endpoint executes with no audience restriction
```

## Target Data Flow (RFC 8693)

```
Browser → Plugin API route (Next.js)
  → createServerSDK() extracts Token-A
  → exchangeToken(tokenA) → POST /oauth2/token [grant_type=token-exchange]
      OAuth2TokenFilter validates client credentials + subject_token
      Rejects if subject_token already has iss=aj-server (re-exchange guard)
      Generates Token-B [iss=aj-server, aud=plugin-id, act={sub: client_id}, jti=uuid]
  → hostFetch() injects Token-B as Authorization: Bearer
  → JwtAuthenticationFilter parses Token-B, validates aud+iss
  → SecurityContext set with scoped permissions from Token-B
```

---

## Dependencies and Consumers

### Java Consumers of JwtTokenProvider
- `SecurityConfiguration.java` — injection point
- `OAuth2TokenFilter.java` — `generateOAuth2Token()` at lines 161, 190, 252
- `OAuth2IntrospectionFilter.java` — `parseRawClaims()` at line 65
- `AuthController.java` — `generateToken()` at line 48

### TypeScript Consumers of createServerSDK
- `plugins/ai-description/src/pages/api/generate.ts:41`
- `plugins/product-validator/src/pages/api/validate.ts:48`

---

## Test Coverage

### Existing Test Files
| File | Lines | Coverage |
|------|-------|----------|
| `JwtTokenProviderTests.java` | 65 | Basic JWT creation and parsing |
| `TokenExchangeIntegrationTests.java` | 263 | RFC 8693 compliance, scope mapping |
| `OAuth2IntrospectionTests.java` | 315 | Introspection lifecycle |
| `OAuth2IntegrationTests.java` | 318 | OAuth2 foundation (authz code, PKCE, refresh) |
| `AuthIntegrationTests.java` | — | Login flow |
| `plugin-sdk-auth.test.ts` | 125 | JWT injection — tests vulnerable behavior, must be rewritten |

### Test Gaps (Required by Implementation Plan)
- Re-exchange rejection (Token-B as subject_token must be rejected)
- `aud`/`iss` validation enforcement (wrong audience → 401)
- `act` claim presence in Token-B
- `jti` uniqueness in generated tokens
- Plugin-specific client registration and exchange flow
- Fail-closed behavior (exchange unavailable → error thrown, not Token-A fallback)
- `plugin-sdk-auth.test.ts` must be **rewritten** (currently asserts the wrong/vulnerable behavior)

---

## Coding Patterns

### Naming Conventions
- Java classes: PascalCase (`OAuth2TokenFilter`, `TokenExchangeClient`)
- Java methods: camelCase action-prefix (`handleTokenExchangeGrant`, `generateOAuth2Token`)
- Liquibase changesets: `NNN-seed-{name}-oauth2-client.yaml`, sequential numbering, `ON CONFLICT DO NOTHING`
- TypeScript functions: camelCase, closure-based SDK pattern
- Test classes: `*Tests` suffix (not `*Test`), same package as production code
- Test methods: `action_condition_expectedResult` pattern

### Architecture Patterns
- Spring stateless filter chain (`OncePerRequestFilter` subclasses), CSRF disabled
- RFC 8693 client authentication: `client_secret_post` or `client_secret_basic`
- Fail-closed: MCP returns 401 (inactive token) / 502 (exchange failure) — plugin SDK must match (throw, never fall back to Token-A)
- Liquibase YAML changesets with explicit rollback blocks

---

## Specific Changes Required

### JwtTokenProvider.java
| Lines | Method | Change | Complexity |
|-------|--------|--------|------------|
| 36–43 | `generateToken()` | Add `jti` claim (UUID) | Simple |
| 51–65 | `generateOAuth2Token()` | Add `jti` + optional `act` claim | Moderate |
| 88–107 | `parseToken()` | Add optional `aud`/`iss` validation parameters | Moderate |

### OAuth2TokenFilter.java
| Lines | Method | Change | Complexity |
|-------|--------|--------|------------|
| 69–71 | `doFilterInternal()` | Remove all token/secret values from log | Simple |
| 166–167 | `handleAuthorizationCodeGrant()` | Replace token values with `[redacted]` | Simple |
| 194 | `handleRefreshTokenGrant()` | Replace token value with `[redacted]` | Simple |
| 230 | `handleTokenExchangeGrant()` | Reject if subject_token has `iss` == own issuer | Moderate |
| 251–253 | `handleTokenExchangeGrant()` | Add `act` claim with client_id, add `jti` | Moderate |

### OAuth2IntrospectionFilter.java
| Lines | Method | Change | Complexity |
|-------|--------|--------|------------|
| 65 | `doFilterInternal()` | Add `aud` validation against expected audience | Moderate |

### JwtAuthenticationFilter.java
| Lines | Method | Change | Complexity |
|-------|--------|--------|------------|
| 28 | `doFilterInternal()` | Enforce `aud`/`iss` for OAuth2 tokens (Token-B path) | Moderate |

### server-sdk.ts
| Lines | Change | Complexity |
|-------|--------|------------|
| 50–70 | Replace raw forward with `exchangeToken()` helper (RFC 8693) | Complex |

### New Files
- `src/main/resources/db/changelog/2026/020-seed-ai-description-oauth2-client.yaml`
- `src/main/resources/db/changelog/2026/021-seed-product-validator-oauth2-client.yaml`
- Env var additions: `PLUGIN_OAUTH_CLIENT_ID`, `PLUGIN_OAUTH_CLIENT_SECRET` per plugin

---

## TypeScript Exchange Pattern (Template)

```typescript
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange";
const TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";

async function exchangeToken(tokenA: string, baseUrl: string): Promise<string> {
  const params = new URLSearchParams({
    grant_type: GRANT_TYPE,
    subject_token: tokenA,
    subject_token_type: TOKEN_TYPE,
    client_id: process.env.PLUGIN_OAUTH_CLIENT_ID!,
    client_secret: process.env.PLUGIN_OAUTH_CLIENT_SECRET!,
  });
  const res = await fetch(`${baseUrl}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const json = await res.json() as { access_token?: string };
  if (!json.access_token) throw new Error("No access_token in exchange response");
  return json.access_token;
}
```

---

## Complexity and Risk Assessment

| Factor | Value |
|--------|-------|
| Primary files changed | 6 (3 Java, 1 TS, 1 config, 2 new Liquibase) |
| Consumer impact | 2 plugin routes + all OAuth2 flows |
| Test gaps to fill | 6+ new test cases; 1 full test rewrite |
| Reference implementation available | Yes (MCP module — complete and working) |
| **Overall complexity** | **Moderate** |
| **Risk level** | **Medium** |

**Key risk**: `aud`/`iss` validation in `parseToken()` must be opt-in at call sites (not global), because login tokens (Token-A) do not carry `aud` and must not be rejected by the existing `JwtAuthenticationFilter` code path.

---

## Recommended Implementation Order

1. **T2** — Redact token logging (zero functional risk)
2. **T3** — Externalize JWT secret to env var (deployment coordination required)
3. **T5** — Re-exchange guard + `jti`/`act` claim addition
4. **T4** — aud/iss validation (opt-in, conditional by token type)
5. **Plugin exchange** — server-sdk.ts token exchange + Liquibase seeds + env vars
6. **Tests** — New test cases + rewrite of `plugin-sdk-auth.test.ts`

```yaml
status: success
report_path: analysis/codebase-analysis.md
summary: "Six files require changes to eliminate Token-A forwarding (server-sdk.ts) and close T2–T5; the complete MCP implementation in the mcp-server module is a direct, working template for all changes."
files_found: 15
complexity: moderate
risk_level: medium
```
