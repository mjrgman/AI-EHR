# Agentic EHR Module Catalog

This document is the canonical operating map for the runtime modules in the AI EHR.

The code-level source of truth lives in `server/agents/module-registry.js`.

## Operating rules

- Patient data stays inside authenticated, auditable workflows.
- Any Tier 3 output remains draft or recommendation-only until a physician approves it.
- Every module has a defined human counterpart, handoff target, and safety boundary.
- The product is a 9-module clinical workflow system, not an unstructured pile of agents.

## Module map

| Module | Workflow band | Human counterpart | Tier | Mission | Primary handoff |
|---|---|---|---|---|---|
| Phone Triage | Access | Phone triage / nurse intake | 1 | Turn inbound calls into urgency-classified chart events and routing decisions | MA, Physician, Front Desk |
| Front Desk | Access and pre-visit | Front desk / scheduling | 1 | Manage scheduling, patient contact, and pre-visit briefing assembly | Patient, Physician, MA |
| Medical Assistant | Protocol execution | Medical assistant | 2 | Execute refill, lab, and patient-support workflows inside clinician-defined protocols | Front Desk, Physician |
| Physician | Clinical governance | Physician | 3 | Own protocol setting, escalation handling, note shaping, and final clinical authority | MA, Orders, Patient, Chart |
| Scribe | Encounter capture | Ambient scribe | 3 | Capture the encounter, extract structure, and draft the SOAP note | Physician, CDS, Orders, Coding, Quality |
| CDS | Encounter support | Clinical decision support | 2 | Surface alerts, care gaps, medication risks, and evidence-based suggestions | Physician, Orders, Quality |
| Orders | Clinical execution | Ordering workflow | 3 | Consolidate labs, imaging, referrals, and prescriptions into structured order packets | Physician approval and downstream services |
| Coding | Revenue and documentation | Coding / billing review | 2 | Generate E&M support, ICD-10 mapping, and coding completeness feedback | Physician, billing staff |
| Quality | Oversight and population health | Quality / compliance operations | 2 | Track care gaps, measures, and readiness for quality programs | Physician, MA, quality operations |

## Patient control and safety boundaries

- Phone Triage: verified caller context and approved triage protocols only; emergency routing must be explicit.
- Front Desk: respects contact preferences and scheduling context; makes no clinical decisions.
- Medical Assistant: acts only inside approved protocols and escalates exceptions.
- Physician: remains final human decision-maker for all Tier 3 outputs.
- Scribe: draft-only; nothing reaches the permanent record without clinician review.
- CDS: recommendation-only; does not diagnose, treat, or silently change care.
- Orders: prepares structured orders but does not transmit without physician authorization.
- Coding: supports accurate coding but cannot distort clinical truth for reimbursement.
- Quality: flags gaps and compliance risks; does not auto-order care.

## Dependency shape

- Access layer: `phone_triage`, `front_desk`, `ma`, `physician`
- Encounter layer phase 1: `scribe`, `cds`
- Encounter layer phase 2: `orders`, `coding`
- Oversight layer phase 3: `quality`

## Why this matters

- The README, vision docs, and runtime metadata should all describe the same system.
- Future UI work can render module metadata directly from the registry instead of duplicating labels by hand.
- Refinement work should happen against these nine modules and their handoffs, not against vague "AI agent" marketing language.
