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
