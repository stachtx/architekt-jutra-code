# Requirements — Plugin Token Exchange Security

**Date**: 2026-06-17

## Initial Description

Wyeliminuj bezpośrednie przekazywanie tokena użytkownika (Token-A) z pluginów (`server-sdk.ts`) do backendu. Zastąp wzorcem RFC 8693 Token Exchange (On-Behalf-Of), identycznym jak istniejąca implementacja MCP. Zamknij luki: T2 (logowanie tokenów w OAuth2TokenFilter), T3 (sekret JWT hardcoded w repo), T4 (brak egzekwowania aud/iss), T5 (możliwość re-exchange Token-B).

## Decisions Made (from Q&A)

- **Issuer**: nowa właściwość `app.issuer=${APP_ISSUER:http://localhost:8080}` — jawna, testowalna
- **Scope'y**: pluginy używają `mcp:read` / `mcp:edit` identycznie jak MCP — zero zmian w `MCP_SCOPE_MAPPING`
- **Credentials**: jeden wspólny klient `plugin-server` — jedna para `PLUGIN_OAUTH_CLIENT_ID` / `PLUGIN_OAUTH_CLIENT_SECRET`
- **Logistics plugin**: przeglądarkowy, poza zakresem
- **Egzekwowanie aud**: warunkowe — tylko gdy token ma claim `iss` (Token-B)

## Functional Requirements

### FR1: Eliminacja forwardu Token-A (T1)
`createServerSDK()` w `server-sdk.ts` musi przed każdym wywołaniem `hostFetch()` wymienić Token-A na Token-B' poprzez POST `/oauth2/token` z `grant_type=token-exchange`. Żadna ścieżka kodu nie może wysyłać Token-A do `/api/**`. Fail-closed: jeśli wymiana się nie powiedzie, throw — nie wywołuj `/api` z surowym tokenem.

### FR2: Rejestracja klienta OAuth2 pluginów
Nowy wpis w `oauth2_registered_client` dla `plugin-server` (Liquibase migration), grant `token-exchange`, scopes `['mcp:read', 'mcp:edit']`, metody `['client_secret_post', 'client_secret_basic']`.

### FR3: Klaim `jti` i `act` w Token-B (T5 + R5)
`JwtTokenProvider.generateOAuth2Token()` musi dodawać `jti` (UUID, unikalny per token) oraz opcjonalny klaim `act` (`{"sub": clientId}`) przy wymianie tokenów. Metoda `generateToken()` (login) też otrzymuje `jti`.

### FR4: Zakaz re-exchange (T5)
`handleTokenExchangeGrant()` w `OAuth2TokenFilter` musi odrzucać żądania wymiany gdy `subject_token.iss == app.issuer` — Token-B nie może być użyty jako `subject_token`.

### FR5: Egzekwowanie aud/iss (T4)
`JwtAuthenticationFilter` po parsowaniu tokenu: jeśli token ma claim `iss` (Token-B path) → sprawdź `iss == app.issuer` i `aud` != null/empty. Login tokeny (Token-A, brak `iss`) omijają sprawdzenie.
`OAuth2IntrospectionFilter` musi walidować `aud` tokenu przy introspekcji.

### FR6: Hardening logowania (T2)
Usunąć/zastąpić `[REDACTED]` wartości tokenów w `OAuth2TokenFilter`: linia 69–71 (mapa parametrów), 166–167 (access+refresh token), 194 (refresh token), 330 (ciało odpowiedzi). Żaden token ani sekret nie może pojawiać się w logach.

### FR7: Sekret JWT z env (T3)
`application.properties`: usunąć hardcoded fallback `app.jwt.secret`; aplikacja fail-fast jeśli `APP_JWT_SECRET` nieustawione poza profilem `dev`.
Nowa właściwość `app.issuer=${APP_ISSUER:http://localhost:8080}`.

## Non-Functional Requirements

### NFR1: Fail-closed
- `server-sdk.ts`: błąd wymiany → throw (brak fallbacku na Token-A)
- Backend: brak egzekwowania aud = 401, nie przepuszczenie

### NFR2: Per-request exchange, brak cache
Token-B wymieniany na każde żądanie (wzorzec MCP: "No caching — exchange per request").

### NFR3: Brak własnej kryptografii
Wyłącznie jjwt 0.12.6 (HS256), `URLSearchParams` / native fetch (TypeScript). Bez ręcznych implementacji JWT/HMAC.

### NFR4: Brak regresji
Istniejące testy (`OAuth2IntegrationTests`, `TokenExchangeIntegrationTests`, `OAuth2IntrospectionTests`, testy MCP) muszą przejść bez zmian.

## Similar Features / Reusability

- **MCP Token Exchange** (primary template): `McpIntrospectionFilter.java`, `TokenExchangeClient.java`, `RestClientConfig.java:81-96`
- **Liquibase seed template**: `010-seed-mcp-server-oauth2-client.yaml`
- **Scope mapping**: `MCP_SCOPE_MAPPING` w `OAuth2TokenFilter.java:33-36` — reużyj bez zmian
- **TypeScript fetch pattern**: `URLSearchParams` + native `fetch` — brak nowych zależności

## Scope Boundaries

**In scope:**
- `plugins/server-sdk.ts` — exchange flow
- `OAuth2TokenFilter.java` — re-exchange guard, act/jti, log hardening
- `JwtTokenProvider.java` — jti generation, act claim, opt-in aud/iss validation
- `JwtAuthenticationFilter.java` — conditional aud/iss enforcement
- `OAuth2IntrospectionFilter.java` — aud validation
- `application.properties` — secret from env, app.issuer property
- `mcp-server/application.yml` — reduce DEBUG logging
- New Liquibase migration: `020-seed-plugin-server-oauth2-client.yaml`
- New `.env.example` additions for plugins
- Tests: new test cases, `plugin-sdk-auth.test.ts` full rewrite

**Out of scope:**
- HS256 → RS256/ES256 migration (T6)
- Logistics plugin (browser-only)
- External IdP / Keycloak
- Token revocation / jti revocation store
- Rate limiting on `/oauth2/token`

## Test Requirements

| Scenario | Level | Expected |
|----------|-------|----------|
| Poprawna wymiana / delegacja | integracyjny backend | 200; Token-B' z sub, aud, downscoped scopes, act, jti |
| Zły issuer | integracyjny backend | 401/403, generyczny błąd |
| Złe audience | integracyjny backend | odrzucenie |
| Niewystarczający scope | integracyjny backend | 403 |
| Wygasły token (exp) | integracyjny backend | odrzucenie |
| Nieprawidłowy podpis | integracyjny backend | odrzucenie |
| Re-exchange (Token-B jako subject_token) | integracyjny backend | odrzucenie |
| Niedostępność mechanizmu wymiany | integracyjny server-sdk | fail closed — błąd, brak Token-A w outbound |
| Token w złej usłudze (złe aud) | integracyjny backend | odrzucenie |
| Brak tokenów/sekretów w logach | przegląd/grep | log token endpointu nie zawiera access_token/subject_token/client_secret |
| Regresja: brak forwardu Token-A | integracyjny + przegląd | brak Token-A w ruchu do /api |
