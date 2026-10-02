'use strict';
// 8 américain, 2 à 6 joueurs. 7 cartes chacun ; on pose une carte de la même
// couleur ou du même rang que le haut de la défausse.
//   8  joker : on choisit la couleur demandée
//   2  le suivant pioche 2 cartes (cumulable : un autre 2 reporte +2 sur le suivant)
//   A  le suivant passe son tour
//   V  (valet) change le sens du jeu ; à 2 joueurs, on rejoue
// Impossible de jouer : on pioche une carte (seulement dans ce cas) ; si elle se
// joue, on peut la poser, sinon on passe. Le premier à vider sa main gagne.

const { SUITS, RANKS, rankOf, suitOf, makeDeck, isCard, shuffle, takeCards } = require('./deck');

const HAND = 7;
const SPECIAL = new Set(['8', '2', 'A', 'J']);
const LOG_MAX = 20;

const ok = () => ({ ok: true });
const fail = (error) => ({ ok: false, error });
const say = (st, text) => { st.log.push(text); if (st.log.length > LOG_MAX) st.log.shift(); };
const byHand = (a, b) => SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)) || RANKS.indexOf(rankOf(a)) - RANKS.indexOf(rankOf(b));

const top = (st) => st.discard[st.discard.length - 1];
const inGame = (st) => st.players.map((_, i) => i).filter((i) => !st.players[i].left);

function init(ids, { rng = Math.random, first = 0 } = {}) {
  const n = ids.length;
  const deck = shuffle(makeDeck(), rng);
  const players = ids.map(() => ({ hand: [], left: false }));
  for (const p of players) p.hand = deck.splice(0, HAND);
  // Carte de départ : on évite les cartes spéciales.
  let at = deck.findIndex((c) => !SPECIAL.has(rankOf(c)));
  if (at === -1) at = 0;
  const starter = deck.splice(at, 1)[0];
  return {
    rng, n, players, draw: deck, discard: [starter], suit: suitOf(starter),
    turn: first % n, dir: 1, pendingDraw: 0, drew: false, winner: null, log: [],
  };
}

function playable(st, card) {
  if (st.pendingDraw > 0) return rankOf(card) === '2'; // on ne peut que se défendre
  if (rankOf(card) === '8') return true;
  return suitOf(card) === st.suit || rankOf(card) === rankOf(top(st));
}

// Joueur `steps` places après `from`, dans le sens du jeu, en sautant ceux qui sont partis.
function nextPlayer(st, from, steps = 1) {
  let i = from;
  for (let k = 0; k < steps; k++) {
    do { i = (i + st.dir + st.n) % st.n; } while (st.players[i].left);
  }
  return i;
}

// Pioche `count` cartes ; si la pioche est vide, la défausse (sauf le haut) est remélangée.
function drawCards(st, count) {
  const out = [];
  for (let k = 0; k < count; k++) {
    if (st.draw.length === 0 && st.discard.length > 1) {
      const keep = st.discard.pop();
      st.draw = shuffle(st.discard, st.rng);
      st.discard = [keep];
    }
    if (st.draw.length === 0) break;
    out.push(st.draw.pop());
  }
  return out;
}

function endTurn(st, from, steps = 1) {
  st.drew = false;
  st.turn = nextPlayer(st, from, steps);
}

function action(st, idx, act) {
  if (st.winner !== null) return fail('over');
  if (!act || typeof act.type !== 'string') return fail('bad-action');
  const me = st.players[idx];
  if (!me || me.left || st.turn !== idx) return fail('not-your-turn');

  switch (act.type) {
    case 'play': {
      const card = act.card;
      if (!isCard(card) || !me.hand.includes(card)) return fail('not-in-hand');
      if (!playable(st, card)) return fail(st.pendingDraw > 0 ? 'must-defend' : 'not-playable');
      const rank = rankOf(card);
      if (rank === '8' && !SUITS.includes(act.suit)) return fail('choose-suit');

      takeCards(me.hand, [card]);
      st.discard.push(card);
      st.suit = rank === '8' ? act.suit : suitOf(card);
      say(st, rank === '8' ? `@${idx} joue ${card} et demande ${act.suit}.` : `@${idx} joue ${card}.`);

      if (me.hand.length === 0) {
        st.winner = idx;
        say(st, `@${idx} a gagné !`);
        return ok();
      }
      if (rank === '2') { st.pendingDraw += 2; endTurn(st, idx); return ok(); }
      if (rank === 'A') { say(st, 'Le suivant passe son tour.'); endTurn(st, idx, 2); return ok(); }
      if (rank === 'J') {
        st.dir = -st.dir;
        say(st, 'Le sens du jeu change.');
        if (inGame(st).length === 2) { st.drew = false; st.turn = idx; } // à 2 : on rejoue
        else endTurn(st, idx);
        return ok();
      }
      endTurn(st, idx);
      return ok();
    }

    case 'draw': {
      if (st.pendingDraw > 0) {
        const cards = drawCards(st, st.pendingDraw);
        me.hand.push(...cards);
        say(st, `@${idx} pioche ${cards.length} carte${cards.length > 1 ? 's' : ''}.`);
        st.pendingDraw = 0;
        endTurn(st, idx);
        return ok();
      }
      if (st.drew) return fail('already-drew');
      if (me.hand.some((c) => playable(st, c))) return fail('must-play');
      const [card] = drawCards(st, 1);
      if (!card) { say(st, `@${idx} ne peut pas piocher : plus de cartes.`); endTurn(st, idx); return ok(); }
      me.hand.push(card);
      say(st, `@${idx} pioche une carte.`);
      if (playable(st, card)) st.drew = true; // il peut la poser (ou passer)
      else endTurn(st, idx);
      return ok();
    }

    case 'pass':
      if (!st.drew) return fail('must-draw');
      endTurn(st, idx);
      say(st, `@${idx} passe.`);
      return ok();

    default:
      return fail('bad-action');
  }
}

function onLeave(st, idx) {
  const p = st.players[idx];
  if (!p || p.left || st.winner !== null) return;
  p.left = true;
  st.draw.unshift(...p.hand); // ses cartes retournent sous la pioche
  p.hand = [];
  say(st, `@${idx} a quitté la partie.`);
  const live = inGame(st);
  if (live.length <= 1) { st.winner = live[0] ?? null; return; }
  if (st.turn === idx) { st.turn = nextPlayer(st, idx); st.drew = false; }
}

function view(st, idx) {
  const me = st.players[idx];
  const mine = st.turn === idx && st.winner === null && me && !me.left;
  const hints = { actions: [], playable: [] };
  if (mine) {
    hints.playable = me.hand.filter((c) => playable(st, c));
    if (hints.playable.length) hints.actions.push('play');
    if (st.pendingDraw > 0 || (!st.drew && hints.playable.length === 0)) hints.actions.push('draw');
    if (st.drew) hints.actions.push('pass');
  }
  return {
    players: st.players.map((p) => ({ count: p.hand.length, left: p.left })),
    hand: me ? [...me.hand].sort(byHand) : [],
    top: top(st),
    suit: st.suit,
    dir: st.dir,
    pendingDraw: st.pendingDraw,
    drawCount: st.draw.length,
    turn: st.turn,
    drew: st.drew,
    winner: st.winner,
    log: [...st.log],
    hints,
  };
}

module.exports = {
  id: 'eights',
  name: '8 américain',
  blurb: '2 à 6 joueurs · 8 joker, 2 pioche, As passe, Valet inverse',
  minPlayers: 2,
  maxPlayers: 6,
  autoStart: false,
  init: (ids, opts) => init(ids, opts),
  action,
  view,
  onLeave,
  isOver: (st) => st.winner !== null,
  nextFirst: (_st, previousFirst) => previousFirst + 1,
};
