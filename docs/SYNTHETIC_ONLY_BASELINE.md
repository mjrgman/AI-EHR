# Synthetic-Only Baseline

**What this repository is:** a local research and demonstration prototype of an
agentic EHR, running on synthetic data, on one machine.

**What it is not:** a live EHR. It is not HIPAA compliant, not clinically
validated, not FDA cleared, holds no interoperability certification, and is not
production ready. No claim of patentability or freedom to operate is made or
implied. It must not be used with real patient data.

This document is the single place where those boundaries are stated, where the
mechanical enforcement is described, and where the known gaps are listed
honestly. Other documents in this repository point here rather than restating
it.

Last verified: 2026-08-07 against commit on `claude/ehr-ultraplan-hardening`.

---

## 1. Boundaries that are mechanically enforced

These are not policy statements. Each is a code path that refuses to run, with a
regression test that proves it. See `test/unit/synthetic-only-baseline.test.js`.

| Boundary | Enforcement | Test |
|---|---|---|
| No external AI runtime | `server/ai-client.js` throws at `require()` time unless `AI_MODE` is unset or `mock`. The Anthropic SDK, the API client singleton, and `callClaude()` were deleted; the `_claude*` implementations are gone. There is no code path from this process to a third-party inference endpoint. | `AI_MODE=api is refused at load time`, `no external-AI symbols remain in the module source` |
| A stray API key cannot enable one | Mode no longer derives from `ANTHROPIC_API_KEY`. `getMode()` returns `'mock'` unconditionally; `isClaudeEnabled()` returns `false`. | `an API key present does NOT enable an api path` |
| No inference SDK in the dependency graph | `package.json` declares none, and no file under `server/` requires one. Checked for Anthropic, OpenAI, Google (Vertex and Generative AI), AWS Bedrock, Azure OpenAI, Cohere and Mistral. | `package.json declares no external-AI or cloud-inference SDK`, `no server source requires an external inference SDK` |
| No live laboratory | `server/integrations/labcorp/client.js` throws at `require()` time unless `LABCORP_MODE` is unset or `mock`, **and** the `LabCorpClient` constructor refuses any non-mock mode independently of the environment. | `LABCORP_MODE=api is refused at load time`, `constructing an API-mode client is refused` |
| The lab route cannot be tricked | `server/routes/labcorp-routes.js` pins `mode: 'mock'` instead of re-reading `process.env`, which was a live bypass for anything mutating the variable after startup. The status endpoint reports `mock` and `syntheticOnly: true` rather than echoing `LABCORP_MODE`. | `every api-mode entry point is refused`, `status never advertises api mode even if env says so` |

CI enforces the same set in a dedicated `synthetic-only-boundary` job, plus a
check that no forbidden SDK is present in the installed `node_modules` tree.

**Why load-time refusal rather than a silent fallback to mock.** A server that
quietly degrades reports one thing and does another. An operator who sets
`AI_MODE=api` believes external AI is on. Failing at startup makes the
misconfiguration impossible to miss and impossible to run with.

## 2. Data

All patient data in this repository is synthetic. This was verified rather than
assumed, on 2026-08-07, across all 302 git-tracked text files:

- **Phone numbers:** every phone-shaped string in tracked source is in the
  `555-01xx` range reserved for fiction (NANP). There are no others.
- **Email addresses:** placeholder domains only.
- **Names, MRNs, DOBs, addresses, insurance IDs:** present by design as seed
  demographics and test fixtures. They are generated, not derived from any real
  record.
- **SSN-shaped strings:** one, in a `DEPLOYMENT.md` code sample, since replaced
  with a placeholder.
- **Databases, exports and logs:** `data/*.db*`, `server/data/*.db*`, `.env`,
  `.env.*` and `.claude/` are gitignored and none is tracked.

The scanner used is preserved at `scripts/phi-scan.py`. It reports file, line
and a shape-preserving redaction with a SHA-256 fingerprint; it never prints a
matched value.

## 3. Private artifacts

`_eval/` and `_dispatch_archive/` hold internal security-review and remediation
records. They must remain available locally and offsite, and absent from every
reachable public history.

- **Where they live:** the local-only branch `local-archive/eval-docs`
  (commit `c07f46a`), and the nightly offsite `git bundle --all` under
  `GSD/Code Dispatch/out/git_bundles/`.
- **Where they must never be:** any history reachable from `main` or from a
  branch proposed for publication. Verified: they appear in no commit reachable
  from `HEAD`, and neither tree is tracked.
- **CI guard:** the `private-artifact-guard` job fails the build if either path
  appears in any commit reachable from `HEAD`, or if either is tracked. Its
  scope is deliberately `HEAD` and not `--all`: the artifacts *do* legitimately
  exist on `local-archive/eval-docs`, so `--all` would fail a correctly
  configured clone. The guard was tested both ways — it passes on `HEAD` and
  correctly flags the archive branch's 28 paths.

Never push `local-archive/eval-docs`.

## 4. Secret scanning

Gitleaks 8.30.1 scans the current tree and all history reachable from `HEAD`.
Configuration is `.gitleaks.toml`, which extends the upstream default ruleset
and adds only narrowly scoped allowlist entries.

The six matches in git-tracked files were each classified by hand and are all
false positives: placeholders in `.env.example`, an all-nibbles
`0123456789abcdef` test vector in CI and the test suite, declared test keys, and
a drug-class token map in `server/pharma/curated-ddi.js` whose
underscore-separated class identifiers trip the entropy heuristic. No live
credential is present in the tree or in reachable history.

The previous CI check was a hand-rolled `grep` for `password=` literals whose
own exclusion chain swallowed its findings and which ended in `|| echo`, so it
could not fail the build. It has been replaced.

## 5. Toolchain and dependency policy

- **Node:** `>=22.0.0 <25`. Verified against the official `nodejs/Release`
  schedule on 2026-08-07: v18 reached EOL 2025-04-30 and v20 reached EOL
  2026-04-30, so both were removed as release gates. v22 is maintenance LTS to
  2027-04-30; v24 is active LTS to 2028-04-30. The full suite, lint and build
  were run on both 22 and 24 before they were made gates.
- **Package manager:** npm only. `pnpm-lock.yaml` was removed — it still pinned
  `@anthropic-ai/sdk@0.39.0`, so anyone running `pnpm install` would have
  silently reinstalled the SDK and undone the boundary in §1. It remains
  recoverable from git history.
- **Advisories:** 0 critical, 0 high, 0 moderate, 0 low as of 2026-08-07. The
  CI threshold is `moderate`. **Do not raise the threshold to obtain a green
  run.** The correct response to a finding is a fix, or a dated exception
  recorded in §7 with dependency path, exposure analysis and an owner.
- **esbuild:** the override is pinned to `^0.25.12`. The previous open
  `>=0.25.0` resolved to 0.28.1, outside the `^0.25.0` that vite 6.4.3
  supports, which broke the production build.

## 6. Prohibited uses

- Any use with real patient data, or with data derived from a real patient.
- Any representation that output is clinical advice, triage, or a diagnosis.
- Any representation of HIPAA compliance, clinical validation, FDA clearance,
  interoperability certification, or production readiness.
- Enabling SMART on FHIR against an untrusted network or in production.
- Publishing to a public remote without an explicit approval step and a fresh
  scan.

## 7. Known gaps — open, not closed

These are recorded so nobody mistakes this document for a clean bill of health.
Per the owner's standing decision, they are **commercial-readiness items, not
safety issues for a synthetic local demo**, and are to be addressed if and when
this becomes a commercial product.

| # | Gap | Where |
|---|---|---|
| 1 | The **central** audit write is fire-and-forget inside `res.on('finish')` in every mode, so it can be lost silently and never blocks an operation. The vault-side MediVault write now fails the export closed with a 503 in `NODE_ENV=production`, but stays best-effort in development. No other operation — signing, prescribing, or PHI disclosure outside MediVault export — is gated on an audit write. | `server/audit-logger.js:420-423`, `server/routes/medivault-routes.js:151-156` |
| 2 | ~~A PHI-bearing route added without a classification drifts silently.~~ **Closed.** `test/unit/audit-route-coverage.test.js` walks the live Express router stack and fails if any route under `/api/` or `/fhir/R4/` is in neither `PHI_ROUTES` nor `NON_PHI_ROUTES`. It found **54 unclassified routes**, since classified — including every FHIR write, the audit read surface itself, scheduling, the decision queue, care management and HEDIS. The guard was verified by injecting an unclassified route and confirming it fails and names it. Residual: 12 PHI routes cannot attribute an access to a single patient; each is now recorded with a reason in `PHI_ROUTES_WITHOUT_PATIENT_ATTRIBUTION`, and 5 of those are marked UNRESOLVED rather than justified. | `server/audit-logger.js`, `test/unit/audit-route-coverage.test.js` |
| 3 | ~~SMART patient scopes are not bound to a patient compartment.~~ **Implemented and tested.** The launch patient is bound into access-token claims and refresh-token rows, patient-scoped tokens without one are refused at grant and refresh, and `patientCompartmentCheck` denies reads outside the bound compartment and constrains `Patient` searches. The async-middleware hang identified in review is fixed: the check is wrapped so a rejected DB read denies with 403 instead of leaving an unrouted promise rejection and a request that never responds. SMART stays disabled regardless, on the strength of gap 4. | `server/fhir/smart/scope-check.js:87`, `server/fhir/router.js:154` |
| 4 | **Mostly closed.** The resource-owner password grant is removed and refused with a specific error; introspection and revocation now require client authentication, revocation is scoped to the calling client, and introspection over GET is refused with 405 so a token cannot land in a query string. Residual: the endpoint still signs with a symmetric HS256 application secret and advertises an empty JWKS, so an external party cannot verify a token independently. That is an interoperability limit, not an access-control hole — but it is why SMART stays disabled. | `server/fhir/smart/token.js`, `test/unit/smart-token-endpoint-hardening.test.js` |
| 5 | **Quantified, not closed.** All 49 clinical rules are now catalogued in [`CLINICAL_RULE_REGISTER.md`](CLINICAL_RULE_REGISTER.md). Every one cites a source in free text, but **0 of 49** carry structured provenance: no issuing authority field, version, publication date, URL, target population, exclusions, evidence strength, last-reviewed date, or physician approval. 17 cite a source older than three years; 23 cite one with no year at all. **No rule has a recorded physician approval, so none should be treated as activated clinical guidance.** | `server/domain/rules/`, `server/database.js` |
| 6 | ~~Compounded peptides and BPC-157 lack an educational/draft-only quarantine.~~ **Enforced.** `educational_only` was previously decoration — it propagated to the client while the engine would still emit a proposed dose. The engine now strips dosing actions from any educational-only rule and reports the count as `withheld_dosing_actions`. BPC-157 and compounded GH secretagogues carry the flag and emit no dose. FDA-approved GLP-1 titration is unaffected and still passes through the Tier 3 approval gate. | `server/domain/functional-med-engine.js`, `test/unit/educational-only-quarantine.test.js` |
| 7 | `server/database.js` is ~1,780 lines carrying repositories and migrations together. `server/server.js` is ~2,806 lines. `src/pages/EncounterPage.jsx` is oversized. | as listed |
| 8 | No line or branch coverage is measured. Test counts are inventory, not coverage. Some tests assert source text rather than behavior. | `test/` |
| 9 | An appointment requested by a patient and awaiting staff confirmation is not clearly distinguished from a confirmed one. | portal + scheduling |
| 10 | No automated accessibility coverage (axe, keyboard, focus-trap) and no browser journey tests. | `src/` |

## 8. Rollback

Everything in this pass is local and reversible.

```bash
# Discard the branch entirely; nothing was pushed.
git checkout feat/ehr-wave1-security-hardening
git branch -D claude/ehr-ultraplan-hardening

# Or step back one commit at a time, keeping the changes staged.
git reset --soft HEAD~1

# Restore dependencies to the pre-pass lockfile.
git checkout feat/ehr-wave1-security-hardening -- package.json package-lock.json
npm ci
```

A verified pre-mutation checkpoint of every ref, including
`local-archive/eval-docs`, is at:

```
GSD/Code Dispatch/out/git_bundles/A_active_projects__Clinical__EHR-20260807-ultraplan-checkpoint.bundle
```

`git bundle verify` on it reports a complete history. To recover from it:

```bash
git clone <that-bundle> recovered-ehr
```
