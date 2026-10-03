'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('../server/server');
const { createCardSkin, MAX_BYTES } = require('../server/card-skin');

// Plus petit PNG valide (1×1) et une signature JPEG suffisante pour la détection.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

let dir;
let srv;
const url = (p) => `http://127.0.0.1:${srv.port}${p}`;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-cards-'));
  srv = await start({ port: 0, host: '127.0.0.1', heartbeatMs: 100000, cardsDir: dir });
});
afterEach(async () => {
  await srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function join(name) {
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
  const queue = [];
  const waiters = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    const w = waiters.shift();
    if (w) w(msg); else queue.push(msg);
  });
  const next = async (pred) => {
    for (;;) {
      const msg = queue.length ? queue.shift() : await new Promise((r) => waiters.push(r));
      if (pred(msg)) return msg;
    }
  };
  await new Promise((r) => ws.addEventListener('open', r));
  ws.send(JSON.stringify({ type: 'join', name }));
  const welcome = await next((m) => m.type === 'welcome');
  return { ws, next, welcome };
}

test('envoi d’une image : stockée sur l’hôte, servie, diffusée à tous', async () => {
  const a = await join('Alice');
  assert.deepEqual(a.welcome.cardSkin, {});

  const put = await fetch(url('/api/cards/AS'), { method: 'PUT', body: PNG, headers: { 'Content-Type': 'image/png' } });
  assert.equal(put.status, 200);
  assert.ok(fs.existsSync(path.join(dir, 'AS.png')));

  const msg = await a.next((m) => m.type === 'card-skin');
  assert.deepEqual(Object.keys(msg.skin), ['AS']);

  const img = await fetch(url(`/custom-cards/AS?v=${msg.skin.AS}`));
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);

  // Un joueur arrivé après reçoit le jeu dans son accueil.
  const b = await join('Bob');
  assert.deepEqual(b.welcome.cardSkin, msg.skin);
  a.ws.close(); b.ws.close();
});

test('remplacer change de format et de version, retirer revient à l’origine', async () => {
  await fetch(url('/api/cards/back'), { method: 'PUT', body: PNG });
  const v1 = srv.app.cardSkin.list().back;
  await fetch(url('/api/cards/back'), { method: 'PUT', body: JPG });
  assert.ok(srv.app.cardSkin.list().back > v1);
  assert.deepEqual(fs.readdirSync(dir), ['back.jpg']); // l'ancien PNG est supprimé

  const del = await fetch(url('/api/cards/back'), { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.deepEqual(srv.app.cardSkin.list(), {});
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal((await fetch(url('/custom-cards/back'))).status, 404);
});

test('tout retirer efface le dossier', async () => {
  await fetch(url('/api/cards/10H'), { method: 'PUT', body: PNG });
  await fetch(url('/api/cards/QC'), { method: 'PUT', body: JPG });
  assert.equal(fs.readdirSync(dir).length, 2);
  assert.equal((await fetch(url('/api/cards'), { method: 'DELETE' })).status, 200);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('refuse carte inconnue, format non image, fichier trop lourd, chemins piégés', async () => {
  const bad = await fetch(url('/api/cards/ZZ'), { method: 'PUT', body: PNG });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'bad-card');

  const txt = await fetch(url('/api/cards/AS'), { method: 'PUT', body: 'pas une image' });
  assert.equal((await txt.json()).error, 'bad-format');

  const huge = Buffer.concat([PNG, Buffer.alloc(MAX_BYTES)]);
  const big = await fetch(url('/api/cards/AS'), { method: 'PUT', body: huge });
  assert.equal(big.status, 413);

  const trap = await fetch(url('/api/cards/..%2F..%2Fserver'), { method: 'PUT', body: PNG });
  assert.equal(trap.status, 400);
  assert.equal((await fetch(url('/custom-cards/..%2Fpackage.json'))).status, 404);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('les images déjà envoyées sont retrouvées au redémarrage', () => {
  fs.writeFileSync(path.join(dir, 'KD.png'), PNG);
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignoré');
  fs.writeFileSync(path.join(dir, 'XX.png'), PNG); // clé inconnue : ignorée
  const skin = createCardSkin({ dir });
  assert.deepEqual(Object.keys(skin.list()), ['KD']);
  assert.equal(skin.get('KD').mime, 'image/png');
});

test('la page statique reste servie', async () => {
  const res = await fetch(url('/deck-editor.js'));
  assert.equal(res.status, 200);
});
