---
name: Clinical Safety Concern
about: A bug or gap that could cause patient harm
title: '[SAFETY] '
labels: safety, triage-urgent
assignees: ''
---

<!--
⚠ IMPORTANT ⚠

If this vulnerability is actively exploitable and you have not yet
disclosed it publicly, please consider whether a public issue is the right
venue. For issues that could reveal PHI or enable harm, contact the
maintainer directly before filing.

For all other clinical safety concerns (wrong dose, missed interaction,
bypassed guardrail, silent failure in an approval flow), file here. Use
this template — not the standard Bug Report template — because clinical
safety issues have a different triage path and SLA.
-->

## Severity (your assessment)

- [ ] **Critical** — could directly cause patient harm if used in production with real patients
- [ ] **High** — safety-relevant but mitigated by existing layers (e.g. CDS still fires, Tier 3 gate still holds)
- [ ] **Medium** — degrades safety posture without creating a direct harm path
- [ ] **Low** — a safety-adjacent code smell or doc gap

## What is the clinical risk?

_In one paragraph: if this bug made it to a real clinic, what could go
wrong with a real patient?_

## Affected module / tier

- **Module**: (e.g. `DomainLogicAgent`, `CDSAgent`, `OrdersAgent`)
- **Autonomy tier**: 1 / 2 / 3
- **Related safety invariant** (from `CONTRIBUTING.md`): which of the three
  core rules does this involve?

## Steps to reproduce

_Exact repro. If you can't reproduce it reliably, say so — an unreliable
repro is still worth filing._

1.
2.
3.

## Observed vs expected

**Observed**: _what the system did_

**Expected** (per guideline / protocol): _what it should have done, with a
citation to the authoritative source_

## Evidence / citation

_Link the guideline, study, or protocol that defines the correct behavior.
Example: "Endocrine Society Testosterone Guideline 2018, Table 4" —
not "a doctor told me once"._

## Suggested fix (optional)

_If you see a fix, describe it. If not, leave blank._

## Disclosure

- [ ] This issue contains no PHI, no patient identifiers, and no data from
      real patients
- [ ] I have not shared this issue or workaround publicly in a way that
      could be exploited
