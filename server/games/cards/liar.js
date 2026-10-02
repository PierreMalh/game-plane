'use strict';
// Menteur (« Bluff »), 3 à 8 joueurs. Toutes les cartes sont distribuées. À son
// tour, on pose 1 à 4 cartes FACE CACHÉE en annonçant le rang demandé (As, puis 2,
// 3 … Roi, et on recommence) : on peut mentir. Le joueur suivant, au lieu de
// poser, peut crier « Menteur ! » : les cartes sont retournées. Si l'une n'est
// pas du rang annoncé, le menteur ramasse tout le tas ; sinon c'est celui qui l'a
// accusé à tort. Celui qui a accusé rejoue en premier. Premier à vider sa main
// gagne… si sa dernière pose n'est pas démasquée par le suivant.

const { RANKS, rankOf, makeDeck, isCard, shuffle, dealAll, takeCards } = require('./deck');

const CLAIM_ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const LOG_MAX = 20;

const ok = () => ({ ok: true });
const fail = (error) => ({ ok: false, error });
const say = (st, text) => { st.log.push(text); if (st.log.length > LOG_MAX) st.log.shift(); };
const byRank = (a, b) => RANKS.indexOf(rankOf(a)) - RANKS.indexOf(rankOf(b));
const inGame = (st) => st.players.map((_, i) => i).filter((i) => !st.players[i].left);

const cartes = (n) => `${n} carte${n > 1 ? 's' : ''}`;
const claimRank = (st) => CLAIM_ORDER[st.step % CLAIM_ORDER.length];

function nextPlayer(st, from) {
  let i = from;
  do { i = (i + 1) % st.n; } while (st.players[i].left);
  return i;
}

function init(ids, { rng = Math.random, first = 0 } = {}) {
  const n = ids.length;
  const hands = dealAll(shuffle(makeDeck(), rng), n);
  return {
    rng, n,
    players: ids.map((_, i) => ({ hand: hands[i], left: false })),
    pile: [],          // cartes posées (cachées)
    step: 0,           // fait avancer le rang annoncé
    turn: first % n,
    last: null,        // dernière pose : { p, count, rank, cards }
    pendingWin: null,  // joueur qui vient de vider sa main : le suivant décide
    reveal: null,      // résultat de la dernière contestation (public)
    winner: null,
    log: [],
  };
}

function action(st, idx, act) {
  if (st.winner !== null) return fail('over');
  if (!act || typeof act.type !== 'string') return fail('bad-action');
  const me = st.players[idx];
  if (!me || me.left || st.turn !== idx) return fail('not-your-turn');

  switch (act.type) {
    case 'play': {
      if (st.pendingWin !== null) return fail('must-respond');
      const cards = act.cards;
      if (!Array.isArray(cards) || cards.length < 1 || cards.length > 4 || !cards.every(isCard)) return fail('bad-cards');
      if (!takeCards(me.hand, cards)) return fail('not-in-hand');
      const rank = claimRank(st);
      st.pile.push(...cards);
      st.last = { p: idx, count: cards.length, rank, cards: [...cards] };
      st.step++;
      st.reveal = null;
      say(st, `@${idx} pose ${cartes(cards.length)} (annoncées : ${rank}).`);
      if (me.hand.length === 0) st.pendingWin = idx;
      st.turn = nextPlayer(st, idx);
      return ok();
    }

    case 'call': {
      if (st.last === null) return fail('nothing-to-call');
      const { last } = st;
      const truthful = last.cards.every((c) => rankOf(c) === last.rank);
      const loser = truthful ? idx : last.p;
      const taken = st.pile.length;
      st.players[loser].hand.push(...st.pile);
      st.pile = [];
      st.reveal = { caller: idx, target: last.p, cards: [...last.cards], rank: last.rank, truthful, loser, taken };
      say(st, truthful
        ? `@${idx} accuse @${last.p} à tort : il ramasse ${cartes(taken)}.`
        : `@${last.p} mentait ! Il ramasse ${cartes(taken)}.`);
      if (st.pendingWin !== null && truthful) { st.winner = st.pendingWin; say(st, `@${st.winner} a gagné !`); }
      st.pendingWin = null;
      st.last = null;
      if (st.winner === null) st.turn = idx; // celui qui a accusé rejoue en premier
      return ok();
    }

    case 'accept': {
      if (st.pendingWin === null) return fail('nothing-to-accept');
      st.winner = st.pendingWin;
      say(st, `@${st.winner} a gagné !`);
      return ok();
    }

    default:
      return fail('bad-action');
  }
}

function onLeave(st, idx) {
  const p = st.players[idx];
  if (!p || p.left || st.winner !== null) return;
  p.left = true;
  p.hand = []; // ses cartes sortent du jeu
  say(st, `@${idx} a quitté la partie.`);
  if (st.pendingWin === idx) st.pendingWin = null;
  const live = inGame(st);
  if (live.length <= 1) { st.winner = live[0] ?? null; return; }
  if (st.turn === idx) st.turn = nextPlayer(st, idx);
}

function view(st, idx) {
  const me = st.players[idx];
  const hints = { actions: [] };
  if (st.winner === null && me && !me.left && st.turn === idx) {
    if (st.pendingWin !== null) hints.actions.push('call', 'accept');
    else {
      hints.actions.push('play');
      if (st.last !== null) hints.actions.push('call');
    }
  }
  return {
    players: st.players.map((p) => ({ count: p.hand.length, left: p.left })),
    hand: me ? [...me.hand].sort(byRank) : [],
    pile: st.pile.length,
    claim: claimRank(st),
    last: st.last && { p: st.last.p, count: st.last.count, rank: st.last.rank }, // jamais les cartes
    pendingWin: st.pendingWin,
    reveal: st.reveal && { ...st.reveal, cards: [...st.reveal.cards] },
    turn: st.turn,
    winner: st.winner,
    log: [...st.log],
    hints,
  };
}

module.exports = {
  id: 'liar',
  name: 'Menteur',
  blurb: '3 à 8 joueurs · pose, bluffe, contredis',
  minPlayers: 3,
  maxPlayers: 8,
  autoStart: false,
  init: (ids, opts) => init(ids, opts),
  action,
  view,
  onLeave,
  isOver: (st) => st.winner !== null,
  nextFirst: (_st, previousFirst) => previousFirst + 1,
  CLAIM_ORDER,
};
