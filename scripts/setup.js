#!/usr/bin/env node
/**
 * Agentic EHR — First-run setup script
 *
 * Generates required secrets, creates .env from .env.example,
 * initializes the database, and creates the first admin user.
 *
 * Usage: node scripts/setup.js
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const ENV_EXAMPLE = path.join(ROOT, '.env.example');
const ENV_FILE = path.join(ROOT, '.env');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

async function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Agentic EHR — Setup Wizard');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // --- Step 1: Generate .env ---
  if (fs.existsSync(ENV_FILE)) {
    const overwrite = await ask('.env already exists. Overwrite? (y/N): ');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Keeping existing .env');
    } else {
      generateEnvFile();
    }
  } else {
    generateEnvFile();
  }

  // --- Step 2: Create data directory ---
  const dataDir = path.join(ROOT, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('[OK] Created data/ directory');
  }

  // --- Step 3: Create backups directory ---
  const backupDir = path.join(ROOT, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
    console.log('[OK] Created backups/ directory');
  }

  // --- Step 4: Offer to create first user ---
  console.log('\n--- First User Setup ---');
  const createAdmin = await ask('Create an admin user now? (Y/n): ');
  if (createAdmin.toLowerCase() !== 'n') {
    const username = await ask('Username: ');
    const displayName = await ask('Display name: ');
    const role = await ask('Role (physician/nurse_practitioner/ma/front_desk/billing/admin): ');
    const password = await ask('Password (min 12 chars): ');

    if (password.length < 12) {
      console.log('[WARN] Password should be at least 12 characters for HIPAA compliance.');
    }

    // Write a one-time seed script
    const seedPath = path.join(ROOT, 'scripts', '_seed-user.js');
    const seedContent = `
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../data/mjr-ehr.db');
const db = new sqlite3.Database(DB_PATH);
(async () => {
  const hash = await bcrypt.hash(${JSON.stringify(password)}, 12);
  db.run(\`INSERT OR IGNORE INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)\`,
    [${JSON.stringify(username)}, hash, ${JSON.stringify(displayName)}, ${JSON.stringify(role)}],
    function(err) {
      if (err) console.error('Error:', err.message);
      else console.log('[OK] User created: ' + ${JSON.stringify(username)} + ' (id=' + this.lastID + ')');
      db.close();
      require('fs').unlinkSync(__filename); // Self-destruct
    });
})();
`;
    fs.writeFileSync(seedPath, seedContent);
    console.log('[OK] User seed script written. Run "node scripts/_seed-user.js" after first server start.');
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Setup complete!');
  console.log('  Start the server with: npm run dev');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  rl.close();
}

function generateEnvFile() {
  let template = fs.readFileSync(ENV_EXAMPLE, 'utf-8');

  // Generate secrets
  const jwtSecret = crypto.randomBytes(64).toString('hex');
  const phiKey = crypto.randomBytes(32).toString('hex');

  template = template.replace(/^JWT_SECRET=$/m, `JWT_SECRET=${jwtSecret}`);
  template = template.replace(/^PHI_ENCRYPTION_KEY=$/m, `PHI_ENCRYPTION_KEY=${phiKey}`);

  fs.writeFileSync(ENV_FILE, template);
  console.log('[OK] Generated .env with fresh secrets');
  console.log('     JWT_SECRET: ' + jwtSecret.slice(0, 8) + '...');
  console.log('     PHI_ENCRYPTION_KEY: ' + phiKey.slice(0, 8) + '...');
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
