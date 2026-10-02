'use strict';
// Poker Texas Hold'em sans limite (No-Limit), 2 à 8 joueurs, en tournoi : chacun part
// avec STACK jetons, les blindes doublent toutes les BLIND_EVERY mains, le dernier
// joueur à avoir des jetons gagne.
//   Une main : 2 cartes privées, enchères pré-flop, flop (3 cartes), turn, river,
//   abattage. Meilleure combinaison de 5 cartes parmi 7.
//   Actions : se coucher, parole (check), suivre, relancer (montant total de la mise
//   du tour), tapis. Relance minimale = la dernière relance (au moins la grosse blinde).
//   Un tapis inférieur à une relance complète ne rouvre pas les enchères pour ceux qui
//   ont déjà parlé (règle officielle).
//   Pots annexes calculés à partir de la mise totale de chaque joueur ; partage à
//   égalité, jeton indivisible au premier gagnant à gauche du bouton.
//   Tête-à-tête : le bouton est petite blinde et parle en premier avant le flop.
// Après chaque main, tout le monde valide (« Main suivante ») avant la donne suivante.

const { RANKS, rankOf, suitOf, makeDeck, shuffle } = require('./deck');

const STACK = 1000;
const BLINDS = [10, 20];   // petite, grosse blinde du premier niveau
const BLIND_EVERY = 10;    // mains par niveau de blindes (puis × 2)
const LOG_MAX = 20;

const ok = () => ({ ok: true });
const fail = (error) => ({ ok: false, error });
const say = (st, text) => { st.log.push(text); if (st.log.length > LOG_MAX) st.log.shift(); };

// ---- évaluation des mains -------------------------------------------------------------

const VAL = Object.fromEntries(RANKS.map((r, i) => [r, i + 2])); // 2..14 (As = 14)
const CATEGORY = ['Hauteur', 'Paire', 'Double paire', 'Brelan', 'Quinte', 'Couleur', 'Full', 'Carré', 'Quinte flush'];
const VAL_NAME = { 14: 'As', 13: 'Roi', 12: 'Dame', 11: 'Valet' };
const vn = (v) => VAL_NAME[v] ?? String(v);
const de = (v) => (v === 14 ? 'd’As' : `de ${vn(v)}`);
const au = (v) => (v === 14 ? 'à l’As' : `au ${vn(v)}`);

// Score d'une main de 5 cartes : [catégorie, départages…], comparable par compareScore.
function score5(cards) {
  const vals = cards.map((c) => VAL[rankOf(c)]).sort((a, b) => b - a);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
  const uniq = [...new Set(vals)];
  let high = 0; // hauteur de la quinte éventuelle
  if (uniq.length === 5) {
    if (vals[0] - vals[4] === 4) high = vals[0];
    else if (vals[0] === 14 && vals[1] === 5) high = 5; // quinte blanche A-2-3-4-5
  }
  if (high && flush) return [8, high];
  // Groupes par nombre d'exemplaires puis par valeur : ex. full = [[3, v], [2, w]].
  const count = new Map();
  for (const v of vals) count.set(v, (count.get(v) ?? 0) + 1);
  const groups = [...count].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const order = groups.map(([v]) => v);
  if (groups[0][1] === 4) return [7, ...order];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, ...order];
  if (flush) return [5, ...vals];
  if (high) return [4, high];
  if (groups[0][1] === 3) return [3, ...order];
  if (groups[0][1] === 2 && groups[1][1] === 2) return [2, ...order];
  if (groups[0][1] === 2) return [1, ...order];
  return [0, ...vals];
}

function compareScore(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

// Meilleure main de 5 parmi 5 à 7 cartes : { score, cards }.
function bestHand(cards) {
  let best = null;
  const n = cards.length;
  const pick = (from, chosen) => {
    if (chosen.length === 5) {
      const s = score5(chosen);
      if (!best || compareScore(s, best.score) > 0) best = { score: s, cards: [...chosen] };
      return;
    }
    for (let i = from; i <= n - (5 - chosen.length); i++) pick(i + 1, [...chosen, cards[i]]);
  };
  pick(0, []);
  return best;
}

// Nom lisible d'un score (« Full aux Rois par les 7 »).
function describe(s) {
  const [cat, a, b] = s;
  switch (cat) {
    case 0: return `Hauteur ${vn(a)}`;
    case 1: return `Paire ${de(a)}`;
    case 2: return `Double paire ${vn(a)} et ${vn(b)}`;
    case 3: return `Brelan ${de(a)}`;
    case 4: return `Quinte ${au(a)}`;
    case 5: return `Couleur ${au(a)}`;
    case 6: return `Full aux ${vn(a)} par les ${vn(b)}`;
    case 7: return `Carré ${de(a)}`;
    default: return a === 14 ? 'Quinte flush royale' : `Quinte flush ${au(a)}`;
  }
}

// ---- état ------------------------------------------------------------------------------

// Joueurs encore dans le tournoi (des jetons, pas partis).
const alive = (st) => st.players.map((_, i) => i).filter((i) => !st.players[i].left && st.players[i].chips > 0);
// Joueurs encore en lice dans la main (pas couchés).
const contenders = (st) => st.players.map((_, i) => i).filter((i) => st.players[i].inHand && !st.players[i].folded);
// Joueurs qui peuvent encore miser (en lice et pas à tapis).
const canAct = (st, i) => { const p = st.players[i]; return p.inHand && !p.folded && p.chips > 0; };

const blindsAt = (handNo) => {
  const k = 2 ** Math.floor((handNo - 1) / BLIND_EVERY);
  return [BLINDS[0] * k, BLINDS[1] * k];
};

// Prochain joueur (dans le sens des aiguilles) après `from` vérifiant `pred`.
function nextWhere(st, from, pred) {
  for (let k = 1; k <= st.n; k++) {
    const i = (from + k) % st.n;
    if (pred(i)) return i;
  }
  return -1;
}

function init(ids, { rng = Math.random, first = 0, shuffle: doShuffle = true } = {}) {
  const n = ids.length;
  const st = {
    rng, doShuffle, n,
    players: ids.map(() => ({ chips: STACK, hand: [], bet: 0, contrib: 0, inHand: false, folded: false, left: false, needsAct: false, mayRaise: false })),
    dealer: (first % n + n - 1) % n, // avancé d'une place à la première donne
    handNo: 0, phase: 'betting', street: 'preflop', board: [], deck: [],
    currentBet: 0, minRaise: 0, turn: -1, sb: -1, bb: -1, blinds: [...BLINDS],
    ready: [], result: null, winner: null, log: [],
  };
  newHand(st);
  return st;
}

function newHand(st) {
  const live = alive(st);
  st.handNo++;
  st.blinds = blindsAt(st.handNo);
  st.dealer = nextWhere(st, st.dealer, (i) => live.includes(i));
  st.deck = st.doShuffle ? shuffle(makeDeck(), st.rng) : makeDeck();
  st.board = [];
  st.result = null;
  st.ready = [];
  st.phase = 'betting';
  st.street = 'preflop';
  for (const [i, p] of st.players.entries()) {
    Object.assign(p, { hand: [], bet: 0, contrib: 0, inHand: live.includes(i), folded: false, needsAct: false, mayRaise: false, shown: false });
  }
  for (const i of live) st.players[i].hand = [st.deck.pop(), st.deck.pop()];

  // Blindes. Tête-à-tête : le bouton est petite blinde.
  const inHand = (i) => st.players[i].inHand;
  st.sb = live.length === 2 ? st.dealer : nextWhere(st, st.dealer, inHand);
  st.bb = nextWhere(st, st.sb, inHand);
  const [small, big] = st.blinds;
  say(st, `Main n° ${st.handNo} · blindes ${small}/${big}.`);
  post(st, st.sb, small);
  post(st, st.bb, big);
  st.currentBet = big;
  st.minRaise = big;
  for (const i of live) Object.assign(st.players[i], { needsAct: canAct(st, i), mayRaise: true });
  st.turn = nextWhere(st, st.bb, (i) => canAct(st, i));
  advance(st);
}

// Mise forcée (blinde), plafonnée au tapis.
function post(st, i, amount) {
  const p = st.players[i];
  const a = Math.min(amount, p.chips);
  p.chips -= a;
  p.bet += a;
  p.contrib += a;
}

// Met `to` jetons devant le joueur pour ce tour d'enchères (mise totale du tour).
function putTo(st, i, to) {
  const p = st.players[i];
  const add = to - p.bet;
  p.chips -= add;
  p.bet = to;
  p.contrib += add;
}

// Après chaque action : main gagnée par abandon, tour d'enchères terminé, ou joueur suivant.
function advance(st) {
  const left = contenders(st);
  if (left.length === 1) return award(st, left[0]);
  const waiting = st.players.some((p, i) => p.needsAct && canAct(st, i));
  if (waiting) {
    if (!st.players[st.turn]?.needsAct || !canAct(st, st.turn)) st.turn = nextWhere(st, st.turn, (i) => st.players[i].needsAct && canAct(st, i));
    return;
  }
  // Tour d'enchères terminé : on ramasse les mises.
  for (const p of st.players) p.bet = 0;
  st.currentBet = 0;
  st.minRaise = st.blinds[1];
  const active = left.filter((i) => canAct(st, i));
  if (st.street === 'river' || active.length <= 1) {
    // Plus d'enchères possibles : on retourne toutes les cartes restantes.
    while (st.board.length < 5) st.board.push(st.deck.pop());
    return showdown(st);
  }
  if (st.street === 'preflop') { st.street = 'flop'; st.board.push(st.deck.pop(), st.deck.pop(), st.deck.pop()); }
  else if (st.street === 'flop') { st.street = 'turn'; st.board.push(st.deck.pop()); }
  else { st.street = 'river'; st.board.push(st.deck.pop()); }
  for (const i of active) Object.assign(st.players[i], { needsAct: true, mayRaise: true });
  st.turn = nextWhere(st, st.dealer, (i) => canAct(st, i));
}

// Pots (principal puis annexes) d'après la mise totale de chacun dans la main.
function pots(st) {
  const levels = [...new Set(st.players.map((p) => p.contrib).filter((c) => c > 0))].sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const lv of levels) {
    const amount = st.players.reduce((s, p) => s + Math.max(0, Math.min(p.contrib, lv) - prev), 0);
    const eligible = st.players.map((_, i) => i).filter((i) => st.players[i].inHand && !st.players[i].folded && st.players[i].contrib >= lv);
    // Personne d'éligible (mise d'un joueur couché au-dessus des autres) : versé au pot précédent.
    if (eligible.length === 0 && out.length) out[out.length - 1].amount += amount;
    else if (amount > 0) out.push({ amount, eligible });
    prev = lv;
  }
  return out;
}

// Un seul joueur encore en lice : il ramasse tout sans montrer ses cartes.
function award(st, winner) {
  const total = st.players.reduce((s, p) => s + p.contrib, 0);
  st.players[winner].chips += total;
  say(st, `@${winner} remporte ${total} (les autres se couchent).`);
  st.result = { showdown: false, pots: [{ amount: total, winners: [winner] }], hands: {} };
  endHand(st);
}

function showdown(st) {
  const hands = {};
  for (const i of contenders(st)) {
    const best = bestHand([...st.players[i].hand, ...st.board]);
    st.players[i].shown = true;
    hands[i] = { score: best.score, cards: best.cards, name: describe(best.score) };
  }
  const result = { showdown: true, pots: [], hands };
  for (const pot of pots(st)) {
    let winners = [];
    for (const i of pot.eligible) {
      const c = winners.length ? compareScore(hands[i].score, hands[winners[0]].score) : 1;
      if (c > 0) winners = [i];
      else if (c === 0) winners.push(i);
    }
    // Ordre à partir de la gauche du bouton : le jeton indivisible va au premier.
    winners.sort((a, b) => (a - st.dealer - 1 + st.n) % st.n - (b - st.dealer - 1 + st.n) % st.n);
    const share = Math.floor(pot.amount / winners.length);
    winners.forEach((w, k) => { st.players[w].chips += share + (k < pot.amount % winners.length ? 1 : 0); });
    result.pots.push({ amount: pot.amount, winners });
    const names = winners.map((w) => `@${w}`).join(' et ');
    say(st, `${names} ${winners.length > 1 ? 'partagent' : 'remporte'} ${pot.amount} avec : ${hands[winners[0]].name}.`);
  }
  st.result = result;
  endHand(st);
}

function endHand(st) {
  for (const p of st.players) { p.bet = 0; p.needsAct = false; }
  st.currentBet = 0;
  st.turn = -1;
  for (const [i, p] of st.players.entries()) {
    if (p.inHand && p.chips === 0 && !p.left) say(st, `@${i} est éliminé.`);
  }
  const live = alive(st);
  if (live.length <= 1) {
    st.phase = 'over';
    st.winner = live[0] ?? null;
    if (st.winner !== null) say(st, `@${st.winner} remporte le tournoi !`);
    return;
  }
  st.phase = 'result';
  st.ready = st.players.map((_, i) => !live.includes(i)); // seuls les joueurs en lice valident
}

// ---- actions ---------------------------------------------------------------------------

function action(st, idx, act) {
  if (st.phase === 'over') return fail('over');
  if (!act || typeof act.type !== 'string') return fail('bad-action');
  const me = st.players[idx];
  if (!me || me.left) return fail('not-your-turn');

  if (act.type === 'ready') {
    if (st.phase !== 'result' || st.ready[idx]) return fail('not-your-turn');
    st.ready[idx] = true;
    if (st.ready.every(Boolean)) newHand(st);
    return ok();
  }

  if (st.phase !== 'betting' || st.turn !== idx) return fail('not-your-turn');
  const toCall = st.currentBet - me.bet;
  const max = me.bet + me.chips; // tapis

  switch (act.type) {
    case 'fold':
      me.folded = true;
      say(st, `@${idx} se couche.`);
      break;
    case 'check':
      if (toCall > 0) return fail('must-call');
      say(st, `@${idx} parle.`);
      break;
    case 'call': {
      if (toCall <= 0) return fail('nothing-to-call');
      putTo(st, idx, Math.min(st.currentBet, max));
      say(st, me.chips === 0 ? `@${idx} suit à tapis (${me.bet}).` : `@${idx} suit (${me.bet}).`);
      break;
    }
    case 'raise':
    case 'allin': {
      const to = act.type === 'allin' ? max : act.to;
      if (!Number.isInteger(to) || to > max) return fail('bad-amount');
      if (to <= st.currentBet) {
        // « Tapis » sans pouvoir relancer : c'est un suivi.
        if (act.type === 'allin' && toCall > 0) return action(st, idx, { type: 'call' });
        return fail('bad-amount');
      }
      if (!me.mayRaise) return fail('cannot-raise');
      const increment = to - st.currentBet;
      if (increment < st.minRaise && to < max) return fail('raise-too-small');
      const bet = st.currentBet === 0;
      putTo(st, idx, to);
      const full = increment >= st.minRaise;
      for (const [i, p] of st.players.entries()) {
        if (i === idx || !canAct(st, i)) continue;
        p.needsAct = true;
        if (full) p.mayRaise = true; // un tapis incomplet ne rouvre pas les relances
      }
      if (full) st.minRaise = increment;
      st.currentBet = to;
      say(st, `@${idx} ${bet ? 'mise' : 'relance à'} ${to}${me.chips === 0 ? ' (tapis)' : ''}.`);
      break;
    }
    default:
      return fail('bad-action');
  }
  me.needsAct = false;
  me.mayRaise = false;
  advance(st);
  return ok();
}

// Départ en cours de tournoi : le joueur se couche (ses mises restent au pot) et ses jetons
// sortent du jeu. La partie continue tant qu'il reste au moins deux joueurs.
function onLeave(st, idx) {
  const p = st.players[idx];
  if (!p || p.left || st.phase === 'over') return;
  p.left = true;
  p.chips = 0;
  say(st, `@${idx} a quitté la partie.`);
  if (st.phase === 'betting' && p.inHand && !p.folded) {
    p.folded = true;
    p.needsAct = false;
    if (st.turn === idx) st.turn = nextWhere(st, idx, (i) => st.players[i].needsAct && canAct(st, i));
    advance(st);
    return;
  }
  if (st.phase === 'result') {
    const live = alive(st);
    if (live.length <= 1) { st.phase = 'over'; st.winner = live[0] ?? null; return; }
    st.ready[idx] = true;
    if (st.ready.every(Boolean)) newHand(st);
  }
}

// ---- vue -------------------------------------------------------------------------------

function view(st, idx) {
  const me = st.players[idx];
  const hints = { actions: [], toCall: 0, minRaise: 0, maxRaise: 0 };
  if (me && !me.left && st.phase === 'betting' && st.turn === idx) {
    const toCall = st.currentBet - me.bet;
    const max = me.bet + me.chips;
    hints.toCall = Math.min(toCall, me.chips);
    hints.actions.push('fold', toCall > 0 ? 'call' : 'check');
    if (me.mayRaise && max > st.currentBet) {
      hints.minRaise = Math.min(st.currentBet + st.minRaise, max);
      hints.maxRaise = max;
      if (hints.minRaise < max) hints.actions.push('raise');
      hints.actions.push('allin');
    }
  } else if (me && st.phase === 'result' && !st.ready[idx]) {
    hints.actions.push('ready');
  }
  const total = st.players.reduce((s, p) => s + p.contrib, 0);
  return {
    phase: st.phase, street: st.street, handNo: st.handNo, blinds: [...st.blinds],
    blindEvery: BLIND_EVERY, dealer: st.dealer, sb: st.sb, bb: st.bb, turn: st.turn,
    board: [...st.board], pot: st.phase === 'betting' ? total : 0, currentBet: st.currentBet,
    players: st.players.map((p) => ({
      chips: p.chips, bet: p.bet, inHand: p.inHand, folded: p.folded, left: p.left,
      allIn: p.inHand && !p.folded && p.chips === 0 && st.phase === 'betting',
      cards: p.shown ? [...p.hand] : null, // cartes montrées à l'abattage seulement
    })),
    hand: me ? [...me.hand] : [],
    result: st.result,
    ready: [...st.ready],
    winner: st.winner,
    log: [...st.log],
    hints,
  };
}

module.exports = {
  id: 'poker',
  name: 'Poker',
  blurb: '2 à 8 joueurs · Texas Hold’em sans limite, en tournoi',
  minPlayers: 2,
  maxPlayers: 8,
  autoStart: false,
  init: (ids, opts) => init(ids, opts),
  action,
  view,
  onLeave,
  isOver: (st) => st.phase === 'over',
  nextFirst: (_st, previousFirst) => previousFirst + 1,
  // Pour les tests.
  _internal: { score5, bestHand, compareScore, describe, pots, STACK, BLIND_EVERY },
};
