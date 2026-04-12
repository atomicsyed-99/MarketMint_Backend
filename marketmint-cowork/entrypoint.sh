#!/bin/sh
set -e

ENV_FILE="/tmp/.env"

# 1. Load secrets from AWS Secrets Manager into /tmp/.env
echo "📦 Loading environment from AWS Secrets Manager..."
bun run scripts/load-env.ts

# 2. Export the .env file into the current shell, then delete it
if [ -f "$ENV_FILE" ]; then
  echo "📄 Sourcing env file..."
  set -a
  . "$ENV_FILE"
  set +a
  rm -f "$ENV_FILE"
  echo "🗑️  Deleted $ENV_FILE"
fi

# 3. Run database migrations
echo "🗄️  Running database migrations..."
bunx drizzle-kit migrate

# 4. Enable Studio if bundled
if [ -d ".mastra/output/studio" ]; then
  export MASTRA_STUDIO_PATH=.mastra/output/studio
  echo "🎨 Studio enabled at MASTRA_STUDIO_PATH=$MASTRA_STUDIO_PATH"
fi

# 5. Start the application
echo "🚀 Starting application..."
exec bun run .mastra/output/index.mjs
