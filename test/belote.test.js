'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const g = require('../server/games/cards/belote');

const game = (opts = {}) => g.init(['a', 'b', 'c', 'd'], opts);
const act = (st, who, a) => g.action(st, who, a);
const must = (res, msg) => assert.equal(res.ok, true, `${msg ?? ''} refusé : ${res.error}`);
const play = (st, who, card) => act(st, who, { type: 'play', card });

// Phase de jeu posée à la main : mains, atout, joueur dont c'est le tour, pli en cours.
function playState(hands, { trump = 'H', turn = 0, taker = 0, dealer = 3, trick = [] } = {}) {
  const st = game({ first: dealer });
  st.phase = 'play';
  st.trump = trump;
  st.taker = taker;
  st.hands = hands.map((h) => [...h]);
  st.turn = turn;
  st.trick = trick.map(([p, card]) => ({ p, card }));
  st.cardPts = [0, 0];
  st.tricks = [0, 0];
  const holder = st.hands.findIndex((h) => h.includes('K' + trump) && h.includes('Q' + trump));
  st.belote = { holder: holder === -1 ? null : holder, played: 0 };
  return st;
}
const legal = (st, idx) => g.legalCards(st, idx).sort();

// ---- donne et enchères -------------------------------------------------------------------

test('donne : 5 cartes chacun + carte retournée + 11 en réserve ; le preneur reçoit la retournée', () => {
  const st = game({ first: 0 });
  assert.deepEqual(st.hands.map((h) => h.length), [5, 5, 5, 5]);
  assert.equal(st.rest.length, 11);
  const all = [...st.hands.flat(), st.turned, ...st.rest];
  assert.equal(new Set(all).size, 32);
  assert.equal(all.every((c) => g.deck32().includes(c)), true);
  assert.equal(st.turn, 1); // le premier à parler est à gauche du donneur

  const turned = st.turned;
  must(act(st, 1, { type: 'take' }));
  assert.equal(st.trump, turned.slice(-1));
  assert.equal(st.taker, 1);
  assert.deepEqual(st.hands.map((h) => h.length), [8, 8, 8, 8]);
  assert.ok(st.hands[1].includes(turned));
  assert.equal(new Set(st.hands.flat()).size, 32);
  assert.equal(st.phase, 'play');
  assert.equal(st.turn, 1); // à gauche du donneur : il entame
});

test('enchères : tour de parole, passer, second tour avec une autre couleur', () => {
  const st = game({ first: 0 });
  assert.equal(act(st, 0, { type: 'take' }).error, 'not-your-turn');
  assert.equal(act(st, 2, { type: 'pass' }).error, 'not-your-turn');
  for (const i of [1, 2, 3, 0]) must(act(st, i, { type: 'pass' }));
  assert.equal(st.phase, 'bid2');
  assert.equal(st.turn, 1);
  const turnedSuit = st.turned.slice(-1);
  assert.equal(act(st, 1, { type: 'take' }).error, 'bad-suit'); // il faut choisir une couleur
  assert.equal(act(st, 1, { type: 'take', suit: turnedSuit }).error, 'bad-suit'); // pas celle retournée
  assert.equal(act(st, 1, { type: 'take', suit: 'X' }).error, 'bad-suit');
  assert.deepEqual(g.view(st, 1).hints.suits.sort(), ['C', 'D', 'H', 'S'].filter((s) => s !== turnedSuit));
  const other = ['C', 'D', 'H', 'S'].find((s) => s !== turnedSuit);
  must(act(st, 1, { type: 'pass' }));
  must(act(st, 2, { type: 'take', suit: other }));
  assert.equal(st.trump, other);
  assert.equal(st.taker, 2);
});

test('tout le monde passe deux fois : nouvelle donne, le donneur change', () => {
  const st = game({ first: 0 });
  for (let k = 0; k < 8; k++) must(act(st, st.turn, { type: 'pass' }));
  assert.equal(st.dealer, 1);
  assert.equal(st.phase, 'bid1');
  assert.equal(st.turn, 2);
  assert.deepEqual(st.hands.map((h) => h.length), [5, 5, 5, 5]);
});

// ---- valeur des cartes et plis ------------------------------------------------------------------

test('valeurs : 152 points de cartes par donne, quel que soit l’atout', () => {
  const st = game();
  for (const trump of ['C', 'D', 'H', 'S']) {
    st.trump = trump;
    assert.equal(g.deck32().reduce((n, c) => n + g.pointsOf(st, c), 0), 152, trump);
  }
  st.trump = 'H';
  assert.equal(g.pointsOf(st, 'JH'), 20);
  assert.equal(g.pointsOf(st, '9H'), 14);
  assert.equal(g.pointsOf(st, 'JS'), 2);
  assert.equal(g.pointsOf(st, '9S'), 0);
  assert.equal(g.pointsOf(st, '10S'), 10);
});

test('plis : l’atout bat tout, ordre des atouts (V 9 A 10 R D 8 7), ordre normal (A 10 R D V 9 8 7)', () => {
  const st = game();
  st.trump = 'H';
  const win = (cards) => g.trickWinner(st, cards.map((card, p) => ({ p, card })));
  assert.equal(win(['AS', '7H', 'KS', '10S']), 1); // un 7 d'atout bat l'as
  assert.equal(win(['JH', '9H', 'AH', '10H']), 0); // valet d'atout > 9 > as
  assert.equal(win(['9H', 'AH', '10H', 'KH']), 0); // 9 d'atout > as
  assert.equal(win(['AH', '10H', 'KH', 'QH']), 0); // as > 10 > roi > dame
  assert.equal(win(['10S', 'AS', 'KS', 'JS']), 1); // hors atout : as > 10
  assert.equal(win(['10S', 'KS', 'QS', 'JS']), 0); // 10 > roi
  assert.equal(win(['KS', 'AD', 'AC', 'QS']), 0); // les autres couleurs ne gagnent pas
  assert.equal(win(['9S', 'JS', 'QS', 'KS']), 3); // roi > dame > valet > 9
  assert.equal(win(['7S', '8S', '9S', 'JS']), 3);
});

// ---- obligations de jeu ----------------------------------------------------------------------------

test('on entame ce qu’on veut ; on fournit la couleur demandée', () => {
  const st = playState([['AS', 'KH', '7D'], ['QS', '9S', 'JD'], [], []], { turn: 1, trick: [[0, 'KS']] });
  assert.deepEqual(legal(st, 1), ['9S', 'QS']); // obligé de fournir pique
  const lead = playState([['AS', 'KH', '7D'], [], [], []], { turn: 0 });
  assert.deepEqual(legal(lead, 0), ['7D', 'AS', 'KH']);
});

test('atout demandé : fournir et monter si possible, sinon un atout plus faible, sinon libre', () => {
  // atout demandé avec le 9 ; le joueur a V (plus fort) et 7 (plus faible)
  let st = playState([[], ['JH', '7H', 'AS'], [], []], { turn: 1, trick: [[0, '9H']] });
  assert.deepEqual(legal(st, 1), ['JH']); // il doit monter
  st = playState([[], ['7H', '8H', 'AS'], [], []], { turn: 1, trick: [[0, '9H']] });
  assert.deepEqual(legal(st, 1), ['7H', '8H']); // ne peut pas monter : tous ses atouts
  st = playState([[], ['AS', 'KD'], [], []], { turn: 1, trick: [[0, '9H']] });
  assert.deepEqual(legal(st, 1), ['AS', 'KD']); // pas d'atout : libre
});

test('sans la couleur : on doit couper, et surcouper si un adversaire a coupé', () => {
  // pique demandé, le joueur n'en a pas mais a des atouts et un adversaire est maître
  let st = playState([['KS'], ['AD', '7H', 'JH'], [], []], { turn: 1, trick: [[0, 'KS']] });
  assert.deepEqual(legal(st, 1), ['7H', 'JH']); // obligé de couper
  // un adversaire a déjà coupé avec le 9 d'atout : il faut monter (V), pas le 7
  st = playState([['KS'], [], ['9H'], ['AD', '7H', 'JH']], { turn: 3, trick: [[0, 'KS'], [2, '9H']] });
  // le partenaire du joueur 3 est 1 ; le maître est 2 (adversaire)
  assert.deepEqual(legal(st, 3), ['JH']);
  // il ne peut pas surcouper : il doit quand même jouer un atout (sous-coupe)
  st = playState([['KS'], [], ['JH'], ['AD', '7H', '8H']], { turn: 3, trick: [[0, 'KS'], [2, 'JH']] });
  assert.deepEqual(legal(st, 3), ['7H', '8H']);
  // aucun atout : se défausser librement
  st = playState([['KS'], ['AD', '7C'], [], []], { turn: 1, trick: [[0, 'KS']] });
  assert.deepEqual(legal(st, 1), ['7C', 'AD']);
});

test('partenaire maître : on peut se défausser sans couper', () => {
  // 0 et 2 sont partenaires. 2 joue après que 0 a mené un as ; 2 n'a pas de pique et a des atouts.
  let st = playState([['AS'], [], ['7D', '9H'], []], { turn: 2, trick: [[0, 'AS'], [1, 'KS']] });
  assert.deepEqual(legal(st, 2), ['7D', '9H']); // 0 est maître : libre
  // mais si un adversaire est maître (a coupé), il faut couper
  st = playState([['AS'], [], ['7D', '9H'], []], { turn: 2, trick: [[0, 'AS'], [1, '8H']] });
  assert.deepEqual(legal(st, 2), ['9H']); // surcoupe obligatoire (9 > 8)
  // le partenaire (1 pour le joueur 3) a coupé avec le valet et est maître : libre malgré l'atout en main
  st = playState([[], [], [], ['7D', '9H']], { turn: 3, trick: [[0, 'AS'], [1, 'JH'], [2, '8H']] });
  assert.deepEqual(legal(st, 3), ['7D', '9H']);
  // un adversaire (2) est maître avec le valet : le joueur 3 doit jouer atout même sans pouvoir surcouper
  st = playState([[], [], [], ['7D', '9H']], { turn: 3, trick: [[0, 'AS'], [1, '8H'], [2, 'JH']] });
  assert.deepEqual(legal(st, 3), ['9H']);
});

test('fournir la couleur dispense de surcouper', () => {
  // un adversaire a coupé ; le joueur a la couleur demandée : il fournit simplement
  const st = playState([['KS'], ['QS', '9S', 'JH'], ['7H'], []], { turn: 1, trick: [[0, 'KS'], [3, '7H']] });
  assert.deepEqual(legal(st, 1), ['9S', 'QS']);
});

// ---- jouer une carte -------------------------------------------------------------------------------------

test('jouer : tour, main, carte légale ; le pli se règle et le gagnant entame', () => {
  const st = playState([['KS', '7D'], ['AS', '9S'], ['QS', '8D'], ['10S', 'JD']], { turn: 0, trump: 'H' });
  assert.equal(play(st, 1, 'AS').error, 'not-your-turn');
  assert.equal(play(st, 0, 'AH').error, 'not-in-hand');
  must(play(st, 0, 'KS'));
  assert.equal(play(st, 1, 'AD').error, 'not-in-hand');
  must(play(st, 1, 'AS'));
  assert.equal(act(st, 2, { type: 'play', card: '8D' }).error, 'illegal-card'); // il a la dame de pique
  must(play(st, 2, 'QS'));
  must(play(st, 3, '10S'));
  // as 11 + roi 4 + dame 3 + dix 10 = 28 points pour l'équipe 1 (joueur 1 gagne avec l'as)
  assert.deepEqual(st.cardPts, [0, 28]);
  assert.deepEqual(st.tricks, [0, 1]);
  assert.equal(st.turn, 1);
  assert.deepEqual(st.trick, []);
  assert.equal(st.lastTrick.winner, 1);
  assert.equal(st.lastTrick.cards.length, 4);
  assert.equal(g.view(st, 0).lastTrick.winner, 1);
});

// ---- belote-rebelote ----------------------------------------------------------------------------------------

test('belote-rebelote : annoncée à la pose du roi puis de la dame d’atout, 20 points', () => {
  const st = playState([['KH', 'QH'], ['9S', '7S'], ['8S', '7D'], ['10S', '7C']], { turn: 0, trump: 'H', taker: 0 });
  assert.equal(st.belote.holder, 0);
  must(play(st, 0, 'KH'));
  assert.ok(st.log.some((l) => l.includes('Belote !')));
  assert.equal(st.log.some((l) => l.includes('Rebelote')), false);
  must(play(st, 1, '9S')); must(play(st, 2, '8S')); must(play(st, 3, '10S'));
  must(play(st, 0, 'QH'));
  assert.ok(st.log.some((l) => l.includes('Rebelote')));
});

test('pas de belote si le roi et la dame d’atout sont dans deux mains', () => {
  const st = playState([['KH'], ['QH'], ['8S'], ['7S']], { turn: 0, trump: 'H' });
  assert.equal(st.belote.holder, null);
});

// ---- comptage d'une donne ---------------------------------------------------------------------------------------

// Joue le dernier pli d'une donne dont les 7 premiers plis sont fixés par cardPts / tricks.
// `last` : [carte du joueur 0, 1, 2, 3] ; le joueur `leader` entame. Atout : cœur.
function finishRound({ cardPts, tricks, taker = 0, belote = null, leader = 0, last, target = 501, scores = [0, 0] }) {
  const hands = [[last[0]], [last[1]], [last[2]], [last[3]]];
  const st = playState(hands, { turn: leader, trump: 'H', taker });
  st.cardPts = [...cardPts];
  st.tricks = [...tricks];
  st.target = target;
  st.scores = [...scores];
  st.belote = { holder: belote, played: 2 };
  for (let k = 0; k < 4; k++) must(play(st, (leader + k) % 4, last[(leader + k) % 4]));
  return st;
}

test('contrat rempli : chaque équipe marque ses points (+ 10 de der)', () => {
  // équipe 0 (preneuse) 100 points de cartes avant le dernier pli ; le dernier pli (7S 8S 9S JS = 2 pts) va à 3 (JS)
  const st = finishRound({ cardPts: [100, 50], tricks: [4, 3], last: ['7S', '8S', '9S', 'JS'] });
  assert.equal(st.result.made, true);
  assert.deepEqual(st.result.add, [100, 50 + 2 + 10]); // 3 gagne : équipe 1 + 10 de der
  assert.deepEqual(st.scores, [100, 62]);
  assert.equal(st.phase, 'roundover');
  assert.equal(st.result.takerTeam, 0);
});

test('contrat : 82 passe, 81 chute ; la belote compte pour le contrat', () => {
  // équipe preneuse (0) : 72 + 10 de der = 82 → rempli (le joueur 0 gagne le dernier pli avec KS)
  let st = finishRound({ cardPts: [70, 70], tricks: [4, 3], last: ['KS', '7S', '8S', '9S'] });
  // dernier pli : KS (4) → 0 gagne : 70 + 4 + 10 = 84 ; équipe 1 70
  assert.equal(st.result.made, true);
  // équipe preneuse : 67 + 4 (roi) + 10 = 81 → chute
  st = finishRound({ cardPts: [67, 71], tricks: [4, 3], last: ['KS', '7S', '8S', '9S'] });
  assert.equal(st.result.made, false);
  assert.deepEqual(st.result.add, [0, 162]);
  // même chose avec belote dans l'équipe preneuse (+20) : 81 + 20 = 101 → rempli
  st = finishRound({ cardPts: [67, 71], tricks: [4, 3], belote: 2, last: ['KS', '7S', '8S', '9S'] });
  assert.equal(st.result.made, true);
  assert.deepEqual(st.result.add, [101, 71]);
});

test('chute : les défenseurs marquent 162, la belote reste acquise à qui la détient', () => {
  // preneurs (équipe 0) chutent mais détiennent la belote : 0 + 20 ; défenseurs 162
  let st = finishRound({ cardPts: [40, 98], tricks: [3, 4], belote: 0, last: ['7S', '8S', '9S', 'JS'] });
  assert.equal(st.result.made, false);
  assert.deepEqual(st.result.add, [20, 162]);
  // les défenseurs ont la belote : 162 + 20
  st = finishRound({ cardPts: [40, 98], tricks: [3, 4], belote: 1, last: ['7S', '8S', '9S', 'JS'] });
  assert.deepEqual(st.result.add, [0, 182]);
});

test('capot : 252 pour l’équipe qui fait tous les plis (preneuse ou non), belote en plus', () => {
  // l'équipe 0 (preneuse) fait les 8 plis
  let st = finishRound({ cardPts: [140, 0], tricks: [7, 0], last: ['AS', '7S', '8S', '9S'] });
  assert.equal(st.result.capot, 0);
  assert.equal(st.result.made, true);
  assert.deepEqual(st.result.add, [252, 0]);
  // les défenseurs font capot : les preneurs chutent, 252 pour les défenseurs
  st = finishRound({ cardPts: [0, 140], tricks: [0, 7], leader: 1, last: ['7S', 'AS', '8S', '9S'] });
  assert.equal(st.result.capot, 1);
  assert.equal(st.result.made, false);
  assert.deepEqual(st.result.add, [0, 252]);
  // capot + belote
  st = finishRound({ cardPts: [140, 0], tricks: [7, 0], belote: 2, last: ['AS', '7S', '8S', '9S'] });
  assert.deepEqual(st.result.add, [272, 0]);
});

test('fin de partie : la première équipe à la cible gagne ; égalité à la cible : on continue', () => {
  let st = finishRound({ cardPts: [100, 50], tricks: [4, 3], last: ['KS', '7S', '8S', '9S'], target: 120, scores: [30, 10] });
  assert.equal(st.scores[0] >= 120, true);
  assert.equal(st.phase, 'over');
  assert.equal(st.winnerTeam, 0);
  assert.equal(g.isOver(st), true);
  assert.equal(act(st, 0, { type: 'ready' }).error, 'over');

  // les deux équipes atteignent la cible à égalité : pas de vainqueur, on rejoue
  st = finishRound({ cardPts: [56, 90], tricks: [3, 4], last: ['KS', '7S', '8S', '9S'], target: 100, scores: [40, 30], taker: 1 });
  // preneurs = équipe 1 : 90 → remplis ; équipe 0 : 56 + 4 + 10 = 70 → 110 ; équipe 1 : 90 → 120
  assert.equal(st.phase, 'over');
  assert.equal(st.winnerTeam, 1);
});

test('donne suivante : tous « prêts », le donneur change', () => {
  const st = finishRound({ cardPts: [100, 50], tricks: [4, 3], last: ['KS', '7S', '8S', '9S'] });
  assert.deepEqual(g.view(st, 0).hints.actions, ['ready']);
  for (let i = 0; i < 3; i++) must(act(st, i, { type: 'ready' }));
  assert.equal(st.phase, 'roundover');
  assert.deepEqual(g.view(st, 0).hints.actions, []);
  must(act(st, 3, { type: 'ready' }));
  assert.equal(st.phase, 'bid1');
  assert.equal(st.round, 2);
  assert.equal(st.dealer, 0); // le donneur initial était 3
  assert.deepEqual(st.hands.map((h) => h.length), [5, 5, 5, 5]);
  assert.deepEqual(st.scores.length, 2);
});

// ---- départ, secret ---------------------------------------------------------------------------------------------------

test('départ : l’équipe adverse gagne', () => {
  const st = game();
  g.onLeave(st, 2);
  assert.equal(st.phase, 'over');
  assert.equal(st.winnerTeam, 1);
  assert.equal(act(st, 0, { type: 'pass' }).error, 'over');
  const st2 = game();
  g.onLeave(st2, 3);
  assert.equal(st2.winnerTeam, 0);
});

test('secret : ni les mains adverses, ni la réserve ; la carte retournée disparaît après la prise', () => {
  const st = game();
  for (let i = 0; i < 4; i++) {
    const json = JSON.stringify(g.view(st, i));
    st.hands.forEach((h, j) => { if (j !== i) for (const c of h) assert.equal(json.includes(`"${c}"`), false); });
    for (const c of st.rest) assert.equal(json.includes(`"${c}"`), false);
    assert.equal(g.view(st, i).turned, st.turned);
  }
  must(act(st, st.turn, { type: 'take' }));
  assert.equal(g.view(st, 0).turned, null);
  assert.deepEqual(g.view(st, 0).counts, [8, 8, 8, 8]);
});

// ---- parties aléatoires -------------------------------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('parties aléatoires : cartes conservées, donne toujours jouable, comptage cohérent', () => {
  const deck = new Set(g.deck32());
  let finished = 0;
  let rounds = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const rand = mulberry32(seed);
    const st = g.init(['a', 'b', 'c', 'd'], { rng: rand, first: seed % 4, target: 200 });
    for (let step = 0; step < 4000 && st.phase !== 'over'; step++) {
      const who = st.phase === 'roundover' ? st.ready.findIndex((r) => !r) : st.turn;
      const h = g.view(st, who).hints;
      assert.ok(h.actions.length > 0, `seed ${seed} étape ${step} : personne ne peut agir (${st.phase})`);
      const a = h.actions[Math.floor(rand() * h.actions.length)];
      let res;
      if (a === 'play') res = act(st, who, { type: 'play', card: h.legal[Math.floor(rand() * h.legal.length)] });
      else if (a === 'take') res = act(st, who, { type: 'take', suit: h.suits.length ? h.suits[Math.floor(rand() * h.suits.length)] : undefined });
      else res = act(st, who, { type: a });
      assert.equal(res.ok, true, `seed ${seed} : ${a} refusé (${res.error})`);

      const seen = [...st.hands.flat(), ...st.trick.map((t) => t.card), ...(st.phase.startsWith('bid') ? [st.turned, ...st.rest] : [])];
      assert.equal(new Set(seen).size, seen.length, `seed ${seed} : carte dupliquée`);
      assert.ok(seen.every((c) => deck.has(c)));
      for (let i = 0; i < 4; i++) {
        const json = JSON.stringify(g.view(st, i));
        // Les cartes d'une annonce qui marque sont révélées à tous après le 1er pli (règle du jeu).
        const shown = new Set((st.announce ? st.announce.combos : []).flatMap((c) => c.cards));
        st.hands.forEach((hand, j) => { if (j !== i) for (const c of hand) if (!shown.has(c)) assert.equal(json.includes(`"${c}"`), false, `seed ${seed} : ${c} fuit`); });
      }
      if (st.phase === 'roundover' || (st.phase === 'over' && st.result)) {
        const r = st.result;
        const bel = r.belote !== null ? 20 : 0;
        const total = r.add[0] + r.add[1] - (r.announce ? r.announce.counted : 0); // hors annonces
        if (r.capot !== null) assert.equal(total, 252 + bel, `seed ${seed} : capot`);
        else assert.equal(total, 162 + bel, `seed ${seed} : total ${total}`);
        rounds++;
      }
    }
    if (st.phase === 'over') finished++;
  }
  assert.equal(finished, 150, 'toutes les parties doivent se terminer');
  assert.ok(rounds > 150);
});
