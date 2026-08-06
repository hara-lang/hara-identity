# Shared GitHub identity

## Goal

A person who signs in on any approved Hara site should see the same stable GitHub identity on www, Specs, Packages, and Identity without repeating OAuth on every origin.

## Boundary

`id.hara-lang.org` is the only OAuth relying party and the only origin that receives the Hara session cookie. The cookie is host-only; it is not a `Domain=.hara-lang.org` cookie and is therefore never attached to requests for www, Specs, or Packages.

Each relying site asks the identity origin for session state:

```text
browser on specs.hara-lang.org
  -> GET https://id.hara-lang.org/session
     credentials: include
     Origin: https://specs.hara-lang.org
  <- exact-origin CORS response + GitHub profile
```

Because the Hara sites are same-site but different origins, the browser can send the host-only identity cookie to `id.hara-lang.org` while the identity service retains control over which origins may read the result.

## Sign-in flow

```text
www | specs | packages | id
  -> id.hara-lang.org/github/start?returnTo=<exact approved URL>
  -> GitHub authorization (state + S256 PKCE)
  -> id.hara-lang.org/auth/github/callback
  -> GitHub token exchange
  -> GitHub /user
  -> signed Hara session cookie on id.hara-lang.org
  -> original approved Hara URL
```

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

`/session` and `/logout` echo `Access-Control-Allow-Origin` only for an exact approved origin and include `Access-Control-Allow-Credentials: true`. Unknown origins receive no readable session response. Sign-out is a credentialed POST to the central origin and clears the host-only session cookie.

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
