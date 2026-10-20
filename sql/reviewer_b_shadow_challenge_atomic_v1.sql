-- SYNTHETIC ONLY: isolated PostgreSQL challenge + signed-proof nonce atomicity.
-- Required order: central_pg_v1, protected_roles_v1, nonce_atomic_v1,
-- then this migration. Does NOT check Ed25519 signatures or real IAM.
-- All challenge issuance in tests is by an isolated superuser, NEVER
-- by the restricted invoker or by a GitHub pull-request workflow.
BEGIN;

DO $trust$
BEGIN
  IF current_setting('is_superuser') <> 'on'
     OR to_regclass('reviewer_b_shadow.consumed_shadow_proofs') IS NULL
     OR to_regprocedure(
       'reviewer_b_shadow.propose_exposure_once(text,integer,text,bigint,text,text,bigint,uuid,text)') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc
       WHERE oid='reviewer_b_shadow.propose_exposure_once(text,integer,text,bigint,text,text,bigint,uuid,text)'::regprocedure
         AND prosecdef
         AND proowner='reviewer_b_shadow_owner_v1'::regrole
     )
  THEN
    RAISE EXCEPTION 'SHADOW_CHALLENGE_PREREQUISITES_UNTRUSTED';
  END IF;
END
$trust$;

-- Composite reference enforces that a consumed challenge's nonce is paired
-- with the *same signed shadow envelope hash* persisted by the nonce gate.
ALTER TABLE reviewer_b_shadow.consumed_shadow_proofs
  ADD CONSTRAINT consumed_shadow_proof_pair UNIQUE(nonce,signed_claim_sha256);

CREATE TABLE reviewer_b_shadow.issued_shadow_challenges (
  challenge_uuid uuid PRIMARY KEY,
  issuer text NOT NULL CHECK (issuer='synthetic-service-account'),
  audience text NOT NULL CHECK (audience='shadow-postgres-processor'),
  month_utc date NOT NULL
    CHECK (EXTRACT(DAY FROM month_utc)=1),
  target_repo text NOT NULL CHECK (target_repo='deenkids7-dev/deenkids'),
  pr_number integer NOT NULL CHECK (pr_number>0),
  head_sha text NOT NULL CHECK (head_sha ~ '^[a-f0-9]{40}$'),
  service_comment_id bigint NOT NULL CHECK (service_comment_id>0),
  model text NOT NULL CHECK (
    model IN ('qwen/qwen3-coder-30b-a3b-instruct','qwen/qwen3.6-35b-a3b')),
  upper_micro_eur bigint NOT NULL CHECK (upper_micro_eur=15000000),
  shadow_digest text NOT NULL CHECK (shadow_digest ~ '^[a-f0-9]{64}$'),
  service_digest text NOT NULL UNIQUE
    CHECK (service_digest ~ '^[a-f0-9]{64}$'),
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_nonce uuid UNIQUE,
  consumed_at timestamptz,
  CONSTRAINT challenge_short_lifetime CHECK (
    expires_at>issued_at AND expires_at<=issued_at+interval '60 seconds'),
  CONSTRAINT challenge_atomic_consumption CHECK (
    (consumed_nonce IS NULL)=(consumed_at IS NULL)),
  CONSTRAINT challenge_nonce_matches_signed_shadow
    FOREIGN KEY (consumed_nonce,shadow_digest)
    REFERENCES reviewer_b_shadow.consumed_shadow_proofs
    (nonce,signed_claim_sha256)
);
ALTER TABLE reviewer_b_shadow.issued_shadow_challenges
  OWNER TO reviewer_b_shadow_owner_v1;
REVOKE ALL ON reviewer_b_shadow.issued_shadow_challenges FROM PUBLIC;
REVOKE ALL ON reviewer_b_shadow.issued_shadow_challenges
  FROM reviewer_b_shadow_invoker_v1;

-- Do not expose the previous 9-arg entrypoint to any restricted caller:
-- it consumed a shadow nonce without a receiver-generated challenge.
REVOKE EXECUTE ON FUNCTION reviewer_b_shadow.propose_exposure_once(
  text,integer,text,bigint,text,text,bigint,uuid,text
) FROM reviewer_b_shadow_invoker_v1;
REVOKE EXECUTE ON FUNCTION reviewer_b_shadow.propose_exposure_once(
  text,integer,text,bigint,text,text,bigint,uuid,text
) FROM PUBLIC;

CREATE FUNCTION reviewer_b_shadow.propose_exposure_with_challenge(
  p_repo text,p_pr integer,p_head text,p_comment bigint,p_model text,
  p_run text,p_upper_micro_eur bigint,p_nonce uuid,p_shadow_digest text,
  p_challenge uuid,p_service_digest text
) RETURNS TABLE (
  recorded boolean, reason text, reserved_micro_eur bigint,
  may_spend boolean, provider_billing_authenticated boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,reviewer_b_shadow,pg_temp
AS $fn$
DECLARE
  v_challenge record;
  v_proposal record;
  v_month date;
BEGIN
  -- Never allow a request to propose a tiny untrusted price in this test.
  -- The conservative *synthetic* reservation consumes the full 15 EUR.
  IF p_upper_micro_eur IS DISTINCT FROM 15000000
     OR p_nonce IS NULL OR p_challenge IS NULL
     OR p_shadow_digest IS NULL
     OR p_shadow_digest !~ '^[a-f0-9]{64}$'
     OR p_service_digest IS NULL
     OR p_service_digest !~ '^[a-f0-9]{64}$'
  THEN
    RETURN QUERY SELECT false,'SHADOW_CHALLENGE_INPUT_INVALID'::text,
      NULL::bigint,false,false;
    RETURN;
  END IF;

  -- This row is the serialization point across all PostgreSQL clients
  -- attempting to consume the same receiver-issued challenge. NOWAIT
  -- contention is a hard error; never automatically retry paid calls.
  SELECT c.* INTO v_challenge
  FROM reviewer_b_shadow.issued_shadow_challenges c
  WHERE c.challenge_uuid=p_challenge
  FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false,'SHADOW_CHALLENGE_UNKNOWN'::text,
      NULL::bigint,false,false;
    RETURN;
  END IF;

  v_month:=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date;
  IF v_challenge.consumed_at IS NOT NULL
     OR v_challenge.consumed_nonce IS NOT NULL
  THEN
    RETURN QUERY SELECT false,'SHADOW_CHALLENGE_ALREADY_CONSUMED'::text,
      NULL::bigint,false,false;
    RETURN;
  END IF;
  -- A pre-issued future challenge must not be usable before its actual
  -- server-recorded issued_at. Expiry alone is not an issuance check.
  IF v_challenge.issued_at>clock_timestamp()
     OR v_challenge.expires_at<=clock_timestamp()
     OR v_challenge.month_utc<>v_month
     OR v_challenge.issuer<>'synthetic-service-account'
     OR v_challenge.audience<>'shadow-postgres-processor'
     OR v_challenge.target_repo IS DISTINCT FROM p_repo
     OR v_challenge.pr_number IS DISTINCT FROM p_pr
     OR v_challenge.head_sha IS DISTINCT FROM p_head
     OR v_challenge.service_comment_id IS DISTINCT FROM p_comment
     OR v_challenge.model IS DISTINCT FROM p_model
     OR v_challenge.upper_micro_eur IS DISTINCT FROM p_upper_micro_eur
     OR v_challenge.shadow_digest IS DISTINCT FROM p_shadow_digest
     OR v_challenge.service_digest IS DISTINCT FROM p_service_digest
  THEN
    RETURN QUERY SELECT false,'SHADOW_CHALLENGE_BINDING_INVALID_OR_EXPIRED'::text,
      NULL::bigint,false,false;
    RETURN;
  END IF;

  -- PostgreSQL executes the nested nonce proposal and challenge update
  -- as ONE statement/transaction. A failed statement (or caller ROLLBACK)
  -- cannot commit either side or its monthly reserved counter.
  SELECT * INTO STRICT v_proposal
  FROM reviewer_b_shadow.propose_exposure_once(
    p_repo,p_pr,p_head,p_comment,p_model,p_run,p_upper_micro_eur,
    p_nonce,p_shadow_digest);
  IF v_proposal.recorded IS DISTINCT FROM true
     OR v_proposal.may_spend IS DISTINCT FROM false
     OR v_proposal.provider_billing_authenticated IS DISTINCT FROM false
  THEN
    RETURN QUERY SELECT false,
      COALESCE(v_proposal.reason,'SHADOW_NONCE_PROPOSAL_DENIED')::text,
      v_proposal.reserved_micro_eur,false,false;
    RETURN;
  END IF;

  UPDATE reviewer_b_shadow.issued_shadow_challenges
  SET consumed_nonce=p_nonce,consumed_at=clock_timestamp()
  WHERE challenge_uuid=p_challenge AND consumed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHADOW_CHALLENGE_ATOMIC_CAS_FAILED';
  END IF;
  -- Prevent an accepted challenge from expiring DURING the nonce/budget
  -- write. Any exception here rolls the entire SQL statement back:
  -- challenge consumed_at, nonce, proposal and monthly counter.
  IF v_challenge.expires_at<=clock_timestamp()
     OR date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date<>v_month
  THEN
    RAISE EXCEPTION 'SHADOW_CHALLENGE_EXPIRED_DURING_WRITE';
  END IF;

  RETURN QUERY SELECT true,'SHADOW_CHALLENGE_AND_NONCE_ATOMIC_NO_SPEND'::text,
    v_proposal.reserved_micro_eur,false,false;
END
$fn$;
ALTER FUNCTION reviewer_b_shadow.propose_exposure_with_challenge(
  text,integer,text,bigint,text,text,bigint,uuid,text,uuid,text)
  OWNER TO reviewer_b_shadow_owner_v1;
REVOKE ALL ON FUNCTION reviewer_b_shadow.propose_exposure_with_challenge(
  text,integer,text,bigint,text,text,bigint,uuid,text,uuid,text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reviewer_b_shadow.propose_exposure_with_challenge(
  text,integer,text,bigint,text,text,bigint,uuid,text,uuid,text)
  TO reviewer_b_shadow_invoker_v1;
COMMIT;
