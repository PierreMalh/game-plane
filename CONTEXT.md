# CONTEXT

Point d'entrée de reprise rapide. `project.md` détaille le « pourquoi ».

## But
Page web ouverte sur téléphone pour jouer entre amis dans l'avion, sans
internet. iPhone et Android mélangés, pas de Mac, pas de publication sur les
stores.

## État actuel
Salon unique avec liste des joueurs en direct et **chat à canaux** (général,
privés, salons de jeu) dans un volet global repliable. Jeux : **Puissance 4**, **Échecs**, **Business Class** (façon Monopoly, 2 à 6 joueurs),
**Cherche l'imposteur** (façon Undercover, 3 à 8 joueurs).

## Chat (important pour les jeux : on ne pourra pas parler dans l'avion)
- `server/chat.js` : canaux `general`, `dm:<idJoueur>` (privé) et salons créés
  par les jeux via `chat.createChannel(id, label, membres)` / `removeChannel`
  (ex. chat des loups). Filtrage **côté serveur**. API exposée par
  `createApp().chat`.
- `public/chat.js` (`GPChat`) : volet réutilisable, aucun travail côté jeu.

## Stack
- Node ≥ 18, **zéro dépendance npm** (rien à `npm install` hors ligne). Seule
  bibliothèque tierce : `chess.js`, copiée dans `server/vendor/` (voir son README).
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

- **Effectif variable** : un jeu avec `autoStart: false` (min < max) est lancé par
  l'hôte (bouton « Démarrer »), et peut définir `onLeave(état, idx)` pour qu'un
  départ en cours de partie n'y mette pas fin (sinon : forfait).
- **Business Class** : `server/games/monopoly/` (moteur `index.js`, cartes
  `cards.js`) ; les données du plateau sont dans `public/games/monopoly-board.js`
  (module UMD) **partagé** par le serveur (`require`) et le navigateur (`<script>`).
  Le client ne connaît aucune règle : il reçoit l'état et des `hints` (actions,
  constructions, hypothèques, enchères possibles).
- Parties de test déterministes : `game.init(ids, { rng, shuffle:false })`
  (dés scriptés, voir `test/monopoly.test.js`).

- **Information cachée** : `view(état, idx)` ne renvoie que ce que `idx` a le droit de
  voir (ex. « Cherche l'imposteur » : son mot seulement ; test de non-fuite dans
  `test/impostor.test.js`). Les mots viennent de `server/games/impostor-words.js`.
