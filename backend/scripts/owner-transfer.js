#!/usr/bin/env node
// Recovers ownership when the owner's account is lost (user decision
// 2026-10-11). Run on the server:
//
//   docker compose exec backend npm run owner:transfer -- <username>
//
// Moves ownership to that local, active account, makes it a System
// Administrator if it isn't one, and records the move in the audit log.
// The previous owner stays a System Administrator.
const { recoverOwnership } = require('../src/services/ownership');
const sequelize = require('../src/config/database');

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error('Usage: npm run owner:transfer -- <username>');
    return 2;
  }
  try {
    const { from, to } = await recoverOwnership(username);
    console.log(`Ownership moved to "${to}"${from ? ` (was "${from}")` : ''}.`);
    return 0;
  } catch (err) {
    console.error(`Ownership not moved: ${err.message}`);
    return 1;
  } finally {
    await sequelize.close();
  }
}

main().then((code) => { process.exitCode = code; });
