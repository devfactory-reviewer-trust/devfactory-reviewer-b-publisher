# DevFactory: financial authority Windows cutover (2026-10-25)

## Trust boundary

Upgrade the MSI user-owned DevFactory-Finance-Ledger-Shadow (Node + SQLite, always maySpend:false) to a Windows Task Scheduler process running NT AUTHORITY\LOCAL SERVICE (SID S-1-5-19). Non-elevated Runner cannot modify protected binaries, ledger, or admin keys.

This establishes OS and persistent storage independence, **not** provider/account-wide financial attestation. Until live OpenRouter/ZDR/FX/global billing proof is obtained, both maySpend and mayReserveForPaidRun must remain false. No paid inference or autonomous Runner.

## Installed design

- Script: scripts/install-finance-reservation-authority.ps1. Admin-only once; -PreflightOnly is read-only; -ResumePartial resumes only empty partial installation and rejects existing ledgers/tokens.
- UAC wrapper: scripts/run-finance-authority-uac.ps1. Sanitized status: %LOCALAPPDATA%\DevFactory\FinanceReservation\authority-cutover-result.txt.
- Executable: scripts/finance-reservation-windows-authority-entrypoint.mjs (Node task process, 127.0.0.1:47881).
- Secret helper: scripts/finance-reservation-windows-authority-unseal.ps1 (DPAPI LocalMachine protected blobs in a short-lived private pipe).

Protected installation root: C:\ProgramData\DevFactoryFinanceAuthority, owner BUILTIN\Administrators, inheritance removed.

| Path | SYSTEM | Administrators | LOCAL SERVICE | Non-admin Runner |
| --- | --- | --- | --- | --- |
| root, app | Full | Full | Read/execute | Denied |
| state (SQLite WAL) | Full | Full | Modify | Denied |
| secrets (DPAPI) | Full | Full | Read | Denied |

New client/admin tokens are rotated. Admin token is never written in user profile; existing shadow admin token no longer authenticates to the new authority. Client token is additionally sealed for current-user DPAPI in shadow secrets/client-authority.dpapi; it permits capped holds, not recording charges.

Cutover stops and disables the shadow task, verifies port release, copies persistent SQLite + WAL/SHM with SHA-256 comparison, registers new AtStartup LOCAL SERVICE task, checks the live listener process owner SID and authenticated NO-SPEND status. Failures attempt to re-enable and restart shadow. It never deletes old ledger or keys.

## Verification

Preflight (ordinary user):

    powershell -NoProfile -File scripts\install-finance-reservation-authority.ps1 -PreflightOnly -ResumePartial

Cutover (administrator UAC required):

    powershell -NoProfile -File scripts\run-finance-authority-uac.ps1

After cutover:

    Get-ScheduledTask -TaskName DevFactory-Finance-Authority
    Get-ScheduledTask -TaskName DevFactory-Finance-Ledger-Shadow
    Invoke-RestMethod http://127.0.0.1:47881/health

Expected: Authority Running, process SID S-1-5-19, shadow Disabled, health status ok and maySpend false, plus non-admin access denied to protected ProgramData secrets and ledger.

Targeted tests: node --test test/finance-reservation-ledger.test.mjs test/finance-reservation-server.test.mjs test/finance-reservation-process.test.mjs test/finance-reservation-windows-authority.test.mjs test/finance-authority-install-recovery.test.mjs.

## Additional permission gates before paid inference

- Independent evidence for all OpenRouter billing keys and global EUR cap.
- FX rate and ledger reconciliation of in-flight and delayed charges.
- Effective Zero Data Retention on exact provider and model route.
- Independent signers and SHA-scoped GitHub owner authorization.
- Proper security review of service and Publisher integration.

Do not infer HUMAN_GO, RUNNER_GO, MERGE_GO or maySpend from a healthy local service.
