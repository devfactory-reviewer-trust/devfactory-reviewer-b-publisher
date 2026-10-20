-- PREPARATORY ONLY: NO LIVE DATABASE DEPLOYMENT OR OPENROUTER AUTHORITY.
-- Requires a dedicated database initialized from reviewer_b_shadow_central_pg_v1.sql.
-- Run only by an explicitly authorized PostgreSQL superuser/operator.
-- Synthetic CI verifies separate login cannot write underlying tables.
--
-- The ledger is untrusted proposal accounting: SECURITY DEFINER does not
-- prove caller identity, provider invoices, pending bills, EUR/USD exchange,
-- consent, or a right to issue any paid model request.
BEGIN;

DO $check_operator$
BEGIN
  IF current_setting('is_superuser') <> 'on' THEN
    RAISE EXCEPTION 'SHADOW_OPERATOR_SUPERUSER_REQUIRED';
  END IF;
  IF to_regclass('reviewer_b_shadow.monthly_periods') IS NULL OR
     to_regclass('reviewer_b_shadow.exposure_proposals') IS NULL OR
     to_regprocedure('reviewer_b_shadow.propose_exposure(text,integer,text,bigint,text,text,bigint)') IS NULL
  THEN
    RAISE EXCEPTION 'SHADOW_SCHEMA_NOT_READY';
  END IF;
  -- Fail BEFORE enabling a definer if any pre-existing named role or
  -- PUBLIC retains schema/table/sequence/function/column permissions.
  -- Ownership transfer alone does NOT remove older GRANTs.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace n,
      LATERAL pg_catalog.aclexplode(
        COALESCE(n.nspacl,pg_catalog.acldefault('n'::"char",n.nspowner))) a
    WHERE n.nspname='reviewer_b_shadow' AND a.grantee<>n.nspowner
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace,
      LATERAL pg_catalog.aclexplode(
        COALESCE(c.relacl,pg_catalog.acldefault(
          CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a
    WHERE n.nspname='reviewer_b_shadow' AND a.grantee<>c.relowner
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace,
      LATERAL pg_catalog.aclexplode(
        COALESCE(p.proacl,pg_catalog.acldefault('f'::"char",p.proowner))) a
    WHERE n.nspname='reviewer_b_shadow' AND a.grantee<>p.proowner
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace,
      LATERAL pg_catalog.aclexplode(a.attacl) grant_acl
    WHERE n.nspname='reviewer_b_shadow' AND
          a.attnum>0 AND NOT a.attisdropped AND
          grant_acl.grantee<>c.relowner
  ) THEN
    RAISE EXCEPTION 'SHADOW_EXISTING_PRIVILEGES_NOT_TRUSTED';
  END IF;
  -- A trusted, unextended v1 schema has two tables, exactly one identity
  -- sequence and exactly one entrypoint. Extra helper functions or objects
  -- may be executable in a SECURITY DEFINER context: reject them.
  IF (SELECT count(*) FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='reviewer_b_shadow'
        AND c.relkind IN ('r','p','S','v','m','f'))<>3 OR
     (SELECT count(*) FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='reviewer_b_shadow')<>1 OR
     NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_depend dep
       JOIN pg_catalog.pg_class seq ON seq.oid=dep.objid
       WHERE seq.oid=to_regclass('reviewer_b_shadow.exposure_proposals_id_seq')
         AND seq.relkind='S'
         AND dep.refobjid=to_regclass('reviewer_b_shadow.exposure_proposals')
         AND dep.deptype='i'
     )
  THEN
    RAISE EXCEPTION 'SHADOW_SCHEMA_SHAPE_NOT_TRUSTED';
  END IF;
END
$check_operator$;

-- Immutable role names. Both roles are NOLOGIN with no elevated attributes.
-- A future authenticated client may be granted invoker membership after
-- a separate security approval; this migration creates no LOGIN role/secret.
CREATE ROLE reviewer_b_shadow_owner_v1 NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE reviewer_b_shadow_invoker_v1 NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

-- NOLOGIN alone is not sufficient: members could otherwise SET ROLE to
-- the owner. Refuse unexpected membership before enabling the definer.
DO $check_membership$
BEGIN
  IF EXISTS(
    SELECT 1 FROM pg_catalog.pg_auth_members member
    JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=member.roleid
    WHERE owner_role.rolname='reviewer_b_shadow_owner_v1'
  ) THEN
    RAISE EXCEPTION 'SHADOW_OWNER_ROLE_HAS_MEMBERS';
  END IF;
END
$check_membership$;

REVOKE ALL ON SCHEMA reviewer_b_shadow FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA reviewer_b_shadow FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA reviewer_b_shadow FROM PUBLIC;
REVOKE ALL ON FUNCTION reviewer_b_shadow.propose_exposure(
  text,integer,text,bigint,text,text,bigint
) FROM PUBLIC;

-- A NOLOGIN role owns every mutable object in the budget transaction.
-- No service account receives membership in this owner role.
ALTER SCHEMA reviewer_b_shadow OWNER TO reviewer_b_shadow_owner_v1;
ALTER TABLE reviewer_b_shadow.monthly_periods OWNER TO reviewer_b_shadow_owner_v1;
ALTER TABLE reviewer_b_shadow.exposure_proposals OWNER TO reviewer_b_shadow_owner_v1;
-- The owned identity sequence follows its table owner. A separately owned
-- sequence would require an explicit ownership handoff before deployment.
ALTER FUNCTION reviewer_b_shadow.propose_exposure(
  text,integer,text,bigint,text,text,bigint
) OWNER TO reviewer_b_shadow_owner_v1;

-- SECURITY DEFINER is now safe from *schema creation* by the caller:
-- all mutable objects are schema-qualified, search path is pinned, only
-- a NOLOGIN role owns the function and tables, and no untrusted role can
-- create objects in the trusted schema.
ALTER FUNCTION reviewer_b_shadow.propose_exposure(
  text,integer,text,bigint,text,text,bigint
) SECURITY DEFINER;
ALTER FUNCTION reviewer_b_shadow.propose_exposure(
  text,integer,text,bigint,text,text,bigint
) SET search_path = pg_catalog, reviewer_b_shadow, pg_temp;

-- Invoker can ONLY call the audited entrypoint, never SELECT/INSERT/UPDATE
-- the ledger, read monthly counters or access underlying sequences directly.
GRANT USAGE ON SCHEMA reviewer_b_shadow TO reviewer_b_shadow_invoker_v1;
REVOKE ALL ON ALL TABLES IN SCHEMA reviewer_b_shadow
  FROM reviewer_b_shadow_invoker_v1;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA reviewer_b_shadow
  FROM reviewer_b_shadow_invoker_v1;
GRANT EXECUTE ON FUNCTION reviewer_b_shadow.propose_exposure(
  text,integer,text,bigint,text,text,bigint
) TO reviewer_b_shadow_invoker_v1;

-- Prevent future functions owned by this exclusive owner role from
-- silently inheriting PostgreSQL's PUBLIC EXECUTE defaults.
ALTER DEFAULT PRIVILEGES FOR ROLE reviewer_b_shadow_owner_v1
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMIT;
