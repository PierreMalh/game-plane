# CONTEXT

Point d'entrée de reprise rapide. `project.md` détaille le « pourquoi ».

## But
Page web ouverte sur téléphone pour jouer entre amis dans l'avion, sans
internet. iPhone et Android mélangés, pas de Mac, pas de publication sur les
stores.

## État actuel
Prototype : salon unique avec liste des joueurs en direct et chat de test.
Aucun jeu encore.

## Stack
- Node ≥ 18, **zéro dépendance** (rien à `npm install` hors ligne).
- `server/server.js` : HTTP statique + WebSocket, serveur autoritaire.
- `server/ws.js` : WebSocket RFC 6455 écrit à la main.
- `public/` : client HTML/JS vanilla, sans ressource externe.
- Tests : `npm test` (`node:test`).

## Déploiement
Aucun serveur distant : l'hôte (Android + Termux) lance `npm start` et partage
son hotspot Wi-Fi. Voir `README.md`.

## Conventions
- Commentaires et docs en français.
- Un commit par feature, `project.md` mis à jour au fil de l'eau.
