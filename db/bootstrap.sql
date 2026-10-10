-- One-time bootstrap for the Gridbox Intelligence database.
--
-- Run this ONCE, as a privileged role (e.g. via the Supabase SQL editor or the
-- Management API), on whichever Supabase project you choose.
--
-- Why it exists: the game lives in its own `gridbox` schema inside a shared
-- Supabase project. Creating a schema and a login role needs privileges the
-- application deliberately does not have, so those two steps are separated from
-- the Drizzle migrations, which run as the unprivileged `gridbox_app` role.
--
-- Replace <APP_PASSWORD> with a strong generated password.

-- 1. The game's namespace. Isolates it from the `public` schema entirely, so no
--    table names collide with anything already in the project.
CREATE SCHEMA IF NOT EXISTS gridbox;

-- 2. Least-privilege application role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gridbox_app') THEN
    CREATE ROLE gridbox_app LOGIN PASSWORD '<APP_PASSWORD>'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

-- 3. Scoped grants: this role can only reach the gridbox schema.
GRANT CONNECT ON DATABASE postgres TO gridbox_app;
GRANT ALL ON SCHEMA gridbox TO gridbox_app;
ALTER ROLE gridbox_app SET search_path TO gridbox;

-- 4. Required for the role to be usable through Supabase's connection pooler.
GRANT gridbox_app TO authenticator;

-- 5. Drizzle's migrator always issues `CREATE SCHEMA IF NOT EXISTS <schema>` for
--    its bookkeeping table, and Postgres checks database-level CREATE before it
--    checks whether the schema already exists. Without this the migration run
--    fails with "permission denied for database postgres" even though the schema
--    is present. The grant lets that statement no-op; the role still has no
--    rights on any schema other than gridbox.
GRANT CREATE ON DATABASE postgres TO gridbox_app;

-- Then, as gridbox_app through the pooler:
--   DATABASE_URL=postgresql://gridbox_app.<project-ref>:<APP_PASSWORD>@\
--     aws-1-<region>.pooler.supabase.com:6543/postgres?sslmode=require
--   npm run db:migrate
