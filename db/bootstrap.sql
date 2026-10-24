-- One-time bootstrap for the Gridbox Intelligence database.
--
-- Run this ONCE, as the project owner role (`neondb_owner`), on the Neon
-- project. Neon's dashboard SQL editor, the Neon API, or any psql client with
-- the owner connection string all work.
--
-- Why it exists: the game lives in its own `gridbox` schema, and the role it
-- connects as needs to be a plain login role rather than the owner. Creating a
-- schema and a login role needs privileges the application deliberately does
-- not have, so those two steps are separated from the Drizzle migrations,
-- which run as the unprivileged `gridbox_app` role.
--
-- Replace <APP_PASSWORD> with a strong generated password, e.g.:
--   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"

-- 1. The game's namespace. Isolates it from the `public` schema entirely, so no
--    table names collide with anything else in the project.
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
GRANT CONNECT ON DATABASE neondb TO gridbox_app;
GRANT ALL ON SCHEMA gridbox TO gridbox_app;
GRANT CREATE ON DATABASE neondb TO gridbox_app;
ALTER ROLE gridbox_app SET search_path TO gridbox;

-- 4. Required because Drizzle's migrator always issues
--    `CREATE SCHEMA IF NOT EXISTS <schema>` for its bookkeeping table, and
--    Postgres checks database-level CREATE before it checks whether the schema
--    already exists. Without this the migration run fails with "permission
--    denied for database neondb" even though the schema is present. The grant
--    lets that statement no-op; the role still has no rights on any schema
--    other than gridbox.
ALTER DEFAULT PRIVILEGES IN SCHEMA gridbox GRANT ALL ON TABLES TO gridbox_app;

-- Then, as gridbox_app over the DIRECT endpoint:
--   DATABASE_URL=postgresql://gridbox_app:<APP_PASSWORD>@<direct-host>/neondb?sslmode=require
--   npm run db:migrate
--
-- The runtime on Vercel uses the POOLED endpoint (<...>-pooler host) instead.
