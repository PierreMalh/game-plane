'use strict';
// Échecs : les règles viennent de chess.js (copié dans server/vendor/), ce
// module ne fait que l'adapter au contrat des jeux (voir games/index.js) :
// validation des coups, fins de partie, propositions de nulle, et vue réseau.
// chess.js reste côté serveur : le client reçoit le FEN et la liste des coups
// légaux, il n'a aucune règle à connaître.
//
// Joueur `white` (index dans la table) = blancs et commence ; il alterne à
// chaque revanche.

const { Chess } = require('../vendor/chess');

const SQUARE = /^[a-h][1-8]$/;
const PROMOTIONS = new Set(['q', 'r', 'b', 'n']);

function init(_playerIds, { first = 0 } = {}) {
  return {
    chess: new Chess(),
    white: first,       // index du joueur blanc
    winner: null,       // null | index | 'draw'
    reason: null,       // checkmate | stalemate | threefold | insufficient | fifty-moves | agreement
    drawOffer: null,    // index du joueur qui propose la nulle
    lastMove: null,
  };
}

// Index du joueur dont c'est le tour.
const turnIdx = (st) => (st.chess.turn() === 'w' ? st.white : 1 - st.white);

// Constate la fin de partie après un coup ; renvoie true si la partie est finie.
function settle(st, mover) {
  const c = st.chess;
  if (c.isCheckmate()) { st.winner = mover; st.reason = 'checkmate'; }
  else if (c.isStalemate()) { st.winner = 'draw'; st.reason = 'stalemate'; }
  else if (c.isInsufficientMaterial()) { st.winner = 'draw'; st.reason = 'insufficient'; }
  else if (c.isThreefoldRepetition()) { st.winner = 'draw'; st.reason = 'threefold'; }
  else if (c.isDrawByFiftyMoves()) { st.winner = 'draw'; st.reason = 'fifty-moves'; }
  return st.winner !== null;
}

function move(st, playerIdx, act) {
  if (playerIdx !== turnIdx(st)) return { ok: false, error: 'not-your-turn' };
  if (!SQUARE.test(act.from ?? '') || !SQUARE.test(act.to ?? '')) return { ok: false, error: 'bad-action' };
  if (act.promotion !== undefined && !PROMOTIONS.has(act.promotion)) return { ok: false, error: 'bad-action' };

  const candidates = st.chess.moves({ square: act.from, verbose: true }).filter((m) => m.to === act.to);
  if (candidates.length === 0) return { ok: false, error: 'illegal-move' };
  if (candidates[0].promotion && !act.promotion) return { ok: false, error: 'promotion-required' };

  const m = st.chess.move({ from: act.from, to: act.to, promotion: act.promotion });
  st.lastMove = { from: m.from, to: m.to };
  // Une nulle proposée reste valable jusqu'à la réponse : seul le coup de l'adversaire
  // (celui à qui on la propose) la refuse implicitement.
  if (st.drawOffer !== null && st.drawOffer !== playerIdx) st.drawOffer = null;
  settle(st, playerIdx);
  return { ok: true };
}

function action(st, playerIdx, act) {
  if (st.winner !== null) return { ok: false, error: 'over' };
  if (!act || typeof act !== 'object') return { ok: false, error: 'bad-action' };

  switch (act.type) {
    case 'move':
      return move(st, playerIdx, act);
    case 'draw-offer':
      if (st.drawOffer === playerIdx) return { ok: false, error: 'already-offered' };
      if (st.drawOffer !== null) { // l'adversaire avait déjà proposé : proposer aussi = accepter
        st.winner = 'draw'; st.reason = 'agreement'; st.drawOffer = null;
        return { ok: true };
      }
      st.drawOffer = playerIdx;
      return { ok: true };
    case 'draw-accept':
      if (st.drawOffer === null || st.drawOffer === playerIdx) return { ok: false, error: 'no-offer' };
      st.winner = 'draw'; st.reason = 'agreement'; st.drawOffer = null;
      return { ok: true };
    case 'draw-decline':
      if (st.drawOffer === null || st.drawOffer === playerIdx) return { ok: false, error: 'no-offer' };
      st.drawOffer = null;
      return { ok: true };
    default:
      return { ok: false, error: 'bad-action' };
  }
}

// Coups légaux regroupés par case de départ : { e2: ['e3', 'e4'], … }.
function legalMap(chess) {
  const map = {};
  for (const m of chess.moves({ verbose: true })) {
    (map[m.from] ??= []);
    if (!map[m.from].includes(m.to)) map[m.from].push(m.to);
  }
  return map;
}

// Ce qui part au client : objet simple (jamais l'instance chess.js).
function view(st, playerIdx) {
  const over = st.winner !== null;
  const mine = turnIdx(st) === playerIdx;
  return {
    fen: st.chess.fen(),
    white: st.white,
    turn: turnIdx(st),
    check: st.chess.isCheck(),
    lastMove: st.lastMove,
    history: st.chess.history(),
    // Les coups légaux ne sont utiles qu'à celui dont c'est le tour.
    legal: !over && mine ? legalMap(st.chess) : null,
    drawOffer: st.drawOffer,
    winner: st.winner,
    reason: st.forfeit ? 'forfeit' : st.reason,
    forfeit: !!st.forfeit,
  };
}

module.exports = {
  id: 'chess',
  name: 'Échecs',
  minPlayers: 2,
  maxPlayers: 2,
  init,
  action,
  view,
  isOver: (st) => st.winner !== null,
  nextFirst: (_st, previousFirst) => 1 - previousFirst,
};
