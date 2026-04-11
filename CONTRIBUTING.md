# Contributing to Agentic EHR

Thank you for your interest in contributing. This project is open-source, but
it is also *clinical software*: changes that touch safety, orders, or
recommendations are held to a higher bar than most repos. Read this whole
document before opening your first PR.

---

## The CATC assembler model (read this first)

Agentic EHR is not a monolithic AI assistant. It is a **9-module Clinical
Agent Tracking & Coordination (CATC)** runtime — nine specialized agents with
defined responsibilities, handoffs, and safety tiers, assembled behind a
single orchestrator. The canonical map lives in
[`MODULE_CATALOG.md`](./MODULE_CATALOG.md) and the authoritative code source
is [`server/agents/module-registry.js`](./server/agents/module-registry.js).

Three rules apply to every module:

1. **Patient data stays inside authenticated, auditable workflows.** If you
   add a new route or agent that touches PHI, it must be covered by the audit
   logger (`server/audit-logger.js`) and RBAC (`server/security/rbac.js`).
2. **Every Tier 3 output stays draft or recommendation-only until a
   physician approves it.** Dosing changes, prescriptions, and orders never
   auto-execute. The `requestDosingApproval()` helper in
   [`server/agents/base-agent.js`](./server/agents/base-agent.js) is the
   mandatory path for anything that adjusts a dose.
3. **Standard of care is the guardrail for specialty medicine.** Domain
   modules like `DomainLogicAgent` depend on `CDSAgent` and can only *add* to
   CDS — never override or suppress a CDS alert. See
   [`server/agents/domain-logic-agent.js`](./server/agents/domain-logic-agent.js)
   for the structural invariant.

If your PR would violate one of these rules, it will be rejected regardless
of how clean the code is.

---

## Safety tiers

Every agent declares an `autonomyTier` of 1, 2, or 3 in its constructor.

| Tier | Meaning | Example |
|---|---|---|
| **Tier 1** | Autonomous within a narrow scope — no clinical risk | Front Desk, Phone Triage |
| **Tier 2** | Acts inside clinician-defined protocols | Medical Assistant, CDS |
| **Tier 3** | Draft / recommendation only until a physician approves | Physician, Scribe, Orders, Domain Logic |

When in doubt, pick the higher tier.

---

## Getting set up

```bash
git clone https://github.com/mjrgman/AI-EHR.git
cd AI-EHR
npm install
npm test          # run the 250+ test suite
npm run dev       # frontend + backend in dev mode
```

The test harness runs in mock mode (`AI_MODE=mock`, `LABCORP_MODE=mock`) and
creates an isolated `data/test-mjr-ehr.db` SQLite file. No real network or
API keys required.

---

## Code style

- **No new linter.** Follow the existing file's style. If you're editing a
  file, match its indentation, quoting, and comment density.
- **Comments explain *why*, not *what*.** The code should be readable
  enough that "what" is obvious. Comment the non-obvious decisions — why
  this rule runs first, why this check fails closed, why this dose is
  capped here.
- **No speculative abstractions.** If three callers need the same behavior,
  extract it. Don't extract for two. Don't extract for one "just in case."
- **Never commit secrets.** The `.github/workflows/ci.yml` secret scanner
  runs on every PR and will block you.

---

## Commit messages

Follow the style already in `git log`:

```
<type>: <short imperative summary>

<optional paragraph explaining the why>

Co-Authored-By: <if applicable>
```

Types in use: `feat`, `fix`, `safety`, `docs`, `test`, `refactor`, `chore`.
Use `safety:` (not `fix:`) when a change closes a clinical-risk gap, even if
the change is small — it makes audit reviews much easier.

---

## How to add a new agent

1. **Pick a tier.** If it touches orders, prescriptions, or dosing, it is
   Tier 3.
2. **Subclass `BaseAgent`** in `server/agents/<your-agent>.js`. Required
   fields: `name`, `autonomyTier`, and an async `process(context)` method.
   Optional: `dependsOn: ['cds', ...]` if your agent reads another agent's
   output — the orchestrator enforces ordering.
3. **Audit every decision.** Use `this.audit('RECOMMENDATION'|'ESCALATION'|'OVERRIDE', ...)`.
   The base class enforces this for Tier 3 gating.
4. **Register the agent** in `server/agents/index.js` (add it to the
   `registerAllAgents` function and the `encounterAgents` list if it runs
   in the encounter pipeline) and add the module to
   `server/agents/module-registry.js` so `MODULE_ORDER` is correct.
5. **Update the catalog.** Add a row to `MODULE_CATALOG.md`. If your agent
   changes the CATC wire diagram, update `VISION.md` Section VI.
6. **Write scenario tests.** Every new agent needs at least one happy-path
   scenario and one failure-mode scenario in `test/scenarios/`.

The `DomainLogicAgent` (landed in Phase 1b) is a complete example. Read it
before you start.

---

## How to add a new integration

1. **Mirror `server/ai-client.js`.** Lazy singleton, `Promise.race` with a
   30-second timeout, env-gated mock/api mode, mock fixtures in a
   sibling directory.
2. **Keep the OAuth + the parser separate** if you need both — see
   `server/integrations/labcorp/{client,oauth,parser}.js` for the split.
3. **Scaffold with mock responses first.** Real API verification comes
   after. Mock fixtures go under `server/integrations/<vendor>/mock-responses/`.
4. **Unit-test the parser.** Every fixture should round-trip to a
   normalized shape your downstream agents can consume. Include at least
   one "corrupt input" negative case.
5. **Route mounting.** Follow
   `mountLabCorpRoutes(app, { db })` /
   `mountMediVaultRoutes(app, { db })` — take `{ db }` explicitly so the
   module is test-mountable on a fresh Express app without circular
   requires.
6. **Add the routes to `server/audit-logger.js` `PHI_ROUTES`** if they
   touch patient data. The HIPAA middleware needs to know which fields
   are PHI.

---

## How to add a new clinical rule

Rules live under `server/domain/rules/*.js` (domain logic) or in the
`cds_rules` SQLite table (CDS engine). Every rule **must** carry:

```js
{
  id: 'hrt-titrate-low-t-male-v1',
  rule_name: 'Low T male — initiation',
  rule_type: 'hormone_dosing',
  category: 'hrt_male',
  trigger_condition: { ... },
  suggested_actions: [{
    action_type: 'dose_adjustment',
    medication: 'Testosterone cypionate',
    proposedDose: '100mg IM every 2 weeks',
    rationale: '...',
    requiresDosingApproval: true
  }],
  priority: 'routine',
  evidence_source: 'Endocrine Society Guideline 2018 (Bhasin et al.)'
}
```

Rules with empty `evidence_source` are rejected at load time by
`server/domain/knowledge-base.js`. Dosing rules without a
`requiresDosingApproval: true` flag are rejected the same way. This is a
deliberate structural check: the rule file cannot silently add a
low-quality suggestion.

Every new rule file should ship with corresponding scenario tests in
`test/scenarios/functional-med-scenarios.json`.

---

## How to add a new test scenario

Scenarios are JSON files under `test/scenarios/`. The shape is:

```json
{
  "id": "HRT-INIT-M-001",
  "name": "Hypogonadal male, testosterone initiation",
  "category": "hrt_male",
  "severity": "routine",
  "patient": { ... },
  "problems": [...],
  "medications": [...],
  "allergies": [...],
  "vitals": {...},
  "labs": [...],
  "transcript": "...",
  "expected_cds": { "should_fire": [...], "should_not_fire": [...] },
  "expected_domain_logic": { "dosing_proposals": [...], "safety_blocks": [...] }
}
```

Scenarios are executed by `test/run-tests.js`, which runs real HTTP against
a locally spawned server. No mocking of the agent pipeline — if the
scenario passes, the full pipeline passed.

**One scenario per bug fix.** If you're fixing a bug, write a scenario
that fails without the fix and passes with it. That's the regression
guarantee.

---

## How to write a good PR

1. **One change per PR.** Don't bundle "add feature X" with "refactor Y."
   Two PRs.
2. **Write the test first.** Watch it fail. Then write the code to make
   it pass. If you wrote the code first, delete it and start over — this
   is a TDD-enforced project. The test harness will fail your PR if
   coverage drops.
3. **Fill in the PR template.** Every section matters, especially the
   tier-impact check and the safety review confirmation.
4. **Reference an issue.** If one doesn't exist, open it first. We use
   issues to discuss scope before code.
5. **Keep the diff small.** Under ~500 lines changed when possible. If
   your change is bigger, split it into a stack of dependent PRs.
6. **Run the full test suite locally.** `npm test` must pass before you
   push. CI runs the same suite across Node 18/20/22 — if it's green
   locally on 22 but red on 18, that's still a failure.

---

## Reporting clinical safety concerns

If you discover a bug that could cause patient harm — wrong dose, wrong
drug interaction, bypassed guardrail, silent failure in a Tier 3 path —
**do not open a public issue.** Use the
[Clinical Safety issue template](.github/ISSUE_TEMPLATE/clinical_safety.md)
and mark it as security-sensitive. Clinical safety issues have a separate
triage path and SLA.

All other bugs: use the standard
[Bug Report](.github/ISSUE_TEMPLATE/bug_report.md) template.

---

## License

By contributing, you agree that your contributions will be licensed under
the project's [MIT License](./LICENSE), including the clinical-use
disclaimer.

---

## Questions?

Open a [discussion](https://github.com/mjrgman/AI-EHR/discussions) or an
issue. This is a small project — a thoughtful question is always
welcome.
