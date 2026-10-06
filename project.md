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

## 2026-10-02 — Échecs (chess.js)
- **Règles = chess.js 1.4.0**, copié tel quel dans `server/vendor/` (BSD-2, un
  seul fichier CJS sans dépendance, README + licence à côté) plutôt que
  réécrites : roque, prise en passant, promotion, pat, nulles sont déjà éprouvés.
  Ça n'entame pas le « zéro `npm install` » : le fichier est dans le dépôt.
- **chess.js reste côté serveur uniquement.** `games/chess.js` adapte la
  bibliothèque au contrat des jeux ; le client reçoit le FEN, le dernier coup,
  l'historique SAN et `legal` ({ case: [cibles] }, rempli seulement pour celui
  dont c'est le tour). Le client n'a donc aucune règle, juste du dessin.
- **Couleurs** : `white` = index du joueur blanc ; il alterne à chaque revanche
  (`nextFirst`). L'échiquier est retourné pour les noirs.
- **Promotion** : le serveur répond `promotion-required` sans pièce choisie ;
  le client détecte « pion qui atteint la dernière rangée » et affiche un
  sélecteur (dame/tour/fou/cavalier).
- **Nulles** : automatiques (pat, matériel insuffisant, triple répétition,
  règle des 50 coups — sans réclamation, pour simplifier) + **par accord**.
  Une proposition reste valable jusqu'à la réponse ; seul le coup de
  l'adversaire la refuse implicitement. Proposer quand l'adversaire a déjà
  proposé vaut acceptation. Abandon = forfait, comme au puissance 4.
- **Affichage** : pièces en caractères Unicode (aucune image, donc hors ligne
  sans coût) ; `U+FE0E` après chaque glyphe pour empêcher iOS d'afficher le pion
  ♟ en emoji ; case du roi en échec, dernier coup, cases possibles et
  captures en surbrillance ; coordonnées discrètes sur les bords.
- **Tests** : 15 nouveaux (règles : mats, tour, coups illégaux, promotion,
  roque, en passant, pat, matériel, répétition, 50 coups, nulle par accord ;
  tables : partie, revanche couleurs inversées, forfait). Vérifié dans Chromium
  à deux joueurs (mat du fou aux doigts, orientation, promotion, nulle).
- **Pas de chrono** pour l'instant (volontaire : en avion, sans pression).

## 2026-10-02 — Business Class (façon Monopoly) + tables à effectif variable
- **Nom et contenu** : « Monopoly » est une marque déposée → jeu **« Business
  Class »**, plateau thème avion (villes, hubs, douane, Cagnotte/Imprévu), textes
  et noms originaux. Les mécaniques et la structure des prix sont celles du jeu
  classique (28 titres, 8 groupes, 1 500 de départ, 200 au Décollage).
- **Extension des tables** (pour 2–6 joueurs) : `autoStart:false` → l'hôte lance
  (« Démarrer », ≥ `minPlayers`) ; `onLeave` → un départ ne termine pas la partie
  (le joueur est éliminé, ses biens retournent à la banque) ; revanche entre les
  joueurs restants (les partis sont retirés, il en faut ≥ `minPlayers`). Les jeux
  à 2 joueurs gardent exactement leur comportement.
- **Moteur = machine à phases** (`roll → moving → buy | auction | debt → after`)
  avec des dés injectables (`rng`) pour des tests déterministes. Le client n'a aucune
  règle : le serveur lui envoie des `hints` (ce qu'il peut faire maintenant).
- **Règles implémentées** : doubles (3 = douane), douane (payer 50 / carte / double,
  3e échec = amende obligatoire), achat, **enchères** (le refuseur enchérit en
  dernier ; le dernier restant ayant enchéri gagne), loyers (groupe complet nu ×2,
  maisons/hôtel, hubs 25–200, compagnies 4×/10× les dés), **construction équilibrée**
  avec stock de la banque (32 maisons / 12 hôtels), revente à moitié prix,
  hypothèque (+10 % pour lever), cartes (déplacements, hub/compagnie le plus
  proche, réparations, payer/recevoir de chacun, carte de sortie de douane
  conservée), **échanges** (argent + titres + cartes), **dettes** (file de
  paiements : on vend / hypothèque / échange, sinon faillite au profit du créancier),
  victoire du dernier joueur en lice.
- **Simplifications assumées** : pas de cagnotte au Salon VIP ; titres hypothéqués
  non échangeables ; un seul échange en attente à la fois ; pas de minuteur (un joueur
  hors ligne bloque le jeu jusqu'à son éviction au bout de 5 min, ou départ volontaire).
- **Interface** : plateau en anneau 11×11 (cases ≈ 32 px : bande de couleur, pions,
  maisons, propriétaire en liseré) + fiche de la case touchée, zone d'actions,
  joueurs (toucher = proposer un échange), mes titres (＋/－/hypothèque), échange en
  fenêtre, journal avec pseudos colorés. Saisies (mise, argent) conservées lors des
  rafraîchissements du serveur.
- **Changement transverse** : le bouton 💬 flottant masquait des contenus en jeu →
  déplacé dans l'**en-tête, désormais fixe** en haut (`body` en `min-height` pour que
  `sticky` marche). Vibration « à ton tour » seulement au passage à ton tour.
- **Tests** : 48 nouveaux (moteur avec dés scriptés, tables à effectif variable,
  **500 parties aléatoires** sans exception avec invariants : maisons/hôtels,
  cartes, argent ≥ 0, titres de faillis) ; vérifié dans Chromium à 3 joueurs
  (attente, achat, loyer, enchères, construction, échange, départ).

## 2026-10-02 — Cherche l'imposteur (façon Undercover)
- **Pourquoi ce jeu** : on ne pourra pas parler dans l'avion ; ici les indices passent
  par le jeu et la discussion par le **chat de la table**, qui s'ouvre tout seul au début
  de la phase de discussion (et se replie aux autres phases pour laisser la place à l'action).
- **Règles** (3 à 8 joueurs, lancement par l'hôte) : les civils ont le même mot
  secret, l'imposteur un mot **voisin** et **ne sait pas** qu'il l'est (70 paires FR ;
  laquelle des deux sert aux civils est tirée au sort). 1 imposteur, 2 à partir de 8 joueurs.
  Manche = un indice d'**un seul mot** par joueur (interdit de dire son propre mot,
  accents/casse ignorés) → discussion libre → quand tous sont « prêts », **vote secret**
  (on peut changer d'avis jusqu'au dernier vote) → le plus voté est éliminé et son rôle
  révélé ; **égalité = personne**.
- **Fin** : civils gagnent en éliminant le dernier imposteur, **sauf** si celui-ci
  devine le mot des civils (phase `guess`, accents/casse ignorés) ; les imposteurs
  gagnent dès qu'ils sont au moins aussi nombreux que les civils, ou si trop
  d'égalités (> n+2 manches). Un départ en cours de partie sort le joueur sans révéler
  son rôle (recale tour de parole / « prêts » / votes) ; l'imposteur qui part = victoire des civils.
- **Secret côté serveur** : la vue ne contient que le mot du joueur, jamais celui de
  l'autre camp (testé sur 300 parties aléatoires, à chaque coup et pour chaque joueur) ;
  rôles et mots dévoilés seulement à l'élimination / en fin de partie ; les votes ne
  sont visibles (qui → qui) qu'après le dépouillement.
- **Pas de minuteur** (choix cohérent avec Business Class) : on passe au vote quand
  tous sont prêts. Un joueur hors ligne bloque jusqu'à son éviction (5 min) ou son départ.
- **Tests** : 21 nouveaux (règles, secret, départs à chaque phase, 300 parties
  aléatoires) ; un test non déterministe (ordre de parole aléatoire) a été repéré et
  corrigé en fixant les rôles. Vérifié dans Chromium à 4 joueurs (refus d'indices,
  chat auto, vote, devinette, révélation, revanche).

## 2026-10-02 — Jeux de cartes : Président, 8 américain, Menteur
- **Cadre commun** : `server/games/cards/deck.js` (52 cartes codées `rang+couleur`, `shuffle`
  injectable, `dealAll`, `takeCards`) et côté client `public/cards.js` (`GPCards`) + `cards.css`.
  Main sur **plusieurs lignes** (pas d'éventail à chevauchement) : cartes de 44 px faciles à
  toucher ; `U+FE0E` sur les symboles ♥ ♦ ♣ ♠ pour que iOS ne les passe pas en emoji.
  Mains privées côté serveur, vérifié par tests (aucune carte adverse dans la vue).
- **Président** (3–6, 3 manches) : ordre 3…A,2 (2 = plus fort) ; 1 à 4 cartes de même rang,
  rang **strictement** supérieur ; passer = écarté du pli ; un 2 ferme le pli aussitôt ;
  le dernier à avoir joué ramasse. Rôles (Président / Vice / Neutre / Vice-trou / Trou) et
  **échange de cartes** à la manche suivante (le Trou donne ses 2 plus fortes, le
  Président en rend 2 de son choix ; 1 carte pour les vices dès 4 joueurs). Points : n−1
  pour le 1er … 0. Le client sélectionne tout seul le bon nombre de cartes du même rang.
  Un départ écarte la main du joueur, la partie continue (fin si 1 seul reste).
- **8 américain** (2–6) : couleur ou rang ; **8 joker** (choix de la couleur), **2** = +2
  **cumulable**, **As** fait sauter le suivant, **Valet** inverse le sens (à 2 joueurs : on
  rejoue). On ne pioche que sans carte jouable ; carte piochée jouable → la poser ou passer.
  Pioche vide : la défausse (sauf le haut) est remélangée. Cartes d'un joueur parti : sous la pioche.
- **Menteur** (3–8) : on pose 1 à 4 cartes face cachée en annonçant le rang (A, 2, 3… R, puis
  on recommence) ; le suivant peut crier « Menteur ! » (cartes retournées à tous : le menteur ou
  l'accusateur à tort ramasse le tas, l'accusateur rejoue). Dernière carte posée : le suivant
  doit **trancher** (accuser ou accepter) avant que la victoire soit actée. Le serveur ne
  renvoie jamais les cartes posées, seulement leur nombre et le rang annoncé.
- **Simplifications** : pas de minuteur ; pas de « révolution » au Président ; pas de score cumulé
  au 8 américain / Menteur (une donne = une partie, la revanche relance) ; seul le joueur
  suivant peut accuser au Menteur (jeu au tour par tour, pas en temps réel).
- **Tests** : 37 nouveaux (règles, secret des mains, 120 à 150 parties aléatoires par jeu avec
  conservation des 52 cartes et absence de blocage) + effectifs/démarrage via les tables.
  Deux défauts trouvés en test et corrigés : « Jouer » proposé sans carte jouable (Président) et
  place non attribuée à un joueur ayant fini en cours de manche. Vérifié dans Chromium.

## 2026-10-02 — Documentation utilisateur (README)
- Le README devient la **doc utilisateur** pour des joueurs non techniques : matériel (hôte Android +
  Termux), préparation au sol (`git pull` avant le vol, test à faire), lancement en avion
  (mode avion + Wi-Fi + hotspot, `npm start`, adresse à communiquer), prise en main de l'appli
  (lobby, tables, démarrage par l'hôte, chat à onglets, revanche, abandon), **règles de chacun
  des 7 jeux**, dépannage (adresse, port occupé, reconnexion, partie « bloquée ») et limites.
- **Pourquoi ces choix** : une section « Pas de Bluetooth » en tête (c'était l'idée de départ, mais
  impossible depuis un navigateur → Wi-Fi local) ; une section « Limites » franche (état en mémoire
  perdu si Termux s'arrête, pas de chrono, pas de chiffrement) pour que personne ne soit surpris en vol.
- **Vérifié** : chiffres relevés dans le code (effectifs par jeu, 20 lettres de pseudo, 8 messages
  / 5 s, 200 messages d'historique, 5 min de reprise, 30 tables), liens internes du sommaire
  contrôlés, messages du serveur (« prêt sur le port », « Impossible de démarrer ») testés.

## 2026-10-02 — Belote (classique, 4 joueurs, 2 équipes)
- **Variante retenue** : belote classique en **501**, sans annonces de suites (tierce/cinquante/
  cent/carrés) ni contrée — les règles de base d'abord, les annonces pourront s'ajouter. Documenté
  dans le README (« ce qui n'est pas géré »).
- **Équipes** = ordre d'arrivée à la table (sièges 0 et 2 contre 1 et 3, partenaires face à face). Pas
  d'écran de choix d'équipe : à documenter plutôt qu'à coder, on rejoint dans le bon ordre. Table à effectif
  **fixe (4)** : démarrage automatique quand elle est pleine ; un départ fait gagner l'équipe adverse ; pas de
  revanche à 3 (règle déjà en place pour les jeux à effectif fixe).
- **Donne et prise** : 3+2 cartes, carte retournée, tour 1 (couleur retournée) puis tour 2 (autre couleur) ;
  tous passent deux fois → redonne, le donneur change. Le preneur reçoit la retournée + 2 cartes (8 chacun).
- **Obligations de jeu** (le point délicat, testé cas par cas) : fournir ; à l'atout, monter si possible ;
  sans la couleur, couper et **surcouper**, **sous-couper** quand on ne peut pas surcouper, sauf si le
  **partenaire est maître** (libre) ; fournir la couleur dispense de surcouper.
- **Comptage** : 152 + 10 de der = 162 ; contrat à **82** (belote comprise dans les 82) ; chute = 0 pour les
  preneurs et 162 pour les défenseurs, **belote toujours acquise** à qui la détient ; **capot** = 252 ; les 81/81
  « litige » sont traités comme une chute (pas de report de points). Belote-rebelote annoncée **automatiquement**
  (le serveur sait qui détient R+D d'atout).
- **UI** : table vue de dessus (toi en bas, partenaire en face, sens anti-horaire comme en France), pli au
  centre, carte retournée pendant les enchères, dernier pli, décompte détaillé en fin de donne ; main triée
  (atout d'abord, couleurs alternées noir/rouge) ; cartes interdites grisées.
- **Tests** : 23 nouveaux dont les obligations de jeu (≈ 15 situations), tous les cas de comptage, et **150 parties
  complètes aléatoires** (cartes conservées, comptage cohérent : 162 + belote ou 252 + belote à chaque donne, jamais
  de joueur sans action possible). Vérifié dans Chromium à 4 joueurs (enchères 2 tours, redonne, donne complète de
  32 cartes, scores « Nous/Eux » cohérents entre partenaires et adversaires, donne suivante).

## 2026-10-02 — Annonces et belote contrée
- **Refonte du moteur** : la belote devient `belote-engine.js` avec deux modes (`classic`, `coinche`) ;
  `belote.js` et `coinche.js` sont de fines enveloppes. Jeu de la carte, belote-rebelote et annonces sont
  communs ; seuls diffèrent la donne, les enchères et le barème. Tous les tests de la belote existants
  sont restés verts sans modification de leurs attentes (hors cartes d'annonce révélées, cf. ci-dessous).
- **Annonces** (les deux modes) : tierce 20, cinquante 50, cent 100 (suite de 5 ou plus), carrés (valets 200,
  9 150, as/10/rois/dames 100 ; 8 et 7 : rien). **Déclarées automatiquement** à la 1re carte jouée par chaque
  joueur (comme la belote-rebelote : moins de manipulation à l'écran et pas d'oubli possible) ; seul le **type**
  est public à ce moment. Après le 1er pli, la meilleure annonce de chaque équipe est comparée (carré > cent >
  cinquante > tierce, puis hauteur, puis atout, puis premier joueur) ; l'équipe gagnante marque **toutes** ses
  annonces et **ses cartes sont révélées**, l'autre rien. Perdues si elles sont celles d'un preneur qui chute.
  Conséquence testée : un test de confidentialité a dû exclure ces cartes révélées (règle du jeu, pas une fuite).
- **Belote contrée** (jeu séparé « Belote contrée », en 1000) : 8 cartes d'emblée, enchères chiffrées (80…160,
  Capot) + couleur d'atout, surenchère stricte, on peut ré-enchérir après avoir passé, fin après 3 passes
  suivant une annonce (4 passes sans annonce : redonne). **Contre** par un adversaire du dernier annonceur à son
  tour, **surcontre** (×4) décidé par le seul annonceur.
- **Barème de la contrée** (choix documentés dans le README) : rempli → valeur du contrat + points réalisés (cartes,
  10 de der, belote) pour les preneurs, leurs points pour les défenseurs ; chuté → 160 + contrat aux défenseurs ;
  contré/surcontré → tout ou rien, (160 + contrat) × 2 ou × 4 ; belote jamais multipliée et toujours acquise ;
  annonces ajoutées sans multiplication ; capot annoncé = 250 + 252, capot non annoncé = 252 réalisés. Le contrat
  ne tient pas compte des annonces mais compte la belote. **Hors périmètre** : générale, sans-atout, tout-atout.
- **Équipes** : toujours l'ordre d'arrivée (1er+3e / 2e+4e), comme à la belote classique.
- **Tests** : 37 nouveaux (détection des annonces, comparaison, hiérarchie, égalités, perte si chute ; enchères de la
  contrée, contre/surcontre, tous les cas du barème à la main) + **150 parties aléatoires de contrée** dont chaque
  donne est comparée à un **calcul de points écrit indépendamment** du moteur. Vérifié dans Chromium à 4 joueurs
  (enchères, contre, surcontre ×4, affichage d'une tierce révélée).

## 2026-10-02 — Préparation au passage du dépôt en public
- **Audit de tout l'historique** (23 commits, aucun fichier supprimé en route) : aucune clé, aucun jeton,
  aucun mot de passe, aucun `.env`, aucune IP ou adresse personnelle. Les auteurs sont l'adresse
  `noreply` GitHub et `noreply@anthropic.com` ; seules IP présentes : `127.0.0.1` (tests) et `192.168.43.1`
  (exemple générique de hotspot Android). Pas de réécriture d'historique nécessaire.
- **`.gitignore`** ajouté (`node_modules/`, `.env*`, journaux, fichiers d'éditeur) pour qu'un secret local ou
  un `npm install` accidentel ne soit jamais commité une fois le dépôt public.
- **`CLAUDE.md`** : sections « Projet » et « Commandes » remplies (elles étaient « à compléter »), et retrait
  de la référence au nom d'un autre projet privé dont les règles de travail sont issues.
- Le `git clone` du README (étape Termux) fonctionnera désormais sans identifiants GitHub.

## 2026-10-02 — Spectateurs
- **Besoin** : depuis le salon, rejoindre une partie en cours pour la regarder.
- **Serveur** (`tables.js`) : chaque table a un ensemble `spectators` ; une map `watch` (joueur → table)
  garantit qu'on ne regarde **qu'une table à la fois** et jamais en étant assis. `table-watch` pour
  regarder, `table-leave` (déjà existant) pour arrêter. Créer/rejoindre une table arrête de regarder
  (pas d'erreur à gérer côté client) ; la fermeture d'une table renvoie ses spectateurs au salon ;
  un spectateur parti pour de bon (balayage des déconnectés) est retiré. On peut regarder une table
  en attente, en cours ou finie (entre deux revanches, il reste spectateur).
- **Vue publique uniquement** : le spectateur reçoit `view(état, -1)`. Choix délibéré de **ne pas** lui
  montrer les mains (façon « télé ») : dans un avion tout le monde est à portée de voix et un
  spectateur pourrait souffler. Les vues de tous les jeux géraient déjà un index inconnu, sauf la
  belote (`hands[-1]`) corrigée. Test qui parcourt **tous les jeux enregistrés** : pas de main, pas de
  mot, aucune action, aucune carte d'une main dans le JSON — un futur jeu est couvert d'office.
- **Chat** : le spectateur entre dans le canal `table:<id>` (lecture et écriture : sans voix, c'est
  le seul moyen d'encourager) et en sort à son départ (`chat.removeMember`, nouveau). Il ne voit rien
  de plus que la vue publique, donc il n'a rien à divulguer.
- **Client** : section « Parties en cours » avec **👁 Regarder** (nombre de spectateurs affiché) ;
  vue de partie avec « · 👁 spectateur » dans le titre, liste « 👁 Regarde : … » visible des joueurs,
  bouton « Arrêter de regarder » (sans confirmation), pas de revanche, « Prendre une place » sur une
  table en attente. `table.me = -1` : chaque jeu évite les « Tu… » (abandon aux échecs / Puissance 4),
  oriente la vue sur un point fixe (blancs en bas, équipe 1 en bas à la belote, « Équipe 1 / 2 » au
  lieu de « Nous / Eux »), masque « Mes titres » à Business Class et le mot secret à l'imposteur.
- **Tests** : 10 nouveaux (`test/spectators.test.js`). Vérifié dans Chromium : spectateur de chaque jeu,
  aucune erreur JS, aucun bouton d'action actif (à Business Class, seules les cases du plateau restent
  touchables, pour afficher leur fiche).

## 2026-10-02 — Coup de propre sur l'interface
Audit par captures d'écran à 390 px de large (taille d'un téléphone) de chaque écran, puis corrections :
- **Salon réordonné** : « Parties ouvertes » (encadrée en bleu) puis « Parties en cours » passent **au-dessus**
  de la liste des jeux, renommée « Nouvelle partie ». Avant, avec 9 jeux, les tables à rejoindre étaient sous
  la ligne de flottaison : un joueur arrivant ne voyait pas la partie de ses amis.
- **Chat replié à l'arrivée** : il s'ouvrait par-dessus le salon (60 % de l'écran) et cachait les jeux. Le
  bouton 💬 et sa pastille de non-lus suffisent à le trouver.
- **Écran d'accueil** : une phrase d'explication, bouton « Entrer » (au lieu de « Rejoindre », déjà utilisé
  pour les tables), focus automatique sur le pseudo.
- **Joueurs** : pastille verte / grise en CSS au lieu des caractères ●/○, « (toi) » sur son propre nom.
- **Salle d'attente** : places libres en pointillé, nombre de joueurs encore nécessaires (« encore 1 pour
  démarrer ») au lieu d'un bouton grisé sans explication, rappel « les autres rejoignent depuis Parties
  ouvertes », « Démarrer à N » (corrige « 1 joueurs ») ; « En attente des autres joueurs… » au lieu
  « d'un adversaire » pour les jeux à plus de 2.
- **En-tête de partie** : nom du jeu en petit surtitre, statut (« À toi de jouer ») en gros et centré : l'info
  utile passe en premier.

## 2026-10-02 — Poker (Texas Hold'em)
- **Variante** : Texas Hold'em **sans limite**, la plus connue et la plus simple à expliquer à table. 2 à
  8 joueurs (au-delà, plus assez de cartes pour une lecture confortable sur téléphone), lancé par l'hôte.
- **Format tournoi** plutôt que « cash game » : sans argent réel, il faut une fin. 1000 jetons chacun,
  blindes 10/20 qui **doublent toutes les 10 mains** (≈ 50 grosses blindes au départ : assez pour jouer,
  et une partie qui tient dans un vol). Le dernier avec des jetons gagne ; la revanche relance un tournoi.
- **Règles d'enchères officielles** implémentées car elles changent le résultat : relance minimale égale
  à la dernière relance ; **tapis incomplet** qui ne rouvre pas les relances pour qui a déjà parlé
  (drapeaux `needsAct` / `mayRaise` par joueur) ; tête-à-tête où le bouton est petite blinde. Montant
  d'une relance exprimé en **mise totale du tour** (« relancer à 60 »), comme en tournoi.
- **Pots annexes** calculés à la fin par couches de mise totale (`contrib`) : chaque niveau forme un pot
  dont seuls les joueurs non couchés ayant misé au moins ce niveau sont éligibles. La mise non suivie
  revient d'elle-même à son auteur (pot dont il est seul éligible). Partage à égalité, jeton
  indivisible au premier gagnant à gauche du bouton.
- **Évaluateur** : meilleure main de 5 parmi 7 (21 combinaisons, largement assez rapide), score
  `[catégorie, départages…]` comparé lexicographiquement ; quinte blanche A-2-3-4-5 gérée.
- **Fin de main** : pas d'enchaînement automatique, chaque joueur en lice touche « Main suivante »
  (comme la « Donne suivante » de la belote) pour avoir le temps de voir l'abattage. Les éliminés et
  les partis n'ont pas à valider. Toutes les mains en jeu sont montrées à l'abattage (pas de « muck » :
  plus simple et pédagogique) ; un joueur qui gagne parce que tout le monde se couche ne montre rien.
- **Départ en cours** (`onLeave`) : le joueur se couche, ses mises restent au pot, ses jetons sortent
  du jeu ; le tournoi continue tant qu'il reste deux joueurs.
- **Interface** : tapis vert avec les 5 emplacements du tableau, jetons et mise de chacun, bouton « D »,
  curseur de relance + raccourcis *Min*, *½ pot*, *Pot* (relance « au pot » : pot après avoir suivi),
  *Tapis*. Le client ne connaît aucune règle : `hints` donne les actions, le montant à suivre et les
  bornes de relance.
- **Tests** : 19 (`test/poker.test.js`) : catégories et départages, donne et blindes, tête-à-tête, secret
  des mains, relance minimale, tapis incomplet, pots annexes, mise non suivie rendue, partage et jeton
  indivisible, élimination, blindes croissantes, départ en cours, et **300 tournois aléatoires** (2 à 8
  joueurs) vérifiant à chaque action la conservation des jetons et l'unicité des cartes. Le test
  spectateur générique couvre aussi le poker. Vérifié dans Chromium à 3 joueurs + 1 spectateur
  (relance au pot, abattage, main suivante, rotation du bouton), aucune erreur JS.

## 2026-10-03 — Jeu de cartes personnalisé
- **Besoin** : remplacer chaque carte (et le dos) par une photo envoyée depuis un téléphone, l'image
  étant conservée **sur l'hôte**, dans le projet.
- **Stockage** : dossier `custom-cards/` à la racine, un fichier `<clé>.<ext>` par carte (`AS.jpg`,
  `back.png`). Hors de `public/` pour ne jamais servir autre chose que les 53 clés connues ; contenu
  ignoré par git (propre à chaque hôte, et des photos de vacances n'ont rien à faire dans le dépôt).
  Le dossier est **relu au démarrage** : contrairement aux parties, le jeu personnalisé survit à un
  redémarrage de Termux. Écriture atomique (fichier temporaire + renommage).
- **Envoi en HTTP** (`PUT /api/cards/<clé>`, corps brut) plutôt que par WebSocket : notre `ws.js`
  n'est pas fait pour de gros messages binaires, et `fetch` + `Blob` marche partout. **Pas de
  multipart** à parser : une requête = une image. Format reconnu à la **signature** des octets
  (PNG, JPEG, GIF, WebP), pas au Content-Type ; 2 Mo max (413 au-delà).
- **Réduction côté navigateur** : canvas → JPEG 0,85, grand côté 400 px (une carte fait ~44 × 62 px,
  ×2–3 pour les écrans haute densité). Une photo de 4 Mo devient ~30 Ko : envoi instantané sur le
  hotspot et 53 images légères à charger pour chaque joueur. Fond blanc sous les PNG transparents.
  Si le navigateur ne sait pas décoder le fichier (HEIC sur ordinateur), on tente l'envoi brut et
  le serveur refuse proprement.
- **Cache** : chaque image a une version (horodatage, strictement croissante) ; l'URL
  `/custom-cards/<clé>?v=<version>` est servie `immutable`, le changement de version suffit à
  invalider. La liste `{ clé: version }` arrive dans `welcome` et est **diffusée à tous** à chaque
  changement (`card-skin`) : la partie en cours est redessinée aussitôt (`GPGames.refresh()`).
- **Affichage** : l'image couvre la carte (`object-fit: cover`). Le **rang et la couleur** restent
  affichés par-dessus, dans deux coins (en haut à gauche, et retourné en bas à droite comme sur une
  vraie carte), sur une pastille blanche : sans eux, une photo seule rend la carte illisible en jeu.
  Le dessin d'origine reste dans le DOM (masqué) et réapparaît si l'image ne charge pas. Aucun jeu
  n'a eu à changer : tout passe par `GPCards.face` / `GPCards.back`.
- **Éditeur** : section repliable dans le salon (pour ne pas charger 53 images à l'arrivée), grille
  par couleur ; toucher une carte ouvre le sélecteur de photos, ✕ la remet d'origine, bouton pour tout
  rétablir (avec confirmation). Champ fichier masqué sans `display:none` (Safari iOS).
- **Droits** : tout joueur sur le hotspot peut modifier le jeu (entre amis, pas de rôle d'hôte dans
  l'appli) ; documenté dans les limites du README.
- **Tests** : 6 (`test/card-skin.test.js`) : envoi, service, diffusion et accueil d'un nouveau joueur,
  remplacement avec changement de format, retrait unitaire et total, refus (clé inconnue, non-image,
  trop lourd, chemins piégés), relecture du dossier au démarrage. Vérifié dans Chromium à 390 px :
  envoi de l'as de pique et du dos, affichage chez l'autre joueur en partie de 8 américain, retour au
  jeu d'origine diffusé, aucune erreur JS.

## 2026-10-06 — Jetons de poker (gestionnaire de jetons, 2 à 10 joueurs)
- **Besoin** : jouer au poker avec de vraies cartes mais sans jetons physiques. Chacun voit le pot, ses
  jetons et ses actions ; un « croupier » règle la partie et les blindes. Distinct du jeu `poker`
  (Texas Hold'em avec cartes, tournoi) : ici **le serveur ne connaît aucune carte**.
- **Moteur** `server/games/poker-chips.js`, enregistré comme un jeu à effectif variable
  (`autoStart: false`, 2–10) : lobby, tables, chat, spectateurs et reconnexion sont réutilisés tels quels.
  Phases : `setup → betting → showdown | between → … → over`.
- **Croupier** : un **téléphone à part qui ne joue pas** (précisé après coup : 0 jeton, jamais dans une main,
  un siège de plus à la table, donc 3 à 11 sièges). L'hôte (index 0) au départ ; réclamable seulement en
  `setup` (l'ancien croupier devient joueur et reçoit le tapis). S'il quitte, le suivant le devient : couché,
  ses jetons sortent du jeu.
  Seul le croupier peut `config`, `start`, `award`, `give`, `end`.
- **Enchères** : No-Limit, relance = « montant total de la mise du tour », relance minimale = dernière
  relance (≥ grosse blinde), tapis incomplet qui ne rouvre pas les enchères (`noRaise`), tête-à-tête avec
  le bouton petite blinde. Tout est en entiers. Même logique que `poker.js`, réécrite pour ne dépendre
  d'aucun paquet. La **mise non suivie est rendue** à la fin du tour (plutôt qu'au calcul des pots), ce
  qui garde les pots justes avec des tapis inégaux.
- **Pots** : un niveau par mise totale distincte des joueurs encore en lice (`pots()`), pots voisins de
  mêmes éligibles fusionnés ; les mises des couchés restent dans le pot sans le disputer. À l'abattage le
  croupier envoie `award { winners: [[…], …] }`, une liste par pot, validée contre les éligibles ; partage
  égal, jeton impair au premier gagnant à gauche du bouton. Tous couchés sauf un : pot attribué seul.
- **Blindes** : réglées par le croupier avant chaque main (`config`), avec option de doublement
  automatique toutes les N mains (0 = manuel). Le tapis de départ n'est modifiable qu'en `setup`.
- **Recave** : `give { player, amount }` (positif ou négatif) entre deux mains ; `sitout` pour mettre
  un joueur de côté. Départ en cours de main = couché, jetons retirés (`onLeave`).
- **Information** : tout est public (pas de cartes), seul `hints` dépend du joueur ; un spectateur voit
  la vue sans action.
- **Client** : `GPChips` (dans `public/games/poker-chips.js`) dessine des piles de jetons en CSS
  (valeurs 1/5/25/100/500/1000, 6 jetons max par colonne puis « ×n ») pour le pot, les tapis et la mise ;
  un plateau de jetons à toucher compose la mise (somme bornée entre relance minimale et tapis), avec
  curseur et raccourcis Min/½ pot/Pot/Tapis. Les saisies du croupier survivent aux rafraîchissements.
- **Tests** : 12 (`test/poker-chips.test.js`) dont des parties aléatoires vérifiant la conservation des
  jetons à chaque action. Vérifié dans Chromium à 390 px à 3 joueurs (réglage, main, relance au plateau),
  aucune erreur JS.
- **Limites** : pas d'ajout de joueur une fois la partie lancée (comportement des tables) ; pas de
  « straddle » ni d'ante.

## 2026-10-06 — Jetons de poker : table en long et refonte de l'interface
- **Besoin** : le croupier voyait une liste de joueurs et des formulaires ; on veut l'ambiance d'une vraie
  table, un bouton « Main suivante » évident et des réglages rangés à part. Seul le client change
  (`public/games/poker-chips.js` + `.css`) : moteur, messages et tests serveur intacts.
- **Table** : un stade vertical (`border-radius: 999px` sur une boîte de rapport 100 × H) au feutre vert
  avec rebord bois et liseré doré. Les sièges sont posés à **intervalles réguliers le long du rebord**
  (côtés droits et virages paramétrés par longueur d'arc, `track()`/`place()`), dans le sens du jeu en
  partant du bas : **celui qui regarde est toujours en bas**, le croupier (🎩) a sa place autour de la
  table. Mises devant chaque siège (piles miniatures sur une piste intérieure), bouton « D », pot et rue
  au centre. Même vue pour le croupier, les joueurs et les spectateurs (table plus haute côté croupier).
- **Croupier** : entre deux mains, **grand jeton doré « Main suivante »** au milieu du tapis (résultat de
  la main précédente au-dessus). Bouton **⚙ Réglages** ouvrant une feuille du bas : **recave** (choix du
  joueur, `+tapis de départ` en un geste, autre montant à donner/retirer), absent/remis en jeu, blindes,
  tapis de départ (en `setup` seulement), doublement des blindes, fin de partie. Toucher un siège ouvre
  directement ce menu sur ce joueur. À l'abattage, on **touche les sièges gagnants** (onglets par pot
  s'il y a des pots annexes) puis « Distribuer ».
- **Joueur** : barre du bas (collante quand c'est à lui) avec ses jetons, l'état de la main et des
  boutons larges couleur poker (couché rouge, suivre/parole vert, relancer or) ; le plateau de jetons
  s'ouvre à la demande (aperçu de la pile, curseur, Min/½ pot/Pot/Tapis). Historique replié sous la
  table (dernière ligne visible).
- **Léger** : aucune image, police ni bibliothèque ; jetons et table en CSS pur, animations coupées si
  `prefers-reduced-motion`. Skill `frontend-design` utilisé pour la direction visuelle.
- **Vérification** : 290 tests verts ; rendu à blanc du client (mini-DOM) sur une partie réelle à
  4 joueurs + croupier (setup, recave via le menu, relance au plateau, tapis, abattage, distribution,
  départ, fin) sans erreur. Pas de navigateur dans l'environnement : rendu visuel à valider sur téléphone.
