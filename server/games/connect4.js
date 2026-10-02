'use strict';
// Puissance 4 : logique pure, sans réseau. Le serveur est seul juge des coups.
// Joueur 0 = rouge (commence), joueur 1 = jaune. board[ligne][colonne], ligne 0 en haut.

const ROWS = 6;
const COLS = 7;
const NEEDED = 4;
const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]]; // horizontal, vertical, deux diagonales

const emptyBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));

// first : joueur qui commence (alterné à chaque revanche).
function init(first = 0) {
  return { board: emptyBoard(), turn: first, winner: null, winLine: null, lastMove: null };
}

// Cases alignées (≥ 4) passant par (r, c), ou null.
function findWin(board, r, c) {
  const who = board[r][c];
  for (const [dr, dc] of DIRECTIONS) {
    const line = [[r, c]];
    for (const sign of [1, -1]) {
      let rr = r + dr * sign;
      let cc = c + dc * sign;
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && board[rr][cc] === who) {
        line.push([rr, cc]);
        rr += dr * sign;
        cc += dc * sign;
      }
    }
    if (line.length >= NEEDED) return line;
  }
  return null;
}

// Joue un jeton dans une colonne. Mutate `state` ; renvoie { ok } ou { ok:false, error }.
function action(state, playerIdx, act) {
  if (state.winner !== null) return { ok: false, error: 'over' };
  if (playerIdx !== state.turn) return { ok: false, error: 'not-your-turn' };
  if (!act || act.type !== 'drop' || !Number.isInteger(act.col) || act.col < 0 || act.col >= COLS) {
    return { ok: false, error: 'bad-action' };
  }
  const col = act.col;
  let row = ROWS - 1;
  while (row >= 0 && state.board[row][col] !== null) row--;
  if (row < 0) return { ok: false, error: 'column-full' };

  state.board[row][col] = playerIdx;
  state.lastMove = { row, col };
  const line = findWin(state.board, row, col);
  if (line) {
    state.winner = playerIdx;
    state.winLine = line;
  } else if (state.board[0].every((cell) => cell !== null)) {
    state.winner = 'draw';
  } else {
    state.turn = 1 - playerIdx;
  }
  return { ok: true };
}

module.exports = {
  id: 'connect4',
  name: 'Puissance 4',
  minPlayers: 2,
  maxPlayers: 2,
  init: (_playerIds, { first = 0 } = {}) => init(first),
  action,
  view: (state) => state, // pas d'information cachée
  isOver: (state) => state.winner !== null,
  // Joueur qui commence la manche suivante (on alterne).
  nextFirst: (state, previousFirst) => 1 - previousFirst,
  ROWS,
  COLS,
};
