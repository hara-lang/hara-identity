# Hara World session handoff

Hara Identity remains the only GitHub OAuth relying party. Hara World receives a verified identity through a short-lived authorization-code exchange and then creates its own host-only session.

```text
browser at World
    -> World creates state + S256 PKCE verifier
    -> Identity authorize endpoint
    -> existing central session, or GitHub OAuth first
    -> one-time opaque code returned to World
    -> World exchanges code server-to-server
    -> World records the handoff ID once
    -> World issues its own host-only session
```

## Endpoints

```text
GET  /.well-known/hara-handoff
GET  /v1/handoffs/authorize
POST /v1/handoffs/token
```

The version-one client is fixed to `world`. Production accepts only `https://world.hara-lang.org/api/auth/callback`; testing accepts only the equivalent testing hostname. Local development may set `HARA_WORLD_HANDOFF_REDIRECT_URI` to a loopback callback.

## Security properties

- The browser never receives the World client secret.
- Codes expire after five minutes and are stored by a SHA-256-derived key in a strongly consistent, site-scoped Netlify Blobs store.
- Every code is bound to the registered callback and an S256 PKCE challenge.
- Identity deletes a code on exchange. World independently records the random handoff ID in PostgreSQL and rejects replay, including concurrent duplicate exchanges.
- The returned assertion is audience-bound to `world`, identifies the stable numeric GitHub account, and expires after one minute.
- GitHub provider tokens and the central session-signing secret are never returned to World.
- The handoff grants human account identity only. It does not grant package, specification, repository, or editorial authority.

Netlify Blobs does not provide compare-and-swap locking. The World consumption ledger is therefore the final one-time-use boundary if two token exchanges race between a strongly consistent read and delete.

## Configuration

Identity requires the existing GitHub OAuth/session variables plus:

```text
HARA_WORLD_HANDOFF_SECRET
```

Use a separate random value for testing and production. The same environment-specific value is configured on the matching World deployment. It must not be exposed to browser code.

The scheduled `handoff-cleanup` function removes expired records that were never exchanged. Live deployment checks require discovery to report `configured: true`, the exact World callback, S256 support, an authenticated-client failure at the token endpoint, and a central-sign-in redirect at the authorize endpoint.
