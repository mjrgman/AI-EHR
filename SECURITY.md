# Security Policy

## Scope

AI-EHR is clinical software. Security issues that touch authentication, PHI handling, CDS logic, orders, dosing, or audit boundaries are treated as release-blocking until triaged.

## How to report a vulnerability

1. Use GitHub private vulnerability reporting if it is enabled for the repository.
2. If private reporting is unavailable, contact the maintainer through GitHub before opening a public issue.
3. Do not post exploit details, patient data, secrets, or proof-of-concept payloads in a public issue or pull request.

## What to include

- A short summary of the issue and affected component.
- The impact: confidentiality, integrity, availability, or patient-safety risk.
- Reproduction steps using synthetic or de-identified data only.
- Any suggested mitigation or guardrail.

## Triage targets

- Critical patient-safety or auth-boundary issues: same business day triage.
- High severity security defects: triage within 2 business days.
- Moderate severity defects: triage within 5 business days.

## Disclosure expectations

- Public disclosure should wait until a fix or mitigation is available.
- Maintainers may request a coordinated disclosure window for high-impact issues.

## Safe harbor

- Good-faith reports that avoid privacy violations, service disruption, and data exfiltration are welcome.
- Do not access, modify, or retain real patient data while testing.
