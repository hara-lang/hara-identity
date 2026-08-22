# Hara global logout

The central Identity cookie and the Learn application cookie are intentionally host-only. Global logout therefore uses a front-channel redirect rather than a parent-domain cookie or a shared session-signing key.

```text
current Hara page
  -> id.hara-lang.org/logout/global
  -> Identity clears hara_identity_session
  -> learn.hara-lang.org/api/auth/logout
  -> Learn clears hara_learn_session
  -> original approved Hara page
```

Production and testing origins remain isolated. The `returnTo` value must be an exact allowlisted Hara origin, and Learn independently validates it before redirecting. Credentialed `POST /logout` remains available for clients that only need to clear the central Identity cookie.
