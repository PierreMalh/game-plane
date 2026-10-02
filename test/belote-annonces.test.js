'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const classic = require('../server/games/cards/belote');
const { findCombos } = require('../server/games/cards/belote-engine');

const g = classic;
const act = (st, who, a) => g.action(st, who, a);
const must = (res, msg) => assert.equal(res.ok, true, `${msg ?? ''} refusé : ${res.error}`);

// ---- donne de référence SANS aucune annonce -------------------------------------------------
// Carré latin : la carte (rang r, couleur s) va au joueur (r + s) % 4. Chaque joueur a donc 2 cartes par
// couleur, à 4 rangs d'écart (jamais 3 qui se suivent), et jamais les 4 couleurs d'un même rang (pas de carré).
const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['C', 'D', 'H', 'S'];
function baseHands() {
  const hands = [[], [], [], []];
  SUITS.forEach((suit, s) => RANKS.forEach((rank, r) => hands[(r + s) % 4].push(rank + suit)));
  return hands;
}

// Donne `cards` au joueur `to` en échangeant avec ses cartes « de remplissage » (jamais celles à garder).
function give(hands, to, cards) {
  const keep = new Set(cards);
  for (const c of cards) {
    const from = hands.findIndex((h) => h.includes(c));
    if (from === to) continue;
    const filler = hands[to].find((x) => !keep.has(x));
    hands[from][hands[from].indexOf(c)] = filler;
    hands[to][hands[to].indexOf(filler)] = c;
  }
  return hands;
}

// Phase de jeu posée à la main avec 4 mains de 8 cartes.
function setup(hands, { game = g, trump = 'H', turn = 0, taker = 0, bid = null, contre = 0 } = {}) {
  const st = game.init(['a', 'b', 'c', 'd'], { first: (turn + 3) % 4 });
  st.phase = 'play';
  st.trump = trump;
  st.taker = taker;
  st.hands = hands.map((h) => [...h]);
  st.turn = turn;
  st.trick = [];
  st.trickNo = 0;
  st.declared = {};
  st.announce = null;
  st.cardPts = [0, 0];
  st.tricks = [0, 0];
  st.bid = bid;
  st.contre = contre;
  const holder = st.hands.findIndex((h) => h.includes('K' + trump) && h.includes('Q' + trump));
  st.belote = { holder: holder === -1 ? null : holder, played: 0 };
  return st;
}

// Joue la première carte légale jusqu'à la fin de la donne.
function autoplay(st, game = g) {
  while (st.phase === 'play') must(game.action(st, st.turn, { type: 'play', card: game.view(st, st.turn).hints.legal[0] }));
}

// Joue seulement le premier pli (4 cartes).
function firstTrick(st, game = g) {
  for (let k = 0; k < 4; k++) must(game.action(st, st.turn, { type: 'play', card: game.view(st, st.turn).hints.legal[0] }));
}

// ---- détection des annonces ---------------------------------------------------------------------

test('la donne de référence ne contient aucune annonce', () => {
  assert.equal(new Set(baseHands().flat()).size, 32);
  for (const h of baseHands()) assert.deepEqual(findCombos(h), []);
});

test('suites : tierce 20, cinquante 50, cent 100 (5 cartes ou plus) ; un trou casse la suite', () => {
  const kinds = (cards) => findCombos([...cards, '7C', '9D', 'KD', 'QC']).filter((c) => c.suit === 'S' || c.suit === 'H');
  let c = kinds(['7S', '8S', '9S']);
  assert.deepEqual(c.map((x) => [x.kind, x.points]), [['tierce', 20]]);
  c = kinds(['10H', 'JH', 'QH', 'KH']);
  assert.deepEqual(c.map((x) => [x.kind, x.points]), [['cinquante', 50]]);
  c = kinds(['9S', '10S', 'JS', 'QS', 'KS']);
  assert.deepEqual(c.map((x) => [x.kind, x.points]), [['cent', 100]]);
  c = kinds(['7S', '8S', '9S', '10S', 'JS', 'QS', 'KS', 'AS']); // 8 cartes : une seule annonce de cent
  assert.deepEqual(c.map((x) => [x.kind, x.points]), [['cent', 100]]);
  c = kinds(['7S', '8S', '10S', 'JS']); // 7 8 _ 10 J : deux paires, pas de suite
  assert.deepEqual(c, []);
  c = kinds(['QS', 'KS', 'AS']); // la suite va jusqu'à l'as
  assert.deepEqual(c.map((x) => x.kind), ['tierce']);
});

test('plusieurs suites dans une main : chacune compte', () => {
  const combos = findCombos(['7S', '8S', '9S', '10H', 'JH', 'QH', 'KH', 'AD']);
  assert.deepEqual(combos.map((c) => [c.kind, c.suit, c.points]).sort(), [['cinquante', 'H', 50], ['tierce', 'S', 20]].sort());
});

test('carrés : valets 200, 9 150, as / 10 / rois / dames 100, 8 et 7 rien', () => {
  const four = (r) => findCombos(['C', 'D', 'H', 'S'].map((s) => r + s).concat(['7C', '9D', 'KD', 'QC']).filter((c, i, a) => a.indexOf(c) === i));
  assert.deepEqual(four('J').filter((c) => c.kind === 'carre').map((c) => c.points), [200]);
  assert.deepEqual(four('9').filter((c) => c.kind === 'carre').map((c) => c.points), [150]);
  for (const r of ['A', '10', 'K', 'Q']) assert.deepEqual(four(r).filter((c) => c.kind === 'carre').map((c) => c.points), [100], r);
  for (const r of ['8', '7']) assert.deepEqual(four(r).filter((c) => c.kind === 'carre'), [], r);
});

test('suite et carré ensemble : les deux comptent', () => {
  const combos = findCombos(['JC', 'JD', 'JH', 'JS', '7C', '8C', '9C', 'AD']);
  const sum = combos.reduce((n, c) => n + c.points, 0);
  assert.equal(sum, 200 + 20 + 20 * 0 + 0); // carré de valets + tierce 7 8 9 de trèfle ; JC n'est pas dans la suite 7-8-9
  assert.deepEqual(combos.map((c) => c.kind).sort(), ['carre', 'tierce']);
});

// ---- déclaration et révélation ---------------------------------------------------------------------------

test('déclaration à la 1re carte : seul le TYPE est public, les cartes restent cachées', () => {
  const hands = give(baseHands(), 0, ['7S', '8S', '9S']);
  assert.deepEqual(findCombos(hands[0]).map((c) => c.kind), ['tierce']);
  const st = setup(hands, { turn: 0 });
  must(act(st, 0, { type: 'play', card: g.view(st, 0).hints.legal[0] }));
  assert.ok(st.log.some((l) => l.includes('annonce') && l.includes('tierce')));
  const v = g.view(st, 1);
  assert.deepEqual(v.declared[0], ['tierce']);
  assert.equal(v.announce, null); // pas encore comparée
  const json = JSON.stringify(v);
  for (const c of ['7S', '8S', '9S']) if (!st.trick.some((t) => t.card === c)) assert.equal(json.includes(`"${c}"`), false, `${c} ne doit pas être visible`);
  assert.equal(st.declared[1], undefined); // les autres n'ont pas encore joué
  must(act(st, 1, { type: 'play', card: g.view(st, 1).hints.legal[0] }));
  assert.deepEqual(g.view(st, 2).declared[1], []); // joueur 1 a joué : rien à annoncer
});

test('l’annonce n’est déclarée qu’une fois, à la première carte', () => {
  const st = setup(give(baseHands(), 0, ['7S', '8S', '9S']), { turn: 0 });
  firstTrick(st);
  const before = st.log.filter((l) => l.includes('annonce')).length;
  firstTrick(st); // 2e pli
  assert.equal(st.log.filter((l) => l.includes('annonce :')).length, before);
});

// ---- comparaison entre équipes ----------------------------------------------------------------------------------
// On déclare directement les annonces dans l'état (la détection est testée plus haut sur des mains
// contrôlées) : le test porte alors uniquement sur la comparaison, la hiérarchie et le décompte.

const seq = (suit, from, len) => ({
  kind: len >= 5 ? 'cent' : len === 4 ? 'cinquante' : 'tierce', suit,
  cards: RANKS.slice(from, from + len).map((r) => r + suit), high: from + len - 1, points: len >= 5 ? 100 : len === 4 ? 50 : 20,
});
const carre = (rank) => ({ kind: 'carre', rank, cards: SUITS.map((s) => rank + s), points: { J: 200, 9: 150 }[rank] ?? 100 });

// Déclare `spec` ({ joueur: [annonces] }) pour tout le monde, l'ordre étant la place dans le 1er pli.
function declare(st, spec) {
  for (let p = 0; p < 4; p++) st.declared[p] = { combos: spec[p] ?? [], order: (p - st.turn + 4) % 4 };
}

// Joue le 1er pli avec ces annonces déclarées et renvoie l'équipe qui les marque (ou null).
function winnerOf(spec, opts = {}) {
  const st = setup(baseHands(), { turn: 0, ...opts });
  declare(st, spec);
  firstTrick(st);
  return st.announce ? st.announce.team : null;
}

test('la meilleure annonce l’emporte : l’équipe gagnante marque TOUTES ses annonces, l’autre aucune', () => {
  const st = setup(baseHands(), { turn: 0 });
  // équipe 0 (joueurs 0 et 2) : deux tierces basses ; équipe 1 : une tierce à l'as, plus haute
  declare(st, { 0: [seq('S', 0, 3)], 2: [seq('H', 0, 3)], 1: [seq('C', 5, 3)] });
  firstTrick(st);
  assert.equal(st.announce.team, 1);
  assert.equal(st.announce.points, 20); // une seule annonce chez les gagnants
  assert.equal(st.announce.combos.length, 1);
  const v = g.view(st, 0);
  assert.equal(v.announce.team, 1);
  assert.deepEqual(v.announce.combos[0].cards.sort(), ['AC', 'KC', 'QC']); // révélées à tous
  assert.equal(st.log.some((l) => l.includes('tierce à')), true);
});

test('l’équipe gagnante cumule les annonces de ses deux joueurs', () => {
  const st = setup(baseHands(), { turn: 0 });
  declare(st, { 0: [seq('S', 0, 3)], 2: [seq('H', 3, 4)] });
  firstTrick(st);
  assert.equal(st.announce.team, 0);
  assert.equal(st.announce.points, 20 + 50);
  assert.deepEqual(st.announce.combos.map((c) => c.p).sort(), [0, 2]);
});

test('hiérarchie : carré > cent > cinquante > tierce ; carré de valets > carré de 9 > carrés de 100', () => {
  assert.equal(winnerOf({ 0: [seq('D', 5, 3)], 1: [seq('S', 3, 4)] }), 1); // cinquante > tierce
  assert.equal(winnerOf({ 0: [seq('D', 0, 5)], 1: [seq('S', 3, 4)] }), 0); // cent > cinquante
  assert.equal(winnerOf({ 0: [seq('D', 5, 3)], 1: [carre('Q')] }), 1); // carré de dames > tierce
  assert.equal(winnerOf({ 0: [carre('J')], 1: [seq('D', 0, 5)] }), 0); // carré de valets > cent
  assert.equal(winnerOf({ 0: [carre('K')], 1: [seq('D', 0, 5)] }), 0); // carré de 100 > cent (même valeur, carré d'abord)
  assert.equal(winnerOf({ 0: [carre('A')], 1: [carre('9')] }), 1); // carré de 9 (150) > carré d'as (100)
  assert.equal(winnerOf({ 0: [carre('9')], 1: [carre('J')] }), 1); // carré de valets (200) > carré de 9
  assert.equal(winnerOf({ 0: [seq('D', 0, 3)], 1: [seq('S', 5, 3)] }), 1); // tierce à l'as > tierce au 9
});

test('égalité de hauteur : l’atout l’emporte, sinon le premier à avoir joué', () => {
  const tie = { 0: [seq('S', 0, 3)], 1: [seq('H', 0, 3)] }; // deux tierces au 9, pique (équipe 0) et cœur (équipe 1)
  assert.equal(winnerOf(tie, { trump: 'H' }), 1); // atout cœur
  assert.equal(winnerOf(tie, { trump: 'S' }), 0); // atout pique
  assert.equal(winnerOf(tie, { trump: 'C', turn: 0 }), 0); // aucune à l'atout : joueur 0 joue le premier
  assert.equal(winnerOf(tie, { trump: 'C', turn: 1 }), 1); // joueur 1 entame : il a joué le premier
});

test('une seule équipe a des annonces : elle marque ; aucune : rien', () => {
  assert.equal(winnerOf({ 3: [seq('D', 0, 3)] }), 1);
  assert.equal(winnerOf({}), null);
});

// ---- points : annonces dans le décompte (classique) ------------------------------------------------------------------

// Comptage de référence, écrit indépendamment du moteur (mode classique), SANS les annonces.
function refClassic(r) {
  const t = r.takerTeam;
  const add = [0, 0];
  if (r.capot !== null) add[r.capot] = 252;
  else if (r.made) { add[0] = r.cardPts[0] + (r.belote === 0 ? 20 : 0); add[1] = r.cardPts[1] + (r.belote === 1 ? 20 : 0); }
  else add[1 - t] = 162;
  if ((r.capot !== null || !r.made) && r.belote !== null) add[r.belote] += 20;
  return add;
}

test('les annonces s’ajoutent au score de l’équipe qui les marque', () => {
  const st = setup(baseHands(), { turn: 0, taker: 0, trump: 'S' });
  declare(st, { 0: [seq('H', 3, 4)] }); // cinquante
  autoplay(st);
  const r = st.result;
  assert.equal(r.announce.team, 0);
  assert.equal(r.announce.points, 50);
  const expected = refClassic(r);
  const counted = r.made || r.announce.team !== r.takerTeam ? 50 : 0;
  assert.equal(r.announce.counted, counted);
  expected[0] += counted;
  assert.deepEqual(r.add, expected);
  assert.equal(st.scores[0], expected[0]);
});

test('annonces perdues si l’équipe qui les marque est celle d’un preneur qui chute', () => {
  let lost = 0;
  let kept = 0;
  for (let k = 0; k < 32; k++) {
    const taker = k % 4; // équipe 0 (sièges 0, 2) ou équipe 1 (sièges 1, 3)
    const st = setup(baseHands(), { turn: (k >> 2) % 4, taker, trump: SUITS[(k >> 1) % 4] });
    declare(st, { 0: [seq('H', 0, 3)] }); // une tierce pour l'équipe 0
    firstTrick(st);
    st.cardPts[0] -= 1000; // l'équipe 0 ne peut plus atteindre 82 : si elle a pris, elle chute
    autoplay(st);
    const r = st.result;
    assert.equal(r.announce.team, 0);
    const loses = r.takerTeam === 0 && !r.made;
    assert.equal(r.announce.counted, loses ? 0 : 20, `partie ${k}`);
    const e = refClassic(r);
    e[0] += loses ? 0 : 20;
    assert.deepEqual(r.add, e, `partie ${k}`);
    if (loses) lost++; else kept++;
  }
  assert.ok(lost > 0 && kept > 0, `les deux cas doivent se rencontrer (perdues ${lost}, gardées ${kept})`);
});

test('secret : après la comparaison, seules les cartes de l’équipe qui marque sont visibles', () => {
  const st = setup(baseHands(), { turn: 0 });
  const loserCards = [...st.hands[1]].slice(0, 3); // 3 cartes du joueur 1
  declare(st, {
    0: [{ kind: 'tierce', suit: 'S', cards: ['QS', 'KS', 'AS'], high: 7, points: 20 }],
    1: [{ kind: 'tierce', suit: 'D', cards: loserCards, high: 2, points: 20 }],
  });
  firstTrick(st);
  assert.equal(st.announce.team, 0);
  const json = JSON.stringify(g.view(st, 3));
  for (const c of ['QS', 'KS', 'AS']) assert.equal(json.includes(`"${c}"`), true, `${c} révélée`);
  const played = new Set(st.lastTrick.cards.map((t) => t.card));
  for (const c of loserCards) if (!played.has(c) && !st.hands[3].includes(c)) assert.equal(json.includes(`"${c}"`), false, `${c} (équipe perdante) reste cachée`);
});
