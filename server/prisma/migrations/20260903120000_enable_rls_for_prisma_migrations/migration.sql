-- Prisma owns this table, but Supabase exposes every table in the public schema
-- to its security advisor. No public policy is added.
ALTER TABLE IF EXISTS public."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
