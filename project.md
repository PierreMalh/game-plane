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
