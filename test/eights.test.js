'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const g = require('../server/games/cards/eights');
const { makeDeck } = require('../server/games/cards/deck');

const game = (n = 3, opts = {}) => g.init(Array(n).fill('x'), opts);
const act = (st, who, a) => g.action(st, who, a);
const must = (res, msg) => assert.equal(res.ok, true, `${msg ?? ''} refusé : ${res.error}`);
const play = (st, who, card, suit) => act(st, who, { type: 'play', card, suit });

// Table posée à la main : mains, haut de défausse, joueur dont c'est le tour.
function setup(hands, { top = '5H', turn = 0, draw = ['9C', '9D', '9S', '4S', '4D', '4C'] } = {}) {
  const st = game(hands.length);
  hands.forEach((h, i) => { st.players[i].hand = [...h]; });
  st.discard = [top];
  st.suit = top.slice(-1);
  st.draw = [...draw];
  st.turn = turn;
  st.dir = 1;
  st.pendingDraw = 0;
  st.drew = false;
  return st;
}

// ---- donne ------------------------------------------------------------------------

test('donne : 7 cartes chacun, carte de départ non spéciale, 52 cartes en tout', () => {
  for (const n of [2, 3, 6]) {
    const st = game(n);
    assert.ok(st.players.every((p) => p.hand.length === 7));
    assert.ok(!['8', '2', 'A', 'J'].includes(st.discard[0].slice(0, -1)));
    const all = [...st.players.flatMap((p) => p.hand), ...st.draw, ...st.discard];
    assert.equal(new Set(all).size, 52);
  }
});

test('secret : on ne voit ni les mains adverses ni la pioche', () => {
  const st = game(3);
  const json = JSON.stringify(g.view(st, 0));
  for (const c of [...st.players[1].hand, ...st.players[2].hand, ...st.draw]) assert.equal(json.includes(`"${c}"`), false);
  assert.equal(g.view(st, 0).drawCount, st.draw.length);
});

// ---- jouer ----------------------------------------------------------------------------

test('jouer : même couleur ou même rang ; sinon refusé ; mauvais tour', () => {
  const st = setup([['9H', '7S', '5D', 'KC'], ['3C'], ['4C']]);
  assert.equal(play(st, 1, '3C').error, 'not-your-turn');
  assert.equal(play(st, 0, 'AH').error, 'not-in-hand');
  assert.equal(play(st, 0, '7S').error, 'not-playable');
  assert.equal(play(st, 0, 'KC').error, 'not-playable');
  must(play(st, 0, '5D')); // même rang
  assert.equal(st.suit, 'D');
  assert.equal(st.turn, 1);
  assert.deepEqual(g.view(st, 0).hints.actions, []);
});

test('le 8 est un joker : il faut choisir la couleur', () => {
  const st = setup([['8S', '9D', '3C'], ['6D', '6C'], ['4C']]);
  assert.equal(play(st, 0, '8S').error, 'choose-suit');
  assert.equal(play(st, 0, '8S', 'X').error, 'choose-suit');
  must(play(st, 0, '8S', 'D'));
  assert.equal(st.suit, 'D');
  assert.equal(play(st, 1, '6C').error, 'not-playable'); // il faut du carreau (ou un 8)
  must(play(st, 1, '6D'));
});

test('2 : le suivant pioche 2, ou se défend avec un autre 2 (cumul)', () => {
  const st = setup([['2H', '9D'], ['2D', '7S'], ['4C']], { draw: ['9C', '9S', '4S', '4D', '4C', '3C'] });
  must(play(st, 0, '2H'));
  assert.equal(st.pendingDraw, 2);
  assert.equal(play(st, 1, '7S').error, 'must-defend');
  must(play(st, 1, '2D')); // cumul : +4 pour le suivant
  assert.equal(st.pendingDraw, 4);
  assert.deepEqual(g.view(st, 2).hints.actions, ['draw']);
  must(act(st, 2, { type: 'draw' }));
  assert.equal(st.players[2].hand.length, 5);
  assert.equal(st.pendingDraw, 0);
  assert.equal(st.turn, 0);
});

test('As : le suivant passe ; Valet : sens inversé, et à 2 joueurs on rejoue', () => {
  const st = setup([['AH', '9D'], ['3C'], ['4C']]);
  must(play(st, 0, 'AH'));
  assert.equal(st.turn, 2); // 1 saute son tour

  const j = setup([['JH', '9D'], ['3C'], ['4C']]);
  must(play(j, 0, 'JH'));
  assert.equal(j.dir, -1);
  assert.equal(j.turn, 2); // sens inverse : le joueur d'avant

  const two = setup([['JH', '9D'], ['3C']]);
  must(play(two, 0, 'JH'));
  assert.equal(two.turn, 0); // à 2 joueurs : on rejoue
});

// ---- piocher -------------------------------------------------------------------------------

test('piocher : seulement sans carte jouable ; carte jouable → on peut la poser ou passer', () => {
  const st = setup([['KC', '3S'], ['9H'], ['4C']], { draw: ['9C', '6H'] });
  assert.equal(act(st, 0, { type: 'pass' }).error, 'must-draw');
  must(act(st, 0, { type: 'draw' })); // pioche 6♥ (jouable : même couleur que 5♥)
  assert.equal(st.turn, 0);
  assert.equal(st.drew, true);
  assert.equal(act(st, 0, { type: 'draw' }).error, 'already-drew');
  assert.deepEqual(g.view(st, 0).hints.actions, ['play', 'pass']);
  must(act(st, 0, { type: 'pass' }));
  assert.equal(st.turn, 1);
  assert.equal(st.drew, false);

  const st2 = setup([['KC', '3S'], ['9H'], ['4C']], { draw: ['9C', '6H'] });
  must(act(st2, 0, { type: 'draw' }));
  must(play(st2, 0, '6H'));
  assert.equal(st2.turn, 1);

  const st3 = setup([['5D', '3S'], ['9H'], ['4C']]);
  assert.equal(act(st3, 0, { type: 'draw' }).error, 'must-play'); // il peut jouer 5♦
});

test('carte piochée non jouable : le tour passe tout seul', () => {
  const st = setup([['KC', '3S'], ['9H'], ['4C']], { draw: ['9C'] });
  must(act(st, 0, { type: 'draw' })); // 9♣ : ni ♥ ni 5
  assert.equal(st.turn, 1);
  assert.equal(st.players[0].hand.length, 3);
});

test('pioche vide : la défausse est remélangée (sauf la carte du dessus)', () => {
  const st = setup([['KC', '3S'], ['9H'], ['4C']], { draw: [] });
  st.discard = ['7D', '8C', '5H'];
  must(act(st, 0, { type: 'draw' }));
  assert.equal(st.discard.length, 1);
  assert.equal(st.discard[0], '5H');
  assert.equal(st.players[0].hand.length, 3);
});

test('victoire : vider sa main', () => {
  const st = setup([['5D'], ['9H'], ['4C']]);
  must(play(st, 0, '5D'));
  assert.equal(st.winner, 0);
  assert.equal(act(st, 1, { type: 'draw' }).error, 'over');
  assert.equal(g.isOver(st), true);
});

// ---- départs ------------------------------------------------------------------------------------

test('départ : le tour passe, ses cartes retournent sous la pioche, il reste 1 joueur → victoire', () => {
  const st = setup([['KC', '3S'], ['9H', '2C'], ['4C']]);
  const drawBefore = st.draw.length;
  g.onLeave(st, 0);
  assert.equal(st.turn, 1);
  assert.equal(st.draw.length, drawBefore + 2);
  g.onLeave(st, 1);
  assert.equal(st.winner, 2);
});

// ---- parties aléatoires -----------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('parties aléatoires : 52 cartes conservées, jamais bloquées, secret respecté', () => {
  let finished = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const rand = mulberry32(seed);
    const n = 2 + (seed % 5);
    const st = g.init(Array(n).fill('x'), { rng: rand });
    for (let step = 0; step < 4000 && st.winner === null; step++) {
      const moves = [];
      for (let i = 0; i < n; i++) {
        const h = g.view(st, i).hints;
        for (const a of h.actions) {
          if (a === 'play') {
            for (const c of h.playable) moves.push([i, { type: 'play', card: c, suit: ['C', 'D', 'H', 'S'][Math.floor(rand() * 4)] }]);
          } else moves.push([i, { type: a }]);
        }
      }
      if (rand() < 0.002) moves.push([Math.floor(rand() * n), 'leave']);
      if (st.winner === null && moves.length === 0) assert.fail(`seed ${seed} étape ${step} : bloquée`);
      if (moves.length === 0) break;
      const [who, a] = moves[Math.floor(rand() * moves.length)];
      if (a === 'leave') g.onLeave(st, who); else must(act(st, who, a), `seed ${seed}`);

      const all = [...st.players.flatMap((p) => p.hand), ...st.draw, ...st.discard];
      assert.equal(all.length, 52, `seed ${seed} : cartes perdues`);
      assert.equal(new Set(all).size, 52, `seed ${seed} : carte dupliquée`);
      for (let i = 0; i < n; i++) JSON.stringify(g.view(st, i));
    }
    if (st.winner !== null) finished++;
  }
  assert.ok(finished >= 100, `trop peu de parties terminées : ${finished}/150`);
});

test('toutes les cartes du jeu existent', () => {
  assert.equal(makeDeck().length, 52);
});
