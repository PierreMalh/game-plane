'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('../server/server');

let srv;
// Serveur neuf à chaque test : le salon est unique, on évite les fuites d'état.
beforeEach(async () => { srv = await start({ port: 0, host: '127.0.0.1', heartbeatMs: 100000 }); });
afterEach(async () => { await srv.close(); });

// Client de test : WebSocket natif de Node, avec file d'attente de messages.
function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
  const queue = [];
  const waiters = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    const w = waiters.shift();
    if (w) w(msg); else queue.push(msg);
  });
  const client = {
    ws,
    open: new Promise((r) => ws.addEventListener('open', r)),
    closed: new Promise((r) => ws.addEventListener('close', (ev) => r(ev.code))),
    send: (obj) => ws.send(JSON.stringify(obj)),
    // Attend le prochain message vérifiant le prédicat (ignore les autres).
    next: async (pred = () => true) => {
      for (;;) {
        const msg = queue.length ? queue.shift() : await new Promise((r) => waiters.push(r));
        if (pred(msg)) return msg;
      }
    },
  };
  return client;
}

async function join(name, id) {
  const c = connect();
  await c.open;
  c.send({ type: 'join', name, id });
  c.welcome = await c.next((m) => m.type === 'welcome');
  return c;
}

test('sert la page d’accueil et refuse la sortie de public/', async () => {
  const ok = await fetch(`http://127.0.0.1:${srv.port}/`);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Game Plane/);

  const missing = await fetch(`http://127.0.0.1:${srv.port}/nope.html`);
  assert.equal(missing.status, 404);

  // fetch normalise les « .. » : on passe par une requête brute.
  const http = require('http');
  const status = await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: srv.port, path: '/%2e%2e/server/server.js' },
      (res) => { res.resume(); resolve(res.statusCode); });
    req.end();
  });
  assert.ok(status === 403 || status === 404);
});

test('un joueur rejoint et reçoit la liste', async () => {
  const a = await join('Alice');
  assert.ok(a.welcome.id);
  assert.deepEqual(a.welcome.players.map((p) => p.name), ['Alice']);
  a.ws.close();
});

test('la présence et le chat sont diffusés à tous', async () => {
  const a = await join('Alice');
  const b = await join('Bob');

  const seen = await a.next((m) => m.type === 'players' && m.players.length === 2);
  assert.deepEqual(seen.players.map((p) => p.name).sort(), ['Alice', 'Bob']);

  b.send({ type: 'chat', text: 'salut' });
  const got = await a.next((m) => m.type === 'chat');
  assert.equal(got.from, 'Bob');
  assert.equal(got.text, 'salut');
  const echo = await b.next((m) => m.type === 'chat');
  assert.equal(echo.text, 'salut');

  a.ws.close(); b.ws.close();
});

test('un message avant join est ignoré', async () => {
  const a = await join('Alice');
  const c = connect();
  await c.open;
  c.send({ type: 'chat', text: 'intrus' });
  c.send({ type: 'join', name: 'Carl' });
  await c.next((m) => m.type === 'welcome');
  // Alice ne doit voir aucun chat « intrus ».
  c.send({ type: 'chat', text: 'ok' });
  const msg = await a.next((m) => m.type === 'chat');
  assert.equal(msg.text, 'ok');
  a.ws.close(); c.ws.close();
});

test('reconnexion avec le même id : même place, ancienne socket remplacée', async () => {
  const a = await join('Alice');
  const observer = await join('Obs');
  const again = await join('Alice', a.welcome.id);

  assert.equal(again.welcome.id, a.welcome.id);
  assert.equal(await a.closed, 4000);
  const names = again.welcome.players.filter((p) => p.name === 'Alice');
  assert.equal(names.length, 1);
  assert.equal(names[0].online, true);

  // Un message de la nouvelle socket arrive à l'observateur.
  again.send({ type: 'chat', text: 'de retour' });
  const msg = await observer.next((m) => m.type === 'chat');
  assert.equal(msg.from, 'Alice');
  again.ws.close(); observer.ws.close();
});

test('un joueur déconnecté reste listé hors ligne', async () => {
  const a = await join('Alice');
  const b = await join('Bob');
  b.ws.close();
  const m = await a.next((x) => x.type === 'players' && x.players.some((p) => p.name === 'Bob' && !p.online));
  assert.ok(m);
  a.ws.close();
});

test('pseudo nettoyé et message tronqué', async () => {
  const a = await join('   ' + 'x'.repeat(50) + '  ');
  assert.equal(a.welcome.players.find((p) => p.id === a.welcome.id).name.length, 20);
  a.send({ type: 'chat', text: 'y'.repeat(2000) });
  const m = await a.next((x) => x.type === 'chat');
  assert.equal(m.text.length, 500);
  a.ws.close();
});

test('trames fragmentées et longues (>125 octets, >64 Kio refusé)', async () => {
  const a = await join('Alice');
  a.send({ type: 'chat', text: 'z'.repeat(300) }); // trame à longueur sur 16 bits
  const m = await a.next((x) => x.type === 'chat');
  assert.equal(m.text.length, 300);

  a.ws.send('a'.repeat(70 * 1024)); // dépasse MAX_PAYLOAD
  assert.equal(await a.closed, 1009);
});

test('un client non WebSocket sur /ws est rejeté', async () => {
  const res = await fetch(`http://127.0.0.1:${srv.port}/ws`);
  assert.equal(res.status, 404);
});

test('une URL malformée ne fait pas planter le serveur', async () => {
  const net = require('net');
  await new Promise((resolve) => {
    const s = net.connect(srv.port, '127.0.0.1', () => s.write('GET http://[ HTTP/1.1\r\nHost: x\r\n\r\n'));
    s.on('data', () => {}); s.on('close', resolve); s.on('error', resolve);
    setTimeout(() => { s.destroy(); resolve(); }, 300);
  });
  const res = await fetch(`http://127.0.0.1:${srv.port}/`);
  assert.equal(res.status, 200);
});

test('chat : le privé ne fuit pas, l’historique revient à la reconnexion', async () => {
  const a = await join('Alice');
  const b = await join('Bob');
  const c = await join('Carl');

  a.send({ type: 'chat', channel: `dm:${b.welcome.id}`, text: 'secret' });
  const got = await b.next((m) => m.type === 'chat');
  assert.equal(got.channel, `dm:${a.welcome.id}`);
  assert.equal(got.text, 'secret');

  c.send({ type: 'chat', text: 'public' });
  const seenByC = await c.next((m) => m.type === 'chat');
  assert.equal(seenByC.text, 'public'); // Carl n'a rien reçu du privé avant

  // Bob se reconnecte : il retrouve général + privé avec l'historique.
  b.ws.close();
  const b2 = await join('Bob', b.welcome.id);
  const chat = b2.welcome.chat;
  assert.deepEqual(chat.history.general.map((m) => m.text), ['public']);
  assert.deepEqual(chat.history[`dm:${a.welcome.id}`].map((m) => m.text), ['secret']);
  // Carl, lui, ne voit que le général.
  assert.equal(c.welcome.chat.channels.length, 1);
  for (const x of [a, b2, c]) x.ws.close();
});

test('chat : « écrit… » et limite de débit via le serveur', async () => {
  const a = await join('Alice');
  const b = await join('Bob');
  a.send({ type: 'typing', channel: 'general' });
  const t = await b.next((m) => m.type === 'typing');
  assert.equal(t.from, 'Alice');

  for (let i = 0; i < 12; i++) a.send({ type: 'chat', text: 'spam' + i });
  const err = await a.next((m) => m.type === 'chat-error');
  assert.equal(err.reason, 'rate');
  a.ws.close(); b.ws.close();
});
