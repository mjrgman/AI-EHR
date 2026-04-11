# LabCorp Integration

LabCorp Link API integration. Provides mock-mode result parsing (Phase 2a),
a full OAuth2 + API-mode client, HTTP routes, and the `LabSynthesisAgent`
that turns raw results into `LAB_SYNTHESIS_READY` events for CDS + Domain
Logic to consume (Phase 2b), plus an optional docker-compose smoke-test
service for sandbox connectivity verification (Phase 2c).

## Status

| Piece | Phase | State |
|---|---|---|
| Result parser (PDF + XML) | 2a | Implemented |
| Mock response fixtures | 2a | Implemented (9 panels) |
| Client surface (`submitOrder`, `fetchResults`, `pollPendingOrders`) | 2a | Mock + API mode both implemented |
| OAuth2 flow (authorization code + refresh, encrypted token storage) | 2b | Implemented |
| Database migration (`labcorp_tokens`, `lab_orders` additions) | 2b | Implemented |
| HTTP routes (`/api/integrations/labcorp/*`, `/api/orders/:id/submit-to-labcorp`) | 2b | Implemented |
| `LabSynthesisAgent` (LAB_RESULTED → LAB_SYNTHESIS_READY) | 2b | Implemented (Tier 2) |
| End-to-end scenario suite (`test/scenarios/labcorp-scenarios.json`) | 2b | 5 scenarios, 6 data-driven tests |
| Docker-compose optional poller service | 2c | Implemented (commented, profile-gated) |
| Sandbox smoke script (`scripts/labcorp-sandbox-smoke.js`) | 2c | Implemented |
| Real LabCorp developer-portal onboarding | — | Operator task — see below |

## Modes

Controlled via `LABCORP_MODE`:

- `mock` (default) — reads fixtures from `mock-responses/`. No network. All
  automated tests run in this mode.
- `api` — hits the real sandbox endpoints using per-user OAuth2 tokens stored
  (encrypted) in `labcorp_tokens`. Requires valid client credentials and a
  completed `/oauth/start → /oauth/callback` flow.

## Environment variables

See `.env.example` for the full block. Minimum required for API mode:

```
LABCORP_MODE=api
LABCORP_CLIENT_ID=<from developer portal>
LABCORP_CLIENT_SECRET=<from developer portal>
LABCORP_AUTH_URL=https://sandbox.example/oauth/authorize
LABCORP_TOKEN_URL=https://sandbox.example/oauth/token
LABCORP_SANDBOX_URL=https://sandbox.example/api/v1
LABCORP_REDIRECT_URI=http://localhost:3000/api/integrations/labcorp/oauth/callback
LABCORP_SCOPE=lab.read lab.write
LABCORP_TIMEOUT_MS=30000
```

`LABCORP_PROD_URL` is intentionally NOT read anywhere. If you need to point
the client at production, change `LABCORP_SANDBOX_URL` — there is no separate
prod switch, which is deliberate: it forces explicit operator review.

## Fixture catalog

Mock responses live in `mock-responses/*.xml`. Each fixture represents a realistic
LabCorp result with at least one abnormal flag so downstream CDS and Domain Logic
pipelines have something to react to.

| Fixture | Panel | Abnormal signal |
|---|---|---|
| `cbc.xml` | Complete Blood Count | Hematocrit 55.2% (erythrocytosis — triggers HRT safety block) |
| `cmp.xml` | Comprehensive Metabolic Panel | eGFR 48 (CKD stage 3) |
| `lipid.xml` | Lipid Panel | LDL 165, HDL 38, trig 210 (mixed dyslipidemia) |
| `a1c.xml` | Hemoglobin A1C | HbA1c 8.2% (uncontrolled diabetes) |
| `thyroid.xml` | TSH / Free T4 / Free T3 / TPO Ab | TSH 6.8 + TPO Ab 145 (Hashimoto pattern) |
| `testosterone.xml` | Total + Free T, SHBG, PSA | Total T 198 ng/dL (low — triggers HRT init rule) |
| `estradiol.xml` | E2 / FSH / LH / Progesterone | Postmenopausal panel baseline |
| `igf1.xml` | Insulin-Like Growth Factor 1 | Normal (baseline for peptide rules) |
| `default.xml` | Fallback | Inert single-result fixture for graceful error paths |

The parser preserves the raw LabCorp test name (e.g. `Hemoglobin A1c` rather than
`hba1c`) because downstream alias matching lives in
`server/domain/functional-med-engine.js:LAB_ALIASES`.

## Architecture notes

The parser **never throws**. All errors become entries in `result.warnings` with
`result.ok = false`. This keeps a single malformed lab from crashing the ingestion
pipeline — downstream code can inspect `ok`/`warnings` and decide whether to retry.

The client exposes a small, stable contract:

```javascript
const labcorp = require('./server/integrations/labcorp/client');
const client = labcorp.getClient();

// Submit an order (mock mode returns a deterministic external order ID)
const order = await client.submitOrder({
  patientId: 42,
  tests: ['Hemoglobin A1c', 'CMP']
});

// Fetch results — returns parser.js output shape
const result = await client.fetchResults(order.externalOrderId);
```

Phase 2b swaps `_submitOrderApi()` / `_fetchResultsApi()` without touching callers.
Phase 2b also wires a `LabSynthesisAgent` downstream of the client so results flow
through the message bus into CDS + Domain Logic automatically.

## Sandbox connectivity smoke test (Phase 2c)

Before flipping `LABCORP_MODE=api` in a real deployment, verify the sandbox
is reachable and speaks OAuth2 correctly. Two ways to run the same check:

```bash
# Option A: on the host
node scripts/labcorp-sandbox-smoke.js --verbose

# Option B: from inside the container network (uses docker-compose)
# First uncomment the labcorp-poller block in docker-compose.yml, then:
docker-compose --profile labcorp run --rm labcorp-poller
```

The script has three stages:

1. **Stage A** — HTTPS reachability to `LABCORP_SANDBOX_URL` (any HTTP
   response counts; only transport errors fail this stage).
2. **Stage B** — HTTPS reachability to `LABCORP_TOKEN_URL`.
3. **Stage C** — OAuth2 semantics check: POST a deliberately invalid code
   and expect a RFC 6749–compliant `400 invalid_grant` (or `401`) response.
   A `200` here is a critical alarm — the endpoint should never accept a
   garbage code.

Exit codes: `0` all green, `1` config error, `2` connectivity failure,
`3` OAuth2 semantics failure. Safe to wire into an ad-hoc check; NOT wired
into CI because real network calls don't belong in deterministic tests.

Hard safety rail: the script aborts if any configured URL contains `prod`
or `production`, and it refuses non-HTTPS URLs outright. It never writes to
the database and never logs secret values.

## Developer portal onboarding

Operator task — not automatable. Steps:

1. Register an application in the LabCorp developer portal (sandbox first).
2. Record the issued client ID + client secret into `.env` as
   `LABCORP_CLIENT_ID` / `LABCORP_CLIENT_SECRET`.
3. Set the authorization redirect URI to exactly
   `http://localhost:3000/api/integrations/labcorp/oauth/callback` (dev) or
   your production redirect. It MUST match the value registered in the portal.
4. Paste the published `authUrl`, `tokenUrl`, and `sandboxUrl` into `.env`.
5. Run the smoke test above. All three stages must pass.
6. Hit `POST /api/integrations/labcorp/oauth/start` in the running app to
   begin the authorization-code flow and complete the tokens handoff.

Until you finish step 6, API mode will fail with
`no stored tokens for user` — tokens are stored per-user on successful
callback, encrypted at rest via `server/security/phi-encryption.js`.
