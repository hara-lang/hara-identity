# Hara package identity

This repository is the public trust policy for Hara packages. It contains
Ed25519 public keys, delegation records, validity windows, and revocations.
Private signing material must never be committed here.

Clients pin an exact commit of this repository in `project.lock.edn` before
they accept publisher intents or registry attestations.

## Layout

- `identity.edn` — root policy document and registry signer references.
- `identity.edn.sig` — detached Ed25519 signature over the exact policy bytes.
- `publishers/` — package-coordinate delegation records.
- `revocations/` — append-only key and release revocations.
- `CODEOWNERS` — review protection for trust-policy changes.

## Official trust anchor

Clients pin the SHA-256 fingerprint of the raw Ed25519 root public key:

`8861d398c14a53b2fe13f7736310bb2c55624260c84e131452457e8aa69ac3dc`
