'use strict';
// Belote classique à 4 joueurs, 2 équipes (partenaires face à face : sièges 0 et 2
// contre 1 et 3). Partie en 501 points.
//
// Donne : 5 cartes chacun, une carte est retournée. Enchères (« prise ») :
//   tour 1  chacun à son tour peut PRENDRE à la couleur de la carte retournée, ou passer ;
//   tour 2  (si tous ont passé) on peut prendre à une AUTRE couleur ;
//   tous passent encore : nouvelle donne (le donneur change).
// Le preneur reçoit la carte retournée + 2 cartes, les autres 3 : 8 cartes chacun.
//
// Jeu (8 plis, le joueur à gauche du donneur entame) :
//   - on fournit la couleur demandée ; à l'atout, on « monte » (carte plus forte) si on peut ;
//   - sans la couleur : on COUPE (atout) si on en a — et on surcoupe si un adversaire a déjà
//     coupé ; si on ne peut pas surcouper on joue quand même un atout —, SAUF si son
//     partenaire est maître du pli : alors on peut se défausser librement.
// Valeur des cartes (atout / autres) : V 20/2 · 9 14/0 · As 11/11 · 10 10/10 · R 4/4 ·
// D 3/3 · 8 et 7 0. Total 152 + 10 de der = 162.
// Belote-rebelote (R + D d'atout dans la même main) : +20, annoncée automatiquement.
// Contrat : l'équipe preneuse doit faire au moins 82 points ; sinon elle « chute » :
// 0 pour elle, 162 pour les défenseurs (la belote reste à qui la détient).
// Capot (tous les plis) : 252 pour l'équipe, 0 pour l'autre.

const { SUITS, rankOf, suitOf, shuffle } = require('./deck');

const RANKS32 = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const PLAIN_POINTS = { A: 11, 10: 10, K: 4, Q: 3, J: 2, 9: 0, 8: 0, 7: 0 };
const TRUMP_POINTS = { J: 20, 9: 14, A: 11, 10: 10, K: 4, Q: 3, 8: 0, 7: 0 };
const PLAIN_ORDER = ['7', '8', '9', 'J', 'Q', 'K', '10', 'A']; // du plus faible au plus fort
const TRUMP_ORDER = ['7', '8', 'Q', 'K', '10', 'A', '9', 'J'];
const TARGET = 501;
const CONTRACT = 82;
const DIX_DE_DER = 10;
const BELOTE = 20;
const CAPOT = 252;
const LOG_MAX = 24;
const DISPLAY_SUITS = ['S', 'H', 'C', 'D']; // couleurs alternées noir / rouge

const ok = () => ({ ok: true });
const fail = (error) => ({ ok: false, error });
const say = (st, text) => { st.log.push(text); if (st.log.length > LOG_MAX) st.log.shift(); };

const deck32 = () => RANKS32.flatMap((r) => SUITS.map((s) => r + s));
const team = (p) => p % 2;
const partner = (p) => (p + 2) % 4;
const isTrump = (st, c) => suitOf(c) === st.trump;
const strength = (st, c) => (isTrump(st, c) ? 100 + TRUMP_ORDER.indexOf(rankOf(c)) : PLAIN_ORDER.indexOf(rankOf(c)));
const pointsOf = (st, c) => (isTrump(st, c) ? TRUMP_POINTS : PLAIN_POINTS)[rankOf(c)];

// ---------------------------------------------------------------- donne et enchères

function init(ids, { rng = Math.random, first = 0, target = TARGET } = {}) {
  const st = {
    rng,
    target,
    dealer: first % 4,
    round: 1,
    phase: 'bid1',
    hands: [[], [], [], []],
    turned: null,
    rest: [],
    trump: null,
    taker: null,
    turn: 0,
    passes: 0,
    trick: [],            // [{ p, card }] du pli en cours
    lastTrick: null,      // { cards, winner }
    cardPts: [0, 0],
    tricks: [0, 0],
    belote: { holder: null, played: 0 },
    scores: [0, 0],
    result: null,
    ready: [false, false, false, false],
    winnerTeam: null,
    forfeit: false,
    log: [],
  };
  deal(st);
  return st;
}

function deal(st) {
  const deck = shuffle(deck32(), st.rng);
  st.hands = [[], [], [], []];
  const start = (st.dealer + 1) % 4;
  let k = 0;
  for (const n of [3, 2]) { // 3 cartes puis 2 cartes à chacun, en commençant à gauche du donneur
    for (let s = 0; s < 4; s++) {
      st.hands[(start + s) % 4].push(...deck.slice(k, k + n));
      k += n;
    }
  }
  st.turned = deck[k++];
  st.rest = deck.slice(k);
  st.trump = null;
  st.taker = null;
  st.trick = [];
  st.lastTrick = null;
  st.cardPts = [0, 0];
  st.tricks = [0, 0];
  st.belote = { holder: null, played: 0 };
  st.result = null;
  st.ready = [false, false, false, false];
  st.phase = 'bid1';
  st.turn = start;
  st.passes = 0;
  say(st, `Donne ${st.round} : carte retournée ${st.turned}.`);
}

// Le preneur choisit la couleur d'atout : la donne est complétée et le jeu commence.
function take(st, idx, suit) {
  st.taker = idx;
  st.trump = suit;
  st.hands[idx].push(st.turned, ...st.rest.slice(0, 2));
  let k = 2;
  for (let s = 1; s <= 4; s++) {
    const p = (st.dealer + s) % 4;
    if (p === idx) continue;
    st.hands[p].push(...st.rest.slice(k, k + 3));
    k += 3;
  }
  st.rest = [];
  for (const h of st.hands) h.sort((a, b) => strength(st, a) - strength(st, b));
  // Belote-rebelote : R et D d'atout dans la même main.
  const holder = st.hands.findIndex((h) => h.includes('K' + suit) && h.includes('Q' + suit));
  st.belote = { holder: holder === -1 ? null : holder, played: 0 };
  st.phase = 'play';
  st.turn = (st.dealer + 1) % 4;
  st.trick = [];
  say(st, `@${idx} prend à ${suit}.`);
}

// ---------------------------------------------------------------- jeu de la carte

// Maître actuel d'un pli (complet ou non) : joueur qui l'emporterait.
function trickWinner(st, trick) {
  const lead = suitOf(trick[0].card);
  const trumps = trick.filter((t) => isTrump(st, t.card));
  const pool = trumps.length ? trumps : trick.filter((t) => suitOf(t.card) === lead);
  return pool.reduce((best, t) => (strength(st, t.card) > strength(st, best.card) ? t : best)).p;
}

// Cartes que `idx` a le droit de jouer.
function legalCards(st, idx) {
  const hand = st.hands[idx];
  if (st.trick.length === 0) return [...hand];
  const lead = suitOf(st.trick[0].card);
  const maxTrump = Math.max(-1, ...st.trick.filter((t) => isTrump(st, t.card)).map((t) => strength(st, t.card)));
  const trumps = hand.filter((c) => isTrump(st, c));

  if (lead === st.trump) { // atout demandé : fournir, et monter si possible
    if (trumps.length === 0) return [...hand];
    const higher = trumps.filter((c) => strength(st, c) > maxTrump);
    return higher.length ? higher : trumps;
  }
  const follow = hand.filter((c) => suitOf(c) === lead);
  if (follow.length) return follow;
  if (trumps.length === 0) return [...hand];
  if (trickWinner(st, st.trick) === partner(idx)) return [...hand]; // le partenaire est maître : libre
  const higher = trumps.filter((c) => strength(st, c) > maxTrump);
  return higher.length ? higher : trumps; // surcouper si possible, sinon sous-couper
}

function playCard(st, idx, card) {
  const hand = st.hands[idx];
  hand.splice(hand.indexOf(card), 1);
  st.trick.push({ p: idx, card });

  // Belote / rebelote : annoncées automatiquement à la pose du R puis de la D d'atout.
  if (st.belote.holder === idx && isTrump(st, card) && (rankOf(card) === 'K' || rankOf(card) === 'Q')) {
    st.belote.played++;
    say(st, st.belote.played === 1 ? `@${idx} : Belote !` : `@${idx} : Rebelote ! (+${BELOTE})`);
  }

  if (st.trick.length < 4) { st.turn = (idx + 1) % 4; return; }

  const winner = trickWinner(st, st.trick);
  const pts = st.trick.reduce((n, t) => n + pointsOf(st, t.card), 0);
  st.cardPts[team(winner)] += pts;
  st.tricks[team(winner)]++;
  st.lastTrick = { cards: st.trick.map((t) => ({ ...t })), winner };
  st.trick = [];
  say(st, `@${winner} remporte le pli (${pts} pts).`);
  if (st.hands.every((h) => h.length === 0)) endRound(st, team(winner));
  else st.turn = winner;
}

// ---------------------------------------------------------------- fin de donne

function endRound(st, lastWinnerTeam) {
  const pts = [...st.cardPts];
  pts[lastWinnerTeam] += DIX_DE_DER;
  const takerTeam = team(st.taker);
  const bel = st.belote.holder === null ? null : team(st.belote.holder);
  const capot = st.tricks[0] === 8 ? 0 : st.tricks[1] === 8 ? 1 : null;

  let add = [0, 0];
  let made;
  if (capot !== null) {
    made = capot === takerTeam;
    add[capot] = CAPOT;
  } else {
    const totals = [...pts];
    if (bel !== null) totals[bel] += BELOTE; // la belote compte pour le contrat
    made = totals[takerTeam] >= CONTRACT;
    if (made) add = totals;
    else add[1 - takerTeam] = 162;
  }
  if (capot !== null || !made) { if (bel !== null) add[bel] += BELOTE; } // toujours acquise à qui la détient

  st.scores[0] += add[0];
  st.scores[1] += add[1];
  st.result = { takerTeam, made, capot, cardPts: pts, belote: bel, dixDeDer: lastWinnerTeam, add, scores: [...st.scores] };
  say(st, made ? `Contrat rempli (${pts[takerTeam]} pts).` : 'Contrat chuté (« dedans ») !');

  const best = Math.max(...st.scores);
  if (best >= st.target && st.scores[0] !== st.scores[1]) {
    st.winnerTeam = st.scores[0] > st.scores[1] ? 0 : 1;
    st.phase = 'over';
    say(st, `L'équipe ${st.winnerTeam === 0 ? 'des sièges 1 et 3' : 'des sièges 2 et 4'} remporte la partie !`);
  } else {
    st.phase = 'roundover';
    st.ready = [false, false, false, false];
  }
}

// ---------------------------------------------------------------- actions

function action(st, idx, act) {
  if (st.phase === 'over') return fail('over');
  if (!act || typeof act.type !== 'string') return fail('bad-action');
  if (!st.hands[idx]) return fail('bad-action');

  switch (act.type) {
    case 'take': {
      if ((st.phase !== 'bid1' && st.phase !== 'bid2') || st.turn !== idx) return fail('not-your-turn');
      const turnedSuit = suitOf(st.turned);
      let suit = turnedSuit;
      if (st.phase === 'bid2') {
        if (!SUITS.includes(act.suit) || act.suit === turnedSuit) return fail('bad-suit');
        suit = act.suit;
      }
      take(st, idx, suit);
      return ok();
    }

    case 'pass': {
      if ((st.phase !== 'bid1' && st.phase !== 'bid2') || st.turn !== idx) return fail('not-your-turn');
      say(st, `@${idx} passe.`);
      st.passes++;
      st.turn = (idx + 1) % 4;
      if (st.passes === 4) {
        if (st.phase === 'bid1') { st.phase = 'bid2'; st.passes = 0; st.turn = (st.dealer + 1) % 4; say(st, 'Second tour : une autre couleur est possible.'); }
        else { st.dealer = (st.dealer + 1) % 4; say(st, 'Personne ne prend : nouvelle donne.'); deal(st); }
      }
      return ok();
    }

    case 'play': {
      if (st.phase !== 'play' || st.turn !== idx) return fail('not-your-turn');
      if (typeof act.card !== 'string' || !st.hands[idx].includes(act.card)) return fail('not-in-hand');
      if (!legalCards(st, idx).includes(act.card)) return fail('illegal-card');
      playCard(st, idx, act.card);
      return ok();
    }

    case 'ready': {
      if (st.phase !== 'roundover') return fail('not-your-turn');
      st.ready[idx] = true;
      if (st.ready.every(Boolean)) { st.round++; st.dealer = (st.dealer + 1) % 4; deal(st); }
      return ok();
    }

    default:
      return fail('bad-action');
  }
}

// Un joueur qui part fait perdre son équipe (à 4 on ne peut pas continuer à 3).
function onLeave(st, idx) {
  if (st.phase === 'over') return;
  st.winnerTeam = 1 - team(idx);
  st.forfeit = true;
  st.phase = 'over';
  say(st, `@${idx} a quitté la partie.`);
}

// ---------------------------------------------------------------- vue

// Main triée : atout d'abord (une fois connu), couleurs alternées, du plus fort au plus faible.
function sortedHand(st, hand) {
  const order = st.trump ? [st.trump, ...DISPLAY_SUITS.filter((s) => s !== st.trump)] : DISPLAY_SUITS;
  const plain = (c) => PLAIN_ORDER.indexOf(rankOf(c));
  const power = (c) => (st.trump ? strength(st, c) % 100 : plain(c));
  return [...hand].sort((a, b) => order.indexOf(suitOf(a)) - order.indexOf(suitOf(b)) || power(b) - power(a));
}

function view(st, idx) {
  const hand = st.hands[idx];
  const hints = { actions: [], legal: [], suits: [] };
  if (st.phase === 'play' && st.turn === idx) {
    hints.actions.push('play');
    hints.legal = legalCards(st, idx);
  } else if ((st.phase === 'bid1' || st.phase === 'bid2') && st.turn === idx) {
    hints.actions.push('take', 'pass');
    if (st.phase === 'bid2') hints.suits = SUITS.filter((s) => s !== suitOf(st.turned));
  } else if (st.phase === 'roundover' && !st.ready[idx]) {
    hints.actions.push('ready');
  }
  return {
    phase: st.phase,
    round: st.round,
    dealer: st.dealer,
    turn: st.turn,
    target: st.target,
    scores: [...st.scores],
    turned: st.phase === 'bid1' || st.phase === 'bid2' ? st.turned : null,
    trump: st.trump,
    taker: st.taker,
    hand: sortedHand(st, hand),
    counts: st.hands.map((h) => h.length),
    trick: st.trick.map((t) => ({ ...t })),
    lastTrick: st.lastTrick && { winner: st.lastTrick.winner, cards: st.lastTrick.cards.map((t) => ({ ...t })) },
    tricks: [...st.tricks],
    result: st.result && { ...st.result, cardPts: [...st.result.cardPts], add: [...st.result.add], scores: [...st.result.scores] },
    ready: [...st.ready],
    winnerTeam: st.winnerTeam,
    forfeit: st.forfeit,
    log: [...st.log],
    hints,
  };
}

module.exports = {
  id: 'belote',
  name: 'Belote',
  blurb: '4 joueurs · 2 équipes · prise, atout, belote-rebelote · en 501',
  minPlayers: 4,
  maxPlayers: 4,
  init: (ids, opts) => init(ids, opts),
  action,
  view,
  onLeave,
  isOver: (st) => st.phase === 'over',
  nextFirst: (_st, previousFirst) => previousFirst + 1,
  // Exposés pour les tests :
  legalCards,
  trickWinner,
  strength,
  pointsOf,
  deck32,
};
