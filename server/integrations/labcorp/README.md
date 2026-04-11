# LabCorp Integration

Phase 2a scaffold for a LabCorp Link API integration. Provides mock-mode result
parsing and a stable client surface that Phase 2b will wire to the real LabCorp
sandbox endpoints.

## Status

| Piece | Phase | State |
|---|---|---|
| Result parser (PDF + XML) | 2a | Implemented |
| Mock response fixtures | 2a | Implemented |
| Client surface (`submitOrder`, `fetchResults`, `pollPendingOrders`) | 2a | Mock mode working, API mode stubbed |
| OAuth2 flow (authorization code + refresh) | 2b | Not started |
| Database migration (`labcorp_tokens`, `lab_orders` additions) | 2b | Not started |
| `LabSynthesisAgent` wiring | 2b | Not started |
| HTTP routes (`/api/integrations/labcorp/*`) | 2b | Not started |
| Docker Compose poller service | 2c | Not started |
| Sandbox smoke script | 2c | Not started |

## Modes

Controlled via `LABCORP_MODE`:

- `mock` (default) — reads fixtures from `mock-responses/`. No network. All tests
  run in this mode.
- `api` — throws until Phase 2b implements the OAuth2 flow and real endpoints.

## Environment variables (Phase 2b will use these)

```
LABCORP_MODE=mock
LABCORP_CLIENT_ID=
LABCORP_CLIENT_SECRET=
LABCORP_SANDBOX_URL=
LABCORP_PROD_URL=
LABCORP_REDIRECT_URI=
LABCORP_TIMEOUT_MS=30000
```

These are NOT yet read anywhere except `LABCORP_MODE` and `LABCORP_TIMEOUT_MS`.
Phase 2b adds a full OAuth2 client.

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

## Developer portal setup (Phase 2b will complete this)

TODO: sandbox signup steps, scope list, known quirks — filled in once we have a
real developer account. Until then, Phase 2a is fully exercised via mock mode.
