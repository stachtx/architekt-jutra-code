# Scope Clarifications — Phase 2

**Date**: 2026-06-17

## Decisions Made

### D1: Issuer configuration — `app.issuer` property
**Decision**: Introduce `app.issuer=${APP_ISSUER:http://localhost:8080}` in `application.properties`.
**Rationale**: Testable, explicit, decoupled from load balancer headers.
**Impact**: New property referenced in `OAuth2TokenFilter.handleTokenExchangeGrant()` (re-exchange guard) and `JwtAuthenticationFilter` (aud/iss enforcement).

### D2: Scope naming — reuse `mcp:read` / `mcp:edit`
**Decision**: Plugin clients register `ARRAY['mcp:read', 'mcp:edit']` — same as MCP client.
**Rationale**: Zero code change to `MCP_SCOPE_MAPPING`; same permission model.
**Impact**: Liquibase seeds for plugins use identical scope arrays as `010-seed-mcp-server-oauth2-client.yaml`.

### D3: Plugin credentials — shared credential
**Decision**: Single shared OAuth2 client (`plugin-server`) with one `PLUGIN_OAUTH_CLIENT_ID` / `PLUGIN_OAUTH_CLIENT_SECRET` env var pair.
**Rationale**: Simpler deployment; current architecture does not require per-plugin token isolation.
**Impact**: One Liquibase migration for the shared plugin client (not two separate per-plugin migrations). Both `ai-description` and `product-validator` use same env vars.

## Important Defaults (Confirmed)

### D4: Logistics plugin — browser-only (no action)
Logistics plugin has no server-side API routes and no `createServerSDK` usage. Out of scope for this task.

### D5: `aud` enforcement scope — conditional (iss-presence-based)
`aud`/`iss` enforcement applies only when the parsed token has an `iss` claim present (Token-B path). Login tokens (Token-A, no `iss`) bypass the check. Minimizes blast radius; preserves existing auth code flow behavior.

## Implications for Implementation

- **Liquibase**: 1 new seed migration for `plugin-server` client (not 2 per-plugin), shared by both plugins
- **Environment**: `PLUGIN_OAUTH_CLIENT_ID=plugin-server`, `PLUGIN_OAUTH_CLIENT_SECRET=<bcrypt preimage>`, `APP_ISSUER=<backend URL>`, `APP_JWT_SECRET=<key>`
- **server-sdk.ts**: Reads `PLUGIN_OAUTH_CLIENT_ID` / `PLUGIN_OAUTH_CLIENT_SECRET` from `process.env`
- **JwtAuthenticationFilter**: After parseToken(), if `claims.getIssuer() != null` → assert equals `app.issuer` and assert `aud` present
- **OAuth2TokenFilter re-exchange guard**: if `subject_token.iss == app.issuer` → reject (Token-B cannot be subject_token)
