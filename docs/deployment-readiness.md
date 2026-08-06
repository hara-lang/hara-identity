# Identity deployment readiness

A successful Netlify upload is not enough to declare Hara Identity healthy. The deployed issuer must also have its GitHub OAuth registration and session secret configured, expose the expected routes, and preserve the cross-origin session boundary.

The production and testing Netlify projects require separate values with Functions/runtime scope:

```text
HARA_GITHUB_OAUTH_CLIENT_ID
HARA_GITHUB_OAUTH_CLIENT_SECRET
HARA_AUTH_SESSION_SECRET
HARA_GITHUB_OAUTH_REDIRECT_URI
```

Use these callbacks:

```text
https://id.testing.hara-lang.org/auth/github/callback
https://id.hara-lang.org/auth/github/callback
```

Testing and production must use separate OAuth registrations and separate session secrets. `HARA_AUTH_SESSION_SECRET` must contain at least 32 characters and must not be copied to consumer sites.

## Automated deployment gate

`.github/scripts/verify-identity-service.sh` runs after each domain reconciliation. It fails the deployment unless the live issuer proves all of the following:

- `/.well-known/hara-session` returns the exact issuer and endpoint set;
- `configured` is `true`;
- the expected relying origin is in `allowedOrigins`;
- `/session` returns an unauthenticated but configured response before login;
- approved origins receive exact credentialed CORS;
- an unknown origin receives `403` without an allow-origin header;
- `/github/start` redirects to GitHub with state and S256 PKCE;
- OAuth attempt cookies are host-only, `HttpOnly`, `SameSite=Lax`, and `Secure` on HTTPS;
- `/identity-client.js` is available;
- `/logout` clears the host-only central session cookie.

Run the probe manually with:

```sh
HARA_IDENTITY_ORIGIN=https://id.testing.hara-lang.org \
HARA_IDENTITY_EXPECTED_RETURN_ORIGIN=https://www.testing.hara-lang.org \
bash .github/scripts/verify-identity-service.sh
```

The probe intentionally fails when the functions are deployed but the OAuth environment is absent. This distinguishes a routable deployment from an operational identity service.

## Browser acceptance journey

After the automated gate passes, complete one browser test against testing:

```text
www.testing → Sign in → GitHub → return to www.testing
specs.testing shows the same account
packages.testing shows the same account
logout from one site logs out all three
```

Only then should the same code and independently configured secrets be promoted to production.
