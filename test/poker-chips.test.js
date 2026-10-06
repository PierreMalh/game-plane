'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const g = require('../server/games/poker-chips');

const must = (res, msg) => assert.equal(res.ok, true, `${msg ?? ''} refusé : ${res.error}`);
const act = (st, who, type, extra = {}) => g.action(st, who, { type, ...extra });
const total = (st) => st.players.reduce((s, p) => s + p.chips + p.total, 0);
const newGame = (k, cfg = {}) => {
  const st = g.init(Array.from({ length: k }, (_, i) => `p${i}`));
  if (Object.keys(cfg).length) must(act(st, 0, 'config', cfg));
  return st;
};

test('réglages, puis main : blindes, tour de parole, conservation des jetons', () => {
  const st = newGame(4, { stack: 500, sb: 5, bb: 10 });
  assert.ok(st.players.every((p) => p.chips === 500));
  assert.equal(act(st, 1, 'start').error, 'not-croupier');
  must(act(st, 0, 'start'));
  // bouton sur le joueur 1 (premier assis après -1 → 0 ; ici dealer = 0)
  assert.equal(st.phase, 'betting');
  const d = st.dealer;
  const sb = (d + 1) % 4, bb = (d + 2) % 4;
  assert.equal(st.players[sb].bet, 5);
  assert.equal(st.players[bb].bet, 10);
  assert.equal(st.turn, (d + 3) % 4);
  assert.equal(g.view(st, st.turn).hints.toCall, 10);
  assert.equal(g.view(st, d === st.turn ? 1 : st.turn).pot, 15);
  assert.equal(act(st, bb, 'fold').error, 'not-your-turn');
  assert.equal(total(st), 2000);
});

test('main complète jusqu\'à l\'abattage, pot distribué par le croupier', () => {
  const st = newGame(3, { stack: 100, sb: 5, bb: 10 });
  must(act(st, 0, 'start'));
  const [d] = [st.dealer];
  const sb = (d + 1) % 3, bb = (d + 2) % 3;
  must(act(st, d, 'call'));
  must(act(st, sb, 'call'));
  must(act(st, bb, 'check'));
  assert.equal(st.street, 'flop');
  for (const street of ['flop', 'turn', 'river']) {
    assert.equal(st.street, street);
    for (const who of [sb, bb, d]) must(act(st, who, 'check'), street);
  }
  assert.equal(st.phase, 'showdown');
  assert.equal(g.view(st, 0).pots.length, 1);
  assert.equal(g.view(st, 0).pot, 30);
  assert.equal(act(st, 1, 'award', { winners: [[bb]] }).error, 'not-croupier');
  assert.equal(act(st, 0, 'award', { winners: [[]] }).error, 'bad-winners');
  must(act(st, 0, 'award', { winners: [[bb]] }));
  assert.equal(st.players[bb].chips, 120);
  assert.equal(st.phase, 'between');
  assert.equal(total(st), 300);
});

test('tous se couchent : le dernier remporte le pot sans abattage', () => {
  const st = newGame(3, { stack: 100, sb: 5, bb: 10 });
  must(act(st, 0, 'start'));
  const d = st.dealer, sb = (d + 1) % 3, bb = (d + 2) % 3;
  must(act(st, d, 'raise', { to: 30 }));
  must(act(st, sb, 'fold'));
  must(act(st, bb, 'fold'));
  assert.equal(st.phase, 'between');
  assert.equal(st.players[d].chips, 115);
  assert.equal(st.result.fold, true);
  assert.equal(total(st), 300);
});

test('relance minimale, suivre, check interdit face à une mise', () => {
  const st = newGame(3, { stack: 200, sb: 5, bb: 10 });
  must(act(st, 0, 'start'));
  const d = st.dealer;
  assert.equal(act(st, d, 'check').error, 'must-call');
  assert.equal(act(st, d, 'raise', { to: 15 }).error, 'raise-too-small');
  assert.equal(act(st, d, 'raise', { to: 500 }).error, 'bad-amount');
  must(act(st, d, 'raise', { to: 30 })); // relance de 20
  assert.equal(st.minRaise, 20);
  const sb = (d + 1) % 3;
  assert.equal(act(st, sb, 'raise', { to: 40 }).error, 'raise-too-small');
  must(act(st, sb, 'raise', { to: 50 }));
});

test('tapis inégaux : pots annexes, mise non suivie rendue', () => {
  const st = newGame(3, { stack: 100, sb: 5, bb: 10 });
  must(act(st, 0, 'give', { player: 1, amount: -50 })); // p1 : 50
  must(act(st, 0, 'give', { player: 2, amount: 100 })); // p2 : 200
  must(act(st, 0, 'start'));
  // tout le monde fait tapis, un par un
  let guard = 0;
  while (st.phase === 'betting' && guard++ < 10) must(act(st, st.turn, 'allin'));
  assert.equal(st.phase, 'showdown');
  const pots = g.view(st, 0).pots;
  // 100 (p0) + 50 (p1) + 200 (p2) : p2 récupère les 100 non suivis → pots 150 (3) et 100 (p0,p2)
  assert.deepEqual(pots.map((p) => p.amount), [150, 100]);
  assert.deepEqual(pots[0].eligible.sort(), [0, 1, 2]);
  assert.deepEqual(pots[1].eligible.sort(), [0, 2]);
  assert.equal(act(st, 0, 'award', { winners: [[1], [1]] }).error, 'bad-winners'); // p1 non éligible au 2e
  must(act(st, 0, 'award', { winners: [[1], [0]] }));
  assert.equal(st.players[1].chips, 150);
  assert.equal(st.players[0].chips, 100);
  assert.equal(st.players[2].chips, 100);
});

test('égalité : partage, jeton impair au premier à gauche du bouton', () => {
  const st = newGame(3, { stack: 100, sb: 5, bb: 10 });
  must(act(st, 0, 'start'));
  const d = st.dealer, sb = (d + 1) % 3, bb = (d + 2) % 3;
  must(act(st, d, 'call')); must(act(st, sb, 'call')); must(act(st, bb, 'check'));
  for (let s = 0; s < 3; s++) for (const who of [sb, bb, d]) must(act(st, who, 'check'));
  assert.equal(st.phase, 'showdown');
  for (const p of st.players) { p.total += 1; p.chips -= 1; } // pot de 33 (impair) pour tester le partage
  const before = st.players.map((p) => p.chips);
  must(act(st, 0, 'award', { winners: [[bb, d]] }));
  // d est après bb dans l'ordre à gauche du bouton ? bb = d+2 passe avant d (d+3)
  assert.equal(st.players[bb].chips - before[bb], 17);
  assert.equal(st.players[d].chips - before[d], 16);
});

test('blindes automatiquement doublées, recave et sitout', () => {
  const st = newGame(2, { stack: 100, sb: 5, bb: 10, blindEvery: 2 });
  must(act(st, 0, 'start'));
  must(act(st, st.turn, 'fold'));
  must(act(st, 0, 'start'));
  assert.equal(st.config.bb, 10); // 2 mains par niveau
  must(act(st, st.turn, 'fold'));
  must(act(st, 0, 'start'));
  assert.equal(st.config.bb, 20);
  must(act(st, st.turn, 'fold'));
  must(act(st, 1, 'sitout', { out: true }));
  assert.equal(act(st, 0, 'start').error, 'not-enough');
  must(act(st, 1, 'sitout', { out: false }));
  assert.equal(act(st, 0, 'give', { player: 1, amount: -99999 }).error, 'bad-amount');
  assert.equal(act(st, 0, 'config', { stack: 5 }).error, 'hand-running'); // plus de changement de tapis après le début
});

test('croupier : réclamer le rôle, passer la main, départ du croupier', () => {
  const st = newGame(3);
  must(act(st, 2, 'croupier'));
  assert.equal(st.croupier, 2);
  assert.equal(act(st, 0, 'start').error, 'not-croupier');
  must(act(st, 2, 'start'));
  assert.equal(act(st, 1, 'croupier').error, 'hand-running');
  g.onLeave(st, 2);
  assert.notEqual(st.croupier, 2);
  assert.equal(st.players[2].folded, true);
});

test('quitter pendant son tour : la main continue', () => {
  const st = newGame(3, { stack: 100, sb: 5, bb: 10 });
  must(act(st, 0, 'start'));
  const t = st.turn;
  g.onLeave(st, t);
  assert.notEqual(st.turn, t);
  assert.equal(st.phase, 'betting');
});

test('fin de partie et vue spectateur sans action', () => {
  const st = newGame(10);
  assert.equal(g.maxPlayers, 10);
  const v = g.view(st, -1);
  assert.deepEqual(v.hints.actions, []);
  assert.equal(v.isCroupier, false);
  must(act(st, 0, 'end'));
  assert.equal(g.isOver(st), true);
});

// Parties aléatoires : les jetons ne se perdent ni ne se créent, quoi que fassent les joueurs.
test('conservation des jetons sur des mains aléatoires', () => {
  let seed = 7;
  const rnd = (k) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k; };
  for (let game = 0; game < 40; game++) {
    const k = 2 + rnd(9);
    const st = newGame(k, { stack: 50 + rnd(500), sb: 1 + rnd(5), bb: 6 + rnd(10) });
    const bank = st.players.reduce((t, p) => t + p.chips, 0);
    for (let hand = 0; hand < 6; hand++) {
      if (!act(st, st.croupier, 'start').ok) break;
      let guard = 0;
      while (st.phase === 'betting' && guard++ < 200) {
        const h = g.view(st, st.turn).hints;
        const pick = rnd(10);
        let r;
        if (pick < 2) r = act(st, st.turn, 'fold');
        else if (pick < 3) r = act(st, st.turn, 'allin');
        else if (pick < 5 && h.actions.includes('raise')) r = act(st, st.turn, 'raise', { to: h.minRaise + rnd(h.maxRaise - h.minRaise + 1) });
        else r = act(st, st.turn, h.actions.includes('check') ? 'check' : 'call');
        if (!r.ok && !['raise-too-small', 'cannot-raise'].includes(r.error)) assert.fail(`refus inattendu : ${r.error}`);
        if (!r.ok) act(st, st.turn, h.actions.includes('check') ? 'check' : 'call');
        assert.equal(total(st), bank);
      }
      assert.ok(guard < 200, 'la main ne se termine pas');
      if (st.phase === 'showdown') {
        const winners = g.view(st, 0).pots.map((p) => [p.eligible[rnd(p.eligible.length)]]);
        must(act(st, st.croupier, 'award', { winners }));
      }
      assert.equal(st.phase, 'between');
      assert.equal(total(st), bank);
    }
  }
});
