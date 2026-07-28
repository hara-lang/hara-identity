# Hara package identity

This repository is the public trust policy for Hara packages. It contains
Ed25519 public keys, delegation records, validity windows, and revocations.
Private signing material must never be committed here.

Clients pin an exact commit of this repository in `project.lock.edn` before
they accept publisher intents or registry attestations.

## Layout

- `identity.edn` — root policy document and registry signer references.
- `publishers/` — package-coordinate delegation records.
- `revocations/` — append-only key and release revocations.
- `CODEOWNERS` — review protection for trust-policy changes.
