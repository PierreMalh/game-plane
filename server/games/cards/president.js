'use strict';
// Président (aussi appelé « Trou du cul »), 3 à 6 joueurs, 3 manches.
//
// Ordre des cartes, du plus faible au plus fort : 3 4 5 6 7 8 9 10 V D R A 2.
// Le meneur pose 1 à 4 cartes de même rang ; les suivants doivent poser le même
// nombre de cartes d'un rang STRICTEMENT supérieur, ou passer (on est alors
// écarté du pli). Le pli est ramassé par le dernier à avoir joué quand tous les
// autres ont passé, ou aussitôt qu'on pose des 2 (rien ne les bat). Le premier à
// vider sa main est Président, le dernier « Trou ».
// Manche suivante : le Trou donne ses 2 plus fortes cartes au Président, qui lui
// rend 2 cartes de son choix ; Vice-trou / Vice-président : 1 carte (dès 4 joueurs).
// Points d'une manche : n−1 pour le 1er … 0 pour le dernier. Le meilleur total gagne.
//
// Phases : play → roundover (tous « prêts ») → exchange → play … → over

const { rankOf, suitOf, makeDeck, isCard, shuffle, dealAll, takeCards } = require('./deck');

const ORDER = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const SUIT_ORDER = ['C', 'D', 'H', 'S'];
const ROUNDS = 3;
const LOG_MAX = 30;

const ok = () => ({ ok: true });
const fail = (error) => ({ ok: false, error });
const val = (c) => ORDER.indexOf(rankOf(c));
const byStrength = (a, b) => val(a) - val(b) || SUIT_ORDER.indexOf(suitOf(a)) - SUIT_ORDER.indexOf(suitOf(b));
const say = (st, text) => { st.log.push(text); if (st.log.length > LOG_MAX) st.log.shift(); };

const inGame = (st) => st.players.map((_, i) => i).filter((i) => !st.players[i].left);
const inRound = (st) => inGame(st).filter((i) => !st.players[i].out);

// Premier index vérifiant `ok`, en partant juste après `from` (tour de table).
function nextMatching(st, from, ok_) {
  for (let k = 1; k <= st.n; k++) {
    const i = (from + k) % st.n;
    if (ok_(i)) return i;
  }
  return undefined;
}

// ---------------------------------------------------------------- initialisation

function init(ids, { rng = Math.random, rounds = ROUNDS } = {}) {
  const st = {
    rng,
    n: ids.length,
    rounds,
    round: 0,
    players: ids.map(() => ({ hand: [], out: false, left: false, passed: false, ready: false, points: 0, place: null })),
    phase: 'play',
    turn: 0,
    trick: null,        // { cards, count, val, by }
    finished: [],       // ordre d'arrivée de la manche
    roles: null,        // { pres, vpres, vtrou, trou } de la manche précédente
    exchange: null,     // { pending: [{ giver, receiver, count, received }] }
    results: null,
    winners: null,
    log: [],
  };
  startRound(st);
  return st;
}

function startRound(st) {
  st.round++;
  const act = inGame(st);
  const hands = dealAll(shuffle(makeDeck(), st.rng), act.length);
  for (const p of st.players) Object.assign(p, { hand: [], out: false, passed: false, ready: false, place: null });
  act.forEach((i, k) => { st.players[i].hand = hands[k].sort(byStrength); });
  st.trick = null;
  st.finished = [];
  st.results = null;
  say(st, `Manche ${st.round} sur ${st.rounds}.`);

  const r = st.roles;
  const stillHere = (i) => i !== null && i !== undefined && !st.players[i].left;
  const pairs = [];
  if (r && act.length >= 3) {
    if (stillHere(r.pres) && stillHere(r.trou)) pairs.push({ from: r.trou, to: r.pres, count: 2 });
    if (stillHere(r.vpres) && stillHere(r.vtrou)) pairs.push({ from: r.vtrou, to: r.vpres, count: 1 });
  }
  if (pairs.length === 0) { beginPlay(st); return; }

  // Les plus fortes cartes du perdant passent d'office au gagnant, qui en rend autant.
  st.exchange = { pending: [] };
  for (const { from, to, count } of pairs) {
    const best = [...st.players[from].hand].sort(byStrength).slice(-count);
    takeCards(st.players[from].hand, best);
    st.players[to].hand.push(...best);
    st.players[to].hand.sort(byStrength);
    st.exchange.pending.push({ giver: to, receiver: from, count, received: best });
    say(st, `@${from} donne ${count} carte${count > 1 ? 's' : ''} à @${to}.`);
  }
  st.phase = 'exchange';
}

function beginPlay(st) {
  st.exchange = null;
  st.phase = 'play';
  const lead = st.roles && !st.players[st.roles.pres]?.left
    ? st.roles.pres
    : inGame(st).find((i) => st.players[i].hand.includes('3C')) ?? inGame(st)[0];
  st.turn = lead;
  say(st, `@${lead} entame.`);
}

// ---------------------------------------------------------------- plis et fin de manche

function closeTrick(st) {
  const winner = st.trick.by;
  st.trick = null;
  for (const p of st.players) p.passed = false;
  const stillIn = (i) => !st.players[i].out && !st.players[i].left;
  st.turn = stillIn(winner) ? winner : nextMatching(st, winner, stillIn);
  say(st, `@${winner} ramasse le pli.`);
}

// Qui doit encore répondre au pli ? Tous les joueurs en lice n'ayant pas passé, sauf le meneur du pli.
function proceed(st, actor) {
  const by = st.trick.by;
  const others = inRound(st).filter((i) => i !== by && !st.players[i].passed);
  if (others.length === 0) { closeTrick(st); return; }
  st.turn = nextMatching(st, actor, (i) => others.includes(i));
}

function endRound(st) {
  const last = inRound(st);
  if (last.length === 1) st.finished.push(last[0]); // le dernier restant
  const m = st.finished.length;
  st.finished.forEach((i, k) => {
    st.players[i].place = k + 1;
    st.players[i].points += m - 1 - k;
  });
  st.roles = {
    pres: st.finished[0],
    vpres: m >= 4 ? st.finished[1] : null,
    vtrou: m >= 4 ? st.finished[m - 2] : null,
    trou: st.finished[m - 1],
  };
  st.results = { order: [...st.finished], points: st.finished.map((i) => st.players[i].points) };
  st.trick = null;
  if (st.round >= st.rounds) { finishGame(st); return; }
  st.phase = 'roundover';
  for (const p of st.players) p.ready = false;
}

function finishGame(st) {
  const live = inGame(st);
  const best = Math.max(...live.map((i) => st.players[i].points));
  st.winners = live.filter((i) => st.players[i].points === best);
  st.phase = 'over';
  say(st, st.winners.length === 1 ? `@${st.winners[0]} remporte la partie !` : 'Égalité en tête !');
}

// ---------------------------------------------------------------- actions

function action(st, idx, act) {
  if (st.phase === 'over') return fail('over');
  if (!act || typeof act.type !== 'string') return fail('bad-action');
  const me = st.players[idx];
  if (!me || me.left) return fail('bad-action');

  switch (act.type) {
    case 'play': {
      if (st.phase !== 'play' || st.turn !== idx) return fail('not-your-turn');
      const cards = act.cards;
      if (!Array.isArray(cards) || cards.length < 1 || cards.length > 4 || !cards.every(isCard)) return fail('bad-cards');
      if (new Set(cards.map(rankOf)).size !== 1) return fail('not-same-rank');
      if (new Set(cards).size !== cards.length || !cards.every((c) => me.hand.includes(c))) return fail('not-in-hand');
      if (st.trick) {
        if (cards.length !== st.trick.count) return fail('wrong-count');
        if (val(cards[0]) <= st.trick.val) return fail('too-low');
      }
      takeCards(me.hand, cards);
      st.trick = { cards: [...cards].sort(byStrength), count: cards.length, val: val(cards[0]), by: idx };
      say(st, `@${idx} joue ${cards.join(' ')}.`);
      if (me.hand.length === 0) {
        me.out = true;
        st.finished.push(idx);
        me.place = st.finished.length; // sa place est acquise dès qu'il a fini
        say(st, `@${idx} a fini sa main !`);
        if (inRound(st).length <= 1) { endRound(st); return ok(); }
      }
      if (rankOf(cards[0]) === '2') closeTrick(st); // rien ne bat un 2
      else proceed(st, idx);
      return ok();
    }

    case 'pass': {
      if (st.phase !== 'play' || st.turn !== idx) return fail('not-your-turn');
      if (!st.trick) return fail('must-lead');
      me.passed = true;
      say(st, `@${idx} passe.`);
      proceed(st, idx);
      return ok();
    }

    case 'give': {
      const pending = st.phase === 'exchange' && st.exchange.pending.find((e) => e.giver === idx);
      if (!pending) return fail('not-your-turn');
      const cards = act.cards;
      if (!Array.isArray(cards) || cards.length !== pending.count) return fail('wrong-count');
      if (!takeCards(me.hand, cards)) return fail('not-in-hand');
      st.players[pending.receiver].hand.push(...cards);
      st.players[pending.receiver].hand.sort(byStrength);
      st.exchange.pending = st.exchange.pending.filter((e) => e !== pending);
      say(st, `@${idx} rend ${cards.length} carte${cards.length > 1 ? 's' : ''} à @${pending.receiver}.`);
      if (st.exchange.pending.length === 0) beginPlay(st);
      return ok();
    }

    case 'ready': {
      if (st.phase !== 'roundover') return fail('not-your-turn');
      me.ready = true;
      if (inGame(st).every((i) => st.players[i].ready)) startRound(st);
      return ok();
    }

    default:
      return fail('bad-action');
  }
}

// Un joueur quitte : sa main est écartée, la partie continue entre les autres.
function onLeave(st, idx) {
  const p = st.players[idx];
  if (!p || p.left || st.phase === 'over') return;
  const wasOut = p.out;
  p.left = true;
  p.passed = false;
  p.hand = [];
  say(st, `@${idx} a quitté la partie.`);

  const live = inGame(st);
  if (live.length <= 1) {
    st.winners = live;
    st.phase = 'over';
    st.trick = null;
    return;
  }

  if (st.phase === 'play' && !wasOut) {
    if (inRound(st).length <= 1) { endRound(st); return; }
    if (st.turn === idx) {
      if (st.trick) proceed(st, idx);
      else st.turn = nextMatching(st, idx, (i) => !st.players[i].out && !st.players[i].left);
    }
    if (st.trick && inRound(st).filter((i) => i !== st.trick.by && !st.players[i].passed).length === 0) closeTrick(st);
  } else if (st.phase === 'exchange') {
    st.exchange.pending = st.exchange.pending.filter((e) => e.giver !== idx && e.receiver !== idx);
    if (st.exchange.pending.length === 0) beginPlay(st);
  } else if (st.phase === 'roundover') {
    if (live.every((i) => st.players[i].ready)) startRound(st);
  }
}

// ---------------------------------------------------------------- vue

const roleOf = (st, i) => {
  const r = st.roles;
  if (!r) return null;
  if (r.pres === i) return 'Président';
  if (r.trou === i) return 'Trou';
  if (r.vpres === i) return 'Vice-président';
  if (r.vtrou === i) return 'Vice-trou';
  return 'Neutre';
};

function view(st, idx) {
  const me = st.players[idx];
  const hints = { actions: [], playable: [], need: null, give: null };
  if (me && !me.left) {
    if (st.phase === 'play' && st.turn === idx) {
      hints.need = st.trick ? st.trick.count : null;
      hints.playable = me.hand.filter((c) => {
        if (!st.trick) return true;
        return val(c) > st.trick.val && me.hand.filter((x) => rankOf(x) === rankOf(c)).length >= st.trick.count;
      });
      if (hints.playable.length) hints.actions.push('play'); // sinon : passer (on ne peut pas être bloqué en tête)
      if (st.trick) hints.actions.push('pass');
    } else if (st.phase === 'exchange') {
      const mine = st.exchange.pending.find((e) => e.giver === idx);
      if (mine) { hints.actions.push('give'); hints.give = { count: mine.count, to: mine.receiver, received: mine.received }; }
    } else if (st.phase === 'roundover' && !me.ready) {
      hints.actions.push('ready');
    }
  }
  return {
    phase: st.phase,
    round: st.round,
    rounds: st.rounds,
    turn: st.turn,
    players: st.players.map((p, i) => ({
      count: p.hand.length, out: p.out, left: p.left, passed: p.passed, ready: p.ready, points: p.points, place: p.place, role: roleOf(st, i),
    })),
    hand: me ? [...me.hand] : [],
    trick: st.trick && { cards: [...st.trick.cards], count: st.trick.count, by: st.trick.by },
    exchange: st.exchange && st.exchange.pending.map((e) => ({ giver: e.giver, receiver: e.receiver, count: e.count })),
    results: st.results,
    winners: st.winners,
    log: [...st.log],
    hints,
  };
}

module.exports = {
  id: 'president',
  name: 'Président',
  blurb: '3 à 6 joueurs · 3 manches · échange de cartes',
  minPlayers: 3,
  maxPlayers: 6,
  autoStart: false,
  init: (ids, opts) => init(ids, opts),
  action,
  view,
  onLeave,
  isOver: (st) => st.phase === 'over',
  nextFirst: (_st, previousFirst) => previousFirst + 1,
  ORDER,
};
