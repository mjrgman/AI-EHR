# Running the Local Synthetic Demo

This is the operating guide for the Agentic EHR demo. It covers running it on
one machine, against synthetic data, for development and review.

**It does not cover deploying this system.** There is no supported deployment.
See [Why this document changed](#why-this-document-changed) below.

Read [`docs/SYNTHETIC_ONLY_BASELINE.md`](docs/SYNTHETIC_ONLY_BASELINE.md) first
if you have not. It states what this system is, what it is not, and which of its
boundaries are mechanically enforced.

---

## Contents

1. [Prerequisites](#prerequisites)
2. [First run](#first-run)
3. [Creating a clinician login](#creating-a-clinician-login)
4. [Environment variables](#environment-variables)
5. [Running the tests](#running-the-tests)
6. [Docker (local only)](#docker-local-only)
7. [Local data and how to reset it](#local-data-and-how-to-reset-it)
8. [Troubleshooting](#troubleshooting)
9. [Why this document changed](#why-this-document-changed)

---

## Prerequisites

- **Node.js 22 LTS or 24 LTS.** The `engines` field requires `>=22.0.0 <25`
  and `.nvmrc` pins 22. Node 18 (EOL 2025-04-30) and Node 20 (EOL 2026-04-30)
  are not supported and are no longer CI gates.
- **npm 10+.** npm only — this project has no pnpm or yarn lockfile, and the
  pnpm one was deliberately removed because it pinned a dependency that has
  since been dropped.
- Nothing else. No cloud account, no API key, no external service.

## First run

```bash
git clone https://github.com/mjrgman/AI-EHR.git
cd AI-EHR
npm ci          # not `npm install` — ci installs the locked tree exactly
npm run dev     # starts the API on :3000 and the Vite dev server on :5173
```

Open <http://localhost:5173>.

The database is created and seeded with synthetic patients on first start. No
configuration is required — the defaults are the correct values for a local
demo.

## Creating a clinician login

The app uses JWT plus refresh-token auth. There is no default account; create
one:

```bash
npm run create-user -- \
  --username dr.renner \
  --role physician \
  --full-name "Michael Renner"
```

You will be prompted for a password. Roles available: `physician`, `nurse`,
`ma`, `front_desk`, `billing`, `admin`.

## Environment variables

Every variable below is optional for local use. The defaults work.

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | API port. |
| `NODE_ENV` | `development` | `test` is used by the suite. |
| `AI_MODE` | `mock` | **Only `mock` is accepted.** Any other value makes the server refuse to start. There is no external-AI runtime to enable. |
| `LABCORP_MODE` | `mock` | **Only `mock` is accepted.** Same refusal. Lab results are parsed from fixtures in `server/integrations/labcorp/mock-responses/`. |
| `JWT_SECRET` | dev value | Required in production; a production boot without it fails. |
| `PHI_ENCRYPTION_KEY` | unset | Enables field-level AES-256-GCM encryption of patient demographics. |
| `PHI_PEPPER` | unset | Required alongside the key in production, and must differ from it. |
| `DATABASE_PATH` | `data/ehr.db` | SQLite file. Gitignored. |

`.env` is gitignored and must stay that way. `.env.example` is the template and
contains placeholders only.

> Variables for live LabCorp OAuth (`LABCORP_CLIENT_ID`, `LABCORP_CLIENT_SECRET`,
> `LABCORP_TOKEN_URL`, `LABCORP_SANDBOX_URL`) are read by the status endpoint
> for a "are these set" display, but they cannot enable anything: the client
> refuses to construct in a non-mock mode regardless of what is set.

## Running the tests

```bash
npm run test:unit   # node --test over test/unit/*.test.js
npm test            # the full runner: HTTP contract, security, scenario, unit
npm run lint        # eslint over server/ and src/
npm run build       # production Vite build
npm audit           # must stay at 0 critical / 0 high
```

The suite sets its own `NODE_ENV=test`, test database, JWT secret and encryption
key. To match CI exactly:

```bash
NODE_ENV=test \
JWT_SECRET=ci-test-secret-not-for-production \
PHI_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
npm test
```

To re-run the PHI scan over tracked files:

```bash
python scripts/phi-scan.py
```

It prints file, line and a redacted fingerprint. It never prints a matched
value.

## Docker (local only)

The `Dockerfile` and `docker-compose.yml` build and run the demo in a container
on your own machine. They are convenience for local isolation, not a deployment
artifact — the compose file has no TLS, no secret management, no backup, and no
monitoring, because it is not meant to be exposed.

```bash
docker compose up --build
```

Do not expose the resulting container to a network you do not control.

## Local data and how to reset it

The SQLite database lives at `data/ehr.db` (plus `-wal` and `-shm` siblings).
All three patterns are gitignored, as is `server/data/*.db*`.

To start over:

```bash
rm -f data/ehr.db data/ehr.db-wal data/ehr.db-shm
npm run dev   # recreates and reseeds
```

Seed patients are synthetic. Phone numbers use the `555-01xx` range reserved for
fiction; emails use placeholder domains.

## Troubleshooting

**`npm ci` fails building `sqlite3`.** The package ships N-API prebuilds, so it
normally needs no compiler. If `prebuild-install` cannot reach GitHub Releases
it falls back to `node-gyp`, which needs Python and a C++ toolchain. Confirm the
binding loads with `node -e "require('sqlite3')"`.

**Server exits immediately with an `AI_MODE` or `LABCORP_MODE` error.** Working
as intended. Unset the variable, or set it to `mock`. There is no mode that
reaches an external service.

**Port already in use.** Set `PORT` for the API; pass `--port` to Vite for the
frontend.

**Tests fail only on your machine.** Check `node --version` is 22.x or 24.x.
Node 18 and 20 are no longer supported and will produce failures the CI gates do
not catch.

---

## Why this document changed

This file previously ran to roughly 1,300 lines and documented AWS, GCP and
Azure deployment, a HIPAA compliance checklist, production key management,
network hardening, backup strategy, monthly cost estimates, and live LabCorp
sandbox credentials setup.

None of that describes anything this repository supports. The system is a local
synthetic-data prototype with no external AI runtime and no live laboratory
integration — both are now refused at startup. Publishing a HIPAA compliance
checklist alongside a demo invites exactly the misreading the rest of the
documentation works to prevent: that these controls have been assessed against a
standard. They have not.

The historical operational design is not lost. It is preserved in git history
and in the verified offsite bundle described in
[`docs/SYNTHETIC_ONLY_BASELINE.md` §8](docs/SYNTHETIC_ONLY_BASELINE.md#8-rollback).
To read it:

```bash
git show feat/ehr-wave1-security-hardening:DEPLOYMENT.md | less
```

If this project ever moves toward a real deployment, that history is the right
starting point — reviewed afresh against the requirements that actually apply at
the time, not resurrected as-is.
