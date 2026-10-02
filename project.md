# project.md — journal des décisions

## 2026-10-02 — Cadrage : quel transport ?
- **Web Bluetooth écarté** : un navigateur ne peut être que « central », jamais
  périphérique, donc deux pages ne peuvent pas se parler ; absent sur iOS Safari.
- **Apps natives écartées** : pas de Mac (donc pas de Xcode) et aucun pair-à-pair
  natif commun iPhone/Android.
- **WebRTC + QR (PWA)** gardé comme plan B : marche sans installation mais
  2 scans par joueur et dépend de la résolution mDNS sur le hotspot.
- **Retenu : serveur Node sur le téléphone hôte (Android/Termux)** + hotspot Wi-Fi.
  Les joueurs ouvrent une URL, pas de poignée de main, serveur autoritaire.
  Contrainte : l'hôte doit être Android (un iPhone ne peut pas héberger).

## 2026-10-02 — Prototype serveur + salon
- **Zéro dépendance** : pas d'`npm install` possible hors ligne dans Termux.
  WebSocket implémenté à la main (`server/ws.js` : handshake, trames masquées
  client→serveur, longueurs 7/16/64 bits, fragmentation, ping/pong, close).
  Limite de 64 Kio par message pour éviter l'abus mémoire.
- **Un seul port** : HTTP (page) et WebSocket (`/ws`) ensemble.
- **Reconnexion** : l'id du joueur est conservé en `localStorage` ; un `join` avec
  un id connu reprend la place et remplace l'ancienne socket (code de fermeture
  4000). Un joueur déconnecté reste listé « hors ligne » 5 min (iOS coupe les
  sockets en arrière-plan, il faut pouvoir revenir sans perdre sa place).
- **Heartbeat** ping toutes les 15 s : une socket muette est coupée.
- **Client** : backoff de reconnexion plafonné à 5 s, reconnexion forcée au
  retour au premier plan. Aucune ressource externe (pas de CDN/police web).
- **Tests** : serveur neuf par test (le salon est unique), client = WebSocket
  natif de Node 22, ce qui valide aussi `ws.js` face à une implémentation tierce.
  Vérifié en plus dans Chromium avec deux joueurs.

## 2026-10-02 — Chat à canaux (on ne pourra pas parler dans l'avion)
- **Pourquoi** : les jeux sociaux (loup-garou, undercover…) reposent sur la
  parole, impossible en vol. Le chat devient un élément central, pas un test.
- **Canaux** : `general` ; privés `dm:<idAutre>` (créés à la volée, l'id interne
  est trié `dm:a|b` et non utilisable par un client) ; salons à membres
  explicites créés par les jeux. Le serveur n'envoie un message qu'aux membres :
  un message du chat des loups ne parvient jamais aux villageois.
- **Historique serveur** : 200 messages par canal, renvoyé dans `welcome.chat`
  à chaque (re)connexion ; les privés d'un joueur oublié (5 min hors ligne)
  sont supprimés.
- **Anti-flood** : 8 messages / 5 s par joueur (`chat-error` « rate » sinon),
  « écrit… » limité à 1/s côté serveur et 1 toutes les 2 s côté client.
- **UI** : volet repliable global (hors du cadre des jeux, donc rien à intégrer
  par jeu), onglets, compteur de non-lus sur le bouton et par onglet, messages
  rapides (👍 😂 😮 Oui Non À toi ! Prêt ✋) pour les saisies lentes, vibration
  à l'arrivée d'un message (ignorée sur iOS), volet recalé au-dessus du
  clavier virtuel via `visualViewport`. Un joueur de la liste ouvre un privé.
- **Non-lus à la reconnexion** : le premier chargement ne marque rien non lu ;
  ensuite les messages des autres reçus pendant la coupure le sont.
- **Tests** : 14 nouveaux (module chat avec joueurs factices + intégration
  WebSocket : confidentialité des privés, historique, débit). Vérifié dans
  Chromium avec 3 joueurs (général, privé, badge, « écrit… », rechargement).

## 2026-10-02 — Cadre de jeux + Puissance 4
- **Serveur autoritaire** : `connect4.js` est une logique pure (plateau 6×7,
  victoire sur 4 directions, nul, colonne pleine, tour). Le client n'envoie que
  « poser en colonne N » ; tout coup est validé côté serveur.
- **Contrat de jeu** (`server/games/index.js`) : `init / action / view / isOver /
  nextFirst`. `view(état, joueur)` existe déjà pour les futurs jeux à
  information cachée (cartes, bataille navale) ; Puissance 4 renvoie l'état tel quel.
- **Tables** (`server/tables.js`) : on crée une table, un autre joueur la
  rejoint, la partie démarre quand elle est pleine. Un joueur = une table à la
  fois. Les tables en attente sont diffusées à tous (« Parties ouvertes »).
- **Abandon = forfait** (confirmation côté client). Les joueurs partis restent
  dans `players` pour garder des index de vue stables ; la table se ferme quand
  plus personne n'y est assis. Joueur resté hors ligne > 5 min : forfait.
- **Revanche** : démarre quand les deux la demandent, le premier joueur
  alterne. Désactivée si l'adversaire est parti.
- **Chat de table** : canal `table:<id>` créé avec la table (valide l'API
  `createChannel`/`addMember`), membres = joueurs assis, supprimé à la fermeture.
  Le bouton « 💬 Chat de la table » ouvre le volet dessus.
- **Reconnexion** : `welcome.table` redonne la partie en cours (plateau compris).
- **UX** : le chat se replie au début de la partie pour laisser la place au
  plateau (le badge signale les messages) ; vibration quand c'est son tour
  (ignorée sur iOS) ; jetons rouge/jaune + emoji dans les textes pour ne pas
  dépendre de la seule couleur.
- **Tests** : 18 nouveaux (règles, tables, WebSocket) ; vérifié dans Chromium
  avec 3 joueurs (création, partie, rechargement en cours de partie, victoire,
  revanche, chat de table, abandon).
