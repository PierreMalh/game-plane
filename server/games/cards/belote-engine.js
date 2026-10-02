'use strict';
// Moteur commun de la belote à 4 joueurs, 2 équipes (partenaires face à face : sièges 0 et 2
// contre 1 et 3). Deux modes :
//
//   « classic » — belote classique, partie en 501. Enchères (« prise ») :
//        tour 1  prendre à la couleur de la carte retournée, ou passer ;
//        tour 2  prendre à une AUTRE couleur ; tous passent encore : redonne.
//        Le preneur reçoit la retournée + 2 cartes (8 chacun). Contrat : 82 points.
//   « coinche » — belote contrée, partie en 1000. 8 cartes dès la donne, enchères chiffrées :
//        on annonce un contrat (80, 90 … 160 ou capot) ET une couleur d'atout, chacun doit
//        surenchérir ; les adversaires peuvent CONTRER, le camp preneur SURCONTRER.
//
// Jeu (communs aux deux modes) — 8 plis, le joueur à gauche du donneur entame :
//   - on fournit la couleur demandée ; à l'atout on « monte » si on le peut ;
//   - sans la couleur : on COUPE si on a de l'atout (et on surcoupe si un adversaire a coupé ;
//     sinon on joue quand même un atout), SAUF si son partenaire est maître du pli.
// Cartes (atout / autres) : V 20/2 · 9 14/0 · As 11 · 10 10 · R 4 · D 3 · 8 et 7 : 0.
// 152 points + 10 de der = 162. Belote-rebelote (R + D d'atout, même main) : +20, automatique.
//
// ANNONCES (les deux modes), déclarées automatiquement à la 1re carte jouée de chaque joueur :
//   tierce (3 cartes qui se suivent dans une couleur) 20 · cinquante (4) 50 · cent (5 ou plus) 100 ·
//   carré de valets 200 · de 9 150 · d'as, 10, rois, dames 100. Suite : 7 8 9 10 V D R A.
//   Après le 1er pli, la MEILLEURE annonce de chaque équipe est comparée : l'équipe gagnante
//   marque toutes ses annonces, l'autre aucune. (carré > cent > cinquante > tierce ; à égalité de
//   hauteur : l'atout, puis le premier à avoir joué.) Perdues si l'équipe gagnante est celle d'un
//   preneur qui chute.

const { SUITS, rankOf, suitOf, shuffle } = require('./deck');

const RANKS32 = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const PLAIN_POINTS = { A: 11, 10: 10, K: 4, Q: 3, J: 2, 9: 0, 8: 0, 7: 0 };
const TRUMP_POINTS = { J: 20, 9: 14, A: 11, 10: 10, K: 4, Q: 3, 8: 0, 7: 0 };
const PLAIN_ORDER = ['7', '8', '9', 'J', 'Q', 'K', '10', 'A']; // du plus faible au plus fort
const TRUMP_ORDER = ['7', '8', 'Q', 'K', '10', 'A', '9', 'J'];
const SEQ = RANKS32; // ordre des suites : 7 8 9 10 V D R A
const SEQ_POINTS = { tierce: 20, cinquante: 50, cent: 100 };
const SEQ_BASE = { tierce: 200, cinquante: 300, cent: 400 };
const CARRE_POINTS = { J: 200, 9: 150, A: 100, 10: 100, K: 100, Q: 100 };
const CARRE_SCORE = { J: 1000, 9: 900, A: 800, 10: 700, K: 600, Q: 500 };
const BID_VALUES = [80, 90, 100, 110, 120, 130, 140, 150, 160, 250]; // 250 = capot
const CAPOT_BID = 250;
const CONTRE_MULT = [1, 2, 4];
const TARGETS = { classic: 501, coinche: 1000 };
const CONTRACT = 82;
const DIX_DE_DER = 10;
const BELOTE = 20;
const CAPOT_POINTS = 252;
const LOG_MAX = 26;
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
const isBid = (st) => st.phase === 'bid1' || st.phase === 'bid2' || st.phase === 'bid' || st.phase === 'surcontre';

// ---------------------------------------------------------------- annonces

// Toutes les annonces d'une main de 8 cartes.
function findCombos(hand) {
  const combos = [];
  for (const s of SUITS) {
    let run = [];
    for (let i = 0; i <= SEQ.length; i++) {
      if (i < SEQ.length && hand.includes(SEQ[i] + s)) { run.push(i); continue; }
      if (run.length >= 3) {
        const kind = run.length >= 5 ? 'cent' : run.length === 4 ? 'cinquante' : 'tierce';
        combos.push({ kind, suit: s, cards: run.map((k) => SEQ[k] + s), high: run[run.length - 1], points: SEQ_POINTS[kind] });
      }
      run = [];
    }
  }
  for (const r of Object.keys(CARRE_POINTS)) {
    if (SUITS.every((s) => hand.includes(r + s))) {
      combos.push({ kind: 'carre', rank: r, cards: SUITS.map((s) => r + s), points: CARRE_POINTS[r] });
    }
  }
  return combos;
}

// Hauteur d'une annonce pour les comparer (l'atout départage deux suites égales).
const comboScore = (st, c) => (c.kind === 'carre' ? CARRE_SCORE[c.rank] : SEQ_BASE[c.kind] + c.high + (c.suit === st.trump ? 0.5 : 0));

// Après le 1er pli : quelle équipe marque ses annonces ?
function resolveAnnounces(st) {
  const best = [null, null]; // meilleure annonce de chaque équipe : { score, order }
  const combos = [[], []];
  for (const [p, d] of Object.entries(st.declared)) {
    const t = team(Number(p));
    for (const c of d.combos) {
      combos[t].push({ p: Number(p), ...c });
      const cand = { score: comboScore(st, c), order: d.order };
      if (!best[t] || cand.score > best[t].score || (cand.score === best[t].score && cand.order < best[t].order)) best[t] = cand;
    }
  }
  let winner = null;
  if (best[0] && best[1]) {
    if (best[0].score !== best[1].score) winner = best[0].score > best[1].score ? 0 : 1;
    else winner = best[0].order < best[1].order ? 0 : 1;
  } else if (best[0] || best[1]) winner = best[0] ? 0 : 1;
  if (winner === null) return;
  const mine = combos[winner];
  st.announce = { team: winner, points: mine.reduce((n, c) => n + c.points, 0), combos: mine };
  for (const c of mine) say(st, `@${c.p} : ${label(c)} (+${c.points}).`);
}

const label = (c) => ({ tierce: 'tierce', cinquante: 'cinquante', cent: 'cent', carre: 'carré' }[c.kind] + (c.kind === 'carre' ? ` de ${c.rank}` : ` à ${c.cards[c.cards.length - 1]}`));

// ---------------------------------------------------------------- jeu : création

function createGame(mode) {
  const coinche = mode === 'coinche';

  function init(ids, { rng = Math.random, first = 0, target = TARGETS[mode] } = {}) {
    const st = {
      mode, rng, target,
      dealer: first % 4, round: 1, phase: 'bid1',
      hands: [[], [], [], []], turned: null, rest: [],
      trump: null, taker: null, turn: 0, passes: 0,
      bid: null,            // contrée : { p, value, suit }
      contre: 0,            // contrée : 0 aucun, 1 contré, 2 surcontré
      trick: [], lastTrick: null, trickNo: 0,
      cardPts: [0, 0], tricks: [0, 0],
      belote: { holder: null, played: 0 },
      declared: {},         // { joueur: { combos, order } } déclarées au 1er pli
      announce: null,       // résultat de la comparaison des annonces
      scores: [0, 0], result: null,
      ready: [false, false, false, false],
      winnerTeam: null, forfeit: false, log: [],
    };
    deal(st);
    return st;
  }

  function resetDeal(st) {
    st.trump = null; st.taker = null; st.bid = null; st.contre = 0; st.passes = 0;
    st.trick = []; st.lastTrick = null; st.trickNo = 0;
    st.cardPts = [0, 0]; st.tricks = [0, 0];
    st.belote = { holder: null, played: 0 };
    st.declared = {}; st.announce = null; st.result = null;
    st.ready = [false, false, false, false];
    st.turn = (st.dealer + 1) % 4;
  }

  function deal(st) {
    const deck = shuffle(deck32(), st.rng);
    st.hands = [[], [], [], []];
    const start = (st.dealer + 1) % 4;
    resetDeal(st);
    if (coinche) { // 8 cartes chacun d'emblée
      for (let s = 0; s < 4; s++) st.hands[(start + s) % 4] = deck.slice(s * 8, s * 8 + 8);
      for (const h of st.hands) h.sort((a, b) => SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)) || PLAIN_ORDER.indexOf(rankOf(b)) - PLAIN_ORDER.indexOf(rankOf(a)));
      st.turned = null; st.rest = [];
      st.phase = 'bid';
      say(st, `Donne ${st.round} : enchères.`);
      return;
    }
    let k = 0;
    for (const n of [3, 2]) { // 3 cartes puis 2, à gauche du donneur d'abord
      for (let s = 0; s < 4; s++) { st.hands[(start + s) % 4].push(...deck.slice(k, k + n)); k += n; }
    }
    st.turned = deck[k++];
    st.rest = deck.slice(k);
    st.phase = 'bid1';
    say(st, `Donne ${st.round} : carte retournée ${st.turned}.`);
  }

  // Début du jeu de la carte : atout fixé, belote repérée.
  function startPlay(st, taker, suit) {
    st.taker = taker;
    st.trump = suit;
    for (const h of st.hands) h.sort((a, b) => strength(st, a) - strength(st, b));
    const holder = st.hands.findIndex((h) => h.includes('K' + suit) && h.includes('Q' + suit));
    st.belote = { holder: holder === -1 ? null : holder, played: 0 };
    st.phase = 'play';
    st.turn = (st.dealer + 1) % 4;
    st.trick = [];
  }

  // Belote classique : le preneur complète sa main, puis on joue.
  function takeClassic(st, idx, suit) {
    st.hands[idx].push(st.turned, ...st.rest.slice(0, 2));
    let k = 2;
    for (let s = 1; s <= 4; s++) {
      const p = (st.dealer + s) % 4;
      if (p === idx) continue;
      st.hands[p].push(...st.rest.slice(k, k + 3));
      k += 3;
    }
    st.rest = [];
    startPlay(st, idx, suit);
    say(st, `@${idx} prend à ${suit}.`);
  }

  function redeal(st, why) {
    st.dealer = (st.dealer + 1) % 4;
    say(st, why);
    deal(st);
  }

  // ---------------------------------------------------------------- jeu de la carte

  function trickWinner(st, trick) {
    const lead = suitOf(trick[0].card);
    const trumps = trick.filter((t) => isTrump(st, t.card));
    const pool = trumps.length ? trumps : trick.filter((t) => suitOf(t.card) === lead);
    return pool.reduce((best, t) => (strength(st, t.card) > strength(st, best.card) ? t : best)).p;
  }

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
    // 1re carte de la donne pour ce joueur : ses annonces sont déclarées (type seulement, cartes cachées).
    if (st.trickNo === 0 && st.declared[idx] === undefined) {
      const combos = findCombos(hand);
      st.declared[idx] = { combos, order: st.trick.length };
      if (combos.length) say(st, `@${idx} annonce : ${combos.map((c) => ({ tierce: 'tierce', cinquante: 'cinquante', cent: 'cent', carre: 'carré' }[c.kind])).join(', ')}.`);
    }
    hand.splice(hand.indexOf(card), 1);
    st.trick.push({ p: idx, card });

    // Belote / rebelote : annoncées à la pose du roi puis de la dame d'atout.
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
    st.trickNo++;
    say(st, `@${winner} remporte le pli (${pts} pts).`);
    if (st.trickNo === 1) resolveAnnounces(st);
    if (st.hands.every((h) => h.length === 0)) endRound(st, team(winner));
    else st.turn = winner;
  }

  // ---------------------------------------------------------------- fin de donne

  function endRound(st, lastWinnerTeam) {
    const pts = [...st.cardPts];
    pts[lastWinnerTeam] += DIX_DE_DER;
    const takerTeam = team(st.taker);
    const def = 1 - takerTeam;
    const bel = st.belote.holder === null ? null : team(st.belote.holder);
    const capot = st.tricks[0] === 8 ? 0 : st.tricks[1] === 8 ? 1 : null;
    const add = [0, 0];
    let made;

    if (!coinche) {
      if (capot !== null) { made = capot === takerTeam; add[capot] = CAPOT_POINTS; }
      else {
        const totals = [...pts];
        if (bel !== null) totals[bel] += BELOTE; // la belote compte pour le contrat
        made = totals[takerTeam] >= CONTRACT;
        if (made) { add[0] = totals[0]; add[1] = totals[1]; } else add[def] = 162;
      }
      if ((capot !== null || !made) && bel !== null) add[bel] += BELOTE; // toujours acquise à qui la détient
    } else {
      const value = st.bid.value;
      const mult = CONTRE_MULT[st.contre];
      const made_ = (t) => (capot === t ? CAPOT_POINTS : pts[t]) + (bel === t ? BELOTE : 0);
      const takerPts = made_(takerTeam);
      made = value === CAPOT_BID ? capot === takerTeam : takerPts >= value;
      if (st.contre === 0) {
        if (made) { add[takerTeam] = value + takerPts; add[def] = made_(def); }
        else { add[def] = 160 + value + (capot === def ? 90 : 0); if (bel !== null) add[bel] += BELOTE; }
      } else { // contré / surcontré : tout ou rien, la belote reste acquise
        add[made ? takerTeam : def] = (160 + value) * mult;
        if (bel !== null) add[bel] += BELOTE;
      }
    }

    // Annonces : à l'équipe qui a la meilleure, sauf si c'est un preneur qui chute.
    let annCounted = 0;
    if (st.announce && !(st.announce.team === takerTeam && !made)) {
      annCounted = st.announce.points;
      add[st.announce.team] += annCounted;
    }

    st.scores[0] += add[0];
    st.scores[1] += add[1];
    st.result = {
      mode, takerTeam, made, capot, cardPts: pts, belote: bel, dixDeDer: lastWinnerTeam,
      bid: st.bid && { ...st.bid }, contre: st.contre,
      announce: st.announce && { team: st.announce.team, points: st.announce.points, counted: annCounted, combos: st.announce.combos.map((c) => ({ ...c, cards: [...c.cards] })) },
      add, scores: [...st.scores],
    };
    say(st, made ? 'Contrat rempli.' : 'Contrat chuté (« dedans ») !');

    if (Math.max(...st.scores) >= st.target && st.scores[0] !== st.scores[1]) {
      st.winnerTeam = st.scores[0] > st.scores[1] ? 0 : 1;
      st.phase = 'over';
      say(st, 'La partie est terminée.');
    } else {
      st.phase = 'roundover';
      st.ready = [false, false, false, false];
    }
  }

  // ---------------------------------------------------------------- actions

  function actBidClassic(st, idx, act) {
    const turnedSuit = suitOf(st.turned);
    if (act.type === 'take') {
      let suit = turnedSuit;
      if (st.phase === 'bid2') {
        if (!SUITS.includes(act.suit) || act.suit === turnedSuit) return fail('bad-suit');
        suit = act.suit;
      }
      takeClassic(st, idx, suit);
      return ok();
    }
    // pass
    say(st, `@${idx} passe.`);
    st.passes++;
    st.turn = (idx + 1) % 4;
    if (st.passes === 4) {
      if (st.phase === 'bid1') { st.phase = 'bid2'; st.passes = 0; st.turn = (st.dealer + 1) % 4; say(st, 'Second tour : une autre couleur est possible.'); }
      else redeal(st, 'Personne ne prend : nouvelle donne.');
    }
    return ok();
  }

  const bidText = (b) => `${b.value === CAPOT_BID ? 'capot' : b.value} ${b.suit}`;

  function actBidCoinche(st, idx, act) {
    if (st.phase === 'surcontre') { // seul le preneur répond au contre
      if (idx !== st.bid.p) return fail('not-your-turn');
      if (act.type === 'surcontre') { st.contre = 2; say(st, `@${idx} : SURCONTRE !`); }
      else if (act.type !== 'pass') return fail('bad-action');
      startPlay(st, st.bid.p, st.bid.suit);
      say(st, `Contrat : ${bidText(st.bid)} par @${st.bid.p}${st.contre === 2 ? ' (surcontré ×4)' : st.contre === 1 ? ' (contré ×2)' : ''}.`);
      return ok();
    }
    if (act.type === 'bid') {
      if (!BID_VALUES.includes(act.value) || !SUITS.includes(act.suit)) return fail('bad-bid');
      if (st.bid && act.value <= st.bid.value) return fail('bid-too-low');
      st.bid = { p: idx, value: act.value, suit: act.suit };
      st.passes = 0;
      st.turn = (idx + 1) % 4;
      say(st, `@${idx} annonce ${bidText(st.bid)}.`);
      return ok();
    }
    if (act.type === 'contre') {
      if (!st.bid || team(st.bid.p) === team(idx) || st.contre !== 0) return fail('cannot-contre');
      st.contre = 1;
      st.phase = 'surcontre';
      st.turn = st.bid.p;
      say(st, `@${idx} : CONTRE !`);
      return ok();
    }
    // pass
    say(st, `@${idx} passe.`);
    st.passes++;
    st.turn = (idx + 1) % 4;
    if (!st.bid && st.passes === 4) redeal(st, 'Personne n’annonce : nouvelle donne.');
    else if (st.bid && st.passes === 3) {
      startPlay(st, st.bid.p, st.bid.suit);
      say(st, `Contrat : ${bidText(st.bid)} par @${st.bid.p}.`);
    }
    return ok();
  }

  function action(st, idx, act) {
    if (st.phase === 'over') return fail('over');
    if (!act || typeof act.type !== 'string') return fail('bad-action');
    if (!st.hands[idx]) return fail('bad-action');

    switch (act.type) {
      case 'take': case 'pass': case 'bid': case 'contre': case 'surcontre': {
        if (!isBid(st) || st.turn !== idx) return fail('not-your-turn');
        if (coinche && act.type === 'take') return fail('bad-action');
        if (!coinche && !['take', 'pass'].includes(act.type)) return fail('bad-action');
        if (act.type === 'surcontre' && st.phase !== 'surcontre') return fail('cannot-contre');
        return coinche ? actBidCoinche(st, idx, act) : actBidClassic(st, idx, act);
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

  function onLeave(st, idx) {
    if (st.phase === 'over') return;
    st.winnerTeam = 1 - team(idx);
    st.forfeit = true;
    st.phase = 'over';
    say(st, `@${idx} a quitté la partie.`);
  }

  // ---------------------------------------------------------------- vue

  function sortedHand(st, hand) {
    const order = st.trump ? [st.trump, ...DISPLAY_SUITS.filter((s) => s !== st.trump)] : DISPLAY_SUITS;
    const power = (c) => (st.trump ? strength(st, c) % 100 : PLAIN_ORDER.indexOf(rankOf(c)));
    return [...hand].sort((a, b) => order.indexOf(suitOf(a)) - order.indexOf(suitOf(b)) || power(b) - power(a));
  }

  function view(st, idx) {
    const hints = { actions: [], legal: [], suits: [], bid: null };
    if (st.phase === 'play' && st.turn === idx) {
      hints.actions.push('play');
      hints.legal = legalCards(st, idx);
    } else if (st.phase === 'surcontre' && st.turn === idx) {
      hints.actions.push('surcontre', 'pass');
    } else if (isBid(st) && st.turn === idx) {
      if (coinche) {
        hints.actions.push('bid', 'pass');
        hints.bid = { values: BID_VALUES.filter((v) => !st.bid || v > st.bid.value), suits: [...SUITS] };
        if (st.bid && team(st.bid.p) !== team(idx) && st.contre === 0) hints.actions.push('contre');
      } else {
        hints.actions.push('take', 'pass');
        if (st.phase === 'bid2') hints.suits = SUITS.filter((s) => s !== suitOf(st.turned));
      }
    } else if (st.phase === 'roundover' && !st.ready[idx]) {
      hints.actions.push('ready');
    }
    return {
      mode, phase: st.phase, round: st.round, dealer: st.dealer, turn: st.turn, target: st.target,
      scores: [...st.scores],
      turned: st.phase === 'bid1' || st.phase === 'bid2' ? st.turned : null,
      trump: st.trump, taker: st.taker,
      bid: st.bid && { ...st.bid }, contre: st.contre,
      hand: sortedHand(st, st.hands[idx]),
      counts: st.hands.map((h) => h.length),
      trick: st.trick.map((t) => ({ ...t })),
      lastTrick: st.lastTrick && { winner: st.lastTrick.winner, cards: st.lastTrick.cards.map((t) => ({ ...t })) },
      tricks: [...st.tricks],
      // Annonces : seul le TYPE est public à la déclaration ; les cartes ne se voient qu'une fois
      // la comparaison faite, et seulement pour l'équipe qui marque.
      declared: Object.fromEntries(Object.entries(st.declared).map(([p, d]) => [p, d.combos.map((c) => c.kind)])),
      announce: st.announce && { team: st.announce.team, points: st.announce.points, combos: st.announce.combos.map((c) => ({ ...c, cards: [...c.cards] })) },
      result: st.result && {
        ...st.result, cardPts: [...st.result.cardPts], add: [...st.result.add], scores: [...st.result.scores],
        announce: st.result.announce && { ...st.result.announce },
      },
      ready: [...st.ready], winnerTeam: st.winnerTeam, forfeit: st.forfeit, log: [...st.log], hints,
    };
  }

  const meta = coinche
    ? { id: 'coinche', name: 'Belote contrée', blurb: '4 joueurs · 2 équipes · contrats, contre, surcontre · en 1000' }
    : { id: 'belote', name: 'Belote', blurb: '4 joueurs · 2 équipes · prise, atout, annonces · en 501' };

  return {
    ...meta,
    minPlayers: 4,
    maxPlayers: 4,
    init: (ids, opts) => init(ids, opts),
    action,
    view,
    onLeave,
    isOver: (st) => st.phase === 'over',
    nextFirst: (_st, previousFirst) => previousFirst + 1,
    // Exposés pour les tests :
    legalCards, trickWinner, strength, pointsOf, deck32,
  };
}

module.exports = { createGame, findCombos, BID_VALUES, CAPOT_BID };
