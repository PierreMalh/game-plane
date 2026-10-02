'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createChat, RATE_MAX, HISTORY_LIMIT, MAX_TEXT } = require('../server/chat');

// Joueurs factices : la « connexion » enregistre ce qu'elle reçoit.
function setup(names = ['a', 'b', 'c']) {
  const players = new Map();
  let t = 1000;
  for (const n of names) {
    const got = [];
    players.set(n, { id: n, name: n.toUpperCase(), got, conn: { send: (txt) => got.push(JSON.parse(txt)) } });
  }
  const chat = createChat({ players, now: () => (t += 10) });
  return { players, chat, got: (n) => players.get(n).got, advance: (ms) => { t += ms; } };
}

test('le général est diffusé à tous, expéditeur compris', () => {
  const { chat, got } = setup();
  assert.equal(chat.send('a', 'general', 'salut').ok, true);
  for (const n of ['a', 'b', 'c']) {
    const m = got(n).find((x) => x.type === 'chat');
    assert.equal(m.channel, 'general');
    assert.equal(m.from, 'A');
    assert.equal(m.text, 'salut');
  }
});

test('canal par défaut : general', () => {
  const { chat, got } = setup();
  chat.send('a', undefined, 'x');
  assert.equal(got('b')[0].channel, 'general');
});

test('un privé n’est vu que par ses deux membres, avec l’id de l’interlocuteur', () => {
  const { chat, got } = setup();
  chat.send('a', 'dm:b', 'psst');
  assert.equal(got('c').length, 0);
  assert.equal(got('a')[0].channel, 'dm:b');
  assert.equal(got('b')[0].channel, 'dm:a');
  // Réponse : même historique partagé.
  chat.send('b', 'dm:a', 'quoi ?');
  assert.deepEqual(chat.snapshot('a').history['dm:b'].map((m) => m.text), ['psst', 'quoi ?']);
  assert.equal(chat.snapshot('c').history['dm:a'], undefined);
  assert.equal(chat.snapshot('c').history['dm:b'], undefined);
});

test('privé refusé : soi-même, joueur inconnu, canal inexistant', () => {
  const { chat } = setup();
  assert.equal(chat.send('a', 'dm:a', 'x').reason, 'channel');
  assert.equal(chat.send('a', 'dm:zzz', 'x').reason, 'channel');
  assert.equal(chat.send('a', 'nope', 'x').reason, 'channel');
  assert.equal(chat.send('a', 'dm:a|b', 'x').reason, 'channel'); // id interne non utilisable
  assert.equal(chat.send('a', 42, 'x').reason, 'channel');
});

test('canal de salon : seuls les membres reçoivent et peuvent écrire', () => {
  const { chat, got } = setup(['a', 'b', 'c', 'd']);
  assert.equal(chat.createChannel('loups', 'Loups', ['a', 'b']), true);
  assert.equal(got('a').at(-1).type, 'channel');
  assert.equal(got('c').length, 0);

  chat.send('a', 'loups', 'on mange qui ?');
  assert.equal(got('b').at(-1).text, 'on mange qui ?');
  assert.equal(got('c').length, 0);
  assert.equal(chat.send('c', 'loups', 'intrus').reason, 'channel');
  assert.equal(chat.snapshot('c').channels.some((c) => c.id === 'loups'), false);
  assert.equal(chat.snapshot('a').channels.some((c) => c.id === 'loups'), true);

  chat.removeChannel('loups');
  assert.equal(got('a').at(-1).type, 'channel-removed');
  assert.equal(chat.send('a', 'loups', 'x').reason, 'channel');
});

test('createChannel refuse les ids réservés ou déjà pris', () => {
  const { chat } = setup();
  assert.equal(chat.createChannel('dm:x', 'x', ['a']), false);
  assert.equal(chat.createChannel('general', 'x', ['a']), false);
  assert.equal(chat.createChannel('r', 'r', ['a']), true);
  assert.equal(chat.createChannel('r', 'r', ['a']), false);
  chat.removeChannel('general'); // le général ne se supprime pas
  assert.equal(chat.send('a', 'general', 'ok').ok, true);
});

test('texte nettoyé, tronqué ; vide refusé', () => {
  const { chat, got } = setup();
  assert.equal(chat.send('a', 'general', '   ').reason, 'empty');
  chat.send('a', 'general', '  hello  ');
  assert.equal(got('b').at(-1).text, 'hello');
  chat.send('a', 'general', 'x'.repeat(MAX_TEXT + 100));
  assert.equal(got('b').at(-1).text.length, MAX_TEXT);
});

test('limite de débit puis reprise après la fenêtre', () => {
  const { chat, advance } = setup();
  for (let i = 0; i < RATE_MAX; i++) assert.equal(chat.send('a', 'general', 'm' + i).ok, true);
  assert.equal(chat.send('a', 'general', 'trop').reason, 'rate');
  assert.equal(chat.send('b', 'general', 'autre joueur ok').ok, true);
  advance(6000);
  assert.equal(chat.send('a', 'general', 'de nouveau').ok, true);
});

test('historique plafonné', () => {
  const { chat, players, advance } = setup(['a']);
  for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
    players.get('a').chatTimes = []; // contourne le débit pour ce test
    chat.send('a', 'general', 'm' + i);
    advance(1);
  }
  const h = chat.snapshot('a').history.general;
  assert.equal(h.length, HISTORY_LIMIT);
  assert.equal(h.at(-1).text, 'm' + (HISTORY_LIMIT + 19));
});

test('« écrit… » : relayé aux autres membres, jamais stocké, limité', () => {
  const { chat, got, advance } = setup();
  chat.typing('a', 'general');
  assert.equal(got('a').length, 0); // pas à l'expéditeur
  assert.deepEqual(got('b')[0], { type: 'typing', channel: 'general', from: 'A', id: 'a' });
  chat.typing('a', 'general'); // trop rapproché
  assert.equal(got('b').length, 1);
  advance(1500);
  chat.typing('a', 'general');
  assert.equal(got('b').length, 2);
  assert.deepEqual(chat.snapshot('b').history.general, []);

  advance(1500);
  chat.typing('a', 'dm:b'); // ne crée pas de canal privé
  assert.equal(chat.snapshot('a').channels.some((c) => c.kind === 'dm'), false);
});

test('oubli d’un joueur : ses privés disparaissent, il quitte les salons', () => {
  const { chat } = setup();
  chat.send('a', 'dm:b', 'x');
  chat.createChannel('r', 'R', ['a', 'b']);
  chat.forget('a');
  assert.equal(chat.snapshot('b').channels.some((c) => c.kind === 'dm'), false);
  chat.send('b', 'r', 'seul');
  assert.equal(chat.snapshot('a').channels.some((c) => c.id === 'r'), false);
});

test('étiquette d’un privé = pseudo de l’interlocuteur', () => {
  const { chat } = setup();
  chat.send('a', 'dm:b', 'x');
  assert.equal(chat.snapshot('a').channels.find((c) => c.kind === 'dm').label, 'B');
  assert.equal(chat.snapshot('b').channels.find((c) => c.kind === 'dm').label, 'A');
});
