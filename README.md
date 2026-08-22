# Hara identity

This repository currently has two deliberately separated responsibilities:

1. It is the Git-authoritative public trust policy for Hara packages: Ed25519 public keys, delegation records, validity windows, and revocations. Private signing material must never be committed here.
2. It deploys the transitional operational service at `id.hara-lang.org`, including one GitHub web session shared by the approved Hara sites.

The shared web session does **not** turn a GitHub login into a publisher grant. Clients still pin an exact trust-policy commit before accepting publisher intents or registry attestations.

## Shared GitHub identity

GitHub OAuth is completed only by `id.hara-lang.org`. The identity service sets a host-only, `Secure`, `HttpOnly`, `SameSite=Lax` session cookie. The other Hara sites read that session through credentialed requests to the identity origin and an exact CORS allowlist:

- `https://www.hara-lang.org`
- `https://docs.hara-lang.org`
- `https://playground.hara-lang.org`
- `https://learn.hara-lang.org`
- `https://build.hara-lang.org`
- `https://packages.hara-lang.org`
- `https://id.hara-lang.org`

Testing uses the equivalent `*.testing.hara-lang.org` origins and `id.testing.hara-lang.org` as issuer.

Public endpoints:

```text
GET  /.well-known/hara-session
GET  /github/start?returnTo=<approved absolute URL>
GET  /auth/github/callback
GET  /session
POST /logout
GET  /logout/global?returnTo=<approved absolute URL>
```

Compatibility aliases are retained at `/auth/github`, `/api/v1/session`, `/api/auth/session`, `/api/v1/logout`, and `/auth/logout`.

The authorization request uses an unpredictable `state` value and S256 PKCE. The temporary GitHub access token is used only to read the stable numeric account ID and current login from GitHub; it is not placed in the Hara session or retained by the service. The signed session lasts seven days.

The browser client at `/identity-client.js` renders the same account control on www, Docs, Playground, Learn, Build, Packages, and Identity. Relying sites may opt into popup sign-in while keeping the existing approved full-page fallback. The client shows the GitHub avatar/login after reading `/session`. Its sign-out control uses the front-channel global logout: Identity clears its host-only cookie, Learn clears its separate host-only cookie, and the browser returns to the exact approved Hara page that initiated logout. See [`docs/global-logout.md`](docs/global-logout.md).

OAuth, handoff, and global-logout Functions are rate-limited at the deployment edge. Expired handoff codes are purged hourly.

## Learn session handoff

Learn performs authenticated writes only after exchanging the central identity for a Learn-local session:

```text
GET  /.well-known/hara-handoff
GET  /v1/handoffs/authorize
POST /v1/handoffs/token
```

The authorization code is opaque, short-lived, callback-bound, and protected by S256 PKCE. Learn authenticates the token exchange with an environment-specific shared secret, records the returned handoff ID once in PostgreSQL, and signs its own host-only cookie with a different key. Identity never shares its session key or the GitHub provider token.

See [`docs/learn-session-handoff.md`](docs/learn-session-handoff.md) for the complete boundary.

### Deployment configuration

Set these encrypted environment variables on the Identity Netlify sites only:

```text
HARA_GITHUB_OAUTH_CLIENT_ID
HARA_GITHUB_OAUTH_CLIENT_SECRET
HARA_AUTH_SESSION_SECRET
HARA_LEARN_HANDOFF_SECRET
```

Optional configuration:

```text
HARA_GITHUB_OAUTH_REDIRECT_URI
HARA_GITHUB_OAUTH_SCOPE
HARA_AUTH_ALLOWED_ORIGINS
HARA_LEARN_HANDOFF_REDIRECT_URI
```

Production callback:

```text
https://id.hara-lang.org/auth/github/callback
```

Testing callback:

```text
https://id.testing.hara-lang.org/auth/github/callback
```

Use separate production and testing OAuth registrations, session secrets, and Learn handoff secrets. `HARA_AUTH_SESSION_SECRET` and `HARA_LEARN_HANDOFF_SECRET` must each be at least 32 characters. Neither value belongs on www, Docs, Playground, Build, or Packages; Learn receives only its matching handoff secret, never the Identity session secret.

See [`docs/shared-github-identity.md`](docs/shared-github-identity.md) for the central session flow.

## Trust-policy layout

- `identity.edn` — root policy document and registry signer references.
- `identity.edn.sig` — detached Ed25519 signature over the exact policy bytes.
- `publishers/` — package-coordinate delegation records.
- `revocations/` — append-only key and release revocations.
- `CODEOWNERS` — review protection for trust-policy changes.

## Service and registry split

The history in this repository remains structurally the registry. The intended long-term boundary is:

- `hara-lang/hara-id-registry` — the history-preserving home for root policy, public keys, grants, delegations, and revocations.
- `hara-lang/hara-id` — the deployable UI/API at `id.hara-lang.org` for shared sessions, challenges, enrollment verification, authorization decisions, and reviewable registry-change preparation.

The centralized GitHub session and Learn handoff are implemented here as migration steps; they should move unchanged to `hara-id` when the repository split is made. The service never receives publisher private keys and does not silently mutate trust roots. See [`docs/repository-split.md`](docs/repository-split.md).

## Development

```sh
npm install
npm test
npx netlify dev
```
