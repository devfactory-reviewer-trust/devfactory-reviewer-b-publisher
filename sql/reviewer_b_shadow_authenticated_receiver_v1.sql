-- ADDITIVE SYNTHETIC PROTECTION ONLY. NO DEPLOYMENT OR SPENDING.
-- Order: central_pg_v1 -> protected_roles_v1 -> nonce_atomic_v1 ->
-- challenge_atomic_v1 -> THIS offline-only receiver identity boundary.
-- PostgreSQL session_user is the authenticated LOGIN principal; it is
-- NOT the SECURITY DEFINER function owner, and cannot be changed by
-- SET ROLE. This is not a substitute for upstream Ed25519 verification.
BEGIN;

DO $preflight$
BEGIN
  IF current_setting('is_superuser') <> 'on'
     OR to_regprocedure(
       'reviewer_b_shadow.propose_exposure_with_challenge(text,integer,text,bigint,text,text,bigint,uuid,text,uuid,text)') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc
       WHERE oid='reviewer_b_shadow.propose_exposure_with_challenge(text,integer,text,bigint,text,text,bigint,uuid,text,uuid,text)'::regprocedure
         AND prosecdef
         AND proowner='reviewer_b_shadow_owner_v1'::regrole
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_auth_members members
       WHERE members.roleid='reviewer_b_shadow_owner_v1'::regrole
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p,
         LATERAL pg_catalog.aclexplode(
           COALESCE(p.proacl,pg_catalog.acldefault('f'::"char",p.proowner))) grant_acl
       WHERE p.oid='reviewer_b_shadow.propose_exposure_with_challenge(text,integer,text,bigint,text,text,bigint,uuid,text,uuid,text)'::regprocedure
         AND grant_acl.grantee NOT IN
           (p.proowner,'reviewer_b_shadow_invoker_v1'::regrole)
     )
  THEN
    RAISE EXCEPTION 'SHADOW_RECEIVER_AUTH_PRECONDITIONS_UNTRUSTED';
  END IF;
END
$preflight$;

-- NOLOGIN is the safe default. A separate, future operator approval
-- would be needed to provision a real authenticated client credential.
-- CI temporarily changes this role to LOGIN ONLY inside disposable PG.
CREATE ROLE reviewer_b_shadow_receiver_v1
  NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT reviewer_b_shadow_invoker_v1 TO reviewer_b_shadow_receiver_v1;
GRANT USAGE ON SCHEMA reviewer_b_shadow TO reviewer_b_shadow_receiver_v1;

-- An existing restricted invoker and any generic invoker-grantee MUST
-- lose the prior public entrypoint. No existing role can mint a shadow
-- proposal via this route without an authenticated receiver principal.
REVOKE EXECUTE ON FUNCTION reviewer_b_shadow.propose_exposure_with_challenge(
  text,integer,text,bigint,text,text,bigint,uuid,text,uuid,text)
  FROM reviewer_b_shadow_invoker_v1;
REVOKE EXECUTE ON FUNCTION reviewer_b_shadow.propose_exposure_with_challenge(
  text,integer,text,bigint,text,text,bigint,uuid,text,uuid,text)
  FROM PUBLIC;

CREATE FUNCTION reviewer_b_shadow.propose_exposure_authenticated_receiver(
  p_repo text,p_pr integer,p_head text,p_comment bigint,p_model text,
  p_run text,p_upper_micro_eur bigint,p_nonce uuid,p_shadow_digest text,
  p_challenge uuid,p_service_digest text
) RETURNS TABLE (
  recorded boolean,reason text,reserved_micro_eur bigint,
  may_spend boolean,provider_billing_authenticated boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,reviewer_b_shadow,pg_temp
AS $fn$
DECLARE
  v_response record;
BEGIN
  -- SECURITY DEFINER switches current_user to the owner. We require
  -- SESSION_USER (the separately authenticated connection identity).
  -- Neither SET ROLE nor caller-supplied SQL args can spoof this value
  -- in a non-superuser PostgreSQL session.
  IF session_user IS DISTINCT FROM 'reviewer_b_shadow_receiver_v1'
  THEN
    RETURN QUERY SELECT false,
      'SHADOW_RECEIVER_SESSION_IDENTITY_UNTRUSTED'::text,
      NULL::bigint,false,false;
    RETURN;
  END IF;
  SELECT * INTO STRICT v_response
    FROM reviewer_b_shadow.propose_exposure_with_challenge(
      p_repo,p_pr,p_head,p_comment,p_model,p_run,p_upper_micro_eur,
      p_nonce,p_shadow_digest,p_challenge,p_service_digest);
  IF v_response.may_spend IS DISTINCT FROM false
     OR v_response.provider_billing_authenticated IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'SHADOW_RECEIVER_UNEXPECTED_PAID_AUTHORITY';
  END IF;
  RETURN QUERY SELECT v_response.recorded,v_response.reason,
    v_response.reserved_micro_eur,false,false;
END
$fn$;
ALTER FUNCTION reviewer_b_shadow.propose_exposure_authenticated_receiver(
 text,integer,text,bigint,text,text,bigint,uuid,text,uuid,text)
 OWNER TO reviewer_b_shadow_owner_v1;
REVOKE ALL ON FUNCTION reviewer_b_shadow.propose_exposure_authenticated_receiver(
 text,integer,text,bigint,text,text,bigint,uuid,text,uuid,text)
 FROM PUBLIC;
-- Explicitly deny prior general invoker in case an operator inadvertently
-- broadens an inherited role later.
REVOKE ALL ON FUNCTION reviewer_b_shadow.propose_exposure_authenticated_receiver(
 text,integer,text,bigint,text,text,bigint,uuid,text,uuid,text)
 FROM reviewer_b_shadow_invoker_v1;
GRANT EXECUTE ON FUNCTION reviewer_b_shadow.propose_exposure_authenticated_receiver(
 text,integer,text,bigint,text,text,bigint,uuid,text,uuid,text)
 TO reviewer_b_shadow_receiver_v1;

DO $postconditions$
BEGIN
  IF EXISTS(
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname='reviewer_b_shadow_receiver_v1' AND
      (rolcanlogin OR rolsuper OR rolcreaterole OR rolcreatedb)
  ) OR EXISTS(
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE roleid='reviewer_b_shadow_owner_v1'::regrole
  ) OR has_function_privilege(
    'reviewer_b_shadow_invoker_v1',
    'reviewer_b_shadow.propose_exposure_with_challenge(text,integer,text,bigint,text,text,bigint,uuid,text,uuid,text)','EXECUTE')
  OR has_function_privilege(
    'reviewer_b_shadow_invoker_v1',
    'reviewer_b_shadow.propose_exposure_authenticated_receiver(text,integer,text,bigint,text,text,bigint,uuid,text,uuid,text)','EXECUTE')
  THEN
    RAISE EXCEPTION 'SHADOW_RECEIVER_POSTCONDITION_FAILED';
  END IF;
END
$postconditions$;

COMMIT;
