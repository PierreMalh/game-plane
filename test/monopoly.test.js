'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const g = require('../server/games/monopoly');
const B = require('../public/games/monopoly-board');
const { CHANCE, CHEST } = require('../server/games/monopoly/cards');

// ---- outils -----------------------------------------------------------------

// Générateur « dés scriptés » : chaque valeur est un dé (1..6) ; échoue s'il est épuisé.
function dice(...vals) {
  let i = 0;
  return () => {
    if (i >= vals.length) throw new Error('dés épuisés');
    return (vals[i++] - 1) / 6 + 0.01;
  };
}
// Partie de n joueurs, paquets non mélangés (ordre des cartes = ordre du fichier).
const game = (n = 3, ...rolls) => g.init(Array(n).fill('x'), { rng: dice(...rolls), shuffle: false });
const act = (st, who, a) => g.action(st, who, a);
const must = (res, msg) => assert.equal(res.ok, true, `${msg ?? ''} refusé : ${res.error}`);
const own = (st, idx, ...sqs) => sqs.forEach((q) => { st.props[q].owner = idx; });
const at = (name) => B.indexByName(name);

// ---- initialisation -----------------------------------------------------------

test('départ : 1500 chacun, 28 titres libres, vue sérialisable sans le générateur ni les paquets', () => {
  const st = game(3);
  assert.deepEqual(st.players.map((p) => p.cash), [1500, 1500, 1500]);
  assert.equal(Object.keys(st.props).length, 28);
  assert.equal(Object.values(st.props).every((p) => p.owner === null), true);
  assert.deepEqual(st.bank, { houses: 32, hotels: 12 });
  const json = JSON.stringify(g.view(st, 0));
  assert.equal(json.includes('rng'), false);
  assert.equal(json.includes('decks'), false);
});

test('le premier joueur peut varier (revanche) et boucle sur le nombre de joueurs', () => {
  assert.equal(g.init(['a', 'b', 'c'], { first: 2 }).turn, 2);
  assert.equal(g.init(['a', 'b', 'c'], { first: 5 }).turn, 2);
  assert.equal(g.nextFirst(null, 1), 2);
});

test('mélange des paquets : 16 cartes distinctes par paquet, tout le monde sort avant de rejouer', () => {
  const st = g.init(['a', 'b'], { rng: () => 0.3 });
  assert.equal(new Set(st.decks.chance.order).size, CHANCE.length);
  assert.equal(new Set(st.decks.chest.order).size, CHEST.length);
});

// ---- déplacement, achat -----------------------------------------------------------

test('lancer, arriver sur un titre libre, acheter, finir son tour', () => {
  const st = game(3, 1, 2);
  must(act(st, 0, { type: 'roll' }));
  assert.equal(st.players[0].pos, 3);
  assert.equal(st.phase, 'buy');
  assert.equal(st.buying, 3);
  must(act(st, 0, { type: 'buy' }));
  assert.equal(st.players[0].cash, 1440);
  assert.equal(st.props[3].owner, 0);
  assert.equal(st.phase, 'after');
  must(act(st, 0, { type: 'end-turn' }));
  assert.equal(st.turn, 1);
  assert.equal(st.phase, 'roll');
});

test('refus : mauvais tour, double lancer, acheter hors phase', () => {
  const st = game(3, 1, 2);
  assert.equal(act(st, 1, { type: 'roll' }).error, 'not-your-turn');
  assert.equal(act(st, 0, { type: 'buy' }).error, 'not-your-turn');
  must(act(st, 0, { type: 'roll' }));
  assert.equal(act(st, 0, { type: 'roll' }).error, 'not-your-turn'); // phase buy
  assert.equal(act(st, 1, { type: 'buy' }).error, 'not-your-turn');
  assert.equal(act(st, 0, { type: 'nope' }).error, 'bad-action');
  assert.equal(act(st, 0, null).error, 'bad-action');
});

test('passer par le Décollage rapporte 200', () => {
  const st = game(2, 1, 2);
  st.players[0].pos = 38;
  must(act(st, 0, { type: 'roll' }));
  assert.equal(st.players[0].pos, 1);
  assert.equal(st.players[0].cash, 1700);
});

test('pas assez d’argent : seul « refuser » reste proposé', () => {
  const st = game(2, 1, 2);
  st.players[0].cash = 10;
  must(act(st, 0, { type: 'roll' }));
  assert.deepEqual(g.view(st, 0).hints.actions, ['decline']);
  assert.equal(act(st, 0, { type: 'buy' }).error, 'no-cash');
});

test('taxe payée à la banque', () => {
  const st = game(2, 1, 3);
  must(act(st, 0, { type: 'roll' }));
  assert.equal(st.players[0].pos, 4);
  assert.equal(st.players[0].cash, 1300);
  assert.equal(st.phase, 'after');
});

test('un double fait rejouer ; trois doubles de suite = douane', () => {
  const st = game(2, 3, 3, 4, 4, 5, 5);
  own(st, 0, 6, 14); // cases possédées : pas d'achat à gérer
  must(act(st, 0, { type: 'roll' }));
  assert.equal(st.phase, 'roll');
  assert.equal(st.turn, 0);
  must(act(st, 0, { type: 'roll' }));
  assert.equal(st.players[0].pos, 14);
  assert.equal(st.phase, 'roll');
  must(act(st, 0, { type: 'roll' })); // 3e double
  assert.equal(st.players[0].pos, 10);
  assert.ok(st.players[0].jail);
  assert.equal(st.phase, 'after');
  assert.equal(st.rollAgain, false);
});

test('un double qui mène à « fouille douanière » envoie en douane sans rejouer', () => {
  const st = game(2, 1, 1);
  st.players[0].pos = 28;
  must(act(st, 0, { type: 'roll' }));
  assert.equal(st.players[0].pos, 10);
  assert.ok(st.players[0].jail);
  assert.equal(st.phase, 'after');
  must(act(st, 0, { type: 'end-turn' }));
  assert.equal(st.turn, 1);
});

// ---- enchères ----------------------------------------------------------------------

test('refuser lance des enchères : le refuseur enchérit en dernier, le plus offrant gagne', () => {
  const st = game(3, 1, 2);
  must(act(st, 0, { type: 'roll' }));
  must(act(st, 0, { type: 'decline' }));
  assert.equal(st.phase, 'auction');
  assert.deepEqual(st.auction.order, [1, 2, 0]);
  assert.equal(act(st, 0, { type: 'bid', amount: 5 }).error, 'not-your-turn');
  must(act(st, 1, { type: 'bid', amount: 50 }));
  assert.equal(act(st, 2, { type: 'bid', amount: 50 }).error, 'bid-too-low');
  assert.equal(act(st, 2, { type: 'bid', amount: 9999 }).error, 'no-cash');
  must(act(st, 2, { type: 'pass' }));
  must(act(st, 0, { type: 'pass' }));
  assert.equal(st.phase, 'after');
  assert.equal(st.props[3].owner, 1);
  assert.equal(st.players[1].cash, 1450);
  assert.equal(st.turn, 0);
});

test('enchères : personne n’enchérit → le titre reste à la banque', () => {
  const st = game(3, 1, 2);
  must(act(st, 0, { type: 'roll' }));
  must(act(st, 0, { type: 'decline' }));
  must(act(st, 1, { type: 'pass' }));
  must(act(st, 2, { type: 'pass' }));
  assert.equal(st.phase, 'auction'); // le dernier restant peut encore prendre pour 1
  assert.deepEqual(g.view(st, 0).hints.actions, ['bid', 'pass']);
  must(act(st, 0, { type: 'pass' }));
  assert.equal(st.props[3].owner, null);
  assert.equal(st.phase, 'after');
});

test('enchères : le dernier restant seul peut emporter le titre pour 1', () => {
  const st = game(2, 1, 2);
  must(act(st, 0, { type: 'roll' }));
  must(act(st, 0, { type: 'decline' }));
  must(act(st, 1, { type: 'pass' }));
  must(act(st, 0, { type: 'bid', amount: 1 }));
  assert.equal(st.props[3].owner, 0);
  assert.equal(st.players[0].cash, 1499);
});

// ---- loyers -------------------------------------------------------------------------

test('loyer simple, doublé sur un groupe complet nu, puis selon les maisons', () => {
  const st = game(2);
  own(st, 1, 1);
  assert.equal(g.rentFor(st, 1), 2);
  own(st, 1, 3);
  assert.equal(g.rentFor(st, 1), 4); // groupe marron complet : double
  st.props[1].houses = 2;
  assert.equal(g.rentFor(st, 1), 30);
  st.props[1].houses = 5;
  assert.equal(g.rentFor(st, 1), 250);
});

test('loyer des hubs selon le nombre possédé', () => {
  const st = game(2);
  own(st, 1, 5);
  assert.equal(g.rentFor(st, 5), 25);
  own(st, 1, 15);
  assert.equal(g.rentFor(st, 5), 50);
  own(st, 1, 25, 35);
  assert.equal(g.rentFor(st, 5), 200);
});

test('loyer des compagnies : 4 × dés, 10 × avec les deux', () => {
  const st = game(2);
  st.dice = [3, 4];
  own(st, 1, 12);
  assert.equal(g.rentFor(st, 12), 28);
  own(st, 1, 28);
  assert.equal(g.rentFor(st, 12), 70);
});

test('tomber chez un joueur : il est payé ; propriétaire / hypothéqué : rien', () => {
  const st = game(2, 1, 2, 1, 2, 1, 2);
  own(st, 1, 3);
  must(act(st, 0, { type: 'roll' }));
  assert.equal(st.players[0].cash, 1500 - 4 + 0 - 0); // loyer 4 (terrain nu isolé : 4)
  assert.equal(st.players[1].cash, 1504);
  assert.equal(st.phase, 'after');

  const st2 = game(2, 1, 2);
  own(st2, 1, 3);
  st2.props[3].mortgaged = true;
  must(act(st2, 0, { type: 'roll' }));
  assert.equal(st2.players[0].cash, 1500);

  const st3 = game(2, 1, 2);
  own(st3, 0, 3);
  must(act(st3, 0, { type: 'roll' }));
  assert.equal(st3.players[0].cash, 1500);
  assert.equal(st3.phase, 'after');
});

// ---- douane -----------------------------------------------------------------------------

test('douane : payer, utiliser la carte, doubles, 3e échec = amende obligatoire puis avance', () => {
  // payer 50
  const a = game(2, 1, 2);
  a.players[0].jail = { turns: 0 };
  a.players[0].pos = 10;
  assert.deepEqual(g.view(a, 0).hints.actions, ['roll', 'pay-jail']);
  must(act(a, 0, { type: 'pay-jail' }));
  assert.equal(a.players[0].cash, 1450);
  assert.equal(a.players[0].jail, null);
  must(act(a, 0, { type: 'roll' }));
  assert.equal(a.players[0].pos, 13);

  // carte
  const b = game(2);
  b.players[0].jail = { turns: 0 };
  b.players[0].cards = [{ deck: 'chest', id: 'c5' }];
  assert.ok(g.view(b, 0).hints.actions.includes('use-card'));
  must(act(b, 0, { type: 'use-card' }));
  assert.equal(b.players[0].jail, null);
  assert.equal(b.decks.chest.order.at(-1), 'c5'); // la carte retourne sous le paquet

  // double : libéré, avance, pas de rejeu
  const c = game(2, 2, 2);
  c.players[0].jail = { turns: 0 };
  c.players[0].pos = 10;
  own(c, 0, 14);
  must(act(c, 0, { type: 'roll' }));
  assert.equal(c.players[0].jail, null);
  assert.equal(c.players[0].pos, 14);
  assert.equal(c.phase, 'after');

  // échecs successifs
  const d = game(2, 1, 2, 1, 2, 1, 2);
  d.players[0].jail = { turns: 0 };
  d.players[0].pos = 10;
  own(d, 0, 13);
  must(act(d, 0, { type: 'roll' }));
  assert.ok(d.players[0].jail);
  assert.equal(d.phase, 'after');
  must(act(d, 0, { type: 'end-turn' }));
  d.turn = 0; d.phase = 'roll';
  must(act(d, 0, { type: 'roll' }));
  d.turn = 0; d.phase = 'roll';
  must(act(d, 0, { type: 'roll' })); // 3e : amende + avance de 3
  assert.equal(d.players[0].jail, null);
  assert.equal(d.players[0].cash, 1450);
  assert.equal(d.players[0].pos, 13);
});

test('douane : amende obligatoire sans argent → dette, puis déplacement une fois réglée', () => {
  const st = game(2, 1, 2);
  st.players[0].jail = { turns: 2 };
  st.players[0].pos = 10;
  st.players[0].cash = 20;
  own(st, 0, 1, 13);
  must(act(st, 0, { type: 'roll' }));
  assert.equal(st.phase, 'debt');
  assert.deepEqual(g.view(st, 0).hints.mortgage.sort(), [1, 13]);
  must(act(st, 0, { type: 'mortgage', sq: 1 })); // +30 → 50 : la dette est réglée
  assert.equal(st.phase, 'after');
  assert.equal(st.players[0].pos, 13);
  assert.equal(st.players[0].cash, 0);
});

// ---- cartes --------------------------------------------------------------------------------

// Place le joueur 0 sur une case Imprévu / Cagnotte avec la carte voulue en tête de paquet.
function withCard(st, deck, id, from, ...dice) {
  st.decks[deck].order = [id, ...st.decks[deck].order.filter((x) => x !== id)];
  st.players[0].pos = from;
  st.rng = (() => { let i = 0; return () => { if (i >= dice.length) throw new Error('dés épuisés'); return (dice[i++] - 1) / 6 + 0.01; }; })();
}

test('cartes d’argent, de déplacement et de recul', () => {
  const a = game(2);
  withCard(a, 'chance', 'i9', 3, 1, 3); // +50
  must(act(a, 0, { type: 'roll' }));
  assert.equal(a.players[0].cash, 1550);

  const b = game(2);
  withCard(b, 'chance', 'i12', 3, 1, 3); // recule de 3 : 7 → 4 (taxe 200)
  must(act(b, 0, { type: 'roll' }));
  assert.equal(b.players[0].pos, 4);
  assert.equal(b.players[0].cash, 1300);

  const c = game(2);
  withCard(c, 'chance', 'i1', 19, 1, 2); // avance au Décollage : 22 → 0, touche 200
  must(act(c, 0, { type: 'roll' }));
  assert.equal(c.players[0].pos, 0);
  assert.equal(c.players[0].cash, 1700);

  const d = game(2);
  withCard(d, 'chance', 'i2', 3, 1, 3); // Dubaï (34), sans repasser par le départ
  must(act(d, 0, { type: 'roll' }));
  assert.equal(d.players[0].pos, 34);
  assert.equal(d.players[0].cash, 1500);
  assert.equal(d.phase, 'buy');
});

test('carte « hub le plus proche » : double loyer ; « compagnie la plus proche » : 10 × nouveau jet', () => {
  const a = game(2);
  own(a, 1, 15);
  withCard(a, 'chance', 'i6', 3, 1, 3);
  must(act(a, 0, { type: 'roll' }));
  assert.equal(a.players[0].pos, 15);
  assert.equal(a.players[0].cash, 1450); // 25 × 2
  assert.equal(a.players[1].cash, 1550);

  const b = game(2);
  own(b, 1, 12);
  withCard(b, 'chance', 'i8', 3, 1, 3, 2, 5); // 1+3 pour aller en 7, puis 2+5 pour la compagnie
  must(act(b, 0, { type: 'roll' }));
  assert.equal(b.players[0].pos, 12);
  assert.equal(b.players[0].cash, 1500 - 70);
});

test('carte douane, carte « sortie de douane » conservée, réparations', () => {
  const a = game(2);
  withCard(a, 'chance', 'i13', 3, 1, 3);
  must(act(a, 0, { type: 'roll' }));
  assert.equal(a.players[0].pos, 10);
  assert.ok(a.players[0].jail);

  const b = game(2);
  withCard(b, 'chance', 'i14', 3, 1, 3);
  must(act(b, 0, { type: 'roll' }));
  assert.deepEqual(b.players[0].cards, [{ deck: 'chance', id: 'i14' }]);
  assert.equal(b.decks.chance.order.includes('i14'), false); // sortie du paquet tant qu'elle est tenue
  assert.equal(b.phase, 'after');

  const c = game(2);
  own(c, 0, 1, 3);
  c.props[1].houses = 3; // 3 maisons
  c.props[3].houses = 5; // 1 hôtel
  withCard(c, 'chance', 'i15', 3, 1, 3);
  must(act(c, 0, { type: 'roll' }));
  assert.equal(c.players[0].cash, 1500 - (3 * 25 + 100));
});

test('cartes « payer chacun » / « chacun te paie »', () => {
  const a = game(3);
  withCard(a, 'chance', 'i16', 3, 1, 3);
  must(act(a, 0, { type: 'roll' }));
  assert.deepEqual(a.players.map((p) => p.cash), [1400, 1550, 1550]);

  const b = game(3);
  withCard(b, 'chest', 'c8', 0, 1, 1); // 0 + 2 = case Cagnotte (double)
  must(act(b, 0, { type: 'roll' }));
  assert.deepEqual(b.players.map((p) => p.cash), [1520, 1490, 1490]);
});

test('« chacun te paie » : un joueur à sec doit d’abord régler sa dette', () => {
  const st = game(3);
  withCard(st, 'chest', 'c8', 0, 1, 1);
  st.players[2].cash = 5;
  own(st, 2, 1);
  must(act(st, 0, { type: 'roll' }));
  assert.equal(st.phase, 'debt');
  assert.equal(g.view(st, 2).hints.actions.includes('bankrupt'), true);
  assert.equal(g.view(st, 0).hints.actions.length, 0); // le joueur du tour attend
  must(act(st, 2, { type: 'mortgage', sq: 1 })); // +30 → peut payer 10
  assert.equal(st.phase, 'roll'); // c'était un double : on rejoue
  assert.equal(st.players[0].cash, 1520);
});

// ---- constructions -----------------------------------------------------------------------------

test('construire : groupe complet, règle d’équilibre, argent, stock de la banque', () => {
  const st = game(2);
  assert.equal(act(st, 0, { type: 'build', sq: 1 }).error, 'not-owner');
  own(st, 0, 1);
  assert.equal(act(st, 0, { type: 'build', sq: 1 }).error, 'no-monopoly');
  own(st, 0, 3);
  must(act(st, 0, { type: 'build', sq: 1 }));
  assert.equal(st.props[1].houses, 1);
  assert.equal(st.players[0].cash, 1450);
  assert.equal(st.bank.houses, 31);
  assert.equal(act(st, 0, { type: 'build', sq: 1 }).error, 'uneven');
  must(act(st, 0, { type: 'build', sq: 3 }));
  for (let i = 0; i < 3; i++) { must(act(st, 0, { type: 'build', sq: 1 })); must(act(st, 0, { type: 'build', sq: 3 })); }
  assert.equal(st.props[1].houses, 4);
  must(act(st, 0, { type: 'build', sq: 1 })); // hôtel : 4 maisons rendues
  assert.equal(st.props[1].houses, 5);
  assert.equal(st.bank.hotels, 11);
  assert.equal(act(st, 0, { type: 'build', sq: 1 }).error, 'max-built');
});

test('construire : refus sans stock, hors tour, en phase d’achat, terrain non constructible', () => {
  const st = game(2);
  own(st, 0, 1, 3);
  st.bank.houses = 0;
  assert.equal(act(st, 0, { type: 'build', sq: 1 }).error, 'no-supply');
  st.bank.houses = 32;
  assert.equal(act(st, 1, { type: 'build', sq: 1 }).error, 'not-your-turn');
  assert.equal(act(st, 0, { type: 'build', sq: 5 }).error, 'not-buildable');
  assert.equal(act(st, 0, { type: 'build', sq: 'x' }).error, 'not-buildable');
  assert.equal(act(st, 0, { type: 'build', sq: 999 }).error, 'not-buildable');
  st.phase = 'buy'; st.buying = 6;
  assert.equal(act(st, 0, { type: 'build', sq: 1 }).error, 'not-your-turn');
});

test('revendre : moitié du prix, règle d’équilibre inverse, hôtel → 4 maisons', () => {
  const st = game(2);
  own(st, 0, 1, 3);
  st.props[1].houses = 2; st.props[3].houses = 1;
  assert.equal(act(st, 0, { type: 'sell-house', sq: 3 }).error, 'uneven'); // on revend d'abord du plus bâti
  must(act(st, 0, { type: 'sell-house', sq: 1 }));
  assert.equal(st.players[0].cash, 1525);
  must(act(st, 0, { type: 'sell-house', sq: 3 }));
  assert.equal(st.players[0].cash, 1550);
  assert.equal(act(st, 0, { type: 'sell-house', sq: 3 }).error, 'no-buildings');
  st.props[1].houses = 5; st.props[3].houses = 5;
  st.bank.houses = 3;
  assert.equal(act(st, 0, { type: 'sell-house', sq: 1 }).error, 'no-supply');
  st.bank.houses = 4;
  must(act(st, 0, { type: 'sell-house', sq: 1 }));
  assert.equal(st.props[1].houses, 4);
  assert.equal(st.bank.hotels, 13);
  assert.equal(st.bank.houses, 0);
});

test('hypothèque : valeur, interdite avec bâtiments, levée avec 10 % d’intérêt', () => {
  const st = game(2);
  own(st, 0, 1, 3);
  st.props[3].houses = 1;
  assert.equal(act(st, 0, { type: 'mortgage', sq: 1 }).error, 'has-buildings'); // groupe bâti
  st.props[3].houses = 0;
  must(act(st, 0, { type: 'mortgage', sq: 1 }));
  assert.equal(st.players[0].cash, 1530);
  assert.equal(act(st, 0, { type: 'mortgage', sq: 1 }).error, 'already-mortgaged');
  assert.equal(act(st, 0, { type: 'build', sq: 3 }).error, 'mortgaged');
  assert.equal(g.unmortgageCost(1), 33);
  must(act(st, 0, { type: 'unmortgage', sq: 1 }));
  assert.equal(st.players[0].cash, 1497);
  assert.equal(act(st, 0, { type: 'unmortgage', sq: 1 }).error, 'not-mortgaged');
  assert.equal(act(st, 0, { type: 'mortgage', sq: 6 }).error, 'not-owner');
});

// ---- dettes et faillite --------------------------------------------------------------------------

function debtGame(n = 3) {
  const st = game(n, 1, 2);
  own(st, 1, 3);
  st.props[3].houses = 5; // loyer énorme : 450 (groupe marron incomplet mais hôtel posé directement)
  st.players[0].cash = 100;
  return st;
}

test('dette : on peut vendre / hypothéquer, jamais finir son tour', () => {
  const st = debtGame();
  own(st, 0, 5); // un hub hypothécable
  must(act(st, 0, { type: 'roll' }));
  assert.equal(st.phase, 'debt');
  assert.deepEqual(st.debt.queue, [{ from: 0, to: 1, amount: 450 }]);
  assert.equal(act(st, 0, { type: 'end-turn' }).error, 'not-your-turn');
  assert.equal(act(st, 0, { type: 'build', sq: 1 }).error, 'not-your-turn'); // construire : interdit en dette
  must(act(st, 0, { type: 'mortgage', sq: 5 })); // 100 + 100 = 200 : toujours insuffisant
  assert.equal(st.phase, 'debt');
});

test('faillite envers un joueur : tous les biens lui reviennent, le tour passe', () => {
  const st = debtGame();
  own(st, 0, 5);
  st.players[0].cards = [{ deck: 'chest', id: 'c5' }];
  must(act(st, 0, { type: 'roll' }));
  assert.deepEqual(g.view(st, 0).hints.actions, ['bankrupt']);
  must(act(st, 0, { type: 'bankrupt' }));
  assert.equal(st.players[0].bankrupt, true);
  assert.equal(st.props[5].owner, 1);
  assert.equal(st.players[1].cash, 1600);
  assert.equal(st.players[1].cards.length, 1);
  assert.equal(st.turn, 1);
  assert.equal(st.phase, 'roll');
  assert.equal(st.winner, null);
  assert.equal(act(st, 0, { type: 'roll' }).error, 'eliminated');
});

test('faillite envers la banque : titres libérés, bâtiments rendus', () => {
  const st = game(3, 1, 3);
  own(st, 0, 1, 3);
  st.props[1].houses = 3;
  st.bank.houses = 29;
  st.players[0].cash = 10;
  must(act(st, 0, { type: 'roll' })); // taxe 200
  assert.equal(st.phase, 'debt');
  must(act(st, 0, { type: 'bankrupt' }));
  assert.equal(st.props[1].owner, null);
  assert.equal(st.props[1].houses, 0);
  assert.equal(st.bank.houses, 32);
});

test('dernier joueur en lice = vainqueur ; plus aucune action ensuite', () => {
  const st = debtGame(2);
  must(act(st, 0, { type: 'roll' }));
  must(act(st, 0, { type: 'bankrupt' }));
  assert.equal(st.winner, 1);
  assert.equal(st.phase, 'over');
  assert.equal(g.isOver(st), true);
  assert.equal(act(st, 1, { type: 'roll' }).error, 'over');
  assert.doesNotThrow(() => JSON.stringify(g.view(st, 1)));
});

// ---- échanges ------------------------------------------------------------------------------------------

test('échange : proposition, acceptation, transfert de titres, d’argent et de cartes', () => {
  const st = game(3);
  own(st, 0, 6);
  own(st, 1, 8);
  st.players[1].cards = [{ deck: 'chance', id: 'i14' }];
  must(act(st, 0, { type: 'trade-propose', to: 1, give: { props: [6], cash: 100 }, get: { props: [8], cards: 1 } }));
  assert.equal(act(st, 2, { type: 'trade-accept' }).error, 'no-trade'); // pas le destinataire
  assert.equal(act(st, 0, { type: 'trade-accept' }).error, 'no-trade');
  must(act(st, 1, { type: 'trade-accept' }));
  assert.equal(st.props[6].owner, 1);
  assert.equal(st.props[8].owner, 0);
  assert.equal(st.players[0].cash, 1400);
  assert.equal(st.players[1].cash, 1600);
  assert.equal(st.players[0].cards.length, 1);
  assert.equal(st.players[1].cards.length, 0);
  assert.equal(st.trade, null);
});

test('échange : refuser, annuler, une seule proposition à la fois', () => {
  const st = game(3);
  own(st, 0, 6);
  must(act(st, 0, { type: 'trade-propose', to: 1, give: { props: [6] }, get: {} }));
  assert.equal(act(st, 2, { type: 'trade-propose', to: 0, give: { cash: 1 }, get: {} }).error, 'trade-pending');
  must(act(st, 1, { type: 'trade-decline' }));
  assert.equal(st.trade, null);
  must(act(st, 0, { type: 'trade-propose', to: 1, give: { props: [6] }, get: {} }));
  assert.equal(act(st, 1, { type: 'trade-cancel' }).error, 'no-trade');
  must(act(st, 0, { type: 'trade-cancel' }));
  assert.equal(st.trade, null);
});

test('échange : validations (propriété, hypothèque, bâtiments, argent, vide, destinataire)', () => {
  const st = game(3);
  own(st, 0, 1, 3, 6);
  const propose = (give, get, to = 1) => act(st, 0, { type: 'trade-propose', to, give, get });
  assert.equal(propose({ props: [8] }, {}).error, 'not-owner');
  assert.equal(propose({ cash: 99999 }, {}).error, 'not-enough');
  assert.equal(propose({ cards: 1 }, {}).error, 'not-enough');
  assert.equal(propose({}, {}).error, 'empty-trade');
  assert.equal(propose({ cash: 1 }, {}, 0).error, 'bad-trade'); // soi-même
  assert.equal(propose({ cash: 1 }, {}, 9).error, 'bad-trade');
  assert.equal(propose({ cash: 1 }, {}, '1').error, 'bad-trade');
  st.props[6].mortgaged = true;
  assert.equal(propose({ props: [6] }, {}).error, 'mortgaged');
  st.props[1].houses = 1;
  assert.equal(propose({ props: [3] }, {}).error, 'has-buildings'); // un voisin du groupe est bâti
  assert.equal(st.trade, null);
});

test('échange : les biens sont revérifiés à l’acceptation', () => {
  const st = game(2);
  own(st, 0, 6);
  must(act(st, 0, { type: 'trade-propose', to: 1, give: { props: [6] }, get: {} }));
  st.props[6].mortgaged = true; // entre-temps
  assert.equal(act(st, 1, { type: 'trade-accept' }).error, 'mortgaged');
  assert.equal(st.trade, null);
  assert.equal(st.props[6].owner, 0);
});

test('échange pendant une dette : l’argent reçu règle la dette', () => {
  const st = debtGame(2);
  own(st, 0, 5);
  must(act(st, 0, { type: 'roll' }));
  assert.equal(st.phase, 'debt');
  must(act(st, 0, { type: 'trade-propose', to: 1, give: { props: [5] }, get: { cash: 400 } }));
  must(act(st, 1, { type: 'trade-accept' }));
  // 100 + 400 = 500 ≥ 450 → réglée
  assert.equal(st.phase, 'after');
  assert.equal(st.players[0].cash, 50);
});

// ---- départ d'un joueur -------------------------------------------------------------------------------------

test('départ : joueur hors tour, du tour, en achat, en enchères, en dette, avant-dernier', () => {
  // hors tour
  let st = game(3);
  g.onLeave(st, 2);
  assert.equal(st.players[2].bankrupt, true);
  assert.equal(st.turn, 0);

  // du tour
  st = game(3);
  g.onLeave(st, 0);
  assert.equal(st.turn, 1);
  assert.equal(st.phase, 'roll');

  // en achat
  st = game(3, 1, 2);
  must(act(st, 0, { type: 'roll' }));
  g.onLeave(st, 0);
  assert.equal(st.turn, 1);
  assert.equal(st.phase, 'roll');
  assert.equal(st.buying, null);

  // en enchères (un enchérisseur part, ça continue ; le refuseur part, ça s'arrête)
  st = game(3, 1, 2);
  must(act(st, 0, { type: 'roll' }));
  must(act(st, 0, { type: 'decline' }));
  g.onLeave(st, 1);
  assert.deepEqual(st.auction.order, [2, 0]);
  must(act(st, 2, { type: 'bid', amount: 20 }));
  g.onLeave(st, 0);
  assert.equal(st.auction, null);

  // en dette (le débiteur part)
  st = debtGame(3);
  must(act(st, 0, { type: 'roll' }));
  g.onLeave(st, 0);
  assert.equal(st.turn, 1);
  assert.equal(st.debt, null);

  // en dette (le créancier part : la dette disparaît)
  st = debtGame(3);
  must(act(st, 0, { type: 'roll' }));
  g.onLeave(st, 1);
  assert.equal(st.phase, 'after');

  // avant-dernier joueur : l'autre gagne
  st = game(2);
  g.onLeave(st, 1);
  assert.equal(st.winner, 0);
  assert.doesNotThrow(() => JSON.stringify(g.view(st, 0)));
});

test('départ : les titres retournent à la banque, les cartes aux paquets, l’échange en cours saute', () => {
  const st = game(3);
  own(st, 2, 6);
  st.props[6].mortgaged = true;
  st.players[2].cards = [{ deck: 'chance', id: 'i14' }];
  own(st, 0, 8);
  must(act(st, 0, { type: 'trade-propose', to: 2, give: { props: [8] }, get: {} }));
  g.onLeave(st, 2);
  assert.equal(st.props[6].owner, null);
  assert.equal(st.props[6].mortgaged, false);
  assert.equal(st.decks.chance.order.includes('i14'), true);
  assert.equal(st.trade, null);
});

// ---- vue et aides ---------------------------------------------------------------------------------------------

test('aides : seul le joueur concerné reçoit des actions', () => {
  const st = game(3, 1, 2);
  assert.deepEqual(g.view(st, 0).hints.actions, ['roll']);
  assert.deepEqual(g.view(st, 1).hints.actions, []);
  must(act(st, 0, { type: 'roll' }));
  const h = g.view(st, 0).hints;
  assert.deepEqual(h.actions, ['buy', 'decline']);
  assert.equal(h.buyPrice, 60);
  must(act(st, 0, { type: 'decline' }));
  assert.deepEqual(g.view(st, 1).hints.actions, ['bid', 'pass']);
  assert.deepEqual(g.view(st, 1).hints.bid, { min: 1, max: 1500 });
  assert.deepEqual(g.view(st, 0).hints.actions, []);
  assert.equal(g.view(st, 1).auction.turn, 1);
});

test('aides : constructions possibles listées', () => {
  const st = game(2);
  own(st, 0, 1, 3);
  assert.deepEqual(g.view(st, 0).hints.build, [1, 3]);
  assert.deepEqual(g.view(st, 1).hints.build, []);
  assert.deepEqual(g.view(st, 0).hints.mortgage, [1, 3]);
});

// ---- parties aléatoires (invariants) ---------------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function checkInvariants(st, ctx) {
  const fail = (m) => assert.fail(`${ctx} : ${m}`);
  let houses = 0;
  let hotels = 0;
  for (const [q, pr] of Object.entries(st.props)) {
    if (pr.houses === 5) hotels++; else houses += pr.houses;
    if (pr.owner !== null && st.players[pr.owner].bankrupt) fail(`titre ${q} à un failli`);
    if (pr.houses > 0 && pr.mortgaged) fail(`titre ${q} bâti et hypothéqué`);
  }
  if (st.bank.houses + houses !== 32) fail(`maisons ${st.bank.houses}+${houses}`);
  if (st.bank.hotels + hotels !== 12) fail(`hôtels ${st.bank.hotels}+${hotels}`);
  st.players.forEach((p, i) => {
    if (p.cash < 0) fail(`joueur ${i} à ${p.cash}`);
    if (p.pos < 0 || p.pos > 39) fail(`position ${p.pos}`);
  });
  const cardCount = st.decks.chance.order.length + st.decks.chest.order.length + st.players.reduce((n, p) => n + p.cards.length, 0);
  if (cardCount !== 32) fail(`cartes ${cardCount}`);
  if (st.winner === null && !st.players.some((p) => !p.bankrupt)) fail('plus personne');
  JSON.stringify(g.view(st, 0));
}

test('parties aléatoires : aucune exception, invariants respectés, des parties se terminent', () => {
  let finished = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const rand = mulberry32(seed);
    const n = 2 + (seed % 5);
    const st = g.init(Array(n).fill('x'), { rng: rand });
    for (let step = 0; step < 4000 && st.winner === null; step++) {
      // Chaque joueur propose ses coups légaux (selon les aides) ; on en joue un au hasard.
      const moves = [];
      for (let i = 0; i < n; i++) {
        const h = g.view(st, i).hints;
        for (const a of h.actions) {
          if (a === 'bid') moves.push([i, { type: 'bid', amount: h.bid.min + Math.floor(rand() * 40) }]);
          else if (a === 'decline' && rand() < 0.5) moves.push([i, { type: 'decline' }]);
          else moves.push([i, { type: a }]);
        }
        if (rand() < 0.4) {
          for (const k of ['build', 'sell', 'mortgage', 'unmortgage']) {
            const list = h[k];
            if (list.length) moves.push([i, { type: k === 'sell' ? 'sell-house' : k, sq: list[Math.floor(rand() * list.length)] }]);
          }
        }
      }
      if (st.trade === null && rand() < 0.05) {
        const a = Math.floor(rand() * n);
        const b = Math.floor(rand() * n);
        moves.push([a, { type: 'trade-propose', to: b, give: { cash: Math.floor(rand() * 100) }, get: { cash: Math.floor(rand() * 100) } }]);
      }
      if (st.trade) moves.push([st.trade.to, { type: rand() < 0.5 ? 'trade-accept' : 'trade-decline' }]);
      if (rand() < 0.002) moves.push([Math.floor(rand() * n), 'leave']);
      if (moves.length === 0) assert.fail(`seed ${seed} étape ${step} : partie bloquée en phase ${st.phase}`);
      const [who, a] = moves[Math.floor(rand() * moves.length)];
      if (a === 'leave') g.onLeave(st, who); else act(st, who, a);
      checkInvariants(st, `seed ${seed} étape ${step}`);
    }
    if (st.winner !== null) finished++;
  }
  assert.ok(finished >= 10, `trop peu de parties terminées : ${finished}/60`);
});
