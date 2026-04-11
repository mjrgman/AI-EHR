<!--
Thanks for contributing. Fill out every section — this is clinical
software, so we care more about the "why" and the "safety review" than
most repos.

If this is a draft / WIP PR, prefix the title with "[WIP]" or mark it
as a Draft.
-->

## Summary

_One or two sentences: what does this PR change, and why?_

Fixes / Related to: #<issue-number>

## Scope

What parts of the system does this PR touch? (check all that apply)

- [ ] Agent (new or modified) — which: `____`
- [ ] Clinical rule (CDS or Domain Logic)
- [ ] Integration (LabCorp, pharma, etc.)
- [ ] Route / API endpoint
- [ ] Database schema / migration
- [ ] UI (React frontend)
- [ ] Audit logger / PHI routes
- [ ] Authentication / RBAC
- [ ] Documentation
- [ ] Test harness / scenarios
- [ ] Build / CI / tooling

## Tier impact

- [ ] This PR adds or modifies a **Tier 3** (physician-gated) workflow
- [ ] This PR adds or modifies a **Tier 2** (protocol-scoped) workflow
- [ ] This PR is Tier 1 or infrastructural — no clinical autonomy change

If Tier 3: describe the approval path. Which `requestDosingApproval()` /
`sendRequest('physician', 'APPROVAL_REQUEST', ...)` flow gets used? How
does the agent fail closed if the physician never responds?

## Test coverage

- [ ] I wrote the test first, watched it fail, then wrote the code
      (TDD — this is enforced)
- [ ] New tests added: `____` (file path + test number if known)
- [ ] All existing tests still pass (`npm test` is green locally)
- [ ] I ran `npm test` on at least one of Node 18 / 20 / 22

If any tests are intentionally skipped or expected to fail, explain why.

## Safety review

This block is required for any PR with **Tier 3** or **clinical rule** boxes
checked above.

- [ ] I read `CONTRIBUTING.md` and I'm not violating any of the three
      core rules (auditable PHI, Tier 3 physician gate,
      standard-of-care guardrail)
- [ ] Every new rule carries a non-empty `evidence_source`
- [ ] Every new dosing suggestion uses `requestDosingApproval()` (or its
      equivalent) — no auto-execute path
- [ ] Every new PHI-touching route has an entry in
      `server/audit-logger.js` `PHI_ROUTES`
- [ ] If this PR adds a new agent, it is registered in
      `server/agents/module-registry.js` and `MODULE_CATALOG.md`

## Screenshots / transcripts (UI changes only)

_Drop screenshots, `preview_snapshot` output, or a short capture of the
change in action._

## Deployment notes

_Anything the deployer needs to know: new env vars, migration commands,
Docker rebuild required, feature-flag rollout plan, etc._

- [ ] No new env vars
- [ ] New env vars added to `.env.example` and documented in `README.md`
      or `DEPLOYMENT.md`

## Reviewer checklist (filled in by reviewer)

- [ ] Summary matches the diff
- [ ] Tier-impact claim is accurate
- [ ] Test coverage is proportional to risk
- [ ] No speculative abstractions or unrelated cleanups
- [ ] Commit message follows the repo convention
