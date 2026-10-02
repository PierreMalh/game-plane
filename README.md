# ✈️ Game Plane

**Jouez entre amis sur vos téléphones, sans aucun accès à internet** — pensé pour l'avion.

Un seul téléphone **Android** (l'« hôte ») fait tourner un petit serveur et partage son
point d'accès Wi-Fi. Tous les autres joueurs, sur **iPhone ou Android**, s'y connectent et
ouvrent une adresse dans leur navigateur. Rien à installer pour eux.

> 📶 **Pas de Bluetooth** : un navigateur ne peut pas communiquer en Bluetooth avec un autre
> téléphone. Tout passe par le **Wi-Fi local** du téléphone de l'hôte, qui marche très bien sans internet.

**9 jeux** : Puissance 4 · Échecs · Business Class (façon Monopoly) · Cherche l'imposteur ·
Président · 8 américain · Menteur · Belote · Belote contrée — avec un **chat intégré** (indispensable quand on ne peut pas parler).

## Sommaire

1. [Ce qu'il vous faut](#1-ce-quil-vous-faut)
2. [Préparer le vol (avec internet)](#2-préparer-le-vol-avec-internet)
3. [Dans l'avion : lancer et rejoindre](#3-dans-lavion--lancer-et-rejoindre)
4. [Utiliser l'application](#4-utiliser-lapplication)
5. [Les jeux et leurs règles](#5-les-jeux-et-leurs-règles)
6. [Problèmes fréquents](#6-problèmes-fréquents)
7. [Limites à connaître](#7-limites-à-connaître)
8. [Pour les curieux (développement)](#8-pour-les-curieux-développement)

---

## 1. Ce qu'il vous faut

| Qui | Quoi |
|---|---|
| **L'hôte** (une seule personne) | Un téléphone **Android** avec l'app **Termux** installée, et assez de batterie. |
| **Les autres joueurs** | N'importe quel téléphone récent (iPhone ou Android) avec un navigateur. |

> ⚠️ L'hôte **doit être sous Android** : un iPhone ne peut pas héberger le serveur.
> Il n'a pas besoin d'être le meilleur joueur — il joue comme les autres, simplement son
> téléphone doit rester allumé et connecté pendant toute la session.

Le Wi-Fi de l'avion n'est **pas** utilisé : c'est le point d'accès du téléphone de l'hôte qui
relie tout le monde. Aucun forfait ni internet n'est nécessaire dans l'avion.

---

## 2. Préparer le vol (avec internet)

**À faire une fois, de préférence la veille, uniquement sur le téléphone de l'hôte.**

1. **Installer Termux** depuis **F-Droid** ([f-droid.org](https://f-droid.org), puis chercher « Termux »).
   Évitez la version du Play Store, qui n'est plus à jour.
2. Ouvrir Termux et taper :
   ```
   pkg update
   pkg install nodejs git
   ```
3. Récupérer le jeu :
   ```
   git clone https://github.com/pierremalh/game-plane
   ```
4. **Tester au sol** (important !) :
   ```
   cd game-plane
   npm start
   ```
   Le serveur affiche une ou plusieurs adresses, par exemple `http://192.168.43.1:8080`.
   Activez le point d'accès Wi-Fi du téléphone, connectez un autre téléphone dessus, ouvrez
   l'adresse affichée : vous devez voir l'écran « Game Plane ». Arrêtez le serveur avec `Ctrl + C`
   (touche `CTRL` de la barre de Termux, puis `c`).

**Mettre à jour** (quand de nouveaux jeux sont ajoutés) : dans Termux, `cd game-plane && git pull`.
Refaites-le **avant** le vol, tant que vous avez internet.

**Pour que Termux ne soit pas endormi par Android** : tirez la notification Termux et appuyez sur
**« Acquire wakelock »**. Pensez aussi à désactiver l'économie de batterie pour Termux dans les
réglages Android.

---

## 3. Dans l'avion : lancer et rejoindre

### L'hôte

1. Activez le **mode avion**, puis **réactivez le Wi-Fi** (le mode avion le coupe).
2. Activez le **point d'accès Wi-Fi** (« partage de connexion » / « hotspot »).
   Donnez-lui un nom et un mot de passe, communiquez-les aux autres.
3. Dans Termux :
   ```
   cd game-plane
   npm start
   ```
4. Le serveur affiche son adresse, par exemple :
   ```
   game-plane prêt sur le port 8080
     → http://192.168.43.1:8080
   ```
   **Communiquez cette adresse aux autres joueurs** (à voix haute, sur un papier, ou…
   en la leur montrant). Si plusieurs adresses sont affichées, essayez la première.
5. Ouvrez vous-même cette adresse dans le navigateur de l'hôte pour jouer aussi.
   Gardez Termux ouvert en arrière-plan : le serveur doit continuer à tourner.

### Les autres joueurs

1. Activez le **mode avion**, puis **réactivez le Wi-Fi**.
2. Connectez-vous au Wi-Fi de l'hôte (nom + mot de passe donnés par l'hôte).
   Votre téléphone dira « pas d'accès à internet » : **c'est normal**, restez connecté
   (sur iPhone, choisissez de **garder** la connexion si on vous le propose).
3. Ouvrez Safari ou Chrome et tapez l'adresse donnée par l'hôte, par exemple
   `http://192.168.43.1:8080`. Écrivez bien `http://` (pas de `https`).
4. Entrez votre **pseudo** (20 lettres maximum) et touchez **Entrer**.

Bonne nouvelle : si votre navigateur se ferme ou se recharge, vous n'avez pas à tout refaire —
voir [Problèmes fréquents](#6-problèmes-fréquents).

> ✈️ Vérifiez que la compagnie autorise le Wi-Fi et le point d'accès en mode avion (c'est le cas
> sur beaucoup de vols, mais pas tous).

---

## 4. Utiliser l'application

### L'écran d'accueil (le « lobby »)

De haut en bas :

- **La liste des joueurs** (pastille verte : en ligne, grise : hors ligne). Touchez un joueur
  pour lui écrire en privé.
- **Parties ouvertes** (encadré bleu, seulement s'il y en a) : les tables en attente de joueurs,
  avec un bouton **Rejoindre**.
- **Parties en cours** : les parties déjà lancées, avec un bouton **👁 Regarder** (voir
  [Regarder une partie](#regarder-une-partie-spectateur)).
- **Nouvelle partie** : la liste des jeux disponibles, avec un bouton **Créer**.
- En haut à droite, le bouton **💬** ouvre le chat (replié à l'arrivée) ; une pastille rouge
  indique les messages non lus.

### Lancer une partie

1. Un joueur touche **Créer** à côté du jeu choisi : une table s'ouvre.
2. Les autres la voient dans **Parties ouvertes** et touchent **Rejoindre**.
3. **Jeux à effectif fixe** (Puissance 4 et Échecs à 2, Belote et Belote contrée à 4) : la partie démarre toute seule
   dès que la table est pleine.
   **Autres jeux** : le créateur de la table (« l'hôte de la table ») voit un bouton
   **Démarrer à N** et lance la partie quand tout le monde est là (la salle d'attente indique
   combien de joueurs manquent encore pour atteindre le minimum).
4. On ne peut être que **sur une table à la fois**.

### Pendant la partie

- Le titre indique **à qui c'est de jouer** ; votre téléphone **vibre** quand c'est à vous
  (sur Android ; l'iPhone ne vibre pas).
- **💬 Chat de la table** : une conversation réservée aux joueurs de la table.
- **Abandonner / Quitter** : à 2 joueurs, abandonner donne la victoire à l'adversaire (à la belote et à la
  belote contrée, c'est l'équipe adverse qui gagne, car on ne peut pas jouer à 3).
  Dans les jeux à plusieurs, vous êtes simplement retiré de la partie qui continue sans vous.
- **Rejouer** : en fin de partie, quand tous les joueurs restants le demandent, une nouvelle
  manche démarre (les couleurs / le premier joueur changent).

### Regarder une partie (spectateur)

Si vous n'êtes assis à aucune table, touchez **👁 Regarder** à côté d'une partie dans
**Parties en cours** pour la suivre en direct, sans y jouer :

- Vous voyez **ce que tout le monde voit** : le plateau, le pli, les scores, les indices, le
  journal… mais **jamais les cartes en main ni les mots secrets** (sinon on pourrait souffler
  les réponses). Aux échecs, les blancs sont en bas ; à la belote, l'équipe 1 est en bas.
- Vous rejoignez le **💬 chat de la table** (lecture et écriture).
- Les joueurs voient qui les regarde (« 👁 Regarde : … ») et le salon affiche le nombre de spectateurs.
- **Arrêter de regarder** vous ramène au salon, sans rien changer à la partie. Vous pouvez aussi
  passer directement à une autre partie, ou créer votre propre table.
- Si la table regardée attend encore des joueurs, un bouton **Prendre une place** permet de s'asseoir.
- Plusieurs spectateurs peuvent regarder la même partie ; on ne regarde qu'une partie à la fois.

### Le chat

Le chat est un panneau qui se déplie par-dessus l'écran (touchez **▾** pour le replier).
Plusieurs conversations (onglets) :

| Onglet | Qui le voit |
|---|---|
| **Général** | Tous les joueurs |
| **🔒 Un pseudo** | Vous et ce joueur uniquement (touchez son nom dans la liste) |
| **Nom du jeu** | Les joueurs de votre table (et ses spectateurs) uniquement |

Pour écrire vite sur un petit clavier, des **messages rapides** sont proposés :
👍 😂 😮 Oui · Non · À toi ! · Prêt ✋.
« *Untel écrit…* » s'affiche pendant qu'un joueur tape. Les 200 derniers messages d'une
conversation sont conservés ; on peut envoyer au plus 8 messages toutes les 5 secondes.

---

## 5. Les jeux et leurs règles

| Jeu | Joueurs | Démarrage |
|---|---|---|
| [Puissance 4](#puissance-4) | 2 | automatique |
| [Échecs](#échecs) | 2 | automatique |
| [Business Class](#business-class-façon-monopoly) | 2 à 6 | par l'hôte de la table |
| [Cherche l'imposteur](#cherche-limposteur) | 3 à 8 | par l'hôte de la table |
| [Président](#président) | 3 à 6 | par l'hôte de la table |
| [8 américain](#8-américain) | 2 à 6 | par l'hôte de la table |
| [Menteur](#menteur) | 3 à 8 | par l'hôte de la table |
| [Belote](#belote) | 4 (2 équipes) | automatique |
| [Belote contrée](#belote-contrée) | 4 (2 équipes) | automatique |

> Aucun jeu n'a de chronomètre : prenez votre temps, ou pressez gentiment vos amis via le chat 😉.

### Puissance 4

Alignez **4 jetons** en ligne, colonne ou diagonale avant votre adversaire.
Touchez une **colonne** pour y lâcher un jeton. Le créateur de la table joue les 🔴 et commence ;
à la revanche, c'est l'autre qui commence. Match nul si la grille est pleine.

### Échecs

Les **règles complètes** : roque, prise en passant, promotion, échec et mat.
- **Jouer un coup** : touchez une pièce (ses cases possibles s'éclairent), puis la case d'arrivée.
  Retouchez la pièce pour la relâcher. Un pion qui arrive au bout propose le choix de la pièce.
- Le roi en échec est entouré de rouge, le dernier coup est surligné, et la liste des coups
  s'affiche sous l'échiquier. L'échiquier est **retourné pour les noirs**.
- **Nulles automatiques** : pat, triple répétition, règle des 50 coups, matériel insuffisant.
  **Nulle par accord** : bouton « Proposer la nulle » ; l'adversaire accepte ou refuse (le coup
  de l'adversaire vaut refus).
- Pas de pendule. À la revanche, les couleurs s'inversent.

### Business Class (façon Monopoly)

On achète des villes du monde, on perçoit des loyers, on construit… et on ruine ses amis.
**Objectif : être le dernier joueur en lice.** Chacun démarre avec **1 500 €**.

- **Votre tour** : lancez les dés, avancez, et appliquez la case. Un **double** vous fait rejouer ;
  **trois doubles de suite** envoient à la **douane**.
- **Case libre** : **Achetez-la**, ou refusez : elle part alors **aux enchères** entre tous
  (chacun mise à son tour ou passe).
- **Case d'un autre joueur** : vous payez un **loyer**, doublé s'il possède **tout le groupe de
  couleur** (et croissant avec les maisons/hôtels). Les 4 **hubs** (aéroports) rapportent de plus
  en plus selon leur nombre ; les 2 **compagnies** coûtent 4× (ou 10×) le total des dés.
- **Décollage** (départ) : **+200 €** à chaque passage.
- **Construire** : avec tout un groupe de couleur, ajoutez des maisons (puis un hôtel),
  **équilibrées** entre les titres du groupe. La banque a 32 maisons et 12 hôtels.
- **Hypothéquer** un titre rapporte la moitié de son prix (le lever coûte 10 % de plus). Interdit
  tant qu'il reste des bâtiments dans le groupe.
- **Douane** : on en sort en payant 50 €, avec une carte « sortie de douane », ou en faisant un double
  (obligatoire à la 3ᵉ tentative).
- **Cartes ❓ Imprévu / 🎁 Cagnotte** : gains, amendes, déplacements, douane…
- **Échanges** : touchez un joueur dans la liste pour lui proposer de l'argent, des titres et/ou des
  cartes. Il accepte ou refuse. (Titres hypothéqués, ou dont le groupe est bâti : non échangeables.)
- **Dette** : si vous devez plus que ce que vous avez, **vendez des bâtiments, hypothéquez ou
  échangez** pour payer. Sinon : **faillite** — vos biens vont à celui à qui vous deviez (ou retournent à la banque).
- **Lire le plateau** : touchez une case pour voir sa fiche (prix, loyers…). Un liseré de couleur
  indique le propriétaire, des pastilles vertes/rouges les maisons/l'hôtel, les pions colorés
  les joueurs.
- Pas de cagnotte au « Salon VIP » (case sans effet).

### Cherche l'imposteur

Un jeu de **déduction** pensé pour le silence : tout se joue avec des indices et le chat.

1. Chacun reçoit un **mot secret** (affiché en haut de l'écran). Les **civils** ont tous le **même
   mot** ; l'**imposteur** en a un **voisin** (par exemple *Chat* / *Chien*) et **ne sait pas qu'il
   est imposteur**.
2. **Indices** : chacun à son tour donne **un seul mot** qui évoque le sien sans le dire
   (dire son propre mot est interdit).
3. **Discussion** dans le chat de la table (il s'ouvre tout seul). Qui a un indice suspect ?
   Quand vous êtes prêt, touchez **« Je suis prêt à voter »**.
4. **Vote secret** : choisissez qui vous soupçonnez (vous pouvez changer d'avis jusqu'au dernier vote).
   Le plus voté est **éliminé** et son rôle est révélé. En cas d'égalité, personne n'est éliminé.
5. On recommence avec les joueurs restants.

**Victoire** : les civils gagnent en démasquant l'imposteur — **mais** celui-ci a une dernière chance :
**deviner le mot des civils** (accents et majuscules ignorés). L'imposteur gagne s'il reste aussi
nombreux que les civils. À partir de 8 joueurs, il y a 2 imposteurs.

### Président

Videz votre main le plus vite possible. **3 manches**, le meilleur total gagne.

- **Force des cartes** (de la plus faible à la plus forte) : 3 4 5 6 7 8 9 10 V D R A **2**.
- Le meneur pose **1 à 4 cartes du même rang**. Les suivants doivent poser **autant de cartes** d'un
  rang **strictement supérieur**, ou **passer** (on est alors écarté du pli).
  Touchez une carte : le bon nombre de cartes du même rang se sélectionne tout seul,
  puis touchez **Jouer**.
- Le dernier à avoir joué **ramasse le pli** (quand tous les autres ont passé) et **entame**.
  Poser des **2** ferme le pli immédiatement (rien ne les bat).
- Le **premier à finir** est **Président**, le dernier est **Trou**. À 4 joueurs et plus, il y a aussi
  Vice-président et Vice-trou.
- **Manche suivante** : le **Trou** donne ses **2 meilleures cartes** au **Président**, qui lui en
  **rend 2 de son choix**. (1 carte entre les « vice » à 4 joueurs et plus.) Le Président entame.
- **Points** d'une manche : le 1ᵉʳ marque (nombre de joueurs − 1), puis un de moins à chaque place,
  0 pour le dernier.

### 8 américain

Soyez le premier à poser toutes vos cartes. **7 cartes** chacun.

- Posez une carte de la **même couleur** ou du **même rang** que celle du dessus de la défausse.
- **Cartes spéciales** :
  - **8** : joker, vous choisissez la couleur demandée (touchez le 8, puis la couleur).
  - **2** : le joueur suivant **pioche 2 cartes**… ou se défend avec un autre 2, et ça s'additionne.
  - **As** : le joueur suivant **passe son tour**.
  - **Valet** : le **sens du jeu s'inverse** (à 2 joueurs, vous rejouez).
- **Pas de carte jouable ?** Touchez **Piocher** (une seule carte) : si elle est jouable, posez-la
  ou passez, sinon votre tour est fini. On ne peut pas piocher quand on a une carte jouable.
- « *Dernière carte !* » s'affiche quand un joueur n'en a plus qu'une.

### Menteur

Soyez le premier à vous débarrasser de toutes vos cartes… **en trichant s'il le faut**.

1. Toutes les cartes sont distribuées. Un **rang à annoncer** est affiché : **As**, puis **2, 3 … Roi**,
   puis on recommence.
2. À votre tour, **posez 1 à 4 cartes face cachée** en annonçant ce rang. **Vous pouvez mentir.**
3. Le joueur suivant peut soit poser à son tour, soit crier **« 🔥 Menteur ! »** : les cartes
   sont retournées pour tout le monde.
   - Si **au moins une carte** n'est pas du rang annoncé : **le menteur ramasse tout le tas**.
   - Sinon, c'est **l'accusateur** qui ramasse (il a accusé à tort).
   - L'accusateur **rejoue en premier**.
4. Si un joueur pose **sa dernière carte**, le suivant doit **trancher** : l'accuser, ou **accepter**
   sa victoire. S'il l'accuse à raison, la partie continue.

Le chat est votre meilleur ami : bluffez, devinez, accusez.

### Belote

La belote **classique** à 4 joueurs, en **2 équipes de 2**. Partie en **501 points**.

**Les équipes** sont décidées par l'ordre d'arrivée à la table : le **1ᵉʳ et le 3ᵉ** sont partenaires,
le **2ᵉ et le 4ᵉ** aussi. Pour choisir vos équipes, rejoignez la table dans le bon ordre. À l'écran,
**vous êtes en bas, votre partenaire en face** ; on joue dans le sens inverse des aiguilles d'une
montre (le joueur suivant est à votre droite). Les scores sont affichés « Nous » / « Eux ».
Le chat de la table est ouvert à tous : convenez de ne pas vous passer d'informations avec votre partenaire 😉.

**1. La prise (les enchères).** Chacun reçoit 5 cartes, et une carte est **retournée**.
- **Tour 1** : chacun son tour peut **prendre à la couleur de la carte retournée** (cette couleur
  devient l'**atout**), ou passer.
- **Tour 2** (si tout le monde a passé) : on peut prendre à **n'importe quelle autre couleur**.
- Si tout le monde repasse : nouvelle donne, un autre joueur distribue.
- Le **preneur** reçoit la carte retournée et 2 cartes ; les autres 3 : **8 cartes chacun**.

**2. Le jeu** : 8 plis. Le joueur à gauche du donneur entame. Touchez une carte pour la sélectionner
(les cartes interdites sont grisées), puis **Jouer la carte**. Le pli est gagné par l'**atout le plus
fort**, sinon par la plus forte carte de la couleur demandée. Le gagnant entame le pli suivant.
- On doit **fournir** la couleur demandée.
- **Atout demandé** : on doit fournir de l'atout et **monter** (jouer plus fort) si on le peut.
- **Sans la couleur demandée** : on doit **couper** (jouer atout) si on en a, et **surcouper** si un
  adversaire a déjà coupé ; si on ne peut pas surcouper, on joue quand même un atout.
  **Exception : si votre partenaire est maître du pli, vous pouvez vous défausser librement.**

**3. Les points** (à l'atout / hors atout) : **Valet 20 / 2** · **9 : 14 / 0** · **As 11** · **10 : 10** ·
**Roi 4** · **Dame 3** · 8 et 7 : 0. Ordre de force à l'atout : V, 9, As, 10, Roi, Dame, 8, 7 ;
hors atout : As, 10, Roi, Dame, Valet, 9, 8, 7. Une donne vaut **162 points** (152 de cartes +
**10 de der** pour le dernier pli).
- **Belote-rebelote** : roi et dame d'atout dans la même main → **+20**, annoncés automatiquement
  quand vous posez la seconde carte. Ces 20 points restent acquis même si le contrat chute.
- **Contrat** : l'équipe qui a pris doit marquer **au moins 82 points** (belote comprise). Sinon elle
  **chute** : elle marque 0 et les adversaires 162.
- **Capot** : une équipe qui fait **les 8 plis** marque **252**.

**4. Les annonces** (déclarées **automatiquement** à votre première carte jouée) :

| Annonce | Points |
|---|---|
| **Tierce** : 3 cartes qui se suivent dans une couleur | 20 |
| **Cinquante** : 4 cartes qui se suivent | 50 |
| **Cent** : 5 cartes qui se suivent ou plus | 100 |
| **Carré** de valets / de 9 | 200 / 150 |
| **Carré** d'as, de 10, de rois ou de dames | 100 |

La suite va de 7, 8, 9, 10, Valet, Dame, Roi à l'As. Un carré de 8 ou de 7 ne compte pas.
- À la déclaration, les autres joueurs voient seulement le **type** (« annonce : tierce ») sur votre siège.
- Après le **premier pli**, la **meilleure annonce de chaque équipe** est comparée : **carré > cent >
  cinquante > tierce**, puis la plus haute carte ; à égalité parfaite, l'**atout** l'emporte, sinon
  le **premier joueur à avoir joué**.
- L'équipe gagnante **marque toutes ses annonces** (celles de ses deux joueurs), dont les cartes sont
  alors **révélées** à tous ; l'autre équipe ne marque aucune annonce.
- Si l'équipe qui marque les annonces est celle du **preneur qui chute**, elles sont **perdues**.

Les enchères chiffrées (contrats, contre, surcontre) existent dans la variante [Belote contrée](#belote-contrée).

### Belote contrée

La **belote coinchée**, en **2 équipes de 2** et **en 1000 points**. Mêmes équipes, même table, même
jeu de la carte (fournir, couper, monter, partenaire maître), mêmes points de cartes, mêmes
**annonces** et même belote-rebelote que la [Belote](#belote) : seuls changent les **enchères** et le **barème**.

**1. Les enchères.** Chacun reçoit **8 cartes** d'emblée (pas de carte retournée). À son tour on peut :
- **Annoncer** un **contrat** et une **couleur d'atout** : **80, 90 … 160** points, ou **Capot**
  (faire tous les plis). Chaque annonce doit être **strictement plus haute** que la précédente.
  On peut ré-enchérir même après avoir passé.
- **Passer.** Les enchères s'arrêtent après **3 passes** qui suivent une annonce : le dernier qui a
  annoncé devient le **preneur**. Si personne n'annonce, nouvelle donne.
- **Contre !** : un joueur de l'**équipe adverse** du dernier annonceur peut **contrer** à son tour
  (les points sont **doublés**). Le preneur peut alors **surcontrer** (×4) ou laisser jouer à ×2.

**2. Le jeu** se déroule comme à la belote classique, avec l'atout choisi par le preneur.

**3. Le barème** (par donne). Les points « réalisés » sont les points de cartes + 10 de der + la belote.
- **Contrat rempli** (l'équipe preneuse réalise au moins la valeur du contrat) : les preneurs
  marquent **la valeur du contrat + leurs points réalisés** ; les défenseurs marquent leurs points.
- **Contrat chuté** : les défenseurs marquent **160 + la valeur du contrat** ; les preneurs 0.
- **Contrat « Capot »** : il faut faire les 8 plis (sinon il chute). Réussi : 250 + 252.
- **Capot non annoncé** : l'équipe qui fait les 8 plis compte 252 points réalisés (+90 de bonus pour les
  défenseurs si les preneurs chutent).
- **Contré / surcontré** : tout ou rien. Le camp qui gagne marque **(160 + valeur du contrat) × 2**
  (× 4 si surcontré), l'autre 0.
- **Belote-rebelote** : +20, jamais multipliés, **acquis même en cas de chute**.
- **Annonces** : ajoutées au score de l'équipe qui les marque, **sans multiplication** ; perdues si c'est
  le preneur qui chute.

La partie s'arrête quand une équipe atteint **1000 points** (la plus haute gagne ; égalité parfaite : on rejoue).

Ce qui n'est **pas** géré : la « générale » (un seul joueur fait tous les plis), le « sans atout » et le
« tout atout ».

---

## 6. Problèmes fréquents

**« La page ne s'ouvre pas ».**
- Vérifiez que vous êtes bien connecté au Wi-Fi **de l'hôte** (pas celui de l'avion).
- Vérifiez l'adresse : `http://` (pas `https://`), le bon numéro, et `:8080` à la fin.
- Demandez à l'hôte si Termux tourne toujours (il doit afficher « game-plane prêt »).
- Essayez une autre adresse si Termux en affiche plusieurs.
- Sur iPhone : si un message propose de quitter un réseau sans internet, choisissez de **rester connecté**.

**« Le serveur ne démarre pas : *Impossible de démarrer* ».** Le port est déjà utilisé (un autre
`npm start` tourne encore). Fermez-le (Termux : `Ctrl + C`), ou lancez sur un autre port :
`PORT=9000 npm start`, puis donnez l'adresse avec `:9000`.

**« Aucune adresse réseau détectée ».** Le point d'accès n'est pas activé. Activez le hotspot,
puis relancez `npm start`.

**« J'ai verrouillé mon téléphone / changé d'application / le navigateur s'est rechargé ».**
Revenez sur la page : elle **se reconnecte toute seule** (statut « Reconnexion… » puis
« Connecté ») et vous retrouvez votre place et votre partie en cours. Si la page a été fermée,
rouvrez l'adresse **avec le même navigateur** : votre pseudo est mémorisé, vous êtes reconnecté
automatiquement (si le navigateur a effacé ses données, vous reviendrez comme un nouveau joueur).
Un joueur déconnecté garde sa place **5 minutes**, ensuite il est retiré de la partie.

**« La partie est bloquée, on attend quelqu'un ».** Il n'y a pas de chronomètre. Le plus souvent
le joueur a verrouillé son téléphone : demandez-lui de le rouvrir (chat, voix ou geste). Au-delà
de 5 minutes hors ligne, il est retiré et la partie continue.

**« Le chat masque mon jeu ».** Touchez **▾** pour le replier ; le bouton **💬** en haut à droite
le rouvre. Il se replie tout seul au début d'une partie.

**« Je ne vois pas mon tour / les boutons n'apparaissent pas ».** Ce n'est probablement pas
votre tour : le titre indique qui joue.

**« Le Wi-Fi de l'hôte a disparu ».** Certains téléphones coupent le hotspot après un moment sans
appareil connecté ou économisent la batterie : désactivez l'extinction automatique du hotspot et
branchez l'hôte si possible.

---

## 7. Limites à connaître

- **Tout est gardé en mémoire dans le téléphone de l'hôte** : si le serveur est arrêté ou
  Termux fermé, **toutes les parties et le chat repartent de zéro**.
- **Si l'hôte quitte la session** (batterie, hotspot coupé), plus personne ne peut jouer.
- **Pas de chronomètre** dans les jeux.
- **Pas de comptes ni de scores durables** : un pseudo par session.
- Un seul « salon » (30 tables ouvertes au maximum), tous les joueurs voient les mêmes tables.
- Pas de chiffrement (`http`) : le jeu reste sur le réseau local de l'hôte, mais ne partagez
  pas de secrets dans le chat.
- Les **iPhone ne vibrent pas** quand c'est leur tour.
- Le **Wi-Fi de l'avion n'est pas utilisé** ; seul compte le point d'accès de l'hôte.

---

## 8. Pour les curieux (développement)

- **Stack** : Node ≥ 18 **sans aucune dépendance npm** (rien à installer hors ligne),
  WebSocket écrit à la main, client en JavaScript pur. Seule bibliothèque tierce :
  `chess.js`, copiée dans `server/vendor/`.
- **Lancer sur un ordinateur** : `npm start`, puis ouvrir l'adresse affichée (ou `http://localhost:8080`).
- **Tests** : `npm test` (plus de 200 tests : règles de chaque jeu, secret des mains,
  centaines de parties aléatoires, WebSocket).
- **Ajouter un jeu** : un fichier moteur dans `server/games/` (logique pure), un fichier
  d'affichage dans `public/games/`, et l'enregistrer dans `server/games/index.js` et
  `public/index.html` — le salon, les tables, le chat et la reconnexion sont déjà gérés.
  Détails et conventions : `CONTEXT.md`.

### Documentation du projet

- `CONTEXT.md` — reprise rapide (état, stack, architecture, conventions)
- `project.md` — journal chronologique des décisions techniques et de leur « pourquoi »
- `CLAUDE.md` — règles de travail du dépôt
