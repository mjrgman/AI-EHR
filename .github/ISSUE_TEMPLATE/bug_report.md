---
name: Bug Report
about: Something is broken or behaving unexpectedly
title: '[BUG] '
labels: bug
assignees: ''
---

<!--
DO NOT USE THIS TEMPLATE for bugs that could cause patient harm.
Use the "Clinical Safety" template instead — it has a separate triage path.

Examples of clinical safety bugs:
- Wrong dose suggested
- Drug interaction missed
- Tier 3 guardrail bypassed
- PHI leaked in logs or responses
- Silent failure in an approval flow
-->

## Summary

_One sentence — what's wrong?_

## Steps to reproduce

1.
2.
3.

## Expected behavior

_What should have happened?_

## Actual behavior

_What actually happened? Include error messages, stack traces, or screenshots._

## Environment

- **Agentic EHR version / commit SHA**:
- **Node version**: (output of `node -v`)
- **OS**:
- **Browser** (if UI bug):
- **`AI_MODE`**: `mock` / `api`
- **`LABCORP_MODE`**: `mock` / `api`

## Relevant logs

```
<paste server logs, browser console errors, or test output here>
```

## Scope

Which module is affected? (check all that apply)

- [ ] Phone Triage
- [ ] Front Desk
- [ ] Medical Assistant
- [ ] Physician
- [ ] Scribe
- [ ] CDS
- [ ] Orders
- [ ] Coding
- [ ] Quality
- [ ] Domain Logic (HRT / peptide / functional med)
- [ ] MediVault
- [ ] PatientLink
- [ ] LabCorp integration
- [ ] Authentication / RBAC
- [ ] Audit logger
- [ ] UI (frontend)
- [ ] Tests / CI
- [ ] Docs
- [ ] Other:

## Additional context

_Anything else you've already tried, related issues, or suspected root cause._
