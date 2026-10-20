-- SYNTHETIC ONLY. Additive quarantine to the existing isolated PostgreSQL16
-- attempt-tombstone test schema. This is NOT a provider reconciliation,
-- payment, receipt validation, dispatch service or production migration.
-- Requires reviewer_b_attempt_tombstone_synthetic_v1.sql in disposable CI.
BEGIN;
DO $precheck$
BEGIN
 IF current_setting('is_superuser')<>'on'
    OR to_regclass('reviewer_b_attempt_shadow.attempts') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname='reviewer_b_attempt_owner_v1' AND NOT rolcanlogin)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname='reviewer_b_attempt_invoker_v1' AND NOT rolcanlogin)
    OR to_regclass('reviewer_b_attempt_shadow.quarantines') IS NOT NULL
 THEN RAISE EXCEPTION 'SHADOW_QUARANTINE_PREREQUISITES_UNTRUSTED'; END IF;
END
$precheck$;

-- Match the ORIGINAL attempt ID and exact HEAD at the database layer.
-- The composite key prevents wrong-attempt quarantines even if a future
-- SECURITY DEFINER caller accidentally omits its procedural checks.
ALTER TABLE reviewer_b_attempt_shadow.attempts
  ADD CONSTRAINT synthetic_attempt_identity_triplet_unique
  UNIQUE(request_id,attempt_id,head_sha);

-- One permanent quarantine record per immutable synthetic request ID.
-- No DELETE / release / mark-verified entrypoint is provided.
CREATE TABLE reviewer_b_attempt_shadow.quarantines(
  request_id text PRIMARY KEY,
  attempt_id text NOT NULL,
  head_sha text NOT NULL CHECK (head_sha ~ '^[a-f0-9]{40}$'),
  CONSTRAINT synthetic_quarantine_exact_attempt_fk
    FOREIGN KEY (request_id,attempt_id,head_sha)
    REFERENCES reviewer_b_attempt_shadow.attempts
    (request_id,attempt_id,head_sha),
  quarantine_reason text NOT NULL CHECK (quarantine_reason IN (
    'dispatch_risk_unresolved','ambiguous_commit',
    'provider_outcome_unknown','billing_claim_unverified')),
  entered_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE reviewer_b_attempt_shadow.quarantines
  OWNER TO reviewer_b_attempt_owner_v1;
REVOKE ALL ON TABLE reviewer_b_attempt_shadow.quarantines FROM PUBLIC;

-- Fixture evidence must never be presented as authenticated OpenRouter
-- data, nor treated as hold-release or proof that an invoice is complete.
CREATE TABLE reviewer_b_attempt_shadow.unverified_evidence(
  evidence_id text PRIMARY KEY CHECK (
    evidence_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$'),
  request_id text NOT NULL REFERENCES reviewer_b_attempt_shadow.quarantines(request_id),
  digest_sha256 text NOT NULL UNIQUE CHECK (digest_sha256 ~ '^[a-f0-9]{64}$'),
  fixture_kind text NOT NULL CHECK (fixture_kind IN (
    'mock_invoice','mock_timeout','mock_adjustment','mock_absence')),
  amount_micro_usd bigint NOT NULL CHECK (amount_micro_usd>=0),
  source text NOT NULL DEFAULT 'unverified-fixture'
    CHECK (source='unverified-fixture'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE reviewer_b_attempt_shadow.unverified_evidence
  OWNER TO reviewer_b_attempt_owner_v1;
REVOKE ALL ON TABLE reviewer_b_attempt_shadow.unverified_evidence FROM PUBLIC;

CREATE FUNCTION reviewer_b_attempt_shadow.quarantine_synthetic_attempt(
  p_request text,p_attempt text,p_head text,p_reason text)
RETURNS TABLE(
  recorded boolean,reason text,may_spend boolean,may_dispatch boolean,
  may_retry boolean,may_release_hold boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $fn$
DECLARE v_req text;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed'
     OR p_request IS NULL OR p_request !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$'
     OR p_attempt IS NULL OR p_attempt !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$'
     OR p_head IS NULL OR p_head !~ '^[a-f0-9]{40}$'
     OR p_reason IS NULL OR p_reason NOT IN (
       'dispatch_risk_unresolved','ambiguous_commit',
       'provider_outcome_unknown','billing_claim_unverified')
  THEN
    RETURN QUERY SELECT false,'SHADOW_QUARANTINE_INPUT_INVALID'::text,
      false,false,false,false;
    RETURN;
  END IF;
  -- A registered or cancelled request cannot manufacture a provider
  -- dispatch claim. No result, even success, releases any authority.
  SELECT a.request_id INTO v_req
  FROM reviewer_b_attempt_shadow.attempts a
  WHERE a.request_id=p_request AND a.attempt_id=p_attempt
    AND a.head_sha=p_head
    AND a.status IN ('dispatch_may_have_occurred','outcome_unknown')
  FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false,'SHADOW_QUARANTINE_RISK_NOT_ESTABLISHED'::text,
      false,false,false,false;
    RETURN;
  END IF;
  BEGIN
    INSERT INTO reviewer_b_attempt_shadow.quarantines
      (request_id,attempt_id,head_sha,quarantine_reason)
    VALUES(v_req,p_attempt,p_head,p_reason);
    RETURN QUERY SELECT true,'SHADOW_QUARANTINED_NO_AUTHORITY'::text,
      false,false,false,false;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT false,'SHADOW_QUARANTINE_ALREADY_RECORDED'::text,
      false,false,false,false;
  END;
END
$fn$;

CREATE FUNCTION reviewer_b_attempt_shadow.record_unverified_evidence_fixture(
  p_request text,p_evidence text,p_digest text,p_kind text,
  p_amount_micro_usd bigint)
RETURNS TABLE(
  recorded boolean,reason text,provider_authenticated boolean,
  may_spend boolean,may_dispatch boolean,may_retry boolean,
  may_release_hold boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $fn$
DECLARE v_request text;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed'
     OR p_request IS NULL OR p_request !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$'
     OR p_evidence IS NULL OR p_evidence !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$'
     OR p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$'
     OR p_kind IS NULL OR p_kind NOT IN (
       'mock_invoice','mock_timeout','mock_adjustment','mock_absence')
     OR p_amount_micro_usd IS NULL OR p_amount_micro_usd<0
  THEN
    RETURN QUERY SELECT false,'SHADOW_EVIDENCE_INPUT_INVALID'::text,
      false,false,false,false,false;
    RETURN;
  END IF;
  SELECT q.request_id INTO v_request
  FROM reviewer_b_attempt_shadow.quarantines q
  WHERE q.request_id=p_request
  FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false,'SHADOW_EVIDENCE_NOT_QUARANTINED'::text,
      false,false,false,false,false;
    RETURN;
  END IF;
  BEGIN
    INSERT INTO reviewer_b_attempt_shadow.unverified_evidence
      (request_id,evidence_id,digest_sha256,fixture_kind,amount_micro_usd)
    VALUES(v_request,p_evidence,p_digest,p_kind,p_amount_micro_usd);
    RETURN QUERY SELECT true,'SHADOW_EVIDENCE_FIXTURE_RECORDED_UNVERIFIED'::text,
      false,false,false,false,false;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT false,'SHADOW_EVIDENCE_DUPLICATE_ID_OR_DIGEST'::text,
      false,false,false,false,false;
  END;
END
$fn$;

ALTER FUNCTION reviewer_b_attempt_shadow.quarantine_synthetic_attempt(text,text,text,text)
  OWNER TO reviewer_b_attempt_owner_v1;
ALTER FUNCTION reviewer_b_attempt_shadow.record_unverified_evidence_fixture(text,text,text,text,bigint)
  OWNER TO reviewer_b_attempt_owner_v1;
REVOKE ALL ON FUNCTION reviewer_b_attempt_shadow.quarantine_synthetic_attempt(text,text,text,text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION reviewer_b_attempt_shadow.record_unverified_evidence_fixture(text,text,text,text,bigint)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reviewer_b_attempt_shadow.quarantine_synthetic_attempt(text,text,text,text)
  TO reviewer_b_attempt_invoker_v1;
GRANT EXECUTE ON FUNCTION reviewer_b_attempt_shadow.record_unverified_evidence_fixture(text,text,text,text,bigint)
  TO reviewer_b_attempt_invoker_v1;
COMMIT;
