'use strict';
// « Cherche l'imposteur » (façon Undercover), 3 à 8 joueurs, pensé pour jouer en
// silence : les indices passent par le jeu, la discussion par le chat de la table.
//
// Les civils ont le même mot secret ; l'imposteur en a un voisin et ne sait pas
// qu'il l'est. Une manche :
//   clues    chacun donne UN indice (un mot), à son tour
//   discuss  discussion libre (chat de la table) ; on passe au vote quand tous sont prêts
//   vote     vote secret ; le plus voté est éliminé et son rôle révélé (égalité : personne)
//   guess    l'imposteur éliminé (le dernier) peut tenter de deviner le mot des civils
//   over     partie finie (st.winner : 'civil' | 'imposter')
// Les civils gagnent en éliminant tous les imposteurs (sauf s'il devine le mot) ;
// les imposteurs gagnent dès qu'ils sont au moins aussi nombreux que les civils.
// 8 joueurs et plus : 2 imposteurs.

const { PAIRS } = require('./impostor-words');

const MAX_CLUE = 24;
const MAX_GUESS = 40;
const ok = () => ({ ok: true });
const fail = (error) => ({ ok: false, error });

// Comparaison de mots : sans accents ni casse ni ponctuation.
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { // Fisher-Yates
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const alive = (st) => st.players.map((_, i) => i).filter((i) => st.players[i].alive);
const count = (st, role) => alive(st).filter((i) => st.players[i].role === role).length;

// `words` ([civil, imposteur]) et `imposters` (indices) permettent des parties scriptées en test.
function init(ids, { rng = Math.random, words, imposters } = {}) {
  const n = ids.length;
  let pair = words;
  if (!pair) {
    const p = PAIRS[Math.floor(rng() * PAIRS.length)];
    pair = rng() < 0.5 ? p : [p[1], p[0]];
  }
  const k = n >= 8 ? 2 : 1;
  const chosen = new Set(imposters ?? shuffle([...Array(n).keys()], rng).slice(0, k));
  const st = {
    rng,
    n,
    words: { civil: pair[0], imposter: pair[1] },
    players: ids.map((_, i) => ({ role: chosen.has(i) ? 'imposter' : 'civil', alive: true, left: false, revealed: false, ready: false })),
    round: 1,
    phase: 'clues',
    order: [],
    clueTurn: 0,
    clues: [],       // { round, p, text }
    votes: {},       // votant → cible (manche en cours)
    lastVote: null,  // résultat du dernier vote : { round, votes, eliminated, role, tie }
    guesser: null,
    winner: null,
    reason: null,
  };
  startRound(st);
  return st;
}

function startRound(st) {
  st.phase = 'clues';
  st.order = shuffle(alive(st), st.rng);
  st.clueTurn = 0;
  st.votes = {};
  for (const p of st.players) p.ready = false;
}

function finish(st, winner, reason) {
  st.winner = winner;
  st.reason = reason;
  st.phase = 'over';
  st.guesser = null;
  for (const p of st.players) p.revealed = true;
}

// La partie continue-t-elle ? Compare les camps vivants ; sinon prépare la manche suivante.
function nextStep(st) {
  const imp = count(st, 'imposter');
  const civ = count(st, 'civil');
  if (imp === 0) return finish(st, 'civil', 'caught');
  if (imp >= civ) return finish(st, 'imposter', 'outnumber');
  st.round++;
  if (st.round > st.n + 2) return finish(st, 'imposter', 'timeout'); // trop d'égalités : l'imposteur tient
  startRound(st);
  return undefined;
}

function tally(st) {
  const counts = {};
  for (const target of Object.values(st.votes)) counts[target] = (counts[target] ?? 0) + 1;
  const max = Math.max(...Object.values(counts));
  const tops = Object.keys(counts).filter((t) => counts[t] === max).map(Number);
  const votes = Object.entries(st.votes).map(([from, to]) => ({ from: Number(from), to }));

  if (tops.length !== 1) { // égalité : personne n'est éliminé
    st.lastVote = { round: st.round, votes, eliminated: null, role: null, tie: true };
    nextStep(st);
    return;
  }
  const out = tops[0];
  const p = st.players[out];
  p.alive = false;
  p.revealed = true;
  st.lastVote = { round: st.round, votes, eliminated: out, role: p.role, tie: false };
  if (p.role === 'imposter' && count(st, 'imposter') === 0) { // dernier imposteur : tentative de devinette
    st.phase = 'guess';
    st.guesser = out;
    st.votes = {};
    return;
  }
  nextStep(st);
}

// ---------------------------------------------------------------- actions

function action(st, idx, act) {
  if (st.winner !== null) return fail('over');
  if (!act || typeof act.type !== 'string') return fail('bad-action');
  const me = st.players[idx];
  if (!me) return fail('bad-action');

  switch (act.type) {
    case 'clue': {
      if (st.phase !== 'clues' || st.order[st.clueTurn] !== idx) return fail('not-your-turn');
      const text = String(act.text ?? '').trim();
      if (!text || text.length > MAX_CLUE || /\s/.test(text)) return fail('bad-clue');
      if (norm(text) === norm(st.words[me.role])) return fail('forbidden-word'); // interdit de dire son mot
      st.clues.push({ round: st.round, p: idx, text });
      st.clueTurn++;
      if (st.clueTurn >= st.order.length) st.phase = 'discuss';
      return ok();
    }

    case 'ready': {
      if (st.phase !== 'discuss' || !me.alive) return fail('not-your-turn');
      me.ready = true;
      if (alive(st).every((i) => st.players[i].ready)) st.phase = 'vote';
      return ok();
    }

    case 'vote': {
      if (st.phase !== 'vote' || !me.alive) return fail('not-your-turn');
      const t = act.target;
      if (!Number.isInteger(t) || !st.players[t] || !st.players[t].alive || t === idx) return fail('bad-target');
      st.votes[idx] = t; // on peut changer d'avis tant que tout le monde n'a pas voté
      if (alive(st).every((i) => i in st.votes)) tally(st);
      return ok();
    }

    case 'guess': {
      if (st.phase !== 'guess' || st.guesser !== idx) return fail('not-your-turn');
      const text = String(act.text ?? '').trim();
      if (!text || text.length > MAX_GUESS) return fail('bad-clue');
      finish(st, norm(text) === norm(st.words.civil) ? 'imposter' : 'civil', 'guess');
      return ok();
    }

    default:
      return fail('bad-action');
  }
}

// Un joueur part en cours de partie : il sort du jeu sans révéler son rôle.
function onLeave(st, idx) {
  const p = st.players[idx];
  if (!p || st.winner !== null || (!p.alive && st.guesser !== idx)) return;
  const wasGuesser = st.guesser === idx;
  p.alive = false;
  p.left = true;
  if (wasGuesser) { finish(st, 'civil', 'left'); return; }

  const at = st.order.indexOf(idx);
  if (at !== -1) {
    st.order.splice(at, 1);
    if (at < st.clueTurn) st.clueTurn--; // il avait déjà parlé : les suivants avancent d'un cran
  }
  delete st.votes[idx];
  for (const [voter, target] of Object.entries(st.votes)) if (target === idx) delete st.votes[voter];

  const imp = count(st, 'imposter');
  const civ = count(st, 'civil');
  if (imp === 0) { finish(st, 'civil', 'left'); return; }
  if (imp >= civ) { finish(st, 'imposter', 'outnumber'); return; }

  // Recale la phase en cours.
  if (st.phase === 'clues') {
    st.clueTurn = Math.min(st.clueTurn, st.order.length);
    if (st.clueTurn >= st.order.length) st.phase = 'discuss';
  }
  if (st.phase === 'discuss' && alive(st).every((i) => st.players[i].ready)) st.phase = 'vote';
  if (st.phase === 'vote' && alive(st).every((i) => i in st.votes)) tally(st);
}

// ---------------------------------------------------------------- vue

// Chaque joueur ne voit que SON mot ; les rôles ne sont connus que pour les
// éliminés (révélés) et, en fin de partie, pour tous.
function view(st, idx) {
  const me = st.players[idx];
  const over = st.winner !== null;
  const voting = st.phase === 'vote';
  const hints = { actions: [], targets: [] };
  if (!over && me?.alive) {
    if (st.phase === 'clues' && st.order[st.clueTurn] === idx) hints.actions.push('clue');
    if (st.phase === 'discuss' && !me.ready) hints.actions.push('ready');
    if (voting) { hints.actions.push('vote'); hints.targets = alive(st).filter((i) => i !== idx); }
  }
  if (st.phase === 'guess' && st.guesser === idx) hints.actions.push('guess');

  return {
    phase: st.phase,
    round: st.round,
    players: st.players.map((p, i) => ({
      alive: p.alive,
      left: p.left,
      ready: p.ready,
      voted: voting && i in st.votes, // a voté (sans dire pour qui)
      role: p.revealed ? p.role : null,
    })),
    order: [...st.order],
    clueTurn: st.clueTurn,
    clues: st.clues.map((c) => ({ ...c })),
    me: me ? { word: st.words[me.role], alive: me.alive } : null,
    myVote: voting && idx in st.votes ? st.votes[idx] : null,
    lastVote: st.lastVote && { ...st.lastVote, votes: st.lastVote.votes.map((v) => ({ ...v })) },
    guesser: st.guesser,
    winner: st.winner,
    reason: st.reason,
    words: over ? { ...st.words } : null,
    hints,
  };
}

module.exports = {
  id: 'impostor',
  name: 'Cherche l’imposteur',
  blurb: '3 à 8 joueurs · indices, chat, vote',
  minPlayers: 3,
  maxPlayers: 8,
  autoStart: false,
  init: (ids, opts) => init(ids, opts),
  action,
  view,
  onLeave,
  isOver: (st) => st.winner !== null,
  nextFirst: (_st, previousFirst) => previousFirst + 1,
  norm,
};
