# R148 — GPU Qwen 2.5 Coder 7B : comparaison à modèle identique

Statut : DRAFT, benchmarks publics synthétiques uniquement, zéro bascule de production.

## Pourquoi

Reviewer B de production utilise qwen2.5-coder:7b sur le CPU d'un runner GitHub.
Le modèle qwen3.6:35b-a3b-coding testé sur A6000 n'a ni le même coût par requête
ni la même qualité. Pour mesurer l'accélération de calcul SANS changer le modèle,
R148 ajoute au tunnel SSH synthétique une deuxième option : qwen2.5-coder:7b.

## Modifications

- Pod cible inchangé : ao1z73um41h61i ; pas de démarrage de GPU.
- Modèles synthétiques autorisés : qwen3.6:35b-a3b-coding OU qwen2.5-coder:7b.
- Pour Qwen 7B, le benchmark local utilise le jeu fixe public holdout
  de 12 cas via --runpod-7b-holdout ; aucun code privé n'est accessible.
- La preuve GET-only /api/ps de R147 reste obligatoire et liée à l'identité du
  modèle sélectionné. Si la carte déporte le modèle vers le CPU, le test échoue.
- Les mêmes garde-fous de budget, stop fournisseur, identité du Pod, tunnel SSH
  à hôte épinglé, absence d'App GitHub et interdiction d'autorité de fusion
  restent strictement actifs.

## Limitations

Le benchmark GPU réel n'est PAS réalisé : pas de clé API fournisseur sur le MSI,
pas de tarification et dépenses courantes certifiées en euros, pas de stop
indépendant prouvé, et pas d'autorisation d'exfiltration privée vers le Pod.

La preuve de résidence VRAM ne garantit pas à elle seule le débit GPU.
Cette PR conserve son statut brouillon et ne modifie ni Publisher main,
ni la revue #926 en cours, ni les gates HUMAN_GO/MERGE_GO.
