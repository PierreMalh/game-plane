'use strict';
// Spectateurs : regarder une table sans y jouer, vue publique uniquement.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createChat } = require('../server/chat');
const { createTables } = require('../server/tables');
const { games } = require('../server/games');

function setup(ids = ['a', 'b', 'c', 'd', 'e']) {
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

// Partie de Puissance 4 lancée entre a et b ; renvoie l'id de la table.
function connect4(tables) {
  tables.create('a', 'connect4');
  const id = tables.list()[0].id;
  tables.join('b', id);
  return id;
}

test('regarder une partie : vue publique, liste des spectateurs, mises à jour', () => {
  const { tables, last } = setup();
  const id = connect4(tables);
  assert.equal(tables.spectate('c', id).ok, true);
  const v = last('c', 'table').table;
  assert.equal(v.spectator, true);
  assert.equal(v.me, -1);
  assert.equal(v.status, 'playing');
  assert.deepEqual(v.spectators.map((p) => p.id), ['c']);
  // Les joueurs voient qui regarde, et le salon aussi.
  assert.deepEqual(last('a', 'table').table.spectators.map((p) => p.name), ['C']);
  assert.equal(last('e', 'tables').tables[0].spectators.length, 1);

  // Un coup est poussé au spectateur.
  tables.action('a', { type: 'drop', col: 3 });
  assert.equal(last('c', 'table').table.state.board[5][3], 0);
});

test('un spectateur ne peut ni jouer, ni demander la revanche', () => {
  const { tables } = setup();
  const id = connect4(tables);
  tables.spectate('c', id);
  assert.equal(tables.action('c', { type: 'drop', col: 0 }).error, 'no-game');
  assert.equal(tables.rematch('c').error, 'no-rematch');
  assert.equal(tables.start('c').error, 'no-table');
});

test('refus : table inconnue, joueur déjà assis', () => {
  const { tables } = setup();
  const id = connect4(tables);
  assert.equal(tables.spectate('c', 'zzz').error, 'no-table');
  assert.equal(tables.spectate('a', id).error, 'already-seated');
  assert.equal(tables.spectate('c', id).ok, true);
  assert.equal(tables.spectate('c', id).ok, true); // idempotent
  assert.equal(tables.list()[0].spectators.length, 1);
});

test('chat de la table : le spectateur y entre et en sort', () => {
  const { tables, chat, last } = setup();
  const id = connect4(tables);
  tables.spectate('c', id);
  assert.equal(last('c', 'channel').channel.id, `table:${id}`);
  assert.equal(chat.send('c', `table:${id}`, 'allez !').ok, true);
  assert.equal(last('a', 'chat').text, 'allez !');

  assert.equal(tables.leave('c').ok, true); // « Arrêter de regarder »
  assert.equal(last('c', 'table').table, null);
  assert.equal(last('c', 'channel-removed').id, `table:${id}`);
  assert.equal(chat.send('c', `table:${id}`, 'encore').ok, false);
  assert.deepEqual(last('a', 'table').table.spectators, []);
  // Le départ du spectateur ne touche pas à la partie.
  assert.equal(tables.list()[0].status, 'playing');
});

test('changer de table regardée, puis créer sa propre table', () => {
  const { tables, last } = setup(['a', 'b', 'c', 'd', 'e']);
  const t1 = connect4(tables);
  tables.create('c', 'chess');
  const t2 = tables.list().find((t) => t.id !== t1).id;
  tables.join('d', t2);

  tables.spectate('e', t1);
  tables.spectate('e', t2);
  assert.deepEqual(last('a', 'table').table.spectators, []);
  assert.equal(last('e', 'table').table.id, t2);

  assert.equal(tables.create('e', 'connect4').ok, true);
  assert.deepEqual(last('c', 'table').table.spectators, []);
  assert.equal(last('e', 'table').table.spectator, false);
  assert.equal(last('e', 'table').table.me, 0);
});

test('un spectateur peut prendre une place libre', () => {
  const { tables, last } = setup();
  tables.create('a', 'connect4');
  const id = tables.list()[0].id;
  tables.spectate('b', id);
  assert.equal(last('b', 'table').table.status, 'waiting');
  assert.equal(tables.join('b', id).ok, true);
  const v = last('b', 'table').table;
  assert.equal(v.spectator, false);
  assert.equal(v.me, 1);
  assert.equal(v.status, 'playing');
  assert.deepEqual(v.spectators, []);
});

test('table fermée : les spectateurs reviennent au salon', () => {
  const { tables, last } = setup();
  const id = connect4(tables);
  tables.spectate('c', id);
  tables.leave('a'); // forfait
  assert.equal(last('c', 'table').table.state.forfeit, true);
  tables.leave('b'); // plus personne d'assis : table fermée
  assert.equal(last('c', 'table').table, null);
  assert.equal(tables.list().length, 0);
  assert.equal(tables.viewFor('c'), null);
  // Libre de regarder ou créer ailleurs.
  assert.equal(tables.create('c', 'connect4').ok, true);
});

test('revanche : le spectateur reste et voit la nouvelle manche', () => {
  const { tables, last } = setup();
  const id = connect4(tables);
  tables.spectate('c', id);
  for (const [p, col] of [['a', 0], ['b', 1], ['a', 0], ['b', 1], ['a', 0], ['b', 1], ['a', 0]]) tables.action(p, { type: 'drop', col });
  assert.equal(last('c', 'table').table.status, 'over');
  tables.rematch('a');
  tables.rematch('b');
  const v = last('c', 'table').table;
  assert.equal(v.status, 'playing');
  assert.equal(v.spectator, true);
});

test('spectateur parti pour de bon : retiré de la table', () => {
  const { tables, last } = setup();
  const id = connect4(tables);
  tables.spectate('c', id);
  tables.playerGone('c');
  assert.deepEqual(last('a', 'table').table.spectators, []);
  assert.equal(tables.viewFor('c'), null);
});

// Aucune information cachée ne doit fuiter vers un spectateur : pas de main, pas de mot,
// aucune action proposée, pour chaque jeu.
test('vue spectateur de chaque jeu : aucune main, aucun mot, aucune action', () => {
  for (const [id, g] of games) {
    const ids = Array.from({ length: g.maxPlayers }, (_, i) => `p${i}`);
    const st = g.init(ids, { first: 0 });
    const v = g.view(st, -1);
    if ('hand' in v) assert.deepEqual(v.hand, [], id);
    if (v.hints) assert.deepEqual(v.hints.actions, [], id);
    if (id === 'chess') assert.equal(v.legal, null);
    if (id === 'impostor') {
      assert.equal(v.me, null);
      assert.equal(v.words, null);
    }
    // Jeux de cartes : aucune carte d'une main n'apparaît dans la vue.
    const hands = st.hands ?? (st.players ?? []).map((p) => p.hand ?? []);
    const text = JSON.stringify(v);
    for (const card of hands.flat()) assert.ok(!text.includes(`"${card}"`), `${id} : ${card} visible`);
  }
});
