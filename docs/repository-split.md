# Hara identity service and registry boundary

## Decision

Hara identity needs two independently deployable and independently auditable repositories:

```text
hara-lang/hara-id            operational UI and API
hara-lang/hara-id-registry   Git-authoritative public trust state
```

The current `hara-lang/hara-identity` repository is already structurally the registry: it contains root policy, public keys, publisher delegations and revocations. Its history should therefore be preserved as the source history of `hara-id-registry`.

`id.hara-lang.org` should become the `hara-id` service. The current static redirect is transitional.

## Registry responsibilities

`hara-id-registry` owns only public, immutable or append-only trust material:

- offline root public keys and root policy
- scoped enrollment and CI delegations
- immutable provider subject IDs and informative current logins
- publisher public keys and key IDs
- namespace grants and validity intervals
- key, grant and release revocations
- canonical serialization and detached signatures
- deterministic indexes, digests and migration provenance
- conformance fixtures for grants, authorization and revocation

It never contains private keys, OAuth tokens, session cookies, reusable challenges or service credentials.

Every consumer resolves a registry ref to an exact commit before evaluating trust. Authorization decisions report that exact commit.

## Service responsibilities

`hara-id` owns operational behavior:

- service discovery, health, capabilities and OpenAPI
- GitHub account and organization ownership challenges
- fresh public-key possession challenges
- enrollment request validation
- namespace conflict checks
- authorization of signed publication intents
- revocation-request preparation
- path-scoped pull-request creation against `hara-id-registry`
- audit events that reference immutable registry commits

The service prepares reviewable state transitions. It does not silently change root policy, retain publisher private keys or turn an unsuccessful verification into an identity grant.

## Version-one API shape

Read API:

```text
GET /.well-known/hara-id
GET /api
GET /api/v1
GET /api/v1/health
GET /api/v1/capabilities
GET /api/v1/root
GET /api/v1/keys
GET /api/v1/grants
GET /api/v1/grants/:id
GET /api/v1/revocations
GET /api/openapi.json
```

Operational API:

```text
POST /api/v1/challenges
POST /api/v1/enrollments/verify
POST /api/v1/authorizations
POST /api/v1/revocations/prepare
```

Operational endpoints remain disabled until challenge storage, provider verification, delegated service keys and path-scoped GitHub credentials are provisioned.

## Challenge model

A challenge is short-lived, single-use and audience-bound. A challenge record contains public metadata and a digest of the challenge, not a reusable secret:

```text
challenge id
challenge type
subject provider and immutable numeric id
requested namespace
proposed publisher key id and algorithm
issued-at and expires-at
service audience
nonce digest
state: issued | consumed | expired | cancelled
```

The service rejects replay, audience mismatch, expired challenges, changed enrollment parameters and signatures from a key other than the proposed publisher key.

## Authorization result

An authorization decision binds:

```text
identity-registry repository and exact commit
subject provider and immutable numeric id
publisher key id
namespace grant id
grant validity interval
publication-intent digest
requested package coordinates
result: authorized | denied | blocked
stable reason codes
revocation evidence considered
service decision timestamp and version
```

An authorization is evidence for a later registry operation; it is not itself a package publication.

## Integration with Hara specifications

The identity and specification services remain separate authorities:

```text
external publisher signer
  -> canonical publication intent
  -> hara-id authorization
  -> hara-specs package and fixture validation
  -> path-scoped hara-specs-registry pull request
  -> registry CI attestation and protected merge
```

`hara-id` does not decide whether a specification conforms. `hara-specs` does not decide who owns a namespace. Registry finalization requires both independently verifiable results.

## Migration sequence

1. Add identity schemas, deterministic indexing, validation and conformance fixtures to the current repository.
2. Create `hara-id-registry` from the current history and record the exact migration source commit.
3. Protect registry paths and require validation for root policy, grants and revocations.
4. Create `hara-id` as a Netlify-deployable service that resolves the registry to an exact commit and fails closed.
5. Implement and deploy the read-only API at `id.testing.hara-lang.org`.
6. Add challenge storage and provider-verification adapters without enabling canonical writes.
7. Add delegated authorization and path-scoped pull-request preparation.
8. Run enrollment, replay, expiration, namespace-conflict, authorization and revocation conformance suites.
9. Cut `id.hara-lang.org` over to the service.
10. Replace `hara-identity` with a migration notice or archive it after all consumers use the new coordinates.

## Naming compatibility

During migration, clients may accept `hara-lang/hara-identity` as an alias for `hara-lang/hara-id-registry`, but lockfiles and signed records always store the exact repository and commit actually evaluated. The alias must not hide a change of trust root.
