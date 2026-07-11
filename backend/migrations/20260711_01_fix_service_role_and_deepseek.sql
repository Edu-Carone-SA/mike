-- MIKE-FIX-LLM-PRODUCTION-01
-- Fix service_role membership, grants, and deepseek provider constraint
-- Must be executed directly on the RDS instance (not via Prisma/Supabase migrations)

-- 1. Grant service_role membership to authenticator
--    Without this, PostgREST cannot SET ROLE service_role when receiving
--    a service-role JWT, causing SQLSTATE 42501 on all queries.
GRANT service_role TO authenticator;

-- 2. Grant schema usage and table/function/sequence privileges to service_role
--    service_role had zero grants in the public schema.
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- 3. Set default privileges so future tables are accessible to service_role
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;

-- 4. Update CHECK constraint to include 'deepseek' provider
--    The original constraint omitted 'deepseek', which would cause
--    CheckConstraintViolation when saving a user-provided DeepSeek API key.
ALTER TABLE public.user_api_keys DROP CONSTRAINT IF EXISTS user_api_keys_provider_check;
ALTER TABLE public.user_api_keys ADD CONSTRAINT user_api_keys_provider_check CHECK (
    provider IN ('claude', 'gemini', 'openai', 'openrouter', 'courtlistener', 'deepseek')
);
