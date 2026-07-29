# Hara package identity

This repository is the public trust policy for Hara packages. It contains
Ed25519 public keys, delegation records, validity windows, and revocations.
Private signing material must never be committed here.

The initial official policy is GitHub-governed: protected branches,
CODEOWNERS and required reviews authorize policy changes while Hara key
custody is being established. This is explicit in `identity.edn`; clients
must not treat an arbitrary Git repository as GitHub-governed.

Clients pin an exact commit of this repository in `project.lock.edn` before
they accept publisher intents or registry attestations. A later root-policy
signature can be added without changing delegated publisher records.

## Layout

- `identity.edn` — root policy document and registry signer references.
- `publishers/` — package-coordinate delegation records.
- `revocations/` — append-only key and release revocations.
- `CODEOWNERS` — review protection for trust-policy changes.

## Bootstrap operations

Add publisher and registry-CI public keys through reviewed pull requests. Do
not add private key material, Actions write tokens, or GitHub App credentials
to this repository. The policy workflow performs structural checks; branch
protection is the bootstrap authority.
