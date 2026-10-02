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
