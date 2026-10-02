'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const chess = require('../server/games/chess');

const mv = (st, who, from, to, promotion) => chess.action(st, who, { type: 'move', from, to, promotion });
// Joue une suite de coups « e2e4 » en alternant blancs (0) / noirs (1).
function play(moves, first = 0) {
  const st = chess.init([], { first });
  let who = first;
  for (const m of moves) {
    const r = mv(st, who, m.slice(0, 2), m.slice(2, 4), m[4]);
    assert.equal(r.ok, true, `coup ${m} refusé : ${r.error}`);
    who = 1 - who;
  }
  return st;
}
// État posé à partir d'un FEN (le trait doit correspondre au joueur qui joue).
function fromFen(fen, first = 0) {
  const st = chess.init([], { first });
  st.chess.load(fen);
  return st;
}

test('départ : blancs = joueur 0, 20 coups légaux, vue sans l’instance chess.js', () => {
  const st = chess.init([]);
  const v = chess.view(st, 0);
  assert.equal(v.turn, 0);
  assert.equal(Object.values(v.legal).flat().length, 20);
  assert.deepEqual(v.legal.e2, ['e3', 'e4']);
  assert.equal(chess.view(st, 1).legal, null); // pas son tour : pas de coups
  assert.doesNotThrow(() => JSON.stringify(v));
  assert.equal(JSON.stringify(v).includes('chess'), false);
});

test('tour, coup illégal, cases invalides', () => {
  const st = chess.init([]);
  assert.equal(mv(st, 1, 'e7', 'e5').error, 'not-your-turn');
  assert.equal(mv(st, 0, 'e2', 'e5').error, 'illegal-move');
  assert.equal(mv(st, 0, 'e7', 'e5').error, 'illegal-move'); // pièce adverse
  assert.equal(mv(st, 0, 'e2', 'z9').error, 'bad-action');
  assert.equal(mv(st, 0, 'e2').error, 'bad-action');
  assert.equal(mv(st, 0, 'e2', 'e4', 'x').error, 'bad-action');
  assert.equal(chess.action(st, 0, { type: 'nope' }).error, 'bad-action');
  assert.equal(chess.action(st, 0, null).error, 'bad-action');
  assert.equal(mv(st, 0, 'e2', 'e4').ok, true);
  assert.equal(chess.view(st, 1).turn, 1);
});

test('mat du berger : victoire des blancs', () => {
  const st = play(['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7']);
  assert.equal(st.winner, 0);
  assert.equal(chess.view(st, 1).reason, 'checkmate');
  assert.equal(chess.isOver(st), true);
  assert.equal(mv(st, 1, 'e8', 'f7').error, 'over');
  assert.equal(chess.view(st, 1).legal, null);
});

test('mat du fou : victoire des noirs (joueur 1)', () => {
  const st = play(['f2f3', 'e7e5', 'g2g4', 'd8h4']);
  assert.equal(st.winner, 1);
});

test('couleurs alternées : si le joueur 1 a les blancs, il commence', () => {
  const st = chess.init([], { first: 1 });
  assert.equal(mv(st, 0, 'e2', 'e4').error, 'not-your-turn');
  assert.equal(mv(st, 1, 'e2', 'e4').ok, true);
  const v = chess.view(st, 0);
  assert.equal(v.white, 1);
  assert.equal(v.turn, 0);
  assert.equal(chess.nextFirst(st, 1), 0);
});

test('échec signalé et obligation de parer', () => {
  const st = play(['e2e4', 'f7f6', 'd1h5']);
  assert.equal(chess.view(st, 1).check, true);
  assert.equal(mv(st, 1, 'a7', 'a6').error, 'illegal-move'); // ne pare pas l'échec
  assert.equal(mv(st, 1, 'g7', 'g6').ok, true);
});

test('promotion : choix obligatoire, pièce choisie posée', () => {
  const st = fromFen('8/P7/8/8/8/8/k6K/8 w - - 0 1');
  assert.deepEqual(chess.view(st, 0).legal.a7, ['a8']);
  assert.equal(mv(st, 0, 'a7', 'a8').error, 'promotion-required');
  assert.equal(mv(st, 0, 'a7', 'a8', 'n').ok, true);
  assert.match(st.chess.fen(), /^N7/); // cavalier en a8
});

test('roque et prise en passant sont des coups légaux', () => {
  const castle = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.ok(chess.view(castle, 0).legal.e1.includes('g1'));
  assert.equal(mv(castle, 0, 'e1', 'g1').ok, true);
  assert.match(castle.chess.fen(), /R4RK1/);

  const ep = fromFen('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
  assert.ok(chess.view(ep, 0).legal.e5.includes('d6'));
  assert.equal(mv(ep, 0, 'e5', 'd6').ok, true);
  assert.equal(ep.chess.get('d5'), undefined); // pion pris en passant
});

test('pat = nulle', () => {
  const st = fromFen('7k/5Q2/8/8/8/8/8/K7 w - - 0 1');
  assert.equal(mv(st, 0, 'f7', 'f7').error, 'illegal-move'); // sur place
  assert.equal(mv(st, 0, 'f7', 'g6').ok, true);
  assert.equal(st.winner, 'draw');
  assert.equal(chess.view(st, 1).reason, 'stalemate');
});

test('matériel insuffisant = nulle', () => {
  // Le roi blanc prend le cavalier noir : il reste roi contre roi.
  const st = fromFen('8/8/8/4k3/8/8/4Kn2/8 w - - 0 1');
  assert.equal(mv(st, 0, 'e2', 'f2').ok, true);
  assert.equal(st.winner, 'draw');
  assert.equal(chess.view(st, 1).reason, 'insufficient');
});

test('triple répétition = nulle', () => {
  const st = play(['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']);
  assert.equal(st.winner, 'draw');
  assert.equal(chess.view(st, 0).reason, 'threefold');
});

test('règle des 50 coups = nulle', () => {
  const st = fromFen('4k3/8/8/8/8/8/R7/4K3 w - - 99 80');
  assert.equal(mv(st, 0, 'a2', 'a3').ok, true);
  assert.equal(st.winner, 'draw');
  assert.equal(chess.view(st, 0).reason, 'fifty-moves');
});

test('nulle par accord : proposer, accepter, refuser, annulée par un coup', () => {
  const st = chess.init([]);
  assert.equal(chess.action(st, 1, { type: 'draw-accept' }).error, 'no-offer');
  assert.equal(chess.action(st, 0, { type: 'draw-offer' }).ok, true);
  assert.equal(chess.view(st, 1).drawOffer, 0);
  assert.equal(chess.action(st, 0, { type: 'draw-offer' }).error, 'already-offered');
  assert.equal(chess.action(st, 0, { type: 'draw-accept' }).error, 'no-offer'); // pas sa propre offre
  assert.equal(chess.action(st, 1, { type: 'draw-decline' }).ok, true);
  assert.equal(st.drawOffer, null);

  chess.action(st, 0, { type: 'draw-offer' });
  mv(st, 0, 'e2', 'e4');
  assert.equal(st.drawOffer, 0); // son propre coup ne retire pas son offre…
  mv(st, 1, 'e7', 'e5');
  assert.equal(st.drawOffer, null); // …un coup de l'adversaire la refuse

  chess.action(st, 1, { type: 'draw-offer' });
  assert.equal(chess.action(st, 0, { type: 'draw-accept' }).ok, true);
  assert.equal(st.winner, 'draw');
  assert.equal(chess.view(st, 0).reason, 'agreement');
});
