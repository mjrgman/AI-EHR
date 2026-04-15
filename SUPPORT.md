# Support

## Getting help

- Usage and setup questions: open a GitHub Discussion or issue with enough detail to reproduce the problem using synthetic data.
- Clinical safety concerns: follow the process in [SECURITY.md](./SECURITY.md) instead of opening a public bug report with sensitive details.
- Feature proposals: use the feature request template and explain the workflow gap, acceptance criteria, and safety impact.

## Before you open a support request

1. Run `npm install`.
2. Run `npm test`.
3. Run `npm run build`.
4. If you are testing clinician login locally, create a user first with:
   `npm run create-user -- --help`

## What to include

- Operating system and Node version.
- Whether you are using SQLite mock/test mode or a custom environment.
- Exact command run and the observed error output.
- Screenshots only if they do not reveal PHI or secrets.

## Maintainer expectations

- Public support is best-effort.
- Reproducible issues with logs, commands, and clear steps will get priority.
- Safety-critical defects may be redirected into the private security workflow.
