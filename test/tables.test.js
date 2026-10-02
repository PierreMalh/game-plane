'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createChat } = require('../server/chat');
const { createTables } = require('../server/tables');

function setup(ids = ['a', 'b', 'c']) {
  const players = new Map();
  for (const id of ids) {
    const got = [];
    players.set(id, { id, name: id.toUpperCase(), got, conn: { send: (t) => got.push(JSON.parse(t)) } });
  }
  const chat = createChat({ players });
  const broadcast = (m) => { for (const p of players.values()) p.conn.send(JSON.stringify(m)); };
  const tables = createTables({ players, chat, broadcast });
  const last = (id, type) => players.get(id).got.filter((m) => m.type === type).at(-1);
  return { players, chat, tables, last };
}
const drop = (tables, id, col) => tables.action(id, { type: 'drop', col });

test('création, rejoindre, démarrage automatique', () => {
  const { tables, last } = setup();
  assert.equal(tables.create('a', 'connect4').ok, true);
  assert.equal(tables.list()[0].status, 'waiting');
  assert.equal(last('a', 'table').table.status, 'waiting');
  assert.equal(last('c', 'tables').tables.length, 1); // visible de tous

  const id = tables.list()[0].id;
  assert.equal(tables.join('b', id).ok, true);
  const va = last('a', 'table').table;
  const vb = last('b', 'table').table;
  assert.equal(va.status, 'playing');
  assert.equal(va.me, 0);
  assert.equal(vb.me, 1);
  assert.equal(va.state.turn, 0);
});

test('refus : jeu inconnu, table inconnue/pleine, double place', () => {
  const { tables } = setup();
  assert.equal(tables.create('a', 'nope').error, 'unknown-game');
  assert.equal(tables.join('b', 'zzz').error, 'no-table');
  tables.create('a', 'connect4');
  assert.equal(tables.create('a', 'connect4').error, 'already-seated');
  const id = tables.list()[0].id;
  assert.equal(tables.join('a', id).error, 'already-seated');
  tables.join('b', id);
  assert.equal(tables.join('c', id).error, 'full');
});

test('coups : tour, hors table, hors partie', () => {
  const { tables } = setup();
  assert.equal(drop(tables, 'a', 0).error, 'no-game');
  tables.create('a', 'connect4');
  assert.equal(drop(tables, 'a', 0).error, 'no-game'); // en attente
  tables.join('b', tables.list()[0].id);
  assert.equal(drop(tables, 'b', 0).error, 'not-your-turn');
  assert.equal(drop(tables, 'a', 0).ok, true);
  assert.equal(drop(tables, 'c', 0).error, 'no-game'); // pas assis
});

test('partie complète jusqu’à la victoire, puis revanche avec premier joueur alterné', () => {
  const { tables, last } = setup();
  tables.create('a', 'connect4');
  tables.join('b', tables.list()[0].id);
  for (const [who, col] of [['a', 0], ['b', 1], ['a', 0], ['b', 1], ['a', 0], ['b', 1], ['a', 0]]) drop(tables, who, col);
  assert.equal(last('b', 'table').table.state.winner, 0);
  assert.equal(last('b', 'table').table.status, 'over');
  assert.equal(drop(tables, 'b', 2).error, 'no-game');

  tables.rematch('a');
  assert.equal(last('a', 'table').table.status, 'over'); // attend b
  assert.deepEqual(last('a', 'table').table.rematch, [0]);
  tables.rematch('b');
  const v = last('a', 'table').table;
  assert.equal(v.status, 'playing');
  assert.equal(v.state.turn, 1); // b commence la 2e manche
  assert.equal(v.state.winner, null);
  assert.equal(drop(tables, 'a', 0).error, 'not-your-turn');
});

test('quitter en attente ferme la table ; le canal de chat disparaît', () => {
  const { tables, chat } = setup();
  tables.create('a', 'connect4');
  const cid = `table:${tables.list()[0].id}`;
  assert.equal(chat.snapshot('a').channels.some((c) => c.id === cid), true);
  tables.leave('a');
  assert.equal(tables.list().length, 0);
  assert.equal(chat.snapshot('a').channels.some((c) => c.id === cid), false);
  assert.equal(tables.leave('a').error, 'not-seated');
});

test('quitter en pleine partie = forfait ; table fermée quand le dernier part', () => {
  const { tables, last } = setup();
  tables.create('a', 'connect4');
  tables.join('b', tables.list()[0].id);
  drop(tables, 'a', 0);
  tables.leave('a');
  assert.equal(last('a', 'table').table, null);
  const v = last('b', 'table').table;
  assert.equal(v.status, 'over');
  assert.equal(v.state.winner, 1);
  assert.equal(v.state.forfeit, true);
  assert.equal(v.left.length, 1);
  assert.equal(tables.rematch('b').error, 'no-rematch'); // adversaire parti
  // a peut recréer une table pendant que b regarde encore le résultat.
  assert.equal(tables.create('a', 'connect4').ok, true);
  tables.leave('b');
  assert.equal(tables.list().length, 1);
});

test('le chat de table n’est visible que des deux joueurs', () => {
  const { tables, chat, players } = setup();
  tables.create('a', 'connect4');
  const cid = `table:${tables.list()[0].id}`;
  tables.join('b', cid.slice(6));
  chat.send('a', cid, 'bien joué');
  assert.equal(players.get('b').got.filter((m) => m.type === 'chat').length, 1);
  assert.equal(players.get('c').got.filter((m) => m.type === 'chat').length, 0);
  assert.equal(chat.send('c', cid, 'intrus').ok, false);
});

test('joueur définitivement parti : forfait', () => {
  const { tables, last } = setup();
  tables.create('a', 'connect4');
  tables.join('b', tables.list()[0].id);
  tables.playerGone('b');
  assert.equal(last('a', 'table').table.state.winner, 0);
  tables.playerGone('zzz'); // inconnu : sans effet
});

test('échecs sur une table : mat, revanche avec couleurs inversées', () => {
  const { tables, last } = setup();
  tables.create('a', 'chess');
  tables.join('b', tables.list()[0].id);
  const mv = (who, from, to) => tables.action(who, { type: 'move', from, to });

  const v0 = last('a', 'table').table;
  assert.equal(v0.game, 'chess');
  assert.equal(v0.state.white, 0);
  assert.ok(v0.state.legal); // a a le trait
  assert.equal(last('b', 'table').table.state.legal, null);

  for (const [who, from, to] of [['a', 'f2', 'f3'], ['b', 'e7', 'e5'], ['a', 'g2', 'g4'], ['b', 'd8', 'h4']]) {
    assert.equal(mv(who, from, to).ok, true);
  }
  const over = last('a', 'table').table;
  assert.equal(over.status, 'over');
  assert.equal(over.state.winner, 1);
  assert.equal(mv('a', 'a2', 'a3').error, 'no-game');

  tables.rematch('a'); tables.rematch('b');
  const again = last('a', 'table').table;
  assert.equal(again.status, 'playing');
  assert.equal(again.state.white, 1); // b a maintenant les blancs
  assert.equal(again.state.legal, null);
  assert.equal(mv('a', 'e2', 'e4').error, 'not-your-turn');
  assert.equal(mv('b', 'e2', 'e4').ok, true);
});

test('échecs : abandonner donne la victoire à l’adversaire', () => {
  const { tables, last } = setup();
  tables.create('a', 'chess');
  tables.join('b', tables.list()[0].id);
  tables.leave('a');
  const v = last('b', 'table').table;
  assert.equal(v.state.winner, 1);
  assert.equal(v.state.reason, 'forfeit');
});

// ---- jeux à effectif variable (Business Class) ------------------------------------

test('effectif variable : démarrage manuel par l’hôte, 2 joueurs minimum', () => {
  const { tables, last } = setup(['a', 'b', 'c', 'd']);
  tables.create('a', 'monopoly');
  const t = tables.list()[0];
  assert.equal(t.min, 2);
  assert.equal(t.max, 6);
  assert.equal(t.manual, true);
  assert.equal(tables.start('a').error, 'not-enough');

  tables.join('b', t.id);
  assert.equal(last('a', 'table').table.status, 'waiting'); // pas de démarrage automatique
  tables.join('c', t.id);
  assert.equal(tables.start('b').error, 'not-host');
  assert.equal(tables.start('zzz').error, 'no-table');
  assert.equal(tables.start('a').ok, true);
  const v = last('c', 'table').table;
  assert.equal(v.status, 'playing');
  assert.equal(v.me, 2);
  assert.equal(v.state.players.length, 3);
  assert.equal(tables.join('d', t.id).error, 'full'); // partie commencée
  assert.equal(tables.start('a').error, 'no-table'); // déjà lancée
});

test('start refusé pour un jeu à démarrage automatique ; le puissance 4 démarre toujours plein', () => {
  const { tables } = setup();
  tables.create('a', 'connect4');
  assert.equal(tables.start('a').error, 'auto-start');
});

test('Business Class : un joueur qui part ne met pas fin à la partie', () => {
  const { tables, last } = setup();
  tables.create('a', 'monopoly');
  const id = tables.list()[0].id;
  tables.join('b', id); tables.join('c', id);
  tables.start('a');
  tables.leave('c');
  assert.equal(last('c', 'table').table, null);
  const v = last('a', 'table').table;
  assert.equal(v.status, 'playing');
  assert.equal(v.state.players[2].bankrupt, true);
  assert.equal(v.left.length, 1);
  assert.equal(tables.leave('b').ok, true); // il ne reste que a : a gagne
  const end = last('a', 'table').table;
  assert.equal(end.status, 'over');
  assert.equal(end.state.winner, 0);
});

test('Business Class : attente — le départ de l’hôte passe la main, table vide fermée', () => {
  const { tables, last } = setup();
  tables.create('a', 'monopoly');
  const id = tables.list()[0].id;
  tables.join('b', id);
  tables.leave('a');
  assert.equal(tables.list()[0].players[0].id, 'b');
  assert.equal(tables.start('b').error, 'not-enough');
  tables.leave('b');
  assert.equal(tables.list().length, 0);
  assert.equal(last('b', 'table').table, null);
});

test('Business Class : revanche entre les joueurs restants, les partis sont retirés', () => {
  const { tables, last } = setup();
  tables.create('a', 'monopoly');
  const id = tables.list()[0].id;
  tables.join('b', id); tables.join('c', id);
  tables.start('a');
  tables.leave('c');
  tables.leave('b'); // a gagne
  assert.equal(last('a', 'table').table.status, 'over');
  assert.equal(tables.rematch('a').error, 'no-rematch'); // seul : moins que minPlayers
});

test('Business Class : revanche à deux après le départ d’un tiers (les partis sont retirés)', () => {
  const { games } = require('../server/games');
  const g = games.get('monopoly');
  const realInit = g.init;
  // Partie scriptée : a (le joueur du tour) a 10 en poche et tombera sur la taxe de 200.
  g.init = (ids, o) => {
    const st = realInit(ids, { ...o, shuffle: false, rng: (() => { const d = [1, 3]; let i = 0; return () => (d[i++ % 2] - 1) / 6 + 0.01; })() });
    if (o.first === 0) st.players[0].cash = 10;
    return st;
  };
  try {
    const { tables, last } = setup();
    tables.create('a', 'monopoly');
    const id = tables.list()[0].id;
    tables.join('b', id); tables.join('c', id);
    tables.start('a');
    tables.leave('c');
    assert.equal(tables.action('a', { type: 'roll' }).ok, true); // 4 : taxe, a est à sec
    assert.equal(tables.action('a', { type: 'bankrupt' }).ok, true);
    const over = last('b', 'table').table;
    assert.equal(over.status, 'over');
    assert.equal(over.state.winner, 1);
    assert.equal(over.left.length, 1); // c est parti

    tables.rematch('a');
    assert.equal(last('a', 'table').table.status, 'over'); // attend b
    tables.rematch('b');
    const again = last('a', 'table').table;
    assert.equal(again.status, 'playing');
    assert.equal(again.state.players.length, 2); // c a été retiré
    assert.equal(again.left.length, 0);
    assert.equal(again.state.turn, 1); // b commence la manche suivante
    assert.equal(again.me, 0);
  } finally {
    g.init = realInit;
  }
});

// ---- jeux de cartes ---------------------------------------------------------------------

test('jeux de cartes : effectifs, démarrage par l’hôte, chaque joueur ne reçoit que sa main', () => {
  const cases = [['president', 3, 6], ['eights', 2, 6], ['liar', 3, 8]];
  for (const [game, min, max] of cases) {
    const { tables, last } = setup(['a', 'b', 'c']);
    tables.create('a', game);
    const t = tables.list()[0];
    assert.deepEqual([t.min, t.max, t.manual], [min, max, true], game);
    tables.join('b', t.id);
    if (min === 3) assert.equal(tables.start('a').error, 'not-enough', game);
    tables.join('c', t.id);
    assert.equal(tables.start('a').ok, true, game);

    const views = ['a', 'b', 'c'].map((id) => last(id, 'table').table);
    const hands = views.map((v) => v.state.hand);
    assert.ok(hands.every((h) => h.length > 0), game);
    // La main d'un joueur n'apparaît dans la vue d'aucun autre.
    views.forEach((v, i) => {
      const json = JSON.stringify(v);
      hands.forEach((h, j) => { if (j !== i) for (const c of h) assert.equal(json.includes(`"${c}"`), false, `${game} : ${c} fuit vers ${i}`); });
    });
  }
});

// ---- Belote : 4 joueurs fixes, démarrage automatique ------------------------------------------------

test('belote : démarre toute seule à 4 ; partir fait gagner l’équipe adverse ; pas de revanche à 3', () => {
  const { tables, last } = setup(['a', 'b', 'c', 'd']);
  tables.create('a', 'belote');
  const t = tables.list()[0];
  assert.deepEqual([t.min, t.max, t.manual], [4, 4, false]);
  tables.join('b', t.id); tables.join('c', t.id);
  assert.equal(last('a', 'table').table.status, 'waiting');
  tables.join('d', t.id);
  const v = last('a', 'table').table;
  assert.equal(v.status, 'playing'); // pas de bouton « Démarrer » : la table est pleine
  assert.equal(v.state.hand.length, 5);
  assert.equal(v.me, 0);
  assert.equal(last('c', 'table').table.me, 2); // 0 et 2 sont partenaires

  // Chaque joueur ne voit que sa main.
  const hands = ['a', 'b', 'c', 'd'].map((id) => last(id, 'table').table.state.hand);
  ['a', 'b', 'c', 'd'].forEach((id, i) => {
    const json = JSON.stringify(last(id, 'table').table);
    hands.forEach((h, j) => { if (j !== i) for (const c of h) assert.equal(json.includes(`"${c}"`), false); });
  });

  tables.leave('c'); // un joueur de l'équipe 0 part → l'équipe 1 gagne
  const end = last('a', 'table').table;
  assert.equal(end.status, 'over');
  assert.equal(end.state.winnerTeam, 1);
  assert.equal(end.left.length, 1);
  assert.equal(tables.rematch('a').error, 'no-rematch'); // à 3, impossible de rejouer
});
