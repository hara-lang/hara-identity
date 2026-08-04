# Hara package identity

This repository is the current public trust policy for Hara packages. It contains Ed25519 public keys, delegation records, validity windows, and revocations. Private signing material must never be committed here.

Clients pin an exact commit of this repository in `project.lock.edn` before they accept publisher intents or registry attestations.

## Layout

- `identity.edn` — root policy document and registry signer references.
- `publishers/` — package-coordinate delegation records.
- `revocations/` — append-only key and release revocations.
- `CODEOWNERS` — review protection for trust-policy changes.

## Service and registry split

The repository already represents Git-authoritative trust state rather than an operational identity service. The proposed long-term boundary is:

- `hara-lang/hara-id-registry` — the history-preserving home for root policy, public keys, grants, delegations and revocations.
- `hara-lang/hara-id` — the deployable UI/API at `id.hara-lang.org` for challenges, enrollment verification, authorization decisions and reviewable registry-change preparation.

The service never receives publisher private keys and does not silently mutate trust roots. See [`docs/repository-split.md`](docs/repository-split.md) and issue #3 for the authority boundary, API shape, threat constraints and migration sequence.
