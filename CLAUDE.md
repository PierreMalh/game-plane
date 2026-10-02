# CLAUDE.md

Ce fichier guide Claude Code (claude.ai/code) pour travailler dans ce dépôt.

## Projet

Jeux multijoueur entre amis sur téléphone, **sans internet** (pensé pour
l'avion) : un téléphone Android hôte fait tourner le serveur sous Termux et
partage son point d'accès Wi-Fi, les autres joueurs ouvrent une page web.
Node ≥ 18, **zéro dépendance npm**, client HTML/JS vanilla. Architecture et
conventions détaillées dans `CONTEXT.md`.

- `server/` : serveur HTTP statique + WebSocket maison (`ws.js`), chat,
  tables, moteurs de jeu (`games/`), bibliothèque tierce copiée (`vendor/`).
- `public/` : client (salon, chat, cadre de jeux, un fichier par jeu).
- `test/` : tests `node:test`.

## Commandes

- Lancer : `npm start` (port 8080 par défaut, `PORT=9000 npm start` pour un autre).
- Tous les tests : `npm test`.
- Un seul fichier de test : `node --test test/belote.test.js`.
- Un seul test par son nom : `node --test --test-name-pattern="contre" test/coinche.test.js`.
- Aucune installation ni build.

## Documentation à tenir à jour

- `project.md` — journal chronologique de chaque décision technique (schéma,
  formules, choix UX) avec le « pourquoi ». **À mettre à jour à chaque
  nouvelle feature**, au fur et à mesure.
- `CONTEXT.md` — point d'entrée de reprise rapide : état actuel, stack,
  déploiement, conventions. À lire en premier en début de session.
- `README.md` — documentation utilisateur (règles des jeux, dépannage).
- `project.md` et `CONTEXT.md` font foi en cas de contradiction avec tout autre document.

## Conventions de travail

- Commentaires et docs rédigés **en français** ; garder cette convention en
  éditant les fichiers existants.
- **Un commit par feature**, avec mise à jour de `project.md` incrémentale
  (pas en bloc à la fin).
- **Démarrage d'une feature/fix** : `git fetch origin main` puis repartir de
  la dernière version de `origin/main` (seule source de vérité de ce qui est
  déployé) ; ne jamais partir d'un état périmé.
- **Fin de tâche** : une fois les changements commités et poussés, ouvrir la
  pull request tout de suite, sans attendre une demande explicite.
- **Avant de pousser dans une branche qui a déjà une PR**, vérifier l'état de
  cette PR (`merged`/`state` via l'API GitHub) : une PR mergée ou fermée ne
  reprend jamais un nouveau commit. Si elle est mergée, repartir de
  `origin/main`, rebaser dessus les commits non livrés (les garder) et ouvrir
  une **nouvelle** PR. Ne pousser dans une PR existante que si elle est
  encore ouverte.
- **Tests en conditions réelles** : si des données de test sont créées sur de
  vrais comptes, tout nettoyer ensuite — jamais de résidu.
- **Actions destructrices / production** (resets, rollbacks) : toujours
  confirmer le périmètre exact (tables, environnement, fenêtre temporelle)
  avant d'écrire quoi que ce soit.
- **Opérations ponctuelles en prod** : via un accès distant dédié (script
  jetable supprimé après usage), jamais une commande locale contre la prod.
- **Migrations de base** : écrire la migration SQL à la main si l'outil est
  bloqué en non-interactif ; les changements purement additifs passent sans
  blocage.

## Workflow pour une nouvelle feature

1. **Plan** — proposer un plan d'attaque avant d'écrire du code.
2. **Dev** — implémenter d'après le plan.
3. **Tests** — écrire les tests unitaires et vérifier que la feature marche.
4. **Review** — relire le diff (lecture seule) et remonter les problèmes.
5. Itérer 2 → 3 → 4 jusqu'à un résultat propre, puis un seul commit + push.
