# CONTEXT

Point d'entrée de reprise rapide. `project.md` détaille le « pourquoi ».

## But
Page web ouverte sur téléphone pour jouer entre amis dans l'avion, sans
internet. iPhone et Android mélangés, pas de Mac, pas de publication sur les
stores.

## État actuel
Salon unique avec liste des joueurs en direct et **chat à canaux** (général,
privés, salons de jeu) dans un volet global repliable. Jeux : **Puissance 4**.

## Chat (important pour les jeux : on ne pourra pas parler dans l'avion)
- `server/chat.js` : canaux `general`, `dm:<idJoueur>` (privé) et salons créés
  par les jeux via `chat.createChannel(id, label, membres)` / `removeChannel`
  (ex. chat des loups). Filtrage **côté serveur**. API exposée par
  `createApp().chat`.
- `public/chat.js` (`GPChat`) : volet réutilisable, aucun travail côté jeu.

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

## Jeux
- `server/games/<jeu>.js` (logique pure, serveur autoritaire) + enregistrement
  dans `server/games/index.js` ; contrat décrit en tête de ce fichier.
- `server/tables.js` : tables (créer / rejoindre / quitter = forfait / revanche),
  une table par joueur, canal de chat privé `table:<id>` créé avec la table.
- Client : `public/games.js` (cadre commun : lobby, parties ouvertes, vue de
  partie) + `public/games/<jeu>.js` (`GPGames.register({ id, name, status,
  render })`) + CSS du jeu.
- **Ajouter un jeu** = un fichier serveur, un fichier client, deux lignes
  d'enregistrement ; lobby, tables, chat et reconnexion sont déjà gérés.
