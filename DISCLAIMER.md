# IMPORTANT DISCLAIMERS

## HIPAA Compliance Notice

**This software is NOT HIPAA-compliant out of the box.**

MJR-EHR is a demonstration and development platform for exploring AI-native
electronic health record concepts. It is **not certified, audited, or validated**
for use with real Protected Health Information (PHI).

Before using this software in any clinical or production environment, you must:

1. **Encrypt data at rest** -- the SQLite database stores data unencrypted on disk.
   Migrate to an encrypted database or enable full-disk encryption.

2. **Encrypt data in transit** -- deploy behind HTTPS/TLS. Never expose the
   Express server directly to the internet without a reverse proxy (e.g., nginx)
   with a valid TLS certificate.

3. **Implement access controls** -- the included JWT authentication is a starting
   point. Production use requires role-based access control (RBAC), audit logging
   of all PHI access, automatic session timeouts, and multi-factor authentication.

4. **Enable audit logging** -- HIPAA requires logging of all access to PHI,
   including who accessed what data, when, and why. This is not yet implemented.

5. **Perform a Security Risk Assessment** -- required under the HIPAA Security
   Rule before deploying any system that handles PHI.

6. **Execute Business Associate Agreements (BAAs)** -- if using third-party
   services (Anthropic API, Twilio, SendGrid, Deepgram, etc.), you must have
   BAAs in place with each vendor before transmitting PHI.

7. **Implement backup and disaster recovery** -- HIPAA requires data backup plans,
   disaster recovery plans, and emergency mode operation plans.

## Not Medical Advice

The clinical decision support (CDS) rules, differential diagnoses, treatment
suggestions, and any AI-generated content in this software are for
**demonstration purposes only**. They do not constitute medical advice,
diagnosis, or treatment recommendations.

- CDS rules are simplified representations and may not reflect current
  clinical guidelines.
- AI-generated SOAP notes, differential diagnoses, and treatment plans are
  **not validated** for clinical accuracy.
- Always rely on qualified medical professionals for clinical decisions.

## No Warranty

This software is provided "as is" without warranty of any kind. The authors and
contributors are not liable for any damages arising from the use of this
software. See the LICENSE file for full terms.

## Demo Data

All patient data included in this repository (Sarah Mitchell, Robert Chen) is
**entirely fictional**. Any resemblance to real persons is coincidental.
