# Hara Learn session handoff

Hara Identity remains the only GitHub OAuth relying party. Hara Learn receives a verified identity through a short-lived authorization-code exchange and then creates its own host-only session.

```text
browser at Learn
    -> Learn creates state + S256 PKCE verifier
    -> Identity authorize endpoint
    -> existing central session, or GitHub OAuth first
    -> one-time opaque code returned to Learn
    -> Learn exchanges code server-to-server
    -> Learn records the handoff ID once
    -> Learn issues its own host-only session
```

## Endpoints

```text
GET  /.well-known/hara-handoff
GET  /v1/handoffs/authorize
POST /v1/handoffs/token
```

Identity uses a code-defined client registry. Its only configured client is currently `learn`: production accepts only `https://learn.hara-lang.org/api/auth/callback`, testing accepts only the equivalent testing hostname. Local development may set `HARA_LEARN_HANDOFF_REDIRECT_URI` to a loopback callback. A future relying site such as www must receive a separately registered client ID, exact callback, and credential; it must never reuse Learn's credential.

## Security properties

- The browser never receives the Learn client secret.
- Codes expire after five minutes and are stored by a SHA-256-derived key in a strongly consistent, site-scoped Netlify Blobs store.
- Every code is bound to the registered callback and an S256 PKCE challenge.
- Identity deletes a code on exchange. Learn independently records the random handoff ID in PostgreSQL and rejects replay, including concurrent duplicate exchanges.
- The returned assertion is audience-bound to `learn`, identifies the stable numeric GitHub account, and expires after one minute.
- GitHub provider tokens and the central session-signing secret are never returned to Learn.
- The handoff grants human account identity only. It does not grant package, specification, repository, or editorial authority.

Netlify Blobs does not provide compare-and-swap locking. The Learn consumption ledger is therefore the final one-time-use boundary if two token exchanges race between a strongly consistent read and delete.

## Configuration

Identity requires the existing GitHub OAuth/session variables plus:

```text
HARA_ID_HANDOFF_LEARN_SECRET
```

Use a separate random value for testing and production. The same environment-specific value is configured on the matching Learn deployment as `HARA_IDENTITY_HANDOFF_SECRET`. The legacy `HARA_LEARN_HANDOFF_SECRET` name is accepted only as a temporary migration fallback. It must not be exposed to browser code.

The scheduled `handoff-cleanup` function removes expired records that were never exchanged. Live deployment checks require discovery to report `configured: true`, the exact Learn callback, S256 support, an authenticated-client failure at the token endpoint, and a central-sign-in redirect at the authorize endpoint.
