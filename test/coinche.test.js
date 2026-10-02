'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const g = require('../server/games/cards/coinche');

const game = (opts = {}) => g.init(['a', 'b', 'c', 'd'], opts);
const act = (st, who, a) => g.action(st, who, a);
const must = (res, msg) => assert.equal(res.ok, true, `${msg ?? ''} refusé : ${res.error}`);
const bid = (st, who, value, suit) => act(st, who, { type: 'bid', value, suit });
const pass = (st, who) => act(st, who, { type: 'pass' });
const play = (st, who, card) => act(st, who, { type: 'play', card });

// ---- donne et enchères -------------------------------------------------------------------------

test('donne : 8 cartes chacun dès le départ, pas de carte retournée, enchères à gauche du donneur', () => {
  const st = game({ first: 0 });
  assert.deepEqual(st.hands.map((h) => h.length), [8, 8, 8, 8]);
  assert.equal(new Set(st.hands.flat()).size, 32);
  assert.equal(st.phase, 'bid');
  assert.equal(st.turn, 1);
  assert.equal(st.turned, null);
  const v = g.view(st, 1);
  assert.equal(v.turned, null);
  assert.deepEqual(v.hints.actions, ['bid', 'pass']);
  assert.deepEqual(v.hints.bid.values, [80, 90, 100, 110, 120, 130, 140, 150, 160, 250]);
  assert.deepEqual(v.hints.bid.suits.sort(), ['C', 'D', 'H', 'S']);
  assert.deepEqual(g.view(st, 0).hints.actions, []); // pas son tour
});

test('enchères : valeur et couleur valides, il faut surenchérir (strictement), « prendre » n’existe pas', () => {
  const st = game({ first: 0 });
  assert.equal(bid(st, 2, 80, 'H').error, 'not-your-turn');
  assert.equal(bid(st, 1, 85, 'H').error, 'bad-bid');
  assert.equal(bid(st, 1, 0, 'H').error, 'bad-bid');
  assert.equal(bid(st, 1, 80, 'X').error, 'bad-bid');
  assert.equal(bid(st, 1, '80', 'H').error, 'bad-bid');
  assert.equal(act(st, 1, { type: 'take' }).error, 'bad-action');
  must(bid(st, 1, 100, 'H'));
  assert.deepEqual(st.bid, { p: 1, value: 100, suit: 'H' });
  assert.equal(bid(st, 2, 100, 'S').error, 'bid-too-low'); // pas d'égalité
  assert.equal(bid(st, 2, 90, 'S').error, 'bid-too-low');
  assert.deepEqual(g.view(st, 2).hints.bid.values, [110, 120, 130, 140, 150, 160, 250]);
  must(bid(st, 2, 110, 'S'));
  assert.equal(st.bid.p, 2);
});

test('personne n’annonce : nouvelle donne, le donneur change', () => {
  const st = game({ first: 0 });
  for (let k = 0; k < 4; k++) must(pass(st, st.turn));
  assert.equal(st.dealer, 1);
  assert.equal(st.phase, 'bid');
  assert.equal(st.turn, 2);
  assert.equal(st.bid, null);
});

test('une annonce suivie de 3 passes : le contrat est fixé et le jeu commence', () => {
  const st = game({ first: 0 });
  must(bid(st, 1, 90, 'S'));
  must(pass(st, 2)); must(pass(st, 3));
  assert.equal(st.phase, 'bid'); // 2 passes seulement
  must(pass(st, 0));
  assert.equal(st.phase, 'play');
  assert.equal(st.trump, 'S');
  assert.equal(st.taker, 1);
  assert.equal(st.turn, 1); // à gauche du donneur
  assert.equal(st.contre, 0);
  assert.ok(st.log.some((l) => l.includes('Contrat : 90 S')));
});

test('on peut ré-enchérir après avoir passé ; chaque annonce remet les passes à zéro', () => {
  const st = game({ first: 0 });
  must(bid(st, 1, 80, 'H'));
  must(pass(st, 2)); must(pass(st, 3));
  must(bid(st, 0, 90, 'S')); // 0 n'avait pas encore parlé
  assert.equal(st.passes, 0);
  must(pass(st, 1)); // 1 passe après avoir annoncé
  must(bid(st, 2, 100, 'D')); // 2 avait passé : il peut ré-enchérir
  assert.equal(st.bid.p, 2);
  assert.equal(st.phase, 'bid');
  must(pass(st, 3)); must(pass(st, 0)); must(pass(st, 1));
  assert.equal(st.phase, 'play');
  assert.equal(st.taker, 2);
  assert.equal(st.trump, 'D');
});

test('capot : la plus haute annonce, plus rien au-dessus', () => {
  const st = game({ first: 0 });
  must(bid(st, 1, 250, 'C'));
  assert.deepEqual(g.view(st, 2).hints.bid.values, []);
  assert.equal(bid(st, 2, 160, 'H').error, 'bid-too-low');
  must(pass(st, 2)); must(pass(st, 3)); must(pass(st, 0));
  assert.equal(st.bid.value, 250);
  assert.equal(st.phase, 'play');
});

// ---- contre et surcontre ---------------------------------------------------------------------------

test('contre : seulement un adversaire du dernier annonceur, à son tour ; puis le preneur répond', () => {
  const st = game({ first: 0 });
  assert.equal(act(st, 1, { type: 'contre' }).error, 'cannot-contre'); // rien à contrer
  assert.ok(!g.view(st, 1).hints.actions.includes('contre'));
  must(bid(st, 1, 100, 'H'));
  assert.equal(act(st, 2, { type: 'contre' }).ok, true); // 2 est adversaire de 1
  assert.equal(st.phase, 'surcontre');
  assert.equal(st.contre, 1);
  assert.equal(st.turn, 1);
  assert.deepEqual(g.view(st, 1).hints.actions, ['surcontre', 'pass']);
  assert.equal(act(st, 3, { type: 'pass' }).error, 'not-your-turn');
  assert.equal(act(st, 2, { type: 'surcontre' }).error, 'not-your-turn');
  assert.equal(act(st, 1, { type: 'contre' }).error, 'bad-action'); // pas de contre dans cette phase
  must(act(st, 1, { type: 'pass' })); // il ne surcontre pas
  assert.equal(st.phase, 'play');
  assert.equal(st.contre, 1);
  assert.equal(st.taker, 1);
});

test('contre : pas le partenaire du preneur, pas deux fois ; surcontre ×4', () => {
  const st = game({ first: 0 });
  must(bid(st, 1, 100, 'H'));
  must(pass(st, 2));
  assert.deepEqual(g.view(st, 3).hints.actions, ['bid', 'pass']); // 3 est le partenaire de 1 : pas de contre
  assert.equal(act(st, 3, { type: 'contre' }).error, 'cannot-contre');
  must(pass(st, 3));
  assert.ok(g.view(st, 0).hints.actions.includes('contre')); // 0 est adversaire : peut contrer
  must(act(st, 0, { type: 'contre' }));
  must(act(st, 1, { type: 'surcontre' }));
  assert.equal(st.contre, 2);
  assert.equal(st.phase, 'play');
  assert.ok(st.log.some((l) => l.includes('surcontré ×4')));
});

test('le contre vise toujours la dernière annonce : seuls ses adversaires peuvent contrer', () => {
  const st = game({ first: 0 });
  must(bid(st, 1, 80, 'H')); // équipe 1
  must(bid(st, 2, 90, 'S')); // équipe 0 surenchérit : c'est maintenant elle qu'on peut contrer
  assert.ok(g.view(st, 3).hints.actions.includes('contre')); // 3 est adversaire de 2
  must(pass(st, 3));
  assert.ok(!g.view(st, 0).hints.actions.includes('contre')); // 0 est le partenaire de 2
  assert.equal(act(st, 0, { type: 'contre' }).error, 'cannot-contre');
});

// ---- comptage : calculs faits à la main ----------------------------------------------------------------------

function finish({ cardPts, tricks, taker = 0, bidValue = 100, bidSuit = 'H', contre = 0, belote = null, leader = 0, last, announce = null, scores = [0, 0], target = 1000 }) {
  const st = game({ first: (leader + 3) % 4, target });
  st.phase = 'play';
  st.trump = bidSuit;
  st.taker = taker;
  st.bid = { p: taker, value: bidValue, suit: bidSuit };
  st.contre = contre;
  st.hands = last.map((c) => [c]);
  st.turn = leader;
  st.trick = [];
  st.trickNo = 7;
  st.cardPts = [...cardPts];
  st.tricks = [...tricks];
  st.scores = [...scores];
  st.announce = announce;
  st.declared = { 0: { combos: [], order: 0 }, 1: { combos: [], order: 1 }, 2: { combos: [], order: 2 }, 3: { combos: [], order: 3 } };
  st.belote = { holder: belote, played: 2 };
  for (let k = 0; k < 4; k++) must(play(st, (leader + k) % 4, last[(leader + k) % 4]));
  return st;
}
// Dernier pli : roi de pique (4 pts) + trois cartes à 0 ; le joueur 0 le remporte → équipe 0 : +4 +10 de der.
const LAST = ['KS', '7S', '8S', '9S'];

test('contrat rempli (sans contre) : valeur du contrat + points réalisés ; les défenseurs gardent les leurs', () => {
  const st = finish({ cardPts: [90, 58], tricks: [4, 3], bidValue: 100, last: LAST });
  const r = st.result;
  assert.equal(r.made, true);
  // équipe 0 : 90 + 4 + 10 = 104 ≥ 100 → 100 + 104 ; équipe 1 : 58
  assert.deepEqual(r.add, [204, 58]);
  assert.deepEqual(st.scores, [204, 58]);
  assert.equal(st.phase, 'roundover');
});

test('contrat chuté (sans contre) : les défenseurs marquent 160 + le contrat, les preneurs 0', () => {
  const st = finish({ cardPts: [90, 58], tricks: [4, 3], bidValue: 120, last: LAST }); // 104 < 120
  assert.equal(st.result.made, false);
  assert.deepEqual(st.result.add, [0, 280]);
});

test('la belote compte dans les points du contrat ; elle reste acquise en cas de chute', () => {
  // 104 + 20 = 124 ≥ 120 → rempli ; l'équipe 0 marque 120 + 124
  let st = finish({ cardPts: [90, 58], tricks: [4, 3], bidValue: 120, belote: 2, last: LAST });
  assert.equal(st.result.made, true);
  assert.deepEqual(st.result.add, [244, 58]);
  // chute (130 demandé, 124 faits) : les 20 de belote restent à l'équipe 0
  st = finish({ cardPts: [90, 58], tricks: [4, 3], bidValue: 130, belote: 2, last: LAST });
  assert.equal(st.result.made, false);
  assert.deepEqual(st.result.add, [20, 290]);
  // belote chez les défenseurs, contrat chuté : 160 + contrat + 20
  st = finish({ cardPts: [90, 58], tricks: [4, 3], bidValue: 130, belote: 1, last: LAST });
  assert.deepEqual(st.result.add, [0, 310]);
  // belote chez les défenseurs, contrat rempli : ils marquent leurs points + 20
  st = finish({ cardPts: [90, 58], tricks: [4, 3], bidValue: 100, belote: 1, last: LAST });
  assert.deepEqual(st.result.add, [204, 78]);
});

test('contre ×2 : tout ou rien, (160 + contrat) × 2 pour le camp qui gagne', () => {
  let st = finish({ cardPts: [90, 58], tricks: [4, 3], bidValue: 100, contre: 1, last: LAST });
  assert.equal(st.result.made, true);
  assert.deepEqual(st.result.add, [520, 0]);
  st = finish({ cardPts: [90, 58], tricks: [4, 3], bidValue: 120, contre: 1, last: LAST });
  assert.equal(st.result.made, false);
  assert.deepEqual(st.result.add, [0, 560]); // (160 + 120) × 2
});

test('surcontre ×4 ; la belote n’est jamais multipliée', () => {
  let st = finish({ cardPts: [90, 58], tricks: [4, 3], bidValue: 100, contre: 2, last: LAST });
  assert.deepEqual(st.result.add, [1040, 0]); // (160 + 100) × 4
  st = finish({ cardPts: [90, 58], tricks: [4, 3], bidValue: 120, contre: 1, belote: 1, last: LAST });
  assert.deepEqual(st.result.add, [0, 580]); // 560 + 20 de belote des défenseurs
  st = finish({ cardPts: [90, 58], tricks: [4, 3], bidValue: 130, contre: 1, belote: 0, last: LAST }); // chute, belote des preneurs
  assert.deepEqual(st.result.add, [20, 580]); // (160 + 130) × 2 = 580
});

test('capot annoncé : réussi (250 + 252) ou raté (les défenseurs : 160 + 250)', () => {
  let st = finish({ cardPts: [140, 0], tricks: [7, 0], bidValue: 250, last: LAST });
  assert.equal(st.result.capot, 0);
  assert.equal(st.result.made, true);
  assert.deepEqual(st.result.add, [502, 0]);
  st = finish({ cardPts: [120, 20], tricks: [6, 1], bidValue: 250, last: LAST });
  assert.equal(st.result.made, false);
  assert.deepEqual(st.result.add, [0, 410]);
});

test('capot non annoncé : 252 points réalisés ; capot des défenseurs : +90', () => {
  let st = finish({ cardPts: [140, 0], tricks: [7, 0], bidValue: 80, last: LAST });
  assert.deepEqual(st.result.add, [80 + 252, 0]);
  // les défenseurs (équipe 1) font les 8 plis : le dernier pli va à l'équipe 1 (le joueur 1 entame et gagne)
  st = finish({ cardPts: [0, 140], tricks: [0, 7], bidValue: 80, leader: 1, last: ['7S', 'KS', '8S', '9S'] });
  assert.equal(st.result.capot, 1);
  assert.equal(st.result.made, false);
  assert.deepEqual(st.result.add, [0, 160 + 80 + 90]);
});

test('annonces : ajoutées sans multiplication ; perdues si c’est le preneur qui chute', () => {
  const ann = (team, points) => ({ team, points, combos: [] });
  // rempli, annonces de l'équipe 0 (+50) : 204 + 50
  let st = finish({ cardPts: [90, 58], tricks: [4, 3], bidValue: 100, last: LAST, announce: ann(0, 50) });
  assert.deepEqual(st.result.add, [254, 58]);
  assert.equal(st.result.announce.counted, 50);
  // contré : les annonces ne sont pas multipliées
  st = finish({ cardPts: [90, 58], tricks: [4, 3], bidValue: 100, contre: 1, last: LAST, announce: ann(0, 50) });
  assert.deepEqual(st.result.add, [570, 0]);
  // le preneur chute : ses annonces sont perdues
  st = finish({ cardPts: [90, 58], tricks: [4, 3], bidValue: 130, last: LAST, announce: ann(0, 50) });
  assert.deepEqual(st.result.add, [0, 290]);
  assert.equal(st.result.announce.counted, 0);
  // le preneur chute mais ce sont les défenseurs qui marquent les annonces : elles comptent
  st = finish({ cardPts: [90, 58], tricks: [4, 3], bidValue: 130, last: LAST, announce: ann(1, 100) });
  assert.deepEqual(st.result.add, [0, 390]);
});

test('fin de partie à 1000 ; égalité à la cible : on continue', () => {
  let st = finish({ cardPts: [90, 58], tricks: [4, 3], bidValue: 100, last: LAST, scores: [900, 300] });
  assert.equal(st.phase, 'over');
  assert.equal(st.winnerTeam, 0);
  assert.equal(g.isOver(st), true);
  st = finish({ cardPts: [90, 58], tricks: [4, 3], bidValue: 100, last: LAST, scores: [796, 1000 - 58] });
  assert.equal(st.scores[0], 1000);
  assert.equal(st.scores[1], 1000);
  assert.equal(st.phase, 'roundover'); // égalité parfaite : on rejoue
});

// ---- vue, départ ---------------------------------------------------------------------------------------------

test('secret : annonces d’enchères publiques, mains privées', () => {
  const st = game({ first: 0 });
  must(bid(st, 1, 100, 'H'));
  for (let i = 0; i < 4; i++) {
    const v = g.view(st, i);
    assert.deepEqual(v.bid, { p: 1, value: 100, suit: 'H' });
    const json = JSON.stringify(v);
    st.hands.forEach((h, j) => { if (j !== i) for (const c of h) assert.equal(json.includes(`"${c}"`), false); });
  }
});

test('départ : l’équipe adverse gagne', () => {
  const st = game();
  g.onLeave(st, 1);
  assert.equal(st.winnerTeam, 0);
  assert.equal(st.phase, 'over');
});

// ---- parties aléatoires, comptage vérifié par un calcul indépendant ------------------------------------------------

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Barème de la contrée recalculé à part, à partir des seuls faits de la donne.
function refCoinche(r) {
  const t = r.takerTeam;
  const d = 1 - t;
  const v = r.bid.value;
  const mult = [1, 2, 4][r.contre];
  const pts = (x) => (r.capot === x ? 252 : r.cardPts[x]) + (r.belote === x ? 20 : 0);
  const made = v === 250 ? r.capot === t : pts(t) >= v;
  assert.equal(r.made, made, 'contrat rempli ?');
  const add = [0, 0];
  if (r.contre === 0) {
    if (made) { add[t] = v + pts(t); add[d] = pts(d); }
    else { add[d] = 160 + v + (r.capot === d ? 90 : 0); if (r.belote !== null) add[r.belote] += 20; }
  } else {
    add[made ? t : d] = (160 + v) * mult;
    if (r.belote !== null) add[r.belote] += 20;
  }
  const counted = r.announce && !(r.announce.team === t && !made) ? r.announce.points : 0;
  if (r.announce) assert.equal(r.announce.counted, counted, 'annonces comptées ?');
  if (counted) add[r.announce.team] += counted;
  return add;
}

test('parties aléatoires : jamais bloquées, cartes conservées, barème vérifié sur chaque donne', () => {
  let rounds = 0;
  let contres = 0;
  let announces = 0;
  let finished = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const rand = mulberry32(seed);
    const st = g.init(['a', 'b', 'c', 'd'], { rng: rand, first: seed % 4, target: 2000 });
    for (let step = 0; step < 6000 && st.phase !== 'over'; step++) {
      const who = st.phase === 'roundover' ? st.ready.findIndex((x) => !x) : st.turn;
      const h = g.view(st, who).hints;
      assert.ok(h.actions.length > 0, `seed ${seed} étape ${step} : personne ne peut agir (${st.phase})`);
      // Une annonce sur 4 environ, pour que les contrats soient variés ; sinon on passe.
      const options = [];
      for (const a of h.actions) {
        if (a === 'play') options.push({ type: 'play', card: h.legal[Math.floor(rand() * h.legal.length)] });
        else if (a === 'bid') { if (h.bid.values.length && rand() < 0.4) options.push({ type: 'bid', value: h.bid.values[Math.floor(rand() * h.bid.values.length)], suit: h.bid.suits[Math.floor(rand() * 4)] }); }
        else options.push({ type: a });
      }
      const choice = options.length ? options[Math.floor(rand() * options.length)] : { type: 'pass' };
      must(act(st, who, choice), `seed ${seed} ${JSON.stringify(choice)}`);

      const seen = [...st.hands.flat(), ...st.trick.map((t) => t.card)];
      assert.equal(new Set(seen).size, seen.length, `seed ${seed} : carte dupliquée`);
      if ((st.phase === 'roundover' || st.phase === 'over') && st.result && st.result.__seen !== st.round) {
        const r = st.result;
        assert.deepEqual(r.add, refCoinche(r), `seed ${seed} donne ${st.round} : ${JSON.stringify(r)}`);
        rounds++;
        if (r.contre) contres++;
        if (r.announce) announces++;
        r.__seen = st.round;
      }
    }
    if (st.phase === 'over') finished++;
  }
  assert.equal(finished, 150, 'toutes les parties doivent se terminer');
  assert.ok(rounds > 300, `donnes jouées : ${rounds}`);
  assert.ok(contres > 0, 'au moins un contre rencontré');
  assert.ok(announces > 0, 'au moins une annonce rencontrée');
});
