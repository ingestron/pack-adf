# Security

## Report a vulnerability

Email security@ingestron.io. Do not open a public issue. Include the version of
@ingestron/pack-adf, what you ran, and the smallest definitions that reproduce the problem.
We acknowledge reports within five working days and agree a disclosure date
with you.

## Supported versions

Security fixes go into the latest `1.x` release.

## Design

The pack turns a resolved model into Azure Data Factory resource files. It
makes no network calls, runs no code from the definitions, and writes
secrets only as Key Vault references.

Dependencies are pinned exactly and updated one reviewed change at a time;
`pnpm validate` checks their licences.
