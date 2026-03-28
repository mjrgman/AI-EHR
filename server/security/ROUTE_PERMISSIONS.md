# API Route Permissions Matrix

**Updated:** 2026-03-28 (Audit Pass 2, S-2)

All routes require JWT authentication (via `auth.requireAuth` middleware) except `/api/auth/login` and `/api/health`.

| Route | Method | RBAC Roles |
|---|---|---|
| `/api/auth/login` | POST | Public (no auth) |
| `/api/auth/logout` | POST | Any authenticated |
| `/api/auth/me` | GET | Any authenticated |
| `/api/health` | GET | Public (no auth) |
| `/api/ai/status` | GET | Any authenticated |
| **Patients** | | |
| `/api/patients` | GET | front_desk, ma, nurse_practitioner, physician, billing, admin, system |
| `/api/patients/:id` | GET | front_desk, ma, nurse_practitioner, physician, billing, admin, system |
| `/api/patients` | POST | front_desk, ma, nurse_practitioner, physician, admin |
| `/api/patients/extract-from-speech` | POST | physician, nurse_practitioner, ma |
| `/api/patients/:id/problems` | POST | physician, nurse_practitioner, ma |
| `/api/patients/:id/medications` | GET | physician, nurse_practitioner, ma, system |
| `/api/patients/:id/medications` | POST | physician, nurse_practitioner |
| `/api/patients/:id/allergies` | GET | physician, nurse_practitioner, ma, system |
| `/api/patients/:id/allergies` | POST | physician, nurse_practitioner, ma |
| `/api/patients/:id/labs` | GET | physician, nurse_practitioner, ma, system |
| `/api/patients/:id/labs` | POST | physician, nurse_practitioner, system |
| `/api/patients/:id/vitals` | GET | physician, nurse_practitioner, ma, system |
| **Encounters** | | |
| `/api/encounters` | GET | physician, nurse_practitioner, ma, front_desk, admin, system |
| `/api/encounters/:id` | GET | physician, nurse_practitioner, ma, front_desk, system |
| `/api/encounters` | POST | front_desk, ma, nurse_practitioner, physician, admin |
| `/api/encounters/:id` | PATCH | physician, nurse_practitioner, ma |
| `/api/encounters/:id/orders` | GET | physician, nurse_practitioner, ma, system |
| **AI/Clinical** | | |
| `/api/ai/extract-data` | POST | physician, nurse_practitioner, ma, system |
| `/api/ai/generate-note` | POST | physician, nurse_practitioner, system |
| **Prescriptions** | | |
| `/api/prescriptions` | POST | physician, nurse_practitioner |
| `/api/prescriptions/from-speech` | POST | physician, nurse_practitioner |
| **Lab Orders** | | |
| `/api/lab-orders` | GET | physician, nurse_practitioner, ma, system |
| `/api/lab-orders` | POST | physician, nurse_practitioner, ma |
| `/api/lab-orders/from-speech` | POST | physician, nurse_practitioner |
| **Imaging Orders** | | |
| `/api/imaging-orders` | GET | physician, nurse_practitioner, ma, system |
| `/api/imaging-orders` | POST | physician, nurse_practitioner |
| **Referrals** | | |
| `/api/referrals` | GET | physician, nurse_practitioner, ma, system |
| `/api/referrals` | POST | physician, nurse_practitioner |
| **Vitals** | | |
| `/api/vitals` | POST | physician, nurse_practitioner, ma, system |
| `/api/vitals/from-speech` | POST | physician, nurse_practitioner, ma |
| **Workflow** | | |
| `/api/workflow` | POST | physician, nurse_practitioner, ma, front_desk, system |
| `/api/workflow/:id` | GET | physician, nurse_practitioner, ma, front_desk, system |
| `/api/workflow/:id/transition` | POST | physician, nurse_practitioner, ma, front_desk, system |
| `/api/workflow/:id/timeline` | GET | physician, nurse_practitioner, ma, front_desk, system |
| `/api/workflow/queue/:state` | GET | physician, nurse_practitioner, ma, front_desk, admin, system |
| `/api/workflows` | GET | physician, nurse_practitioner, ma, front_desk, admin, system |
| **CDS** | | |
| `/api/cds/evaluate` | POST | physician, nurse_practitioner, system |
| `/api/cds/suggestions/:id` | GET | physician, nurse_practitioner, system |
| `/api/cds/suggestions/:id/accept` | POST | physician, nurse_practitioner |
| `/api/cds/suggestions/:id/reject` | POST | physician, nurse_practitioner |
| `/api/cds/suggestions/:id/defer` | POST | physician, nurse_practitioner |
| **Provider Learning** | | |
| `/api/provider/preferences` | GET | physician, nurse_practitioner, admin |
| `/api/provider/preferences/decay` | POST | physician, admin |
| **Dashboard** | | |
| `/api/dashboard` | GET | physician, nurse_practitioner, ma, front_desk, admin, system |
| **Audit** | | |
| `/api/audit/logs` | GET | admin, physician |
| `/api/audit/stats` | GET | admin, physician |
| `/api/audit/sessions` | GET | admin |
| `/api/audit/patient/:id` | GET | admin, physician |
| `/api/audit/export` | GET | admin |
| **Agents** | | |
| `/api/agents/run` | POST | physician, nurse_practitioner, system |
| `/api/agents/run-all` | POST | physician, nurse_practitioner, system |
| `/api/agents/run/:name` | POST | physician, nurse_practitioner, system |
| `/api/agents/triage` | POST | physician, nurse_practitioner, ma, front_desk, system |
| `/api/agents/front-desk` | POST | physician, nurse_practitioner, ma, front_desk, system |
| `/api/agents/briefing/:id` | GET | physician, nurse_practitioner, ma, front_desk, system |
| `/api/agents/ma` | POST | physician, nurse_practitioner, ma, system |
| `/api/agents/physician` | POST | physician, nurse_practitioner, system |
| `/api/agents/governance` | GET | physician, nurse_practitioner, admin |
| `/api/agents/:name/audit` | GET | physician, nurse_practitioner, admin |
| `/api/agents/safety-events` | GET | physician, nurse_practitioner, admin |
| `/api/agents/:name/override` | POST | physician, nurse_practitioner |
| `/api/agents/status` | GET | physician, nurse_practitioner, ma, admin, system |
| `/api/agents/last-result` | GET | physician, nurse_practitioner, system |
| `/api/agents/summary` | GET | physician, nurse_practitioner, system |
