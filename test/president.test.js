'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const g = require('../server/games/cards/president');
const { makeDeck } = require('../server/games/cards/deck');

const game = (n = 4, opts = {}) => g.init(Array(n).fill('x'), opts);
const act = (st, who, a) => g.action(st, who, a);
const must = (res, msg) => assert.equal(res.ok, true, `${msg ?? ''} refusé : ${res.error}`);
const play = (st, who, ...cards) => act(st, who, { type: 'play', cards });

// Pose des mains précises (le reste du jeu est ignoré) et donne la main à `turn`.
function setup(hands, { turn = 0, round = 1, rounds = 3 } = {}) {
  const st = game(hands.length, { rounds });
  hands.forEach((h, i) => { st.players[i].hand = [...h]; st.players[i].out = false; st.players[i].passed = false; });
  st.turn = turn;
  st.trick = null;
  st.finished = [];
  st.round = round;
  st.phase = 'play';
  return st;
}

// ---- donne --------------------------------------------------------------------

test('donne : les 52 cartes, écart d’une carte au plus, 3♣ entame', () => {
  for (const n of [3, 4, 5, 6]) {
    const st = game(n);
    const all = st.players.flatMap((p) => p.hand);
    assert.equal(all.length, 52);
    assert.equal(new Set(all).size, 52);
    const sizes = st.players.map((p) => p.hand.length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
    assert.ok(st.players[st.turn].hand.includes('3C'));
    assert.equal(st.phase, 'play');
  }
});

test('secret : on ne voit jamais les cartes des autres', () => {
  const st = game(4);
  for (let i = 0; i < 4; i++) {
    const json = JSON.stringify(g.view(st, i));
    st.players.forEach((p, j) => {
      if (j === i) return;
      for (const c of p.hand) assert.equal(json.includes(`"${c}"`), false, `joueur ${i} voit ${c} de ${j}`);
    });
    assert.equal(g.view(st, i).players[(i + 1) % 4].count > 0, true); // seulement le nombre
  }
});

// ---- jouer ----------------------------------------------------------------------

test('jouer : tour, main, même rang, 1 à 4 cartes', () => {
  const st = setup([['3C', '3D', '5H', '9S'], ['4C', '6D', 'QH'], ['7C', 'KD', 'AS']]);
  assert.equal(play(st, 1, '4C').error, 'not-your-turn');
  assert.equal(play(st, 0, 'AH').error, 'not-in-hand');
  assert.equal(play(st, 0, 'ZZ').error, 'bad-cards');
  assert.equal(play(st, 0).error, 'bad-cards');
  assert.equal(play(st, 0, '3C', '5H').error, 'not-same-rank');
  assert.equal(play(st, 0, '3C', '3C').error, 'not-in-hand');
  assert.equal(act(st, 0, { type: 'pass' }).error, 'must-lead'); // en tête, on ne passe pas
  must(play(st, 0, '3C', '3D'));
  assert.equal(st.turn, 1);
});

test('répondre : même nombre de cartes, rang strictement supérieur', () => {
  const st = setup([['5C', '5D', '9S'], ['5H', '6D', '6H', 'QH'], ['7C', 'KD', 'AS']]);
  must(play(st, 0, '5C', '5D')); // une paire de 5
  assert.equal(play(st, 1, '6D').error, 'wrong-count'); // une seule carte
  assert.equal(play(st, 1, '5H', '6D').error, 'not-same-rank');
  must(play(st, 1, '6D', '6H')); // paire de 6 > paire de 5
  assert.equal(st.trick.by, 1);
  // égalité de rang refusée
  assert.equal(play(st, 2, '7C').error, 'wrong-count');
  const st2 = setup([['5C', '9S'], ['5H', '6D'], ['7C', 'KD']]);
  must(play(st2, 0, '5C'));
  assert.equal(play(st2, 1, '5H').error, 'too-low');
  must(play(st2, 1, '6D'));
});

test('ordre des cartes : le 2 est le plus fort, l’as est sous le 2', () => {
  const st = setup([['AS', '9S'], ['2C', '5H'], ['7C', 'KD']]);
  must(play(st, 0, 'AS'));
  must(play(st, 1, '2C'));
  assert.equal(st.trick, null); // un 2 ferme le pli aussitôt
  assert.equal(st.turn, 1); // et son joueur rejoue
});

// ---- plis ---------------------------------------------------------------------------

test('tous passent : le dernier à avoir joué ramasse et entame ; passer écarte du pli', () => {
  const st = setup([['5C', '9S', 'KD'], ['6D', 'QH', '4C'], ['7C', 'KH', '8S'], ['8D', '9H', 'JS']]);
  must(play(st, 0, '5C'));
  must(play(st, 1, '6D'));
  must(act(st, 2, { type: 'pass' }));
  must(act(st, 3, { type: 'pass' }));
  // 0 n'a pas passé : il peut encore répondre à 1
  assert.equal(st.turn, 0);
  assert.equal(act(st, 0, { type: 'pass' }).ok, true);
  assert.equal(st.trick, null);
  assert.equal(st.turn, 1); // 1 avait le pli
  assert.equal(st.players.every((p) => !p.passed), true); // les « passé » sont remis à zéro
  assert.equal(act(st, 1, { type: 'pass' }).error, 'must-lead');
});

test('un joueur qui a passé ne peut plus jouer dans le pli', () => {
  const st = setup([['5C', '9S'], ['6D', 'QH'], ['7C', 'KH'], ['8D', '9H']]);
  must(play(st, 0, '5C'));
  must(act(st, 1, { type: 'pass' }));
  must(play(st, 2, '7C'));
  must(play(st, 3, '8D'));
  assert.equal(st.turn, 0); // 1 est écarté : on saute son tour
  assert.equal(play(st, 1, 'QH').error, 'not-your-turn');
  must(act(st, 0, { type: 'pass' }));
  assert.equal(st.turn, 2); // 2 (qui avait posé le 7) peut encore répondre au 8
  must(act(st, 2, { type: 'pass' }));
  assert.equal(st.trick, null);
  assert.equal(st.turn, 3);
});

// ---- fin de manche et échange -------------------------------------------------------------

function finishRound(st, order) {
  // Fait finir les joueurs de `order` (hors le dernier) en leur donnant une seule carte à jouer en tête.
  st.players.forEach((p) => { p.hand = []; });
  order.slice(0, -1).forEach((i) => { st.players[i].hand = ['3C']; });
  st.players[order[order.length - 1]].hand = ['4D', '5D'];
}

test('fin de manche : places, points, rôles ; manche suivante avec échange de cartes', () => {
  const st = setup([['3C'], ['4C'], ['5C'], ['6C']], { rounds: 3 });
  // 0 joue sa dernière carte → classé 1er ; puis 1, 2 ; 3 reste → dernier.
  must(play(st, 0, '3C'));
  assert.equal(st.players[0].place, 1); // la place est acquise dès qu'on a fini
  assert.equal(st.players[0].points, 0); // les points, eux, sont comptés en fin de manche
  must(play(st, 1, '4C'));
  must(play(st, 2, '5C'));
  assert.equal(st.phase, 'roundover');
  assert.deepEqual(st.results.order, [0, 1, 2, 3]);
  assert.deepEqual(st.players.map((p) => p.points), [3, 2, 1, 0]);
  assert.deepEqual(st.players.map((p) => p.place), [1, 2, 3, 4]);
  assert.equal(g.view(st, 0).players[0].role, 'Président');
  assert.equal(g.view(st, 1).players[1].role, 'Vice-président');
  assert.equal(g.view(st, 1).players[2].role, 'Vice-trou');
  assert.equal(g.view(st, 1).players[3].role, 'Trou');

  // Tout le monde doit être prêt.
  for (let i = 0; i < 3; i++) must(act(st, i, { type: 'ready' }));
  assert.equal(st.phase, 'roundover');
  must(act(st, 3, { type: 'ready' }));
  assert.equal(st.phase, 'exchange');
  assert.equal(st.round, 2);
  assert.equal(st.players.reduce((n, p) => n + p.hand.length, 0), 52);
  assert.equal(g.view(st, 1).hints.actions[0], 'give');
  assert.equal(g.view(st, 0).hints.give.count, 2);
});

test('échange : le Trou donne ses 2 plus fortes cartes ; le Président en rend 2 de son choix', () => {
  const st = game(3, { rng: () => 0.2 });
  st.roles = { pres: 0, vpres: null, vtrou: null, trou: 2 };
  st.round = 1;
  // Relance une manche avec ces rôles.
  st.players.forEach((p) => { p.ready = true; });
  st.phase = 'roundover';
  st.round = 1;
  act(st, 0, { type: 'ready' });
  assert.equal(st.phase, 'exchange');
  assert.equal(st.exchange.pending.length, 1);
  const { received } = st.exchange.pending[0];
  assert.equal(received.length, 2);
  // Les cartes données sont les plus fortes du Trou : aucune carte restée en main ne les dépasse.
  const val = (c) => g.ORDER.indexOf(c.slice(0, -1));
  const weakestGiven = Math.min(...received.map(val));
  for (const c of st.players[2].hand) assert.ok(val(c) <= weakestGiven, `${c} plus fort qu'une carte donnée`);
  for (const c of received) assert.equal(st.players[0].hand.includes(c), true);

  assert.equal(act(st, 2, { type: 'give', cards: [] }).error, 'not-your-turn'); // le Trou ne rend rien
  assert.equal(act(st, 0, { type: 'give', cards: [st.players[0].hand[0]] }).error, 'wrong-count');
  assert.equal(act(st, 0, { type: 'give', cards: ['AS', 'AS'] }).error, 'not-in-hand');
  const give = st.players[0].hand.slice(0, 2);
  must(act(st, 0, { type: 'give', cards: give }));
  assert.equal(st.phase, 'play');
  assert.equal(st.turn, 0); // le Président entame
  assert.equal(st.players.reduce((n, p) => n + p.hand.length, 0), 52);
  for (const c of give) assert.equal(st.players[2].hand.includes(c), true);
});

test('3 manches : le meilleur total gagne', () => {
  const st = setup([['3C'], ['4C'], ['5C']], { rounds: 1, round: 1 });
  must(play(st, 0, '3C'));
  must(play(st, 1, '4C'));
  assert.equal(st.phase, 'over');
  assert.deepEqual(st.winners, [0]);
  assert.equal(act(st, 0, { type: 'ready' }).error, 'over');
  assert.equal(g.isOver(st), true);
});

// ---- départs ---------------------------------------------------------------------------------

test('départ : le tour passe, le pli se règle, la partie continue entre les autres', () => {
  const st = setup([['5C', '9S'], ['6D', 'QH'], ['7C', 'KH'], ['8D', '9H']]);
  must(play(st, 0, '5C'));
  g.onLeave(st, 1); // c'était son tour
  assert.equal(st.turn, 2);
  g.onLeave(st, 3);
  assert.equal(st.turn, 2);
  must(act(st, 2, { type: 'pass' })); // reste 0 (meneur) et 2 : 2 passe → 0 ramasse
  assert.equal(st.trick, null);
  assert.equal(st.turn, 0);
  assert.equal(st.phase, 'play');
});

test('départ : il ne reste qu’un joueur → fin de partie ; en échange et en fin de manche', () => {
  const st = setup([['5C'], ['6D'], ['7C']]);
  g.onLeave(st, 0);
  g.onLeave(st, 1);
  assert.equal(st.phase, 'over');
  assert.deepEqual(st.winners, [2]);

  const ex = game(4, { rng: () => 0.3 });
  ex.roles = { pres: 0, vpres: 1, vtrou: 2, trou: 3 };
  ex.phase = 'roundover'; ex.players.forEach((p) => { p.ready = true; }); ex.round = 1;
  act(ex, 0, { type: 'ready' });
  assert.equal(ex.phase, 'exchange');
  g.onLeave(ex, 0); // un Président part : son échange saute, l'autre reste
  assert.equal(ex.exchange.pending.every((e) => e.giver !== 0), true);
  g.onLeave(ex, 1);
  assert.equal(ex.phase, 'play');

  const ro = setup([['3C'], ['4C'], ['5C'], ['6C']]);
  must(play(ro, 0, '3C')); must(play(ro, 1, '4C')); must(play(ro, 2, '5C'));
  assert.equal(ro.phase, 'roundover');
  for (let i = 0; i < 3; i++) must(act(ro, i, { type: 'ready' }));
  g.onLeave(ro, 3); // le dernier non prêt part : la manche démarre
  assert.notEqual(ro.phase, 'roundover');
});

// ---- parties aléatoires -----------------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('parties aléatoires : jamais bloquées, cartes jamais dupliquées, secret respecté', () => {
  const deck = new Set(makeDeck());
  for (let seed = 1; seed <= 120; seed++) {
    const rand = mulberry32(seed);
    const n = 3 + (seed % 4);
    const st = g.init(Array(n).fill('x'), { rng: rand });
    for (let step = 0; step < 3000 && st.phase !== 'over'; step++) {
      const moves = [];
      for (let i = 0; i < n; i++) {
        const h = g.view(st, i).hints;
        for (const a of h.actions) {
          if (a === 'play') {
            const pool = h.playable;
            const c = pool[Math.floor(rand() * pool.length)];
            const same = st.players[i].hand.filter((x) => x.slice(0, -1) === c.slice(0, -1));
            const k = h.need ?? 1 + Math.floor(rand() * same.length);
            moves.push([i, { type: 'play', cards: same.slice(0, k) }]);
          } else if (a === 'give') moves.push([i, { type: 'give', cards: st.players[i].hand.slice(0, h.give.count) }]);
          else moves.push([i, { type: a }]);
        }
      }
      if (rand() < 0.004) moves.push([Math.floor(rand() * n), 'leave']);
      if (moves.length === 0) assert.fail(`seed ${seed} étape ${step} : bloquée (${st.phase})`);
      const [who, a] = moves[Math.floor(rand() * moves.length)];
      if (a === 'leave') g.onLeave(st, who); else must(act(st, who, a), `seed ${seed}`);

      // Aucune carte en double entre les mains et le pli ; tout est un vrai code de carte.
      const seen = [...st.players.flatMap((p) => p.hand), ...(st.trick ? st.trick.cards : [])];
      assert.equal(new Set(seen).size, seen.length, `seed ${seed} : carte dupliquée`);
      assert.ok(seen.every((c) => deck.has(c)));
      for (let i = 0; i < n; i++) JSON.stringify(g.view(st, i));
    }
    assert.equal(st.phase, 'over', `seed ${seed} : partie non terminée`);
  }
});
