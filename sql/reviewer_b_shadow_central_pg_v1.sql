-- PREPARATORY SHADOW ONLY. No provider API, deployment, or spend authority.
-- All distinct callers must connect to the SAME durable PostgreSQL database.
BEGIN;
CREATE SCHEMA IF NOT EXISTS reviewer_b_shadow;
CREATE TABLE reviewer_b_shadow.monthly_periods (
  month_utc date PRIMARY KEY,
  ceiling_micro_eur bigint NOT NULL DEFAULT 15000000
    CHECK (ceiling_micro_eur = 15000000),
  reserved_micro_eur bigint NOT NULL DEFAULT 0
    CHECK (reserved_micro_eur BETWEEN 0 AND 15000000),
  proposal_count integer NOT NULL DEFAULT 0
    CHECK (proposal_count BETWEEN 0 AND 500),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT first_day_only CHECK (EXTRACT(DAY FROM month_utc) = 1)
);
CREATE TABLE reviewer_b_shadow.exposure_proposals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  month_utc date NOT NULL REFERENCES reviewer_b_shadow.monthly_periods(month_utc),
  target_repo text NOT NULL CHECK (target_repo = 'deenkids7-dev/deenkids'),
  pr_number integer NOT NULL CHECK (pr_number > 0),
  head_sha text NOT NULL CHECK (head_sha ~ '^[a-f0-9]{40}$'),
  service_comment_id bigint NOT NULL CHECK (service_comment_id > 0),
  model text NOT NULL CHECK (
    model IN ('qwen/qwen3-coder-30b-a3b-instruct','qwen/qwen3.6-35b-a3b')),
  run_id text NOT NULL CHECK (run_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$'),
  upper_micro_eur bigint NOT NULL CHECK (upper_micro_eur BETWEEN 1 AND 15000000),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT unique_target_head UNIQUE (target_repo,pr_number,head_sha),
  CONSTRAINT unique_service_comment UNIQUE (service_comment_id)
);
CREATE INDEX exposure_by_month ON reviewer_b_shadow.exposure_proposals(month_utc);
REVOKE ALL ON SCHEMA reviewer_b_shadow FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA reviewer_b_shadow FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA reviewer_b_shadow FROM PUBLIC;

CREATE FUNCTION reviewer_b_shadow.propose_exposure(
  p_repo text,p_pr integer,p_head text,p_comment bigint,p_model text,
  p_run text,p_upper_micro_eur bigint
) RETURNS TABLE (
  recorded boolean,reason text,reserved_micro_eur bigint,
  may_spend boolean,provider_billing_authenticated boolean
)
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, reviewer_b_shadow
AS $function$
DECLARE
  v_month date;
  v_ceiling bigint;
  v_total bigint;
  v_records bigint;
BEGIN
  -- The caller must not hold a stale Repeatable Read/Serializable snapshot.
  -- Separate authentic PostgreSQL sessions must fail closed if they request
  -- anything other than READ COMMITTED, even with zero contention.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RETURN QUERY SELECT false,'SHADOW_ISOLATION_UNSUPPORTED'::text,
      NULL::bigint,false,false;
    RETURN;
  END IF;
  -- Wall-clock UTC for admission, not transaction start (which may be old).
  v_month := date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date;
  IF p_repo IS DISTINCT FROM 'deenkids7-dev/deenkids'
    OR p_pr IS NULL OR p_pr<=0
    OR p_head IS NULL OR p_head !~ '^[a-f0-9]{40}$'
    OR p_comment IS NULL OR p_comment<=0
    OR p_model IS NULL OR p_model NOT IN
      ('qwen/qwen3-coder-30b-a3b-instruct','qwen/qwen3.6-35b-a3b')
    OR p_run IS NULL OR p_run !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$'
    OR p_upper_micro_eur IS NULL
    OR p_upper_micro_eur<1 OR p_upper_micro_eur>15000000
  THEN
    RETURN QUERY SELECT false,'SHADOW_INPUT_INVALID'::text,NULL::bigint,false,false;
    RETURN;
  END IF;
  -- A provisioned period row is a single serialization point for ALL clients
  -- in this calendar month. Contention raises lock_not_available, safely
  -- aborting the transaction: never queue or auto-retry billable attempts.
  SELECT month.ceiling_micro_eur,month.reserved_micro_eur,
         month.proposal_count INTO v_ceiling,v_total,v_records
    FROM reviewer_b_shadow.monthly_periods AS month
   WHERE month.month_utc=v_month FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false,'SHADOW_MONTH_NOT_PROVISIONED'::text,
      NULL::bigint,false,false;
    RETURN;
  END IF;
  -- Identity uniqueness survives UTC month rollover (ambiguous old requests).
  IF EXISTS (
    SELECT 1 FROM reviewer_b_shadow.exposure_proposals AS e
     WHERE (e.target_repo=p_repo AND e.pr_number=p_pr AND e.head_sha=p_head)
        OR e.service_comment_id=p_comment
  ) THEN
    RETURN QUERY SELECT false,'SHADOW_DUPLICATE_OR_AMBIGUOUS'::text,
      NULL::bigint,false,false;
    RETURN;
  END IF;
  IF date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date <> v_month THEN
    RETURN QUERY SELECT false,'SHADOW_MONTH_CHANGED_DURING_ADMISSION'::text,
      v_total,false,false;
    RETURN;
  END IF;
  IF v_records>=500 THEN
    RETURN QUERY SELECT false,'SHADOW_MONTHLY_RECORD_LIMIT'::text,
      v_total,false,false;
    RETURN;
  END IF;
  IF v_total>v_ceiling OR p_upper_micro_eur>v_ceiling-v_total THEN
    RETURN QUERY SELECT false,'SHADOW_EUR15_CEILING_EXCEEDED'::text,
      v_total,false,false;
    RETURN;
  END IF;
  -- Records represent UNTRUSTED proposed upper bounds, not provider invoices.
  INSERT INTO reviewer_b_shadow.exposure_proposals(
    month_utc,target_repo,pr_number,head_sha,service_comment_id,
    model,run_id,upper_micro_eur)
  VALUES(v_month,p_repo,p_pr,p_head,p_comment,p_model,p_run,p_upper_micro_eur);
  -- Mutate the same row locked by FOR UPDATE. This forms a durable CAS
  -- serialization point (and invalidates older snapshots) for all writers.
  UPDATE reviewer_b_shadow.monthly_periods AS mp
     SET reserved_micro_eur=mp.reserved_micro_eur+p_upper_micro_eur,
         proposal_count=mp.proposal_count+1
   WHERE mp.month_utc=v_month;
  -- If midnight UTC arrives during the write itself, abort the entire
  -- statement so neither the proposal nor its counter can commit.
  IF date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date <> v_month THEN
    RAISE EXCEPTION 'SHADOW_MONTH_CHANGED_DURING_WRITE';
  END IF;
  RETURN QUERY SELECT true,'SHADOW_RECORDED_NOT_SPEND_AUTHORITY'::text,
    v_total+p_upper_micro_eur,false,false;
END
$function$;
REVOKE ALL ON FUNCTION reviewer_b_shadow.propose_exposure(
 text,integer,text,bigint,text,text,bigint
) FROM PUBLIC;
COMMIT;
