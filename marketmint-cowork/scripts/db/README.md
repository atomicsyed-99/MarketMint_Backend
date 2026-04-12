# Database Setup

## Drizzle Migrations (primary)

All table schemas live in `src/db/schema/`. Migrations are in `drizzle/`.

```bash
# Apply all pending migrations
npx drizzle-kit migrate

# Or push schema directly (skips migration files)
npx drizzle-kit push

# Generate a new migration after changing a schema file
npx drizzle-kit generate
```

## Legacy Patches

Some schema changes (enums, column defaults, constraints) can't be expressed in Drizzle. Use the `run-sql.mjs` runner:

```bash
node scripts/db/run-sql.mjs scripts/db/mastra_safe_patch.sql
```

## Fresh Database Setup

```bash
# 1. Run Drizzle migrations (creates tables)
npx drizzle-kit migrate

# 2. Run legacy patches (enums, defaults, constraints)
node scripts/db/run-sql.mjs scripts/db/mastra_safe_patch.sql
```
