# Optional-data backup and restore

M1 sites have no database, object storage, authentication store, queue, or
background worker by default. A standard handoff manifest therefore records:

```text
status: NOT_APPLICABLE
reason: No optional persistent infrastructure is configured
```

Do not create a backup platform or empty database merely to satisfy handoff.

## When persistence is purchased

If a later purchased feature declares `DATABASE`, `OBJECT_STORAGE`, or
`AUTHENTICATION`, the handoff input must include one matching
`OptionalDataResourceDeclaration` for each configured resource. Every
declaration records:

- provider name;
- client data, backup, and restore ownership;
- a provider-specific portable backup procedure;
- a provider-specific restore procedure;
- an acceptance procedure that verifies the restored feature.

The toolkit validates and documents these declarations. It does not connect to
the provider, schedule backups, copy data, create storage, or perform a restore.

## Backup responsibility

The client-owned provider remains authoritative unless the commercial contract
explicitly says otherwise. The responsible owner must:

1. execute the documented provider export;
2. store the backup in a client-controlled location;
3. record backup time, provider resource identity, format, encryption custody,
   and retention outside the source repository;
4. verify the backup using provider tooling without placing data or credentials
   in the handoff manifest.

## Restore responsibility

The responsible client owner must:

1. authorize the target client-owned resource;
2. import the selected backup using the documented provider procedure;
3. configure required values directly in the client environment;
4. run the declared feature-specific verification;
5. record the result in the client's operational system.

A source/deployment rollback does not roll back optional data. A data restore
does not authorize a code rollback, provider-account transfer, or DNS change.
Coordinate them explicitly when an incident requires more than one operation.
