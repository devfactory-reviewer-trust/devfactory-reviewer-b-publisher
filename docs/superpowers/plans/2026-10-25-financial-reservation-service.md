# Service de reservation financiere — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Livrer un service local separe du Runner, avec journal SQLite persistant, limites de reservations atomiques, et aucun pouvoir de depense.

**Architecture:** Module SQLite sans reseau, facade HTTP loopback a tokens de roles separes, journal conservateur non destructif. La vraie autorite externe reste un gate futur.
**Tech Stack:** Node.js >=24, `node:sqlite`, `node:http`, `node:test`, zero dep externe.
**Spec:** `docs/superpowers/specs/2026-10-25-financial-reservation-service-design.md`

## Global Constraints
- `MAY_SPEND=false` a toute etape.
- Ne jamais reutiliser de secrets ni modifier les taches Windows, OpenRouter ou GitHub.
- SQLite WAL, `synchronous=FULL`, transaction `BEGIN IMMEDIATE`, quotas mensuels 3/10 USD et 15 EUR.
- Aucun endpoint de release/reset/delete.

## Review Focus
- Meme ID et contenu different : conflit ; tester dans Tache 1.
- Deux reservations concurrentes depassant le solde : au plus une passe ; tester dans Tache 1.
- Redemarrage et changement de mois : conserve les lignes, nouvelle periode separee ; tester dans Tache 1.
- Usurpation du token admin/client : acces refuse ; tester dans Tache 2.
- Charge superieure au hold ou en doublon : consigner de maniere conservatrice sans accorder une nouvelle autorisation ; tester dans Tache 1.

### Task 1: Registre atomique durable
**Files:** Create `service/finance-reservation-ledger.mjs`; Test `test/finance-reservation-ledger.test.mjs`.
**Interfaces:** `openFinanceLedger(file, {now})` retourne `reserve({id,role,pr,head,upperUsdMicros})`, `recordCharge({eventId,reservationId,amountUsdMicros})`, `status()`, `close()`.
- [ ] Ecrire tests red : persistance, idempotence, quotas, collisions, charge et mois.
- [ ] Executer `node --test test/finance-reservation-ledger.test.mjs` et constater les echecs attendus.
- [ ] Implementer schema SQLite, montants entiers, assertions strictes, transactions.
- [ ] Rejouer le test : tous verts.

### Task 2: Processus API isole sans depense
**Files:** Create `service/finance-reservation-server.mjs`; Test `test/finance-reservation-server.test.mjs`.
**Interfaces:** `createFinanceServer({ledger,clientToken,adminToken})` retourne un `http.Server` non demarre ; CLI exige variables `DF_FINANCE_DB`, `DF_FINANCE_CLIENT_TOKEN`, `DF_FINANCE_ADMIN_TOKEN`, `DF_FINANCE_PORT`.
- [ ] Ecrire tests red : authentification distincte, methods, corps, reponses `maySpend:false`, API idempotente.
- [ ] Executer test et constater l'echec attendu.
- [ ] Implementer HTTP loopback et bornes de requete ; aucune sortie de secret.
- [ ] Rejouer test : tous verts.

### Task 3: Verification et passation
**Files:** Create `docs/FINANCE-RESERVATION-SERVICE.md`.
- [ ] Tester l'ensemble `npm test` et `git diff --check`.
- [ ] Verifier l'absence d'appels provider et de modification aux workflows ou production.
- [ ] Documenter demarrage manuel de test, ACL requises, limites, et integration externe restee bloquee.
- [ ] Constater l'etat Git avant tout commit/PR ; ne pas fusionner.
