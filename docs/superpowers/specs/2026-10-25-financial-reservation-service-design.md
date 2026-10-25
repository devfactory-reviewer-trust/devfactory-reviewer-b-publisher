# Service de reservation financiere DevFactory — conception (2026-10-25)

## Objet
Creer un processus **distinct du Runner**, sans appel de modele, avec journal durable des reservations et charges, pour eviter les depassements et garder la tracabilite lors des redemarrages.

## Choix et alternatives
1. **Retenu pour la premiere tranche :** Node.js 24 + SQLite WAL, API HTTP uniquement sur 127.0.0.1 et deux identites de service distinctes (client / rapprochement). Fonctionne sans nouvelle dependance ni modification du PostgreSQL personnel.
2. PostgreSQL sur MSI : transactions convenables, mais configuration des roles et privileges inconnue ; reutiliser ce serveur personnel augmenterait le risque.
3. Infrastructure cloud independante : meilleure separation de confiance pour la production, mais nouvel hebergement, secrets, signataires approuves et autorisation financiere necessaires.

## Contrat de la tranche
- Une nouvelle base SQLite sous un repertoire explicite, cree par l'operateur et protege par les ACL du compte de service.
- Appels POST authentifies, corps JSON strict et borne, identifiants et SHA verifies.
- Roles `reviewer_b` 3 USD/mois et `development` 10 USD/mois ; enveloppe partagee 15 EUR/mois.
- Les montants sont en micro-USD entiers ; chaque reservation compte a **3 EUR par USD** pour une marge de change conservatrice, et chaque charge se cumule aux reservations non liberees.
- Transaction `BEGIN IMMEDIATE` : exclusion mutuelle, controle de plafond et insertion atomiques. ID de reservation reutilise a l'identique = idempotent ; change = refus.
- Aucun endpoint de suppression, liberation de reservation, remise a zero, modele ou depense.
- Une identite **admin distincte** peut ajouter des charges observees sans liberer les reservations.
- Le serveur ne promet jamais une autorisation de depense : toutes les reponses portent `maySpend: false`. Aucun branchement aux PR #940/#941 ni a OpenRouter n'est active.

## Limites clairement assumees
Cette premiere tranche est un registre operationnel local et un verrou conservateur ; **pas** encore une autorite financiere independante de confiance. Pour autoriser un seul appel payant, il manque la separation effective des comptes OS, les signataires approuves, les preuves de facturation multi-workspaces, la conversion officielle, les charges en vol et l'integration eprouvee du workflow protege. Le Runner et Reviewer B restent sur `MAY_SPEND=false`.

## Validation
Tests sur vraie SQLite avec redemarrage, idempotence, plafonds, charges, authentification, concurrence et refus des entrees hostiles. Demarrage manuel de test seulement sur loopback, sans ouvrir de connexion a OpenRouter.
