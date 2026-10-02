'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const c4 = require('../server/games/connect4');

const drop = (st, who, col) => c4.action(st, who, { type: 'drop', col });

// Joue une suite de colonnes en alternant, en partant du joueur 0.
function play(cols, first = 0) {
  const st = c4.init([], { first });
  let who = first;
  for (const col of cols) {
    const r = drop(st, who, col);
    assert.equal(r.ok, true, `coup colonne ${col} refusé : ${r.error}`);
    who = 1 - who;
  }
  return st;
}

test('le jeton tombe tout en bas et les tours alternent', () => {
  const st = c4.init([]);
  assert.equal(drop(st, 0, 3).ok, true);
  assert.equal(st.board[5][3], 0);
  assert.deepEqual(st.lastMove, { row: 5, col: 3 });
  assert.equal(st.turn, 1);
  drop(st, 1, 3);
  assert.equal(st.board[4][3], 1);
});

test('refus : mauvais tour, colonne invalide, action inconnue, colonne pleine', () => {
  const st = c4.init([]);
  assert.equal(drop(st, 1, 0).error, 'not-your-turn');
  assert.equal(drop(st, 0, -1).error, 'bad-action');
  assert.equal(drop(st, 0, 7).error, 'bad-action');
  assert.equal(drop(st, 0, 1.5).error, 'bad-action');
  assert.equal(drop(st, 0, '3').error, 'bad-action');
  assert.equal(c4.action(st, 0, { type: 'nope' }).error, 'bad-action');
  assert.equal(c4.action(st, 0, null).error, 'bad-action');
  // Remplit la colonne 0 (6 jetons), le 7e est refusé sans changer le tour.
  const full = play([0, 0, 0, 0, 0, 0]);
  assert.equal(drop(full, 0, 0).error, 'column-full');
  assert.equal(full.turn, 0);
});

test('victoire horizontale', () => {
  const st = play([0, 0, 1, 1, 2, 2, 3]);
  assert.equal(st.winner, 0);
  assert.equal(st.winLine.length, 4);
  assert.equal(drop(st, 1, 4).error, 'over');
});

test('victoire verticale', () => {
  const st = play([0, 1, 0, 1, 0, 1, 0]);
  assert.equal(st.winner, 0);
  assert.deepEqual(st.winLine.map(([r]) => r).sort(), [2, 3, 4, 5]);
});

test('victoire diagonale montante (↗)', () => {
  // Rouge : (5,0) (4,1) (3,2) (2,3)
  const st = play([0, 1, 1, 2, 3, 2, 2, 3, 3, 6, 3]);
  assert.equal(st.winner, 0);
  assert.equal(st.winLine.length, 4);
});

test('victoire diagonale descendante (↘), côté jaune', () => {
  // Position posée à la main : jaune en (5,3) (4,2) (3,1), il joue la colonne 0 → (2,0).
  const st = c4.init([], { first: 1 });
  const set = (r, col, who) => { st.board[r][col] = who; };
  for (const r of [5, 4, 3]) set(r, 0, 0); // colonne 0 : trois rouges
  set(5, 1, 0); set(4, 1, 0); set(3, 1, 1);
  set(5, 2, 0); set(4, 2, 1);
  set(5, 3, 1);
  assert.equal(drop(st, 1, 0).ok, true);
  assert.equal(st.winner, 1);
  assert.deepEqual(st.winLine.map(([r, c]) => `${r},${c}`).sort(), ['2,0', '3,1', '4,2', '5,3']);
});

test('trois alignés ne suffisent pas ; la victoire n’arrive pas par-dessus un bord', () => {
  const st = play([0, 0, 1, 1, 2]);
  assert.equal(st.winner, null);
  // Colonnes 5,6 puis 0,1 : pas de « bouclage » entre les bords du plateau.
  const st2 = play([5, 0, 6, 0, 0, 1, 1]);
  assert.equal(st2.winner, null);
});

test('match nul sur plateau plein sans alignement', () => {
  // Motif sans 4 alignés : couleur = ((ligne >> 1) + colonne) % 2.
  const st = c4.init([]);
  const color = (r, col) => ((r >> 1) + col) % 2;
  for (let r = 0; r < c4.ROWS; r++) for (let col = 0; col < c4.COLS; col++) st.board[r][col] = color(r, col);
  st.board[0][3] = null; // dernière case libre
  st.turn = color(0, 3);
  assert.equal(drop(st, st.turn, 3).ok, true);
  assert.equal(st.winner, 'draw');
  assert.equal(st.winLine, null);
});

test('le premier joueur peut être le joueur 1 (revanche)', () => {
  const st = c4.init([], { first: 1 });
  assert.equal(drop(st, 0, 0).error, 'not-your-turn');
  assert.equal(drop(st, 1, 0).ok, true);
  assert.equal(c4.nextFirst(st, 1), 0);
});
