# Database Backend Status

Updated: 2026-05-08

## Current Runtime Support

SQLite is the only supported runtime database backend for this worktree.

- Use `DATABASE_PATH` for local and single-deployment data storage.
- Do not set `DATABASE_URL=postgresql://...`; the runtime intentionally fails closed when it sees a PostgreSQL URL.
- Postgres/RDS/Cloud SQL references are roadmap or planning material until the adapter, SQL translation, connection pooling, migration parity tests, and backup/restore drill are complete.

## Safe Deployment Boundary

The safe default is per-deployment SQLite hardening:

- one deployment per clinic/practice boundary,
- isolated database volume,
- encrypted storage and backups,
- no multi-tenant database claim,
- no managed-Postgres claim.

## Completion Criteria Before Postgres Can Be Claimed

Postgres support must not be advertised as implemented until all of these are true:

- `server/db/adapters/postgres.js` implements `init`, `run`, `get`, `all`, and `close`;
- placeholder translation and SQLite-specific schema differences are handled;
- migrations pass against both fresh and populated Postgres databases;
- adapter parity tests compare SQLite and Postgres behavior;
- deployment docs include tested RDS/Cloud SQL instructions;
- backup and restore drills are automated and verified.
