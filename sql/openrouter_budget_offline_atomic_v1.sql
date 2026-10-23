-- OFFLINE TEST FIXTURE ONLY; NOT a financial authority, not deployed or imported by the paid path.
-- Inputs are untrusted and caller-provided. No source/billing/FX authentication.
-- This schema is intentionally one-shot; a reused namespace MUST cause an error.
BEGIN;
CREATE SCHEMA openrouter_budget_offline;

CREATE TABLE openrouter_budget_offline.months (
  month_utc date PRIMARY KEY CHECK (EXTRACT(DAY FROM month_utc) = 1),
  global_held_micro_eur bigint NOT NULL DEFAULT 0
    CHECK (global_held_micro_eur BETWEEN 0 AND 15000000)
);
CREATE TABLE openrouter_budget_offline.roles (
  month_utc date NOT NULL REFERENCES openrouter_budget_offline.months(month_utc),
  role text NOT NULL CHECK (role IN ('reviewer_b','development')),
  key_held_micro_usd bigint NOT NULL DEFAULT 0 CHECK (key_held_micro_usd >= 0),
  PRIMARY KEY (month_utc,role),
  CONSTRAINT role_usd_cap CHECK (
    (role = 'reviewer_b' AND key_held_micro_usd <= 3000000) OR
    (role = 'development' AND key_held_micro_usd <= 10000000)
  )
);
CREATE TABLE openrouter_budget_offline.quotes (
  source_digest text NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  run_id text NOT NULL CHECK (run_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$'),
  month_utc date NOT NULL,
  role text NOT NULL,
  upper_micro_eur bigint NOT NULL CHECK (upper_micro_eur BETWEEN 1 AND 15000000),
  upper_micro_usd bigint NOT NULL CHECK (upper_micro_usd BETWEEN 1 AND 10000000),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (source_digest,run_id),
  FOREIGN KEY (month_utc,role)
    REFERENCES openrouter_budget_offline.roles(month_utc,role)
);
REVOKE ALL ON SCHEMA openrouter_budget_offline FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA openrouter_budget_offline FROM PUBLIC;

-- Only a proposal is recorded; return flags are ALWAYS false. No release,
-- retry, reconciliation, provider POST, or real key/credential access.
CREATE FUNCTION openrouter_budget_offline.propose_quote(
 p_source text,p_run text,p_role text,p_eur bigint,p_usd bigint
) RETURNS TABLE(recorded boolean,reason text,
                may_reserve boolean,may_spend boolean,may_start_runner boolean)
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, openrouter_budget_offline, pg_temp
AS $body$
DECLARE
  v_month date;
  v_global bigint;
  v_key bigint;
  v_role_cap bigint;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RETURN QUERY SELECT false,'OFFLINE_ISOLATION_UNSUPPORTED'::text,
      false,false,false;
    RETURN;
  END IF;
  v_month := date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date;
  IF p_source IS NULL OR p_source !~ '^[a-f0-9]{64}$'
     OR p_run IS NULL OR p_run !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$'
     OR p_role IS NULL OR p_role NOT IN ('reviewer_b','development')
     OR p_eur IS NULL OR p_eur<1 OR p_eur>15000000
     OR p_usd IS NULL OR p_usd<1 OR p_usd>10000000 THEN
    RETURN QUERY SELECT false,'OFFLINE_INVALID_INPUT'::text,false,false,false;
    RETURN;
  END IF;

  -- All callers serialize through one month row, before locking role row.
  -- Lock contention raises 55P03; NEVER automatically retry a paid request.
  SELECT m.global_held_micro_eur INTO v_global
    FROM openrouter_budget_offline.months AS m
   WHERE m.month_utc=v_month FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false,'OFFLINE_MONTH_UNPROVISIONED'::text,false,false,false;
    RETURN;
  END IF;
  SELECT r.key_held_micro_usd INTO v_key
    FROM openrouter_budget_offline.roles AS r
   WHERE r.month_utc=v_month AND r.role=p_role FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false,'OFFLINE_ROLE_UNPROVISIONED'::text,false,false,false;
    RETURN;
  END IF;
  v_role_cap := CASE WHEN p_role='reviewer_b' THEN 3000000 ELSE 10000000 END;
  -- Identity is globally unique even across month boundaries or role changes.
  IF EXISTS (SELECT 1 FROM openrouter_budget_offline.quotes AS q
              WHERE q.source_digest=p_source AND q.run_id=p_run) THEN
    RETURN QUERY SELECT false,'OFFLINE_DUPLICATE_OR_AMBIGUOUS'::text,
      false,false,false;
    RETURN;
  END IF;
  IF date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date <> v_month THEN
    RETURN QUERY SELECT false,'OFFLINE_MONTH_CHANGED'::text,false,false,false;
    RETURN;
  END IF;
  IF p_eur>15000000-v_global OR p_usd>v_role_cap-v_key THEN
    RETURN QUERY SELECT false,'OFFLINE_CAP_EXCEEDED'::text,false,false,false;
    RETURN;
  END IF;

  INSERT INTO openrouter_budget_offline.quotes(
    source_digest,run_id,month_utc,role,upper_micro_eur,upper_micro_usd)
  VALUES (p_source,p_run,v_month,p_role,p_eur,p_usd);
  UPDATE openrouter_budget_offline.months AS m
     SET global_held_micro_eur=m.global_held_micro_eur+p_eur
   WHERE m.month_utc=v_month;
  UPDATE openrouter_budget_offline.roles AS r
     SET key_held_micro_usd=r.key_held_micro_usd+p_usd
   WHERE r.month_utc=v_month AND r.role=p_role;
  IF date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date <> v_month THEN
    RAISE EXCEPTION 'OFFLINE_MONTH_CHANGED_DURING_WRITE';
  END IF;
  RETURN QUERY SELECT true,'OFFLINE_QUOTE_ONLY_NO_SPEND_AUTHORITY'::text,
    false,false,false;
END
$body$;
REVOKE ALL ON FUNCTION openrouter_budget_offline.propose_quote(
  text,text,text,bigint,bigint) FROM PUBLIC;
COMMIT;
