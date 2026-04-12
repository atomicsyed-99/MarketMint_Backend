/**
 * Run a SQL file against the database.
 *
 * Usage:
 *   node scripts/db/run-sql.mjs <path-to-sql-file>
 *
 * Examples:
 *   node scripts/db/run-sql.mjs scripts/db/mastra_safe_patch.sql
 *   node scripts/db/run-sql.mjs scripts/db/create-user-connections.sql
 *
 * Reads DATABASE_URL from .env.local or .env.
 * Runs each statement individually (required for ALTER TYPE ADD VALUE
 * which cannot run inside a transaction block).
 */
import { readFileSync } from "fs";
import { config } from "dotenv";
import postgres from "postgres";

// Load env
config({ path: ".env.local" });
config({ path: ".env" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/db/run-sql.mjs <path-to-sql-file>");
  process.exit(1);
}

const sql = postgres(url);
const patch = readFileSync(file, "utf-8");

// Strip BEGIN/COMMIT since we run each statement on its own
// (required for ALTER TYPE ADD VALUE which can't run in a transaction)
const cleaned = patch.replace(/^BEGIN;/m, "").replace(/^COMMIT;/m, "");

// Split on semicolons that are NOT inside $$ blocks
const statements = [];
let current = "";
let inDollar = false;
for (const line of cleaned.split("\n")) {
  const trimmed = line.trim();
  if (trimmed.startsWith("--") && !inDollar) continue;

  const dollarCount = (line.match(/\$\$/g) || []).length;
  if (dollarCount % 2 === 1) inDollar = !inDollar;

  current += line + "\n";

  if (!inDollar && trimmed.endsWith(";")) {
    const stmt = current.trim();
    if (stmt && stmt !== ";") statements.push(stmt);
    current = "";
  }
}

console.log(`Running ${statements.length} statement(s) from ${file}...`);

let failed = 0;
for (let i = 0; i < statements.length; i++) {
  const stmt = statements[i];
  const preview = stmt.split("\n")[0].slice(0, 80);
  try {
    await sql.unsafe(stmt);
    console.log(`  [${i + 1}/${statements.length}] OK: ${preview}`);
  } catch (err) {
    failed++;
    console.error(`  [${i + 1}/${statements.length}] ERROR: ${preview}`);
    console.error(`    ${err.message}`);
  }
}

await sql.end();
console.log(failed ? `Done with ${failed} error(s).` : "Done.");
process.exit(failed ? 1 : 0);
