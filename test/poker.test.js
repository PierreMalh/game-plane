'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const g = require('../server/games/cards/poker');

const { score5, bestHand, compareScore, describe, STACK, BLIND_EVERY } = g._internal;
const must = (res, msg) => assert.equal(res.ok, true, `${msg ?? ''} refusé : ${res.error}`);
const act = (st, who, type, to) => g.action(st, who, { type, to });
const chipsTotal = (st) => st.players.reduce((s, p) => s + p.chips + (st.phase === 'betting' ? p.contrib : 0), 0);
const name = (cards) => describe(bestHand(cards).score);

// Donne truquée : bouton sur le joueur 0, cartes privées et tableau imposés (blindes déjà posées).
function rig(holes, board = ['2C', '7D', '9H', 'JS', '3D'], opts = {}) {
  const st = g.init(holes.map((_, i) => `p${i}`), opts);
  holes.forEach((h, i) => { st.players[i].hand = [...h]; });
  st.deck = [...board].reverse();
  return st;
}

// ---- évaluation ------------------------------------------------------------------------

test('catégories de mains, de la hauteur à la quinte flush royale', () => {
  assert.equal(name(['AS', 'KD', '9C', '7H', '3S']), 'Hauteur As');
  assert.equal(name(['AS', 'AD', '9C', '7H', '3S']), 'Paire d’As');
  assert.equal(name(['9S', '9D', '4C', '4H', 'KS']), 'Double paire 9 et 4');
  assert.equal(name(['QS', 'QD', 'QC', '7H', '3S']), 'Brelan de Dame');
  assert.equal(name(['5S', '6D', '7C', '8H', '9S']), 'Quinte au 9');
  assert.equal(name(['AS', '2D', '3C', '4H', '5S']), 'Quinte au 5'); // quinte blanche
  assert.equal(name(['10S', 'JD', 'QC', 'KH', 'AS']), 'Quinte à l’As');
  assert.equal(name(['2H', '7H', '9H', 'JH', 'KH']), 'Couleur au Roi');
  assert.equal(name(['KS', 'KD', 'KC', '7H', '7S']), 'Full aux Roi par les 7');
  assert.equal(name(['JS', 'JD', 'JC', 'JH', '3S']), 'Carré de Valet');
  assert.equal(name(['5H', '6H', '7H', '8H', '9H']), 'Quinte flush au 9');
  assert.equal(name(['10D', 'JD', 'QD', 'KD', 'AD']), 'Quinte flush royale');
});

test('comparaison : catégorie puis départages (kickers), égalité exacte', () => {
  const cmp = (a, b) => Math.sign(compareScore(score5(a), score5(b)));
  assert.equal(cmp(['AS', 'AD', 'KC', '7H', '3S'], ['AH', 'AC', 'QC', 'JH', '9S']), 1); // kicker Roi
  assert.equal(cmp(['9S', '9D', '4C', '4H', 'KS'], ['9H', '9C', '4S', '4D', 'QS']), 1);
  assert.equal(cmp(['AS', '2D', '3C', '4H', '5S'], ['2S', '3D', '4C', '5H', '6S']), -1); // la roue est la plus petite
  assert.equal(cmp(['2H', '7H', '9H', 'JH', 'KH'], ['5S', '6D', '7C', '8H', '9S']), 1); // couleur > quinte
  assert.equal(cmp(['KS', 'KD', 'KC', '2H', '2S'], ['QS', 'QD', 'QC', 'AH', 'AS']), 1); // full : le brelan d'abord
  assert.equal(cmp(['AS', 'KD', '9C', '7H', '3S'], ['AH', 'KC', '9D', '7S', '3H']), 0);
});

test('meilleure main parmi 7 cartes', () => {
  const best = bestHand(['AH', 'KH', '2H', '7H', '9C', '9H', '9D']);
  assert.equal(describe(best.score), 'Couleur à l’As');
  assert.equal(best.cards.length, 5);
  assert.equal(name(['2C', '2D', '2H', '9C', '9D', '9S', 'AS']), 'Full aux 9 par les 2');
});

// ---- donne et blindes ------------------------------------------------------------------

test('donne : 2 cartes chacun, blindes posées, premier à parler après la grosse blinde', () => {
  const st = g.init(['a', 'b', 'c', 'd']);
  assert.equal(st.dealer, 0);
  assert.equal(st.sb, 1);
  assert.equal(st.bb, 2);
  assert.equal(st.turn, 3);
  assert.deepEqual(st.players.map((p) => p.chips), [STACK, STACK - 10, STACK - 20, STACK]);
  assert.ok(st.players.every((p) => p.hand.length === 2));
  assert.equal(new Set([...st.players.flatMap((p) => p.hand), ...st.deck]).size, 52);
});

test('tête-à-tête : le bouton est petite blinde, parle en premier avant le flop et en dernier après', () => {
  const st = rig([['AS', 'AD'], ['KS', 'KD']]);
  assert.equal(st.sb, 0);
  assert.equal(st.bb, 1);
  assert.equal(st.turn, 0);
  must(act(st, 0, 'call'));
  assert.equal(st.street, 'preflop'); // la grosse blinde a encore la parole
  assert.equal(st.turn, 1);
  must(act(st, 1, 'check'));
  assert.equal(st.street, 'flop');
  assert.equal(st.board.length, 3);
  assert.equal(st.turn, 1);
});

test('secret : on ne voit ni les mains adverses ni le paquet ; spectateur sans main', () => {
  const st = g.init(['a', 'b', 'c']);
  const json = JSON.stringify(g.view(st, 0));
  for (const c of [...st.players[1].hand, ...st.players[2].hand, ...st.deck]) assert.equal(json.includes(`"${c}"`), false);
  assert.deepEqual(g.view(st, 0).hand, st.players[0].hand);
  const spec = g.view(st, -1);
  assert.deepEqual(spec.hand, []);
  assert.deepEqual(spec.hints.actions, []);
});

// ---- enchères --------------------------------------------------------------------------

test('actions proposées et refusées', () => {
  const st = rig([['AS', 'AD'], ['KS', 'KD'], ['QS', 'QD']]);
  const h = g.view(st, 0).hints;
  assert.deepEqual(h.actions, ['fold', 'call', 'raise', 'allin']);
  assert.equal(h.toCall, 20);
  assert.equal(h.minRaise, 40);
  assert.equal(h.maxRaise, STACK);
  assert.equal(act(st, 1, 'call').error, 'not-your-turn');
  assert.equal(act(st, 0, 'check').error, 'must-call');
  assert.equal(act(st, 0, 'raise', 30).error, 'raise-too-small');
  assert.equal(act(st, 0, 'raise', STACK + 1).error, 'bad-amount');
  assert.equal(act(st, 0, 'raise', 40.5).error, 'bad-amount');
  must(act(st, 0, 'raise', 60)); // relance de 40
  assert.equal(g.view(st, 1).hints.minRaise, 100); // relance minimale = la dernière relance
  assert.equal(act(st, 1, 'raise', 90).error, 'raise-too-small');
  must(act(st, 1, 'raise', 100));
});

test('tout le monde se couche : la grosse blinde ramasse sans montrer', () => {
  const st = rig([['AS', 'AD'], ['KS', 'KD'], ['QS', 'QD']]);
  must(act(st, 0, 'fold'));
  must(act(st, 1, 'fold'));
  assert.equal(st.phase, 'result');
  assert.equal(st.players[2].chips, STACK + 10);
  assert.equal(st.result.showdown, false);
  assert.ok(g.view(st, 0).players.every((p) => p.cards === null));
});

test('main complète jusqu’à l’abattage : meilleure main, cartes montrées, main suivante', () => {
  const st = rig([['AS', 'AD'], ['KS', 'KD'], ['7S', '2H']], ['AC', 'KC', '5D', '8H', '9S']);
  must(act(st, 0, 'call'));
  must(act(st, 1, 'call'));
  must(act(st, 2, 'check'));
  for (const street of ['flop', 'turn', 'river']) {
    assert.equal(st.street, street);
    assert.equal(st.turn, 1); // après le flop, la petite blinde parle en premier
    must(act(st, 1, 'check'));
    must(act(st, 2, 'check'));
    must(act(st, 0, 'check'));
  }
  assert.equal(st.phase, 'result');
  assert.deepEqual(st.result.pots, [{ amount: 60, winners: [0] }]);
  assert.equal(st.result.hands[0].name, 'Brelan d’As');
  assert.equal(st.players[0].chips, STACK + 40);
  // Cartes montrées à tous, même au spectateur.
  assert.deepEqual(g.view(st, -1).players[1].cards, ['KS', 'KD']);
  // Main suivante quand tout le monde a validé ; le bouton avance.
  assert.equal(act(st, 0, 'check').error, 'not-your-turn');
  must(act(st, 0, 'ready'));
  assert.equal(act(st, 0, 'ready').error, 'not-your-turn');
  must(act(st, 1, 'ready'));
  assert.equal(st.phase, 'result');
  must(act(st, 2, 'ready'));
  assert.equal(st.phase, 'betting');
  assert.equal(st.handNo, 2);
  assert.equal(st.dealer, 1);
  assert.ok(g.view(st, -1).players.every((p) => p.cards === null));
  assert.ok(st.players.every((p) => p.hand.length === 2));
});

test('partage du pot à égalité (le tableau joue), jeton indivisible à gauche du bouton', () => {
  const st = rig([['2S', '3D'], ['2H', '3C'], ['4S', '5D']], ['AC', 'AD', 'KH', 'KS', 'QD']);
  st.players[2].chips -= 1; // grosse blinde un peu plus forte pour un pot impair
  st.players[2].bet += 1;
  st.players[2].contrib += 1;
  st.currentBet = 21;
  must(act(st, 0, 'call'));
  must(act(st, 1, 'call'));
  must(act(st, 2, 'check'));
  for (let k = 0; k < 3; k++) for (const p of [1, 2, 0]) must(act(st, p, 'check'));
  assert.equal(st.result.pots[0].amount, 63);
  assert.deepEqual(st.result.pots[0].winners, [1, 2, 0]); // ordre depuis la gauche du bouton
  assert.deepEqual(st.players.map((p) => p.chips), [STACK, STACK, STACK]); // 21 chacun
  assert.equal(chipsTotal(st), 3 * STACK);
});

test('pots annexes : un tapis court ne gagne que ce qu’il a pu couvrir', () => {
  // Joueur 0 court à 100 avec la meilleure main, 1 bat 2 pour le pot annexe.
  const st = rig([['AS', 'AD'], ['KS', 'KD'], ['QS', 'QD']], ['2C', '7D', '9H', 'JS', '3D']);
  st.players[0].chips = 100;
  must(act(st, 0, 'allin'));
  must(act(st, 1, 'raise', 300));
  must(act(st, 2, 'call'));
  assert.equal(st.street, 'flop');
  must(act(st, 1, 'raise', 200)); // mise au flop
  must(act(st, 2, 'call'));
  must(act(st, 1, 'check'));
  must(act(st, 2, 'check'));
  must(act(st, 1, 'check'));
  must(act(st, 2, 'check'));
  assert.deepEqual(st.result.pots, [{ amount: 300, winners: [0] }, { amount: 800, winners: [1] }]);
  assert.deepEqual(st.players.map((p) => p.chips), [300, STACK - 500 + 800, STACK - 500]);
});

test('mise non suivie rendue : le gros tapis récupère l’excédent', () => {
  const st = rig([['2S', '3D'], ['AS', 'AD']], ['KC', '7D', '9H', 'JS', '4D']);
  st.players[1].chips = 180; // 200 en tout avec la grosse blinde
  must(act(st, 0, 'allin')); // 1000
  must(act(st, 1, 'call')); // tapis à 200
  assert.equal(st.phase, 'result'); // plus personne ne peut miser : tableau déroulé
  assert.equal(st.board.length, 5);
  assert.deepEqual(st.result.pots, [{ amount: 400, winners: [1] }, { amount: 800, winners: [0] }]);
  assert.deepEqual(st.players.map((p) => p.chips), [800, 400]);
});

test('un tapis incomplet ne rouvre pas les relances pour qui a déjà parlé', () => {
  const st = rig([['AS', 'AD'], ['KS', 'KD'], ['QS', 'QD'], ['JS', 'JD']]);
  // Ordre : 3, 0, 1 (petite blinde), 2 (grosse blinde).
  st.players[1].chips = 110; // petite blinde : 120 en tout
  must(act(st, 3, 'raise', 100));
  must(act(st, 0, 'call'));
  must(act(st, 1, 'allin')); // 120 : relance de 20 < 80, incomplète
  assert.equal(st.currentBet, 120);
  const h2 = g.view(st, 2).hints; // la grosse blinde n'a pas encore parlé : elle peut relancer
  assert.ok(h2.actions.includes('raise'));
  must(act(st, 2, 'call'));
  const h3 = g.view(st, 3).hints;
  assert.deepEqual(h3.actions, ['fold', 'call']);
  assert.equal(act(st, 3, 'raise', 300).error, 'cannot-raise');
  must(act(st, 3, 'call'));
  assert.deepEqual(g.view(st, 0).hints.actions, ['fold', 'call']);
  must(act(st, 0, 'call'));
  assert.equal(st.street, 'flop');
});

test('relance complète : rouvre les enchères pour tous', () => {
  const st = rig([['AS', 'AD'], ['KS', 'KD'], ['QS', 'QD']]);
  must(act(st, 0, 'call'));
  must(act(st, 1, 'call'));
  must(act(st, 2, 'raise', 60));
  assert.equal(st.turn, 0);
  assert.ok(g.view(st, 0).hints.actions.includes('raise'));
  must(act(st, 0, 'call'));
  must(act(st, 1, 'call'));
  assert.equal(st.street, 'flop');
  assert.equal(g.view(st, 1).pot, 180);
});

// ---- tournoi ---------------------------------------------------------------------------

test('élimination et fin de tournoi', () => {
  const st = rig([['AS', 'AD'], ['KS', 'KD']], ['2C', '7D', '9H', 'JS', '3D']);
  must(act(st, 0, 'allin'));
  must(act(st, 1, 'call'));
  assert.equal(st.phase, 'over');
  assert.equal(st.winner, 0);
  assert.equal(g.isOver(st), true);
  assert.equal(st.players[0].chips, 2 * STACK);
  assert.equal(act(st, 0, 'ready').error, 'over');
});

test('un joueur éliminé ne reçoit plus de cartes et n’a pas à valider', () => {
  const st = rig([['AS', 'AD'], ['KS', 'KD'], ['QS', 'QD']], ['2C', '7D', '9H', 'JS', '3D']);
  st.players[2].chips = 0; // grosse blinde à tapis (20)
  must(act(st, 0, 'call'));
  must(act(st, 1, 'call'));
  for (let k = 0; k < 3; k++) for (const p of [1, 0]) must(act(st, p, 'check'));
  assert.equal(st.phase, 'result');
  assert.equal(st.players[2].chips, 0);
  assert.deepEqual(g.view(st, 2).hints.actions, []);
  must(act(st, 0, 'ready'));
  must(act(st, 1, 'ready'));
  assert.equal(st.phase, 'betting');
  assert.equal(st.players[2].inHand, false);
  assert.deepEqual(g.view(st, 2).hand, []);
  assert.deepEqual([st.dealer, st.sb, st.bb], [1, 1, 0]); // tête-à-tête désormais
});

test('les blindes doublent tous les ' + BLIND_EVERY + ' mains', () => {
  const st = g.init(['a', 'b', 'c']);
  for (let k = 1; k < BLIND_EVERY; k++) {
    const order = [st.turn, ...[1, 2].map((d) => (st.turn + d) % 3)];
    must(act(st, order[0], 'fold'));
    must(act(st, order[1], 'fold'));
    for (let i = 0; i < 3; i++) must(act(st, i, 'ready'));
  }
  assert.equal(st.handNo, BLIND_EVERY);
  assert.deepEqual(st.blinds, [10, 20]);
  const order = [st.turn, (st.turn + 1) % 3];
  must(act(st, order[0], 'fold'));
  must(act(st, order[1], 'fold'));
  for (let i = 0; i < 3; i++) must(act(st, i, 'ready'));
  assert.deepEqual(st.blinds, [20, 40]);
});

test('départ en cours de main : il se couche, ses mises restent au pot', () => {
  const st = rig([['AS', 'AD'], ['KS', 'KD'], ['QS', 'QD']]);
  must(act(st, 0, 'raise', 100));
  g.onLeave(st, 1); // petite blinde, à elle de parler
  assert.equal(st.players[1].folded, true);
  assert.equal(st.turn, 2);
  must(act(st, 2, 'fold'));
  assert.equal(st.phase, 'result');
  assert.equal(st.players[0].chips, STACK + 30);
  must(act(st, 0, 'ready'));
  must(act(st, 2, 'ready')); // le joueur parti n'a pas à valider
  assert.equal(st.phase, 'betting');
  assert.equal(st.players[1].inHand, false);
  g.onLeave(st, 2);
  assert.equal(st.phase, 'over');
  assert.equal(st.winner, 0);
});

test('parties aléatoires : jetons conservés, aucun blocage, toujours un vainqueur', () => {
  let seed = 7;
  const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let t = 0; t < 300; t++) {
    const n = 2 + (t % 7);
    const st = g.init(Array(n).fill('x'), { rng });
    for (let guard = 0; !g.isOver(st); guard++) {
      assert.ok(guard < 20000, 'partie bloquée');
      if (st.phase === 'result') {
        for (let i = 0; i < n; i++) if (st.phase === 'result' && !st.ready[i]) must(act(st, i, 'ready'));
        continue;
      }
      const h = g.view(st, st.turn).hints;
      const r = rng();
      let a;
      if (r < 0.15) a = { type: 'fold' };
      else if (r < 0.22 && h.actions.includes('allin')) a = { type: 'allin' };
      else if (r < 0.45 && h.actions.includes('raise')) a = { type: 'raise', to: h.minRaise + Math.floor(rng() * (h.maxRaise - h.minRaise)) };
      else a = { type: h.actions[1] };
      must(g.action(st, st.turn, a));
      assert.equal(chipsTotal(st), n * STACK);
      if (st.phase === 'betting') assert.equal(new Set([...st.board, ...st.deck, ...st.players.flatMap((p) => p.hand)]).size, st.board.length + st.deck.length + st.players.reduce((s, p) => s + p.hand.length, 0));
    }
    assert.equal(st.players[st.winner].chips, n * STACK);
  }
});
