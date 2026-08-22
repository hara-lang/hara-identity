# Shared GitHub identity

## Goal

A person who signs in on any approved Hara site should see the same stable GitHub identity on www, Build, Packages, Learn, and Identity without repeating OAuth on every origin.

## Boundary

`id.hara-lang.org` is the only OAuth relying party and the only origin that receives the Hara session cookie. The cookie is host-only; it is not a `Domain=.hara-lang.org` cookie and is therefore never attached to requests for www, Build, Packages, or Learn.

Each relying site asks the identity origin for session state:

```text
browser on build.hara-lang.org
  -> GET https://id.hara-lang.org/session
     credentials: include
     Origin: https://build.hara-lang.org
  <- exact-origin CORS response + GitHub profile
```

Because the Hara sites are same-site but different origins, the browser can send the host-only identity cookie to `id.hara-lang.org` while the identity service retains control over which origins may read the result.

## Sign-in flow

The default mode remains a full-page redirect:

```text
www | specs | packages | learn | id
  -> id.hara-lang.org/github/start?returnTo=<exact approved URL>
  -> GitHub authorization (state + S256 PKCE)
  -> id.hara-lang.org/auth/github/callback
  -> GitHub token exchange
  -> GitHub /user
  -> signed Hara session cookie on id.hara-lang.org
  -> original approved Hara URL
```

A relying site can opt into popup mode with:

```html
<meta name="hara-identity-mode" content="popup">
```

Popup mode keeps the relying page in place:

```text
www page
  -> synchronously opens a small blank window
  -> clears that window's opener before navigating to GitHub
  -> completes the normal Identity OAuth flow in the popup
  -> returns to the exact original www origin with a random completion nonce
  -> signals the parent through same-origin BroadcastChannel or storage
  -> closes the popup
  -> parent refreshes /session and renders the GitHub account
```

The OAuth popup never receives a provider token in browser code. Its initial blank document loses `window.opener` before any GitHub content loads, so GitHub cannot navigate the relying page through the opener relationship. The random completion nonce is correlation data only; authentication still comes exclusively from the host-only Identity session cookie.

If the browser blocks the popup, BroadcastChannel/storage is unavailable, or JavaScript is disabled, the existing full-page sign-in URL remains the fallback. Modified clicks keep ordinary link behavior.

The `returnTo` value must parse to an exact allowlisted origin. Substring matches, suffix tricks, protocol-relative URLs, credentials, and non-HTTP schemes are rejected.

## Session statement

The signed session contains only:

```text
issuer
provider = github
stable numeric GitHub account id
current GitHub login
optional public display name
issued-at
expiry
```

The current avatar and profile URLs are derived from the numeric account ID and login. No GitHub access token, package signing key, namespace grant, or authorization decision is stored in the browser session.

## CORS and sign-out

`/session` and `/logout` echo `Access-Control-Allow-Origin` only for an exact approved origin and include `Access-Control-Allow-Credentials: true`. Unknown origins receive no readable session response. The shared account control uses front-channel global logout so Identity and Learn can each clear their separate host-only cookies before returning to the initiating approved page.

## Production and testing

Production and testing are separate issuers:

```text
https://id.hara-lang.org
https://id.testing.hara-lang.org
```

Their session signatures and OAuth callbacks must remain separate. A production session is rejected by the testing issuer and vice versa.

## Publisher identity remains separate

A GitHub session says which GitHub account is operating the web UI. It does not establish ownership of a Hara namespace. Publishing still requires the independent chain:

```text
GitHub web session
  -> publisher key possession
  -> namespace grant
  -> signed publication intent
  -> specification/package validation
  -> reviewable registry transition
```
