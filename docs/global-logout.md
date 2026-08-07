# Hara global logout

The central Identity cookie and the World application cookie are intentionally host-only. Global logout therefore uses a front-channel redirect rather than a parent-domain cookie or a shared session-signing key.

```text
current Hara page
  -> id.hara-lang.org/logout/global
  -> Identity clears hara_identity_session
  -> world.hara-lang.org/api/auth/logout
  -> World clears hara_world_session
  -> original approved Hara page
```

Production and testing origins remain isolated. The `returnTo` value must be an exact allowlisted Hara origin, and World independently validates it before redirecting. Credentialed `POST /logout` remains available for clients that only need to clear the central Identity cookie.
