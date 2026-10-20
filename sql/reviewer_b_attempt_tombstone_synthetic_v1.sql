-- OFFLINE SYNTHETIC ONLY: preparatory durable PostgreSQL attempt tombstones.
-- PostgreSQL 16 in ephemeral CI only. No real models, provider egress,
-- key material, account authorization, payment, runner or production deploy.
-- This ledger is NOT connected to the paid Publisher or shadow budget.
BEGIN;
DO $operator$
BEGIN
  IF current_setting('is_superuser') <> 'on'
  THEN RAISE EXCEPTION 'SHADOW_ATTEMPT_SUPERUSER_REQUIRED'; END IF;
  IF to_regnamespace('reviewer_b_attempt_shadow') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles
                 WHERE rolname IN ('reviewer_b_attempt_owner_v1',
                                   'reviewer_b_attempt_invoker_v1'))
  THEN RAISE EXCEPTION 'SHADOW_ATTEMPT_SCHEMA_ALREADY_EXISTS'; END IF;
END
$operator$;

CREATE ROLE reviewer_b_attempt_owner_v1
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE reviewer_b_attempt_invoker_v1
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE SCHEMA reviewer_b_attempt_shadow AUTHORIZATION reviewer_b_attempt_owner_v1;

CREATE TABLE reviewer_b_attempt_shadow.attempts (
  request_id text PRIMARY KEY
    CHECK (request_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$'),
  attempt_id text NOT NULL UNIQUE
    CHECK (attempt_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$'),
  key_role text NOT NULL CHECK (key_role IN ('development','reviewer_b')),
  head_sha text NOT NULL CHECK (head_sha ~ '^[a-f0-9]{40}$'),
  created_month_utc date NOT NULL CHECK (EXTRACT(DAY FROM created_month_utc)=1),
  status text NOT NULL DEFAULT 'registered' CHECK (status IN (
    'registered','dispatch_may_have_occurred','outcome_unknown',
    'cancelled_before_dispatch')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  dispatch_marker_at timestamptz,
  unknown_at timestamptz,
  cancelled_at timestamptz,
  CONSTRAINT synthetic_attempt_state_consistency CHECK (
    (status='registered' AND dispatch_marker_at IS NULL
     AND unknown_at IS NULL AND cancelled_at IS NULL)
    OR
    (status='dispatch_may_have_occurred' AND dispatch_marker_at IS NOT NULL
     AND unknown_at IS NULL AND cancelled_at IS NULL)
    OR
    (status='outcome_unknown' AND dispatch_marker_at IS NOT NULL
     AND unknown_at IS NOT NULL AND cancelled_at IS NULL)
    OR
    (status='cancelled_before_dispatch' AND dispatch_marker_at IS NULL
     AND unknown_at IS NULL AND cancelled_at IS NOT NULL))
);
ALTER TABLE reviewer_b_attempt_shadow.attempts
  OWNER TO reviewer_b_attempt_owner_v1;
REVOKE ALL ON SCHEMA reviewer_b_attempt_shadow FROM PUBLIC;
REVOKE ALL ON TABLE reviewer_b_attempt_shadow.attempts FROM PUBLIC;

-- The NOLOGIN definer owns all mutable objects. It grants only narrowly
-- scoped test functions to a separate NOLOGIN invoker, never table writes.
-- Every function returns may_spend=false and may_dispatch=false.
CREATE FUNCTION reviewer_b_attempt_shadow.register_synthetic_attempt(
  p_request text,p_attempt text,p_role text,p_head text)
RETURNS TABLE (recorded boolean,reason text,may_spend boolean,may_dispatch boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $fn$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed'
     OR p_request IS NULL OR p_request !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$'
     OR p_attempt IS NULL OR p_attempt !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$'
     OR p_role IS NULL OR p_role NOT IN ('development','reviewer_b')
     OR p_head IS NULL OR p_head !~ '^[a-f0-9]{40}$'
  THEN
    RETURN QUERY SELECT false,'SHADOW_ATTEMPT_REGISTER_INVALID'::text,false,false;
    RETURN;
  END IF;
  BEGIN
    INSERT INTO reviewer_b_attempt_shadow.attempts(
      request_id,attempt_id,key_role,head_sha,created_month_utc)
    VALUES(p_request,p_attempt,p_role,p_head,
      date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date);
    RETURN QUERY SELECT true,'SHADOW_ATTEMPT_REGISTERED_NO_SPEND'::text,false,false;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT false,'SHADOW_ATTEMPT_REUSED_ID'::text,false,false;
  END;
END
$fn$;

-- A recorded dispatch-risk tombstone is the most conservative state.
-- The operator MUST commit it before any prospective network egress.
-- This synthetic function does not make an API call or permit one.
CREATE FUNCTION reviewer_b_attempt_shadow.record_dispatch_risk(
  p_request text,p_attempt text,p_head text)
RETURNS TABLE (recorded boolean,reason text,may_spend boolean,may_dispatch boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $fn$
DECLARE v_id text;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed'
     OR p_request IS NULL OR p_attempt IS NULL OR p_head IS NULL
  THEN
    RETURN QUERY SELECT false,'SHADOW_ATTEMPT_DISPATCH_INVALID'::text,false,false;
    RETURN;
  END IF;
  SELECT a.request_id INTO v_id
    FROM reviewer_b_attempt_shadow.attempts a
   WHERE a.request_id=p_request AND a.attempt_id=p_attempt
     AND a.head_sha=p_head AND a.status='registered'
   FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false,'SHADOW_ATTEMPT_DISPATCH_DUPLICATE_OR_UNKNOWN'::text,
      false,false;
    RETURN;
  END IF;
  UPDATE reviewer_b_attempt_shadow.attempts a
     SET status='dispatch_may_have_occurred',dispatch_marker_at=clock_timestamp()
   WHERE a.request_id=v_id AND a.status='registered';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHADOW_ATTEMPT_DISPATCH_CAS_FAILED';
  END IF;
  RETURN QUERY SELECT true,'SHADOW_ATTEMPT_RISK_TOMBSTONE_NO_SPEND'::text,
    false,false;
END
$fn$;

-- Once a request MAY have crossed the network, "outcome unknown" is a
-- permanent conservative state in this synthetic schema. Never retry.
CREATE FUNCTION reviewer_b_attempt_shadow.mark_outcome_unknown(
  p_request text,p_attempt text,p_head text)
RETURNS TABLE (recorded boolean,reason text,may_spend boolean,may_dispatch boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $fn$
DECLARE v_id text;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed'
     OR p_request IS NULL OR p_attempt IS NULL OR p_head IS NULL
  THEN
    RETURN QUERY SELECT false,'SHADOW_ATTEMPT_UNKNOWN_INVALID'::text,false,false;
    RETURN;
  END IF;
  SELECT a.request_id INTO v_id
    FROM reviewer_b_attempt_shadow.attempts a
   WHERE a.request_id=p_request AND a.attempt_id=p_attempt
     AND a.head_sha=p_head AND a.status='dispatch_may_have_occurred'
   FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false,'SHADOW_ATTEMPT_UNKNOWN_STATE_INVALID'::text,
      false,false;
    RETURN;
  END IF;
  UPDATE reviewer_b_attempt_shadow.attempts a
     SET status='outcome_unknown',unknown_at=clock_timestamp()
   WHERE a.request_id=v_id AND a.status='dispatch_may_have_occurred';
  IF NOT FOUND THEN RAISE EXCEPTION 'SHADOW_ATTEMPT_UNKNOWN_CAS_FAILED'; END IF;
  RETURN QUERY SELECT true,'SHADOW_ATTEMPT_UNKNOWN_TOMBSTONE_NO_RETRY'::text,
    false,false;
END
$fn$;

CREATE FUNCTION reviewer_b_attempt_shadow.cancel_before_dispatch(
  p_request text,p_attempt text,p_head text)
RETURNS TABLE (recorded boolean,reason text,may_spend boolean,may_dispatch boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $fn$
DECLARE v_id text;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed'
     OR p_request IS NULL OR p_attempt IS NULL OR p_head IS NULL
  THEN
    RETURN QUERY SELECT false,'SHADOW_ATTEMPT_CANCEL_INVALID'::text,false,false;
    RETURN;
  END IF;
  SELECT a.request_id INTO v_id
    FROM reviewer_b_attempt_shadow.attempts a
   WHERE a.request_id=p_request AND a.attempt_id=p_attempt
     AND a.head_sha=p_head AND a.status='registered'
   FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false,'SHADOW_ATTEMPT_CANCEL_AFTER_RISK_FORBIDDEN'::text,
      false,false;
    RETURN;
  END IF;
  UPDATE reviewer_b_attempt_shadow.attempts a
     SET status='cancelled_before_dispatch',cancelled_at=clock_timestamp()
   WHERE a.request_id=v_id AND a.status='registered';
  IF NOT FOUND THEN RAISE EXCEPTION 'SHADOW_ATTEMPT_CANCEL_CAS_FAILED'; END IF;
  RETURN QUERY SELECT true,'SHADOW_ATTEMPT_CANCELLED_NO_SPEND'::text,false,false;
END
$fn$;

-- OFFLINE ONLY: read-only inspection after an ambiguous/lost COMMIT reply.
-- A REGISTERED or absent row cannot prove an external send never occurred.
-- No observation, even a committed risk marker, authorizes dispatch or retry.
CREATE FUNCTION reviewer_b_attempt_shadow.observe_attempt_after_uncertain_commit(
  p_request text,p_attempt text,p_head text)
RETURNS TABLE (
  identity_found boolean,reason text,observed_state text,
  may_spend boolean,may_dispatch boolean,may_retry boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $fn$
DECLARE v_state text;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed'
     OR p_request IS NULL OR p_request !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$'
     OR p_attempt IS NULL OR p_attempt !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$'
     OR p_head IS NULL OR p_head !~ '^[a-f0-9]{40}$'
  THEN
    RETURN QUERY SELECT false,'SHADOW_RECOVERY_INPUT_INVALID'::text,
      NULL::text,false,false,false;
    RETURN;
  END IF;

  -- Fail closed on conflicting in-flight row changes (NOWAIT raises 55P03).
  SELECT a.status INTO v_state
  FROM reviewer_b_attempt_shadow.attempts a
  WHERE a.request_id=p_request AND a.attempt_id=p_attempt
    AND a.head_sha=p_head
  FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false,'SHADOW_RECOVERY_NOT_FOUND_OR_MISMATCH'::text,
      NULL::text,false,false,false;
    RETURN;
  END IF;
  RETURN QUERY SELECT true,'SHADOW_RECOVERY_READONLY_NOT_AUTHORITY'::text,
    v_state,false,false,false;
END
$fn$;

ALTER FUNCTION reviewer_b_attempt_shadow.register_synthetic_attempt(text,text,text,text)
  OWNER TO reviewer_b_attempt_owner_v1;
ALTER FUNCTION reviewer_b_attempt_shadow.record_dispatch_risk(text,text,text)
  OWNER TO reviewer_b_attempt_owner_v1;
ALTER FUNCTION reviewer_b_attempt_shadow.mark_outcome_unknown(text,text,text)
  OWNER TO reviewer_b_attempt_owner_v1;
ALTER FUNCTION reviewer_b_attempt_shadow.cancel_before_dispatch(text,text,text)
  OWNER TO reviewer_b_attempt_owner_v1;
ALTER FUNCTION reviewer_b_attempt_shadow.observe_attempt_after_uncertain_commit(text,text,text)
  OWNER TO reviewer_b_attempt_owner_v1;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA reviewer_b_attempt_shadow FROM PUBLIC;
REVOKE ALL ON TABLE reviewer_b_attempt_shadow.attempts
  FROM reviewer_b_attempt_invoker_v1;
GRANT USAGE ON SCHEMA reviewer_b_attempt_shadow
  TO reviewer_b_attempt_invoker_v1;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA reviewer_b_attempt_shadow
  TO reviewer_b_attempt_invoker_v1;
ALTER DEFAULT PRIVILEGES FOR ROLE reviewer_b_attempt_owner_v1
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMIT;
