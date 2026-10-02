'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const g = require('../server/games/cards/liar');
const { makeDeck } = require('../server/games/cards/deck');

const game = (n = 3, opts = {}) => g.init(Array(n).fill('x'), opts);
const act = (st, who, a) => g.action(st, who, a);
const must = (res, msg) => assert.equal(res.ok, true, `${msg ?? ''} refusé : ${res.error}`);
const play = (st, who, ...cards) => act(st, who, { type: 'play', cards });

function setup(hands, { turn = 0 } = {}) {
  const st = game(hands.length);
  hands.forEach((h, i) => { st.players[i].hand = [...h]; });
  st.turn = turn;
  st.pile = [];
  st.step = 0;
  st.last = null;
  st.pendingWin = null;
  st.winner = null;
  return st;
}

// ---- donne et secret ---------------------------------------------------------------------

test('donne : toutes les cartes distribuées ; le rang à annoncer commence par l’As', () => {
  for (const n of [3, 5, 8]) {
    const st = game(n);
    const all = st.players.flatMap((p) => p.hand);
    assert.equal(all.length, 52);
    assert.equal(new Set(all).size, 52);
  }
  assert.equal(g.view(game(3), 0).claim, 'A');
});

test('secret : ni les mains adverses, ni les cartes du tas, même après une pose', () => {
  const st = setup([['AH', '5S'], ['KC', '9D'], ['3C', '4D']]);
  must(play(st, 0, '5S')); // il annonce un As mais pose un 5 : menteur
  for (let i = 0; i < 3; i++) {
    const json = JSON.stringify(g.view(st, i));
    for (const c of ['5S']) if (i !== 0) assert.equal(json.includes(`"${c}"`), false, `joueur ${i} voit la carte posée`);
    for (const c of [...st.players[1].hand, ...st.players[2].hand]) if (i === 0) assert.equal(json.includes(`"${c}"`), false);
  }
  const v = g.view(st, 1);
  assert.deepEqual(v.last, { p: 0, count: 1, rank: 'A' });
  assert.equal(v.pile, 1);
});

// ---- poser ----------------------------------------------------------------------------------------

test('poser : 1 à 4 cartes de sa main ; le rang annoncé avance à chaque pose', () => {
  const st = setup([['AH', '5S', '5D', '5C', '5H', '6D'], ['KC', '9D'], ['3C', '4D']]);
  assert.equal(play(st, 1, 'KC').error, 'not-your-turn');
  assert.equal(play(st, 0).error, 'bad-cards');
  assert.equal(play(st, 0, '5S', '5D', '5C', '5H', '6D').error, 'bad-cards'); // 5 cartes
  assert.equal(play(st, 0, 'QH').error, 'not-in-hand');
  assert.equal(play(st, 0, 'AH', 'AH').error, 'not-in-hand');
  must(play(st, 0, 'AH'));
  assert.equal(st.last.rank, 'A');
  assert.equal(g.view(st, 1).claim, '2');
  must(play(st, 1, 'KC'));
  assert.equal(st.last.rank, '2'); // mensonge possible
  assert.equal(st.turn, 2);
});

// ---- contester ----------------------------------------------------------------------------------------

test('accuser à raison : le menteur ramasse le tas, l’accusateur rejoue', () => {
  const st = setup([['AH', '5S'], ['KC', '9D'], ['3C', '4D']]);
  must(play(st, 0, '5S')); // annonce As, pose 5 → ment
  must(act(st, 1, { type: 'call' }));
  assert.equal(st.players[0].hand.length, 2); // 'AH' + le 5♠ ramassé
  assert.ok(st.players[0].hand.includes('5S'));
  assert.equal(st.pile.length, 0);
  assert.equal(st.last, null);
  assert.equal(st.turn, 1); // l'accusateur rejoue
  assert.equal(st.reveal.truthful, false);
  assert.equal(st.reveal.loser, 0);
  assert.deepEqual(g.view(st, 2).reveal.cards, ['5S']); // révélé à tous
  assert.equal(g.view(st, 2).claim, '2'); // le rang annoncé a continué
});

test('accuser à tort : l’accusateur ramasse le tas', () => {
  const st = setup([['AH', '5S'], ['KC', '9D'], ['3C', '4D']]);
  must(play(st, 0, 'AH')); // vrai : un As
  must(act(st, 1, { type: 'call' }));
  assert.equal(st.reveal.truthful, true);
  assert.equal(st.players[1].hand.length, 3); // KC, 9D + AH
  assert.equal(st.turn, 1);
});

test('contester : rien à contester en tête de tas ; plusieurs cartes toutes justes', () => {
  const st = setup([['AH', 'AD', 'AS'], ['KC', '9D'], ['3C', '4D']]);
  assert.equal(act(st, 0, { type: 'call' }).error, 'nothing-to-call');
  must(play(st, 0, 'AH', 'AD'));
  assert.deepEqual(g.view(st, 1).hints.actions, ['play', 'call']);
  must(act(st, 1, { type: 'call' }));
  assert.equal(st.reveal.truthful, true);
});

// ---- dernière pose -----------------------------------------------------------------------------------------------

test('dernière carte : le suivant doit trancher ; accuser à raison → la partie continue', () => {
  const st = setup([['5S'], ['KC', '9D'], ['3C', '4D']]);
  must(play(st, 0, '5S')); // dernière carte, mensonge
  assert.equal(st.pendingWin, 0);
  assert.equal(st.winner, null);
  assert.deepEqual(g.view(st, 1).hints.actions, ['call', 'accept']);
  assert.equal(play(st, 1, 'KC').error, 'must-respond');
  must(act(st, 1, { type: 'call' }));
  assert.equal(st.winner, null);
  assert.equal(st.pendingWin, null);
  assert.equal(st.players[0].hand.length, 1);
});

test('dernière carte : accuser à tort, ou accepter → victoire', () => {
  const a = setup([['AH'], ['KC', '9D'], ['3C', '4D']]);
  must(play(a, 0, 'AH')); // vrai
  must(act(a, 1, { type: 'call' }));
  assert.equal(a.winner, 0);

  const b = setup([['AH'], ['KC', '9D'], ['3C', '4D']]);
  must(play(b, 0, 'AH'));
  assert.equal(act(b, 2, { type: 'accept' }).error, 'not-your-turn');
  must(act(b, 1, { type: 'accept' }));
  assert.equal(b.winner, 0);
  assert.equal(act(b, 2, { type: 'call' }).error, 'over');

  const c = setup([['AH', '2C'], ['KC'], ['3C']]);
  assert.equal(act(c, 0, { type: 'accept' }).error, 'nothing-to-accept');
});

// ---- départs -----------------------------------------------------------------------------------------------------------

test('départ : le tour passe, ses cartes sortent du jeu ; à un seul restant, victoire', () => {
  const st = setup([['AH', '5S'], ['KC', '9D'], ['3C', '4D']]);
  g.onLeave(st, 0);
  assert.equal(st.turn, 1);
  assert.equal(st.players[0].hand.length, 0);
  g.onLeave(st, 1);
  assert.equal(st.winner, 2);

  const w = setup([['AH'], ['KC', '9D'], ['3C', '4D']]);
  must(play(w, 0, 'AH'));
  g.onLeave(w, 0); // celui qui allait gagner part : plus de victoire en attente
  assert.equal(w.pendingWin, null);
  assert.deepEqual(g.view(w, 1).hints.actions, ['play', 'call']);
});

// ---- parties aléatoires -----------------------------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('parties aléatoires : cartes conservées (hors départs), jamais bloquées, mains cachées', () => {
  let finished = 0;
  const deck = new Set(makeDeck());
  for (let seed = 1; seed <= 150; seed++) {
    const rand = mulberry32(seed);
    const n = 3 + (seed % 6);
    const st = g.init(Array(n).fill('x'), { rng: rand });
    let leftCards = 0;
    for (let step = 0; step < 6000 && st.winner === null; step++) {
      const moves = [];
      for (let i = 0; i < n; i++) {
        const h = g.view(st, i).hints;
        for (const a of h.actions) {
          if (a === 'play') {
            const hand = st.players[i].hand;
            const k = 1 + Math.floor(rand() * Math.min(4, hand.length));
            moves.push([i, { type: 'play', cards: hand.slice(0, k) }]);
          } else moves.push([i, { type: a }]);
        }
      }
      if (rand() < 0.002) moves.push([Math.floor(rand() * n), 'leave']);
      if (moves.length === 0) assert.fail(`seed ${seed} étape ${step} : bloquée`);
      const [who, a] = moves[Math.floor(rand() * moves.length)];
      if (a === 'leave') { if (!st.players[who].left) leftCards += st.players[who].hand.length; g.onLeave(st, who); }
      else must(act(st, who, a), `seed ${seed}`);

      const all = [...st.players.flatMap((p) => p.hand), ...st.pile];
      assert.equal(new Set(all).size, all.length, `seed ${seed} : carte dupliquée`);
      assert.ok(all.every((c) => deck.has(c)));
      assert.equal(all.length + leftCards, 52, `seed ${seed} : cartes perdues`);
      for (let i = 0; i < n; i++) {
        const json = JSON.stringify(g.view(st, i));
        const publicCards = st.reveal ? st.reveal.cards : []; // révélées par une contestation : publiques
        st.players.forEach((p, j) => {
          if (j !== i) for (const c of p.hand) if (!publicCards.includes(c)) assert.equal(json.includes(`"${c}"`), false, `seed ${seed} : ${c} fuit`);
        });
        for (const c of st.pile) if (!st.reveal || !st.reveal.cards.includes(c)) assert.equal(json.includes(`"${c}"`), false, `seed ${seed} : carte du tas visible`);
      }
    }
    if (st.winner !== null) finished++;
  }
  assert.ok(finished >= 100, `trop peu de parties terminées : ${finished}/150`);
});
