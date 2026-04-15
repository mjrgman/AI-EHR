#!/usr/bin/env node

const path = require('path');

process.env.DATABASE_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../data/ehr.db');

const auth = require('../server/security/auth');
const db = require('../server/database');
const { runMigrations } = require('../server/database-migrations');

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const value = argv[i + 1];
    args[key] = value && !value.startsWith('--') ? value : 'true';
    if (value && !value.startsWith('--')) {
      i += 1;
    }
  }

  return args;
}

function printHelp() {
  console.log(`Create a clinician account for AI-EHR.

Usage:
  npm run create-user -- --username dr.renner --password 'SecurePass!234' --full-name 'Dr. Michael Renner' --role physician --email dr.renner@example.com --npi-number 1234567890

Required:
  --username
  --password
  --full-name
  --role
  --email

Conditionally required:
  --npi-number for physician, nurse_practitioner, and physician_assistant roles

Optional:
  --phone
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printHelp();
    return;
  }

  const required = ['username', 'password', 'full-name', 'role', 'email'];
  const missing = required.filter((key) => !args[key]);
  if (missing.length) {
    throw new Error(`Missing required arguments: ${missing.join(', ')}`);
  }

  const role = args.role;
  const requiresNpi = ['physician', 'nurse_practitioner', 'physician_assistant'].includes(role);
  if (requiresNpi && !args['npi-number']) {
    throw new Error(`--npi-number is required for role ${role}`);
  }

  await db.ready;
  await runMigrations(db);
  await auth.init(db);

  const user = await auth.createUser(
    args.username,
    args.password,
    args['full-name'],
    role,
    args.email,
    args.phone || null,
    args['npi-number'] || null
  );

  console.log(`Created user ${user.username} (${user.role}) with id ${user.id}.`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
