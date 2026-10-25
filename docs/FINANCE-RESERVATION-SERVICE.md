# DevFactory — service de reservation financiere local

Etat : **deploiement local SHADOW actif sur MSI, NON AUTORISE POUR LES DEPENSES** (2026-10-25). La version locale ne constitue pas une autorite financiere independante du Runner au niveau du compte OS.

## Composants livres
- `service/finance-reservation-ledger.mjs` : SQLite WAL, `synchronous=FULL`, transactions `BEGIN IMMEDIATE` et journal durable de reservations et de charges.
- `service/finance-reservation-server.mjs` : processus HTTP distinct du Runner, ecoute CLI exclusivement sur `127.0.0.1`, deux tokens differents.
- `test/finance-reservation-{ledger,server}.test.mjs` : tests vrais SQLite et HTTP.

## Regles
- Enveloppe globale : **15 EUR / mois UTC**.
- Reservation reviewer B : **3 USD / mois**, une demande au maximum 0,50 USD.
- Reservation developpement : **10 USD / mois**, une demande au maximum 1 USD.
- Conversion conservatrice interne : **1 USD reserve = 3 EUR d'exposition**. Ceci n'est PAS un taux FX authentifie : c'est un plafond pessimiste pour les tests.
- Charges ajoutees **EN PLUS** des reservations, sans liberation automatique des holds. Les factures tardives restent rattachees au mois d'origine.
- Reemploi identique d'un ID = idempotence ; contenu contradictoire = 409.
- Aucune suppression ni release. Aucun appel a OpenRouter. Toutes les reponses: `maySpend:false`, jamais une attestation.

## Mode manuel de test (sur MSI uniquement, aucun secret en git)
1. Choisir un repertoire de donnees dedie, existant et non partage avec le Runner, avec permissions NTFS restreintes au compte de service.
2. Fournir des tokens aleatoires distincts de 32 caracteres minimum via variables de processus `DF_FINANCE_CLIENT_TOKEN` et `DF_FINANCE_ADMIN_TOKEN`. Ne pas les stocker dans `.env` suivi par git.
3. Fournir `DF_FINANCE_DB` (chemin absolu vers le fichier SQLite) et `DF_FINANCE_PORT` (port libre).
4. Depuis ce dossier, demarrer `node service/finance-reservation-server.mjs` sous une identite OS separee. Message attendu : `FINANCE_LEDGER_LOCAL_READY_NO_SPEND`.
5. `GET http://127.0.0.1:<port>/health` retourne `{"status":"ok","maySpend":false}`.
6. `POST /v1/reservations` avec `Authorization: Bearer <client>` et JSON exact `{"id":"test-001","role":"reviewer_b","pr":940,"head":"<40 hexadecimal>","upperUsdMicros":500000}`. Si l'enveloppe le permet, retourne un hold local, **pas** la permission d'appeler le modele.
7. `POST /v1/charges` demande le token administrateur distinct ; JSON `{"eventId":"facture-001","reservationId":"test-001","amountUsdMicros":120000}`.
8. `GET /v1/status` avec l'un des tokens donne les totaux et `mayReserveForPaidRun:false`.

## Pour un vrai demarrage de Reviewer B / du Runner
Le service est independant **en processus et stockage**, mais n'est pas encore une **autorite independante de confiance** :
- heberger le service et sa base sous un compte/une machine inaccessible en ecriture au Runner ;
- installer et approuver les signataires et l'authentification d'origine, avec rotation et anti-rejeu ;
- acquérir les preuves serveur de tous les workspaces/cles OpenRouter, les charges en vol et les factures, ainsi qu'un FX authentifie ;
- definir la reservation/settlement avec transfert de preuves, audits et refus en cas d'ambiguite ;
- faire une revue de securite independante, verifier les plafonds et le ZDR, puis raccorder explicitement le workflow Publisher protege ;
- ajouter l'autorisation exacte du proprietaire pour les SHA des PR #940/#941 avant chaque paid-call.

**Ne pas** presenter cette version locale comme preuve de `MAY_SPEND=true`, et ne pas activer `DeenKids-DevFactory-Autonomy` sur sa seule base.

## Deploiement MSI shadow — preuves du 25 octobre 2026
- Windows Scheduled Task : `DevFactory-Finance-Ledger-Shadow`, declenchement a l'ouverture de session, execution sous `MSI\\ismah` avec niveau `Limited`, et redemarrages sur echec. **Action directe Node** (`finance-reservation-windows-entrypoint.mjs`) : la tache suit le vrai processus et l'arrete, sans wrapper PowerShell resident. Il ne s'agit PAS d'un service Windows administrateur/LocalService.
- Code installe dans `%LOCALAPPDATA%\\DevFactory\\FinanceReservation\\app`. Registre SQLite persistant dans `state\\ledger.sqlite`. Aucun fichier du Runner n'est modifie.
- Secrets de client et d'administration distincts, generes aleatoirement au deploiement, stockes via DPAPI CurrentUser dans `secrets`; leur dechiffrement ponctuel passe par `finance-reservation-windows-unseal.ps1` dans un pipe prive vers Node, sans argument de ligne de commande ni journal. ACL NTFS sur le dossier : seul `MSI\\ismah` et `SYSTEM` ont FullControl.
- Port local `127.0.0.1:47881` uniquement. Tache `Running`, processus Node identifie, `GET /health` -> `maySpend:false`.
- `GET /v1/status` authentifie : reservationCount=0, chargeCount=0, `mayReserveForPaidRun:false`, `maySpend:false`, `providerBillingVerified:false`, `independentSignerVerified:false`. Role client sur charges -> HTTP 403.
- Stop/Start de la tache teste : ancien PID Node effectivement termine, nouveau PID distinct, `/health` valide, fichier registre conserve. Test subprocess d'arret/redemarrage avec vraie reservation et charge : PASS. Ensemble du service financier : **12 PASS / 0 FAIL**.
- Suite complete sur Windows : 3 epreuves d'autres workflows echouent sur CRLF LF; elles ne doivent pas etre masquees ou comptees comme reussies. Ne pas modifier les controles de gouvernance pour obtenir artificiellement du vert.
- `DeenKids-DevFactory-Autonomy` toujours `Disabled`. Aucun appel inference OpenRouter, aucun depassement budget, aucun `HUMAN_GO`, `MERGE_GO` ni `RUNNER_GO` deduit.

**Limite de confiance** : la tache et le Runner potentiel pourraient tourner sous la meme identite Windows. Ce staging n'est donc PAS une autorite de reservation independante et ne donne aucune permission de depense. Pour la production il faudra un compte OS de service distinct approuve, son propre ACL, une synchronisation financiere serveur authentifiee, les preuves ZDR/FX/compte-entier et la revue formelle sur le SHA exact.

L'installation peut etre reproduite sur un MSI vierge via `scripts/install-finance-reservation-shadow.ps1`. Ce script refuse de remplacer un dossier ou une tache existante afin de conserver les donnees et les secrets.
