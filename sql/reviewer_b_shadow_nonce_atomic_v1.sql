-- OFFLINE / SYNTHETIC ONLY: nonces for shadow PROPOSALS, never paid claims.
-- Prerequisites: reviewer_b_shadow_central_pg_v1.sql and
-- reviewer_b_shadow_protected_roles_v1.sql on one disposable PostgreSQL DB.
-- This migration does not authenticate a signed envelope or real provider costs.
BEGIN;
DO $validate$
BEGIN
  IF current_setting('is_superuser') <> 'on' OR
     to_regclass('reviewer_b_shadow.exposure_proposals') IS NULL OR
     to_regprocedure('reviewer_b_shadow.propose_exposure(text,integer,text,bigint,text,text,bigint)') IS NULL OR
     NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc
       WHERE oid='reviewer_b_shadow.propose_exposure(text,integer,text,bigint,text,text,bigint)'::regprocedure
         AND prosecdef
         AND proowner='reviewer_b_shadow_owner_v1'::regrole
     )
  THEN RAISE EXCEPTION 'SHADOW_NONCE_MIGRATION_PREREQUISITES_UNTRUSTED';
  END IF;
END
$validate$;

-- Each nonce AND signed-envelope digest may be used only once across
-- every UTC month. The FK binds a successful consumption to a durable
-- exposure_proposals row, not an untrusted supplied comment alone.
CREATE TABLE reviewer_b_shadow.consumed_shadow_proofs (
  nonce uuid PRIMARY KEY,
  signed_claim_sha256 text NOT NULL UNIQUE
    CHECK (signed_claim_sha256 ~ '^[a-f0-9]{64}$'),
  target_repo text NOT NULL,
  pr_number integer NOT NULL,
  head_sha text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT consumed_proof_exact_proposal FOREIGN KEY
    (target_repo,pr_number,head_sha)
    REFERENCES reviewer_b_shadow.exposure_proposals
    (target_repo,pr_number,head_sha)
);
ALTER TABLE reviewer_b_shadow.consumed_shadow_proofs
  OWNER TO reviewer_b_shadow_owner_v1;

REVOKE ALL ON TABLE reviewer_b_shadow.consumed_shadow_proofs FROM PUBLIC;
REVOKE ALL ON TABLE reviewer_b_shadow.consumed_shadow_proofs
  FROM reviewer_b_shadow_invoker_v1;

-- The former 7-parameter function must never remain a public route after
-- introducing nonce consumption. It is only callable internally by the
-- NOLOGIN owner, not by the restricted application role.
REVOKE EXECUTE ON FUNCTION reviewer_b_shadow.propose_exposure(
  text,integer,text,bigint,text,text,bigint)
  FROM reviewer_b_shadow_invoker_v1;
REVOKE EXECUTE ON FUNCTION reviewer_b_shadow.propose_exposure(
  text,integer,text,bigint,text,text,bigint)
  FROM PUBLIC;

CREATE FUNCTION reviewer_b_shadow.propose_exposure_once(
  p_repo text,p_pr integer,p_head text,p_comment bigint,p_model text,
  p_run text,p_upper_micro_eur bigint,p_nonce uuid,p_claim_digest text
) RETURNS TABLE (
  recorded boolean,reason text,reserved_micro_eur bigint,
  may_spend boolean,provider_billing_authenticated boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,reviewer_b_shadow,pg_temp
AS $fn$
DECLARE
  v_result record;
BEGIN
  IF p_nonce IS NULL OR p_claim_digest IS NULL OR
     p_claim_digest !~ '^[a-f0-9]{64}$'
  THEN
    RETURN QUERY SELECT false,'SHADOW_NONCE_OR_DIGEST_INVALID'::text,
      NULL::bigint,false,false;
    RETURN;
  END IF;

  -- This fast-path is NOT the concurrency guard. The database's UNIQUE
  -- constraints on nonce and digest are the final atomic protection.
  IF EXISTS(
    SELECT 1 FROM reviewer_b_shadow.consumed_shadow_proofs
    WHERE nonce=p_nonce OR signed_claim_sha256=p_claim_digest
  ) THEN
    RETURN QUERY SELECT false,'SHADOW_SIGNED_PROOF_REPLAY'::text,
      NULL::bigint,false,false;
    RETURN;
  END IF;

  -- The nested exception block is a PostgreSQL subtransaction: if a
  -- concurrent nonce/digest insert conflicts, BOTH the reservation
  -- and the nonce write roll back, including the monthly counters.
  BEGIN
    SELECT * INTO STRICT v_result
      FROM reviewer_b_shadow.propose_exposure(
        p_repo,p_pr,p_head,p_comment,p_model,p_run,p_upper_micro_eur);
    IF v_result.recorded IS DISTINCT FROM true OR
       v_result.may_spend IS DISTINCT FROM false OR
       v_result.provider_billing_authenticated IS DISTINCT FROM false
    THEN
      RETURN QUERY SELECT false,COALESCE(v_result.reason,'SHADOW_DENIED')::text,
        v_result.reserved_micro_eur,false,false;
      RETURN;
    END IF;

    INSERT INTO reviewer_b_shadow.consumed_shadow_proofs
      (nonce,signed_claim_sha256,target_repo,pr_number,head_sha)
    VALUES (p_nonce,p_claim_digest,p_repo,p_pr,p_head);

    RETURN QUERY SELECT true,'SHADOW_NONCE_AND_PROPOSAL_ATOMIC_NO_SPEND'::text,
      v_result.reserved_micro_eur,false,false;
  EXCEPTION
    WHEN unique_violation THEN
      -- No partial reservation survives, even on cross-PR nonce reuse.
      RETURN QUERY SELECT false,'SHADOW_SIGNED_PROOF_REPLAY_OR_DUPLICATE'::text,
        NULL::bigint,false,false;
  END;
END
$fn$;

ALTER FUNCTION reviewer_b_shadow.propose_exposure_once(
  text,integer,text,bigint,text,text,bigint,uuid,text)
  OWNER TO reviewer_b_shadow_owner_v1;
REVOKE ALL ON FUNCTION reviewer_b_shadow.propose_exposure_once(
  text,integer,text,bigint,text,text,bigint,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reviewer_b_shadow.propose_exposure_once(
  text,integer,text,bigint,text,text,bigint,uuid,text)
  TO reviewer_b_shadow_invoker_v1;
COMMIT;
