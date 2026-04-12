BEGIN;
-- 1) Ensure enum type exists and contains required values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'messagerole' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.messagerole AS ENUM ('user', 'ai', 'tool');
  END IF;
END $$;
-- Add enum values if missing (idempotent on modern Postgres)
ALTER TYPE public.messagerole ADD VALUE IF NOT EXISTS 'user';
ALTER TYPE public.messagerole ADD VALUE IF NOT EXISTS 'ai';
ALTER TYPE public.messagerole ADD VALUE IF NOT EXISTS 'tool';
-- 1b) Ensure messageagent enum exists and contains required values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'messageagent' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.messageagent AS ENUM ('none', 'photographer', 'developer', 'planner', 'finisher');
  END IF;
END $$;
ALTER TYPE public.messageagent ADD VALUE IF NOT EXISTS 'none';
ALTER TYPE public.messageagent ADD VALUE IF NOT EXISTS 'photographer';
ALTER TYPE public.messageagent ADD VALUE IF NOT EXISTS 'developer';
ALTER TYPE public.messageagent ADD VALUE IF NOT EXISTS 'planner';
ALTER TYPE public.messageagent ADD VALUE IF NOT EXISTS 'finisher';
-- 1c) Align messages table JSON/timestamp/default semantics with app expectations
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Drop existing defaults before type conversion (defaults may not cast automatically)
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN content DROP DEFAULT;
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN attachments DROP DEFAULT;
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN tool_calls DROP DEFAULT;

-- Convert legacy array-of-jsonb columns into jsonb columns
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN content TYPE jsonb USING to_jsonb(content);
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN attachments TYPE jsonb USING to_jsonb(attachments);
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN tool_calls TYPE jsonb USING to_jsonb(tool_calls);

-- Ensure defaults expected by current app inserts
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN content SET DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN attachments SET DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN tool_calls SET DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN files SET DEFAULT '{}'::text[];
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN message_id SET DEFAULT gen_random_uuid();

-- Backfill/relax constraints to match app schema behavior
UPDATE public.messages
SET message_id = gen_random_uuid()
WHERE message_id IS NULL;
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN message_id SET NOT NULL;
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN llm_usage DROP NOT NULL;
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN files DROP NOT NULL;

-- 2) Ensure chats timestamp defaults are present (additive, no data deletion)
ALTER TABLE IF EXISTS public.chats
  ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE IF EXISTS public.chats
  ALTER COLUMN last_updated SET DEFAULT now();
-- 3) Backfill null timestamps if any, then enforce NOT NULL
UPDATE public.chats
SET created_at = now()
WHERE created_at IS NULL;
UPDATE public.chats
SET last_updated = now()
WHERE last_updated IS NULL;
ALTER TABLE IF EXISTS public.chats
  ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE IF EXISTS public.chats
  ALTER COLUMN last_updated SET NOT NULL;
-- 4) Ensure messages.message_id unique constraint exists (only if not already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'messages_message_id_unique'
      AND conrelid = 'public.messages'::regclass
  ) THEN
    -- This may fail if duplicates exist; that's expected and safe (no data loss).
    BEGIN
      ALTER TABLE public.messages
        ADD CONSTRAINT messages_message_id_unique UNIQUE (message_id);
    EXCEPTION
      WHEN unique_violation THEN
        RAISE NOTICE 'messages.message_id has duplicates; unique constraint not added.';
      WHEN others THEN
        RAISE NOTICE 'Could not add unique constraint on messages.message_id: %', SQLERRM;
    END;
  END IF;
END $$;
COMMIT;