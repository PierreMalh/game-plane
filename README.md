# game-plane

Jeux multijoueur sur téléphone, **sans internet** (pensé pour l'avion).
Un téléphone Android héberge un petit serveur Node ; les autres joueurs
(iPhone ou Android) ouvrent simplement une adresse dans leur navigateur.

## Lancer le serveur (hôte Android, Termux)

Avant le vol, avec internet :

1. Installer **Termux** depuis F-Droid (pas le Play Store, version obsolète).
2. Dans Termux : `pkg install nodejs git`
3. `git clone https://github.com/pierremalh/game-plane` (ou copier le dossier).

Dans l'avion :

1. Mode avion, puis réactiver le Wi-Fi et **activer le point d'accès Wi-Fi**.
2. Les autres joueurs se connectent à ce hotspot.
3. Dans Termux : `cd game-plane && npm start`
4. Le serveur affiche son adresse, par ex. `http://192.168.43.1:8080` :
   les joueurs l'ouvrent dans leur navigateur.

Sur un ordinateur (pour tester) : `npm start`, puis ouvrir l'adresse affichée.

## Tests

`npm test` (Node ≥ 18, aucune dépendance).

## Documentation

- `CONTEXT.md` — reprise rapide (état, stack, conventions)
- `project.md` — journal des décisions techniques
