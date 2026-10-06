'use strict';
// Jetons de poker : gère les jetons, les mises, les blindes et les pots d'une partie de
// poker jouée avec de VRAIES cartes (2 à 10 joueurs). Aucune carte ici : le serveur ne
// connaît pas les mains, c'est le croupier qui désigne le ou les gagnants de chaque pot à
// l'abattage.
//   Croupier : un téléphone à part qui NE JOUE PAS (pas de jetons, jamais dans une main). C'est
//   l'hôte de la table par défaut ; avant la première main, un autre joueur peut le devenir (l'ancien
//   croupier devient joueur). Il règle la partie (tapis de départ, blindes, hausse automatique), lance les mains,
//   distribue les pots, corrige les jetons (recave, erreur) et clôt la partie.
//   Mains : blindes, enchères pré-flop / flop / turn / river (No-Limit), abattage.
//   Actions : se coucher, parole (check), suivre, relancer (montant total de la mise du
//   tour), tapis. Relance minimale = la dernière relance (au moins la grosse blinde).
//   Un tapis incomplet ne rouvre pas les enchères pour ceux qui ont déjà parlé.
//   Pots annexes calculés sur la mise totale de chacun ; mise non suivie rendue.
//   Tête-à-tête : le bouton est petite blinde et parle en premier avant le flop.
//   Durée de partie : le croupier choisit une durée (en minutes) ; `blindPlan` en déduit une
//   structure de blindes par niveaux de temps (départ à ~100 grosses blindes, arrivée vers le
//   20e des jetons en jeu, progression géométrique arrondie à des valeurs « rondes »). Le
//   niveau change au début d'une main ; le croupier peut passer au niveau suivant, mettre en pause
//   et modifier un niveau (blindes, durée). Partie de 1 h 30 par défaut ; régler des blindes à la
//   main (sans durée) repasse en mode libre.
//   Pour rire : compteur de clics sur les jetons (`tap`), œufs lancés sur un joueur (`egg`) qu'il
//   doit nettoyer (`clean`). Chacun commence avec 10 œufs, en gagne un par main remportée ; après
//   un nettoyage on est protégé 15 s. Aucun effet sur les jetons.
//   Le croupier peut recommencer la partie (`restart`) : jetons, mains et horloge remis à zéro.
// Phases : setup → betting → showdown | between → betting … → over.

const MAX_CHIPS = 1e9;
const LOG_MAX = 20;
const STREETS = ['preflop', 'flop', 'turn', 'river'];
const DEFAULTS = { stack: 1000, sb: 10, bb: 20, blindEvery: 0, duration: 90 };
const MAX_EGGS = 12; // taches en attente sur un écran
const EGG_STOCK = 10; // œufs de départ de chacun
const SHIELD_MS = 15000; // protection après un nettoyage
const MAX_TAPS = 50; // clics envoyés en un message (le client les regroupe)
let now = () => Date.now();

const ok = () => ({ ok: true });
const fail = (error) => ({ ok: false, error });
const say = (st, text) => { st.log.push(text); if (st.log.length > LOG_MAX) st.log.shift(); };
const isInt = (n, min, max = MAX_CHIPS) => Number.isInteger(n) && n >= min && n <= max;

function init(ids) {
  const st = {
    phase: 'setup',
    croupier: 0,
    config: { ...DEFAULTS },
    handNo: 0,
    dealer: -1,
    street: null,
    turn: -1,
    currentBet: 0,
    minRaise: DEFAULTS.bb,
    result: null,
    log: [],
    base: { sb: DEFAULTS.sb, bb: DEFAULTS.bb }, // blindes réglées (avant doublements), pour recommencer
    clock: null, // niveaux de blindes au temps : { levels: [{ sb, bb, min }], planned, level, levelAt, paused }
    players: ids.map((_, i) => ({ chips: i === 0 ? 0 : DEFAULTS.stack, bet: 0, total: 0, folded: false, allIn: false, inHand: false, acted: false, noRaise: false, sitOut: false, left: false, taps: 0, eggs: 0, eggBy: -1, eggStock: EGG_STOCK, shieldUntil: 0 })),
  };
  setPlan(st);
  return st;
}

// ---- utilitaires de table -------------------------------------------------------------

const n = (st) => st.players.length;
const next = (st, i) => (i + 1) % n(st);
const live = (st) => st.players.map((p, i) => i).filter((i) => st.players[i].inHand && !st.players[i].folded);
const pot = (st) => st.players.reduce((t, p) => t + p.total, 0);
const present = (st) => st.players.map((p, i) => i).filter((i) => !st.players[i].left);

// Prochain joueur (après `from`, en tournant) satisfaisant `pred`, ou -1.
function seatAfter(st, from, pred) {
  for (let k = 1; k <= n(st); k++) {
    const i = (from + k) % n(st);
    if (pred(i, st.players[i])) return i;
  }
  return -1;
}

function put(st, i, amount) {
  const p = st.players[i];
  const a = Math.min(amount, p.chips);
  p.chips -= a; p.bet += a; p.total += a;
  if (p.chips === 0) p.allIn = true;
  return a;
}

// Pots (principal + annexes) : un niveau par mise totale distincte des joueurs encore en
// lice. Les mises des couchés restent dans le pot mais ne le disputent pas.
function pots(st) {
  const contenders = live(st);
  const levels = [...new Set(contenders.map((i) => st.players[i].total))].sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const level of levels) {
    const amount = st.players.reduce((t, p) => t + Math.min(p.total, level) - Math.min(p.total, prev), 0);
    const eligible = contenders.filter((i) => st.players[i].total >= level);
    const last = out[out.length - 1];
    if (last && last.eligible.join() === eligible.join()) last.amount += amount;
    else out.push({ amount, eligible });
    prev = level;
  }
  // Mises des couchés au-delà du plus gros tapis encore en lice : au dernier pot.
  const rest = st.players.reduce((t, p) => t + Math.max(0, p.total - prev), 0);
  if (rest && out.length) out[out.length - 1].amount += rest;
  return out.filter((p) => p.amount > 0);
}

// ---- durée de partie : structure de blindes --------------------------------------------

// Grosses blindes « rondes » (toutes paires, pour une petite blinde = moitié entière).
const NICE = (() => {
  const out = [2, 4, 6, 8, 10, 12, 16, 20, 24, 30, 40, 50, 60, 80];
  for (let k = 100; k <= 1e7; k *= 10) for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8]) out.push(m * k);
  return out;
})();
const nice = (x) => NICE.reduce((best, v) => (Math.abs(Math.log(v / x)) < Math.abs(Math.log(best / x)) ? v : best), NICE[0]);

// Structure de blindes pour `count` joueurs à `stack` jetons et une partie de `minutes` minutes.
// Départ à ~100 grosses blindes ; la dernière grosse blinde prévue vaut ~1/20 des jetons en jeu
// (deux joueurs restants à ~10 grosses blindes chacun : la partie se termine vite). Progression
// géométrique de raison ~1,5 ; la durée d'un niveau en découle. Au-delà, 6 niveaux de
// prolongation ×1,5 pour finir la partie si elle déborde.
// `startBb` : grosse blinde de départ imposée (durée choisie en cours de partie).
function blindPlan(stack, count, minutes, startBb) {
  const bb0 = startBb ? nice(startBb) : nice(Math.max(2, stack / 100));
  const end = Math.max(bb0 * 2, (stack * Math.max(2, count)) / 20);
  const steps = Math.max(1, Math.round(Math.log(end / bb0) / Math.log(1.5)));
  const levelMin = Math.min(60, Math.max(3, Math.round(minutes / (steps + 1))));
  const ratio = Math.pow(end / bb0, 1 / steps);
  const levels = [];
  for (let k = 0; k <= steps + 6; k++) {
    let bb = nice(bb0 * Math.pow(ratio, k));
    const prev = levels[levels.length - 1];
    if (prev && bb <= prev.bb) bb = NICE.find((v) => v > prev.bb);
    levels.push({ sb: bb / 2, bb, min: levelMin });
  }
  return { levels, levelMin, planned: steps + 1 };
}

// Calcule l'horloge. Avant la partie : d'après le tapis de départ. En cours de partie : d'après
// les jetons en jeu, à partir des blindes actuelles, et l'horloge part tout de suite.
function setPlan(st) {
  const cfg = st.config;
  if (!cfg.duration) { st.clock = null; return; }
  const seats = present(st).filter((i) => i !== st.croupier);
  const running = st.phase !== 'setup';
  const chips = seats.reduce((t, i) => t + st.players[i].chips, 0);
  const count = running ? seats.filter((i) => st.players[i].chips > 0).length : seats.length;
  const plan = running ? blindPlan(chips / Math.max(1, count), count, cfg.duration, cfg.bb) : blindPlan(cfg.stack, count, cfg.duration);
  st.clock = { levels: plan.levels, planned: plan.planned, level: 0, levelAt: running ? now() : null, paused: null };
  setBlinds(cfg, plan.levels[0]);
}

const setBlinds = (cfg, lv) => { cfg.sb = lv.sb; cfg.bb = lv.bb; };
const levelMs = (c, k = c.level) => c.levels[k].min * 60000;

// Temps restant du niveau en cours (ms), horloge arrêtée comprise.
function levelLeft(c) {
  if (c.levelAt === null) return levelMs(c);
  if (c.paused !== null) return c.paused;
  return Math.max(0, c.levelAt + levelMs(c) - now());
}

// Avance l'horloge (au début d'une main) et applique les blindes du niveau atteint.
function tickClock(st) {
  const c = st.clock;
  if (!c) return;
  if (c.levelAt === null) c.levelAt = now();
  if (c.paused === null) {
    while (c.level < c.levels.length - 1 && now() - c.levelAt >= levelMs(c)) { c.levelAt += levelMs(c); c.level++; }
  }
  applyLevel(st);
}

function applyLevel(st) {
  const lv = st.clock.levels[st.clock.level];
  if (st.config.bb === lv.bb && st.config.sb === lv.sb) return;
  setBlinds(st.config, lv);
  say(st, `Niveau ${st.clock.level + 1} : blindes ${lv.sb}/${lv.bb}.`);
}

// ---- déroulement d'une main -----------------------------------------------------------

function startHand(st) {
  const cfg = st.config;
  const players = st.players.map((p, i) => i).filter((i) => i !== st.croupier && !st.players[i].left && !st.players[i].sitOut && st.players[i].chips > 0);
  if (players.length < 2) return fail('not-enough');
  st.handNo++;
  if (st.clock) tickClock(st);
  else if (cfg.blindEvery > 0 && st.handNo > 1 && (st.handNo - 1) % cfg.blindEvery === 0) {
    cfg.sb *= 2; cfg.bb *= 2;
    say(st, `Les blindes passent à ${cfg.sb}/${cfg.bb}.`);
  }
  const inGame = new Set(players);
  for (const p of st.players) Object.assign(p, { bet: 0, total: 0, folded: false, allIn: false, acted: false, noRaise: false, inHand: false });
  for (const i of players) st.players[i].inHand = true;
  st.result = null;

  st.dealer = seatAfter(st, st.dealer, (i) => inGame.has(i));
  const headsUp = players.length === 2;
  const sb = headsUp ? st.dealer : seatAfter(st, st.dealer, (i) => inGame.has(i));
  const bb = seatAfter(st, sb, (i) => inGame.has(i));
  put(st, sb, cfg.sb);
  put(st, bb, cfg.bb);
  st.street = 'preflop';
  st.currentBet = Math.max(st.players[sb].bet, st.players[bb].bet);
  st.minRaise = cfg.bb;
  st.phase = 'betting';
  st.turn = bb; // premier à parler : le suivant après la grosse blinde
  say(st, `Main n° ${st.handNo} : @${sb} petite blinde ${st.players[sb].bet}, @${bb} grosse blinde ${st.players[bb].bet}.`);
  settle(st);
  return ok();
}

function roundDone(st) {
  const active = live(st).filter((i) => !st.players[i].allIn);
  if (active.length === 0) return true;
  if (active.length === 1 && st.players[active[0]].bet >= st.currentBet) return true;
  return active.every((i) => st.players[i].acted && st.players[i].bet === st.currentBet);
}

// La mise la plus haute n'a été suivie par personne : l'excédent revient à son auteur.
function refundUncalled(st) {
  const bets = st.players.map((p, i) => [i, p.bet]).sort((a, b) => b[1] - a[1]);
  if (bets.length < 2 || bets[0][1] <= bets[1][1]) return;
  const [i, top] = bets[0];
  const back = top - bets[1][1];
  const p = st.players[i];
  p.chips += back; p.bet -= back; p.total -= back;
  if (p.chips > 0) p.allIn = false;
  say(st, `@${i} récupère ${back} (mise non suivie).`);
}

// Fait avancer la main tant que personne n'a à parler : fin de tour d'enchères, rue suivante,
// abattage, ou gagnant unique si tous les autres sont couchés.
function settle(st) {
  for (;;) {
    const alive = live(st);
    if (alive.length === 1) { winByFold(st, alive[0]); return; }
    if (alive.length === 0) { st.phase = 'between'; st.turn = -1; return; }
    if (!roundDone(st)) {
      st.turn = seatAfter(st, st.turn, (i, p) => p.inHand && !p.folded && !p.allIn && (!p.acted || p.bet < st.currentBet));
      return;
    }
    refundUncalled(st);
    if (st.street === 'river') {
      st.phase = 'showdown';
      st.turn = -1;
      st.players.forEach((p) => { p.bet = 0; });
      st.currentBet = 0;
      say(st, `Abattage : pot de ${pot(st)}. Le croupier désigne les gagnants.`);
      return;
    }
    st.street = STREETS[STREETS.indexOf(st.street) + 1];
    for (const p of st.players) { p.bet = 0; p.acted = false; p.noRaise = false; }
    st.currentBet = 0;
    st.minRaise = st.config.bb;
    st.turn = st.dealer; // le premier à parler est le premier actif après le bouton
    say(st, `${{ flop: 'Flop', turn: 'Turn', river: 'River' }[st.street]} · pot ${pot(st)}.`);
  }
}

function winByFold(st, i) {
  const amount = pot(st);
  st.players[i].chips += amount;
  st.players[i].eggStock++;
  st.result = { fold: true, pots: [{ amount, winners: [i] }] };
  say(st, `@${i} remporte ${amount} : tous les autres se sont couchés.`);
  endHand(st);
}

function endHand(st) {
  for (const p of st.players) { p.bet = 0; p.total = 0; }
  st.phase = 'between';
  st.turn = -1;
  st.street = null;
  st.currentBet = 0;
}

// ---- actions des joueurs --------------------------------------------------------------

function bet(st, i, a) {
  if (st.phase !== 'betting') return fail('no-bet');
  if (st.turn !== i) return fail('not-your-turn');
  const p = st.players[i];
  const toCall = st.currentBet - p.bet;

  if (a.type === 'fold') {
    p.folded = true;
    say(st, `@${i} se couche.`);
  } else if (a.type === 'check') {
    if (toCall > 0) return fail('must-call');
    p.acted = true;
    say(st, `@${i} fait parole.`);
  } else if (a.type === 'call') {
    if (toCall <= 0) return fail('nothing-to-call');
    const paid = put(st, i, toCall);
    p.acted = true;
    say(st, `@${i} suit ${paid}${p.allIn ? ' (tapis)' : ''}.`);
  } else if (a.type === 'raise' || a.type === 'allin') {
    const to = a.type === 'allin' ? p.bet + p.chips : a.to;
    if (!isInt(to, 1)) return fail('bad-amount');
    if (to <= st.currentBet) {
      // Un tapis qui ne dépasse pas la mise courante n'est qu'un « suivre ».
      if (a.type === 'allin' && p.chips > 0) {
        const paid = put(st, i, p.chips);
        p.acted = true;
        say(st, `@${i} suit ${paid} (tapis).`);
        return finish(st);
      }
      return fail('raise-too-small');
    }
    if (p.noRaise) return fail('cannot-raise');
    if (to > p.bet + p.chips) return fail('bad-amount');
    const full = to - st.currentBet >= st.minRaise;
    if (!full && to < p.bet + p.chips) return fail('raise-too-small');
    const wasBet = st.currentBet === 0;
    const size = to - st.currentBet;
    put(st, i, to - p.bet);
    st.currentBet = to;
    if (full) {
      st.minRaise = size;
      for (const q of st.players) { if (q !== p) { q.acted = false; q.noRaise = false; } }
    } else {
      // Tapis incomplet : ceux qui avaient déjà parlé doivent répondre mais ne peuvent plus relancer.
      for (const q of st.players) { if (q !== p) { if (q.acted) q.noRaise = true; q.acted = false; } }
    }
    p.acted = true;
    say(st, `@${i} ${p.allIn ? 'fait tapis à' : wasBet ? 'mise' : 'relance à'} ${to}.`);
  } else return fail('bad-action');
  return finish(st);
}

function finish(st) { settle(st); return ok(); }

// ---- actions du croupier --------------------------------------------------------------

const idleOrSetup = (st) => st.phase === 'setup' || st.phase === 'between';

function config(st, a) {
  if (!idleOrSetup(st)) return fail('hand-running');
  const c = st.config;
  const sb = a.sb ?? c.sb, bb = a.bb ?? c.bb, every = a.blindEvery ?? c.blindEvery;
  const stack = a.stack ?? c.stack;
  // Blindes réglées à la main sans durée : mode libre (pas d'horloge).
  const manual = a.duration === undefined && (a.sb !== undefined || a.bb !== undefined || a.blindEvery !== undefined);
  const duration = manual ? 0 : a.duration ?? c.duration;
  if (!isInt(sb, 1, 1e6) || !isInt(bb, 1, 1e6) || bb < sb) return fail('bad-blinds');
  if (!isInt(every, 0, 100) || !isInt(duration, 0, 720)) return fail('bad-amount');
  if (!isInt(stack, 1, 1e7)) return fail('bad-amount');
  const setup = st.phase === 'setup';
  if (!setup && a.stack !== undefined && a.stack !== c.stack) return fail('hand-running');
  const newDuration = duration !== c.duration;
  Object.assign(c, { sb, bb, blindEvery: every, stack, duration });
  if (setup) st.base = { sb, bb };
  if (setup) {
    st.players.forEach((p, i) => { p.chips = i === st.croupier ? 0 : stack; });
    setPlan(st); // la durée impose les blindes de départ
  } else if (newDuration) {
    setPlan(st); // nouvelle durée en cours de partie : nouvelle structure à partir des blindes actuelles
  } else if (st.clock) {
    // Blindes modifiées à la main en cours de partie : l'horloge est arrêtée.
    if (c.sb !== st.clock.levels[st.clock.level].sb || c.bb !== st.clock.levels[st.clock.level].bb) { st.clock = null; c.duration = 0; }
  }
  if (st.clock) say(st, `Réglages : tapis ${stack}, partie de ${duration} min, niveaux de ${st.clock.levels[0].min} min, blindes de départ ${c.sb}/${c.bb}.`);
  else say(st, `Réglages : tapis ${stack}, blindes ${c.sb}/${c.bb}${every ? `, doublées toutes les ${every} mains` : ''}.`);
  return ok();
}

// Passe au niveau suivant (ou précédent) sans attendre l'horloge.
function level(st, a) {
  const c = st.clock;
  if (!c) return fail('no-clock');
  const to = c.level + (a.delta === -1 ? -1 : 1);
  if (to < 0 || to >= c.levels.length) return fail('no-level');
  c.level = to;
  c.levelAt = c.levelAt === null ? null : now();
  if (c.paused !== null) c.paused = levelMs(c);
  if (idleOrSetup(st)) applyLevel(st);
  else say(st, `Niveau ${to + 1} (${c.levels[to].sb}/${c.levels[to].bb}) à la prochaine main.`);
  return ok();
}

function pause(st, a) {
  const c = st.clock;
  if (!c || c.levelAt === null) return fail('no-clock');
  if (a.on && c.paused === null) { c.paused = levelLeft(c); say(st, 'Horloge des blindes en pause.'); }
  else if (!a.on && c.paused !== null) { c.levelAt = now() - (levelMs(c) - c.paused); c.paused = null; say(st, 'Horloge des blindes relancée.'); }
  return ok();
}

// Modifie un niveau de la structure (blindes et durée). Le niveau en cours s'applique tout de
// suite entre deux mains, sinon à la main suivante ; changer sa durée garde le temps déjà écoulé.
function editLevel(st, a) {
  const c = st.clock;
  if (!c) return fail('no-clock');
  const k = a.level;
  if (!Number.isInteger(k) || k < 0 || k >= c.levels.length) return fail('no-level');
  const lv = c.levels[k];
  const sb = a.sb ?? lv.sb, bb = a.bb ?? lv.bb, min = a.min ?? lv.min;
  if (!isInt(sb, 1, 1e6) || !isInt(bb, 1, 1e6) || bb < sb) return fail('bad-blinds');
  if (!isInt(min, 1, 240)) return fail('bad-amount');
  if (k === c.level && c.paused !== null) c.paused = Math.max(0, c.paused + (min - lv.min) * 60000);
  Object.assign(lv, { sb, bb, min });
  say(st, `Niveau ${k + 1} modifié : ${sb}/${bb}, ${min} min.`);
  if (k === c.level && idleOrSetup(st)) setBlinds(st.config, lv);
  return ok();
}

// Distribue les pots : `winners` = une liste de gagnants par pot (dans l'ordre de `pots`).
function award(st, a) {
  if (st.phase !== 'showdown') return fail('no-showdown');
  const all = pots(st);
  if (!Array.isArray(a.winners) || a.winners.length !== all.length) return fail('bad-winners');
  for (let k = 0; k < all.length; k++) {
    const w = a.winners[k];
    if (!Array.isArray(w) || w.length === 0 || new Set(w).size !== w.length || !w.every((i) => all[k].eligible.includes(i))) return fail('bad-winners');
  }
  const result = { fold: false, pots: [] };
  all.forEach((p, k) => {
    // Ordre de partage : à partir du premier à gauche du bouton, le reste va au premier.
    const order = [...a.winners[k]].sort((x, y) => ((x - st.dealer + n(st) - 1) % n(st)) - ((y - st.dealer + n(st) - 1) % n(st)));
    const share = Math.floor(p.amount / order.length);
    const extra = p.amount - share * order.length;
    order.forEach((i, j) => { st.players[i].chips += share + (j < extra ? 1 : 0); });
    result.pots.push({ amount: p.amount, winners: order });
    say(st, `${order.map((i) => `@${i}`).join(' et ')} ${order.length > 1 ? 'partagent' : 'remporte'} ${p.amount}.`);
  });
  st.result = result;
  // Un œuf de plus par gagnant de la main (une seule fois même avec plusieurs pots).
  for (const i of new Set(result.pots.flatMap((p) => p.winners))) st.players[i].eggStock++;
  endHand(st);
  return ok();
}

// Corrige les jetons d'un joueur (recave, erreur de comptage) entre deux mains.
function give(st, a) {
  if (!idleOrSetup(st)) return fail('hand-running');
  const p = st.players[a.player];
  if (!p || p.left || a.player === st.croupier) return fail('bad-target');
  if (!Number.isInteger(a.amount) || a.amount === 0 || Math.abs(a.amount) > MAX_CHIPS || p.chips + a.amount < 0 || p.chips + a.amount > MAX_CHIPS) return fail('bad-amount');
  p.chips += a.amount;
  say(st, `@${a.player} ${a.amount > 0 ? 'reçoit' : 'rend'} ${Math.abs(a.amount)} jetons (croupier).`);
  return ok();
}

// Recommence la partie : tapis de départ pour tous, mains, bouton et horloge remis à zéro. Les
// réglages, les absences et les compteurs de clics sont conservés ; les œufs repartent à 10.
function restart(st) {
  st.players.forEach((p, i) => Object.assign(p, {
    chips: i === st.croupier || p.left ? 0 : st.config.stack, bet: 0, total: 0, folded: false, allIn: false,
    inHand: false, acted: false, noRaise: false, eggs: 0, eggStock: EGG_STOCK, shieldUntil: 0,
  }));
  Object.assign(st, { phase: 'setup', handNo: 0, dealer: -1, street: null, turn: -1, currentBet: 0, result: null, log: [] });
  Object.assign(st.config, st.base);
  st.minRaise = st.config.bb;
  setPlan(st);
  say(st, 'Partie recommencée par le croupier.');
  return ok();
}

function croupierAction(st, i, a) {
  switch (a.type) {
    case 'config': return config(st, a);
    case 'start': return idleOrSetup(st) ? startHand(st) : fail('hand-running');
    case 'award': return award(st, a);
    case 'give': return give(st, a);
    case 'level': return level(st, a);
    case 'pause': return pause(st, a);
    case 'editLevel': return editLevel(st, a);
    case 'restart': return restart(st);
    case 'end': st.phase = 'over'; st.turn = -1; return ok();
    default: return null;
  }
}

function action(st, idx, a) {
  if (!a || typeof a.type !== 'string') return fail('bad-action');
  if (st.phase === 'over' || st.players[idx]?.left) return fail('no-game');

  // Actions de tout joueur
  if (a.type === 'croupier') {
    if (st.phase !== 'setup') return fail('game-running');
    if (idx === st.croupier) return ok();
    // L'ancien croupier devient joueur ; le nouveau pose ses jetons.
    st.players[st.croupier].chips = st.config.stack;
    st.players[idx].chips = 0;
    st.players[idx].sitOut = false;
    st.croupier = idx;
    say(st, `@${idx} devient croupier.`);
    return ok();
  }
  // Pour rire (sans effet sur les jetons), ouverts à tous y compris le croupier.
  if (a.type === 'tap') {
    if (!isInt(a.n ?? 1, 1, MAX_TAPS)) return fail('bad-amount');
    st.players[idx].taps += a.n ?? 1;
    return ok();
  }
  if (a.type === 'egg') {
    const p = st.players[a.player];
    if (!p || p.left || a.player === idx) return fail('bad-target');
    if (st.players[idx].eggStock <= 0) return fail('no-eggs');
    if (p.shieldUntil > now()) return fail('protected');
    st.players[idx].eggStock--;
    p.eggs = Math.min(p.eggs + 1, MAX_EGGS);
    p.eggBy = idx;
    return ok();
  }
  if (a.type === 'clean') {
    const p = st.players[idx];
    if (p.eggs) { p.eggs = 0; p.shieldUntil = now() + SHIELD_MS; }
    return ok();
  }
  if (a.type === 'sitout') {
    if (!idleOrSetup(st)) return fail('hand-running');
    // Soi-même, ou n'importe qui si on est croupier.
    const who = idx === st.croupier && Number.isInteger(a.player) ? a.player : idx;
    const p = st.players[who];
    if (!p || p.left || who === st.croupier) return fail('bad-target');
    p.sitOut = !!a.out;
    return ok();
  }
  if (['fold', 'check', 'call', 'raise', 'allin'].includes(a.type)) return bet(st, idx, a);

  if (idx !== st.croupier) return fail('not-croupier');
  return croupierAction(st, idx, a) ?? fail('bad-action');
}

// Un joueur part : il se couche, ses jetons sortent du jeu ; le croupier est repris par un autre.
function onLeave(st, idx) {
  const p = st.players[idx];
  if (!p || p.left) return;
  p.left = true;
  p.sitOut = true;
  if (st.phase === 'betting' && p.inHand && !p.folded) {
    p.folded = true;
    say(st, `@${idx} quitte la table et se couche.`);
  }
  if (st.croupier === idx) {
    const heir = seatAfter(st, idx, (i, q) => !q.left);
    if (heir === -1) { st.phase = 'over'; return; }
    // L'héritier arrête de jouer : couché s'il est dans la main, ses jetons sortent du jeu.
    const h = st.players[heir];
    if (st.phase === 'betting' && h.inHand && !h.folded) h.folded = true;
    h.chips = 0; h.sitOut = true;
    st.croupier = heir;
    say(st, `@${heir} devient croupier.`);
  }
  if (present(st).length < 2) { st.phase = 'over'; return; }
  if (st.phase === 'betting') {
    settle(st);
  } else if (st.phase === 'showdown' && pots(st).length === 0) {
    endHand(st);
  }
}

// ---- vue ------------------------------------------------------------------------------

function hints(st, idx) {
  const none = { actions: [], toCall: 0, minRaise: 0, maxRaise: 0 };
  if (st.phase !== 'betting' || st.turn !== idx || idx < 0) return none;
  const p = st.players[idx];
  const toCall = Math.min(st.currentBet - p.bet, p.chips);
  const actions = ['fold', toCall > 0 ? 'call' : 'check'];
  const maxRaise = p.bet + p.chips;
  if (!p.noRaise && p.chips > st.currentBet - p.bet) actions.push('raise');
  return { actions, toCall, minRaise: Math.min(st.currentBet + st.minRaise, maxRaise), maxRaise };
}

// Toute l'information est publique (pas de cartes) ; seul `hints` dépend du joueur.
function view(st, idx) {
  const croupier = idx >= 0 && idx === st.croupier;
  return {
    phase: st.phase,
    croupier: st.croupier,
    isCroupier: croupier,
    config: { ...st.config },
    handNo: st.handNo,
    dealer: st.dealer,
    street: st.street,
    turn: st.turn,
    currentBet: st.currentBet,
    minRaise: st.minRaise,
    pot: pot(st),
    pots: st.phase === 'showdown' ? pots(st) : [],
    result: st.result,
    log: st.log,
    clock: st.clock && {
      level: st.clock.level, levels: st.clock.levels, planned: st.clock.planned,
      started: st.clock.levelAt !== null, paused: st.clock.paused !== null, left: levelLeft(st.clock),
    },
    players: st.players.map((p) => ({ chips: p.chips, bet: p.bet, total: p.total, folded: p.folded, allIn: p.allIn, inHand: p.inHand, sitOut: p.sitOut, left: p.left, taps: p.taps, eggs: p.eggs, eggBy: p.eggBy, eggStock: p.eggStock, shield: Math.max(0, p.shieldUntil - now()) })),
    me: idx >= 0 ? idx : null,
    hints: hints(st, idx),
  };
}

const isOver = (st) => st.phase === 'over';
const nextFirst = (st, first) => first;

module.exports = {
  id: 'chips',
  name: 'Jetons de poker',
  minPlayers: 3, // croupier + 2 joueurs
  maxPlayers: 11, // croupier + 10 joueurs
  autoStart: false,
  init, action, view, isOver, nextFirst, onLeave,
  _internal: { pots, DEFAULTS, blindPlan, setNow: (f) => { now = f; } },
};
